"""
Keyword search (BM25) over procedures, in French and Arabic.

Vector search finds procedures with a similar *meaning*; BM25 finds procedures that share the
*exact words* of the question (a document name, an acronym like "CNSS", a legal reference).
rag.py combines both ("hybrid search").

The corpus is small (a few thousand procedures at most), so the index is built in memory from
the database and cached. It is rebuilt after `invalidate()` (called when new procedures are
embedded) or after CACHE_TTL_SECONDS, so renamed administrations are picked up too.
"""
import math
import re
import threading
import time
import unicodedata
from collections import Counter

from sqlalchemy.orm import selectinload

import models

CACHE_TTL_SECONDS = 300

# BM25 parameters (standard values)
K1 = 1.5
B = 0.75

# The title says what the procedure *is*: count it several times so it weighs more
TITLE_WEIGHT = 3

_ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
_ARABIC_LETTERS = str.maketrans({
    "ى": "ي",   # alef maqsura -> ya
    "ة": "ه",   # ta marbuta -> ha
    "ـ": None,  # tatweel
})
_ARABIC_PREFIXES = ("وال", "بال", "كال", "فال", "لل", "ال")

_STOPWORDS = {
    # French
    "le", "la", "les", "un", "une", "des", "du", "de", "d", "l", "et", "ou", "en", "au", "aux",
    "a", "à", "pour", "par", "sur", "dans", "avec", "sans", "ce", "cette", "ces", "est", "sont",
    "je", "j", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "me", "m", "mon", "ma",
    "mes", "son", "sa", "ses", "leur", "leurs", "qui", "que", "qu", "quoi", "quel", "quelle",
    "quels", "quelles", "comment", "combien", "est", "ce", "faut", "il", "veux", "voudrais",
    "dois", "doit", "peux", "puis", "faire", "avoir", "etre", "pas", "ne", "plus", "tout", "tous",
    "s", "y", "c", "n",
    # Arabic (after normalization)
    "في", "من", "الي", "علي", "عن", "مع", "هذا", "هذه", "ذلك", "تلك", "التي", "الذي", "ان",
    "او", "و", "ما", "ماذا", "كيف", "كم", "هل", "لا", "انا", "نحن", "انت", "هو", "هي", "اريد",
    "يجب", "اود", "لي", "به", "بها", "له", "لها", "كل", "بعد", "قبل", "عند", "اجل", "حول",
}


def normalize(text: str) -> str:
    """Lowercase, remove French accents and Arabic diacritics, unify Arabic letter forms."""
    text = (text or "").lower().translate(_ARABIC_DIGITS)
    # NFKD splits "é" -> "e" + accent and "أ" -> "ا" + hamza; drop the combining marks
    # (this also removes Arabic harakat such as fatha, damma, shadda)
    text = "".join(ch for ch in unicodedata.normalize("NFKD", text) if not unicodedata.combining(ch))
    text = text.translate(_ARABIC_LETTERS)
    return text.replace("’", "'")


def _stem(token: str) -> str:
    # Arabic: strip the definite article ("الشهادة" -> "شهاده", "بالمجان" -> "مجان")
    for prefix in _ARABIC_PREFIXES:
        if token.startswith(prefix) and len(token) - len(prefix) >= 3:
            return token[len(prefix):]
    # French: very light plural stemming ("pièces" -> "piece", "animaux" stays readable)
    if token.isascii() and len(token) > 4 and token[-1] in "sx":
        return token[:-1]
    return token


def tokenize(text: str) -> list[str]:
    tokens = re.findall(r"\w+", normalize(text))
    return [_stem(t) for t in tokens if len(t) > 1 and t not in _STOPWORDS]


def procedure_text(p) -> str:
    """The text indexed for one procedure, in both languages."""
    parts = [p.titre_proc_fr, p.titre_proc_ar] * TITLE_WEIGHT
    parts += [p.description_proc_fr, p.description_proc_ar]
    if p.administration:
        parts += [p.administration.nom_administration_fr, p.administration.nom_administration_ar]
    parts += [x for piece in p.pieces for x in (piece.nom_piece_fr, piece.nom_piece_ar)]
    parts += [x for e in p.etapes for x in (e.description_etape_fr, e.description_etape_ar)]
    return " ".join(part for part in parts if part)


class BM25Index:
    def __init__(self, docs: dict[str, list[str]]):
        self.ids = list(docs)
        self.tf = [Counter(docs[i]) for i in self.ids]
        self.lengths = [len(docs[i]) for i in self.ids]
        self.avg_len = (sum(self.lengths) / len(self.lengths)) if self.lengths else 0.0
        df = Counter(term for counts in self.tf for term in counts)
        n = len(self.ids)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}

    def search(self, query_tokens: list[str], limit: int) -> list[tuple[str, float]]:
        terms = [t for t in set(query_tokens) if t in self.idf]
        if not terms:
            return []
        scores = []
        for idx, counts in enumerate(self.tf):
            score = 0.0
            norm = K1 * (1 - B + B * self.lengths[idx] / self.avg_len)
            for t in terms:
                f = counts.get(t)
                if f:
                    score += self.idf[t] * f * (K1 + 1) / (f + norm)
            if score > 0:
                scores.append((self.ids[idx], score))
        scores.sort(key=lambda x: x[1], reverse=True)
        return scores[:limit]


_lock = threading.Lock()
_index: BM25Index | None = None
_built_at = 0.0


def invalidate() -> None:
    """Forces a rebuild on the next search (call it after procedures are added or changed)."""
    global _index
    with _lock:
        _index = None


def _get_index(session) -> BM25Index:
    global _index, _built_at
    with _lock:
        if _index is not None and time.monotonic() - _built_at < CACHE_TTL_SECONDS:
            return _index
    procedures = (
        session.query(models.Procedure)
        .options(
            selectinload(models.Procedure.administration),
            selectinload(models.Procedure.pieces),
            selectinload(models.Procedure.etapes),
        )
        .filter(models.Procedure.statut_proc == "active")
        .all()
    )
    index = BM25Index({p.id_procedure: tokenize(procedure_text(p)) for p in procedures})
    with _lock:
        _index, _built_at = index, time.monotonic()
    return index


def keyword_search(session, question: str, limit: int = 20) -> list[tuple[str, float]]:
    """Returns [(id_procedure, score)] ranked by BM25 score, best first."""
    return _get_index(session).search(tokenize(question), limit)
