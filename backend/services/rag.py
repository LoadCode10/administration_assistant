import logging
import os
import re

from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer
from sqlalchemy import inspect, select
from sqlalchemy.orm import selectinload
from google import genai

import models
from services import keyword_search

load_dotenv()

logger = logging.getLogger(__name__)

print("Chargement du modèle d'embedding...")
embed_model = SentenceTransformer("BAAI/bge-m3")
print("Modèle chargé.")

llm_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

LLM_MODEL = "gemini-2.5-flash"

_ARABIC_CHARS = re.compile(r"[\u0600-\u06FF]")


def detect_lang(text: str) -> str:
  """Returns 'ar' if the text contains Arabic script, otherwise 'fr'."""
  return "ar" if _ARABIC_CHARS.search(text or "") else "fr"


def pick(fr: str | None, ar: str | None, lang: str) -> str | None:
  """Returns the value in the requested language, falling back to the other one."""
  if lang == "ar":
    return ar or fr
  return fr or ar


# ---------------------------------------------------------------------------
# Retrieval
#   "vector"  : meaning-based search with bge-m3 embeddings (pgvector)
#   "keyword" : exact-word search with BM25 (services/keyword_search.py)
#   "hybrid"  : both, merged with Reciprocal Rank Fusion (default)
# Set RETRIEVAL_MODE in .env to switch without changing code.
# ---------------------------------------------------------------------------
RETRIEVAL_MODES = ("vector", "keyword", "hybrid")
RETRIEVAL_MODE = os.environ.get("RETRIEVAL_MODE", "hybrid")
if RETRIEVAL_MODE not in RETRIEVAL_MODES:
  raise ValueError(f"RETRIEVAL_MODE doit être l'un de {RETRIEVAL_MODES}, reçu : {RETRIEVAL_MODE!r}")

# How many candidates each search contributes before fusion
CANDIDATES = 20
# RRF constant: 60 is the value from the original paper and works well without tuning
RRF_K = 60


def vector_search_ids(session, question: str, limit: int = CANDIDATES) -> list[str]:
  q_vector = embed_model.encode(question)
  statement = (
    select(models.Procedure.id_procedure)
    .where(models.Procedure.statut_proc == "active")
    .where(models.Procedure.embedding.is_not(None))
    .order_by(models.Procedure.embedding.cosine_distance(q_vector))
    .limit(limit)
  )
  return list(session.execute(statement).scalars().all())


def keyword_search_ids(session, question: str, limit: int = CANDIDATES) -> list[str]:
  return [pid for pid, _score in keyword_search.keyword_search(session, question, limit)]


def reciprocal_rank_fusion(rankings: list[list[str]], k: int = RRF_K) -> list[str]:
  """
  Merges several ranked lists: each procedure gets sum(1 / (k + rank)) over the lists it
  appears in. A procedure found by both searches rises to the top; one found by only one
  search is still kept. Only ranks are used, so the two score scales never need comparing.
  """
  scores: dict[str, float] = {}
  for ranking in rankings:
    for rank, pid in enumerate(ranking, start=1):
      scores[pid] = scores.get(pid, 0.0) + 1.0 / (k + rank)
  return sorted(scores, key=scores.get, reverse=True)


def retrieve_ids(session, question: str, top_k: int = 3, mode: str | None = None) -> list[str]:
  """Ranked procedure ids for a question. Used by my_retriever and by the evaluation script."""
  mode = mode or RETRIEVAL_MODE
  if mode == "vector":
    return vector_search_ids(session, question)[:top_k]
  if mode == "keyword":
    return keyword_search_ids(session, question)[:top_k]
  fused = reciprocal_rank_fusion([
    vector_search_ids(session, question),
    keyword_search_ids(session, question),
  ])
  return fused[:top_k]


def my_retriever(session, question, top_k=3, mode: str | None = None):
  # Ask for a few extra ids: some may have become obsolete since the keyword index was built
  ids = retrieve_ids(session, question, top_k + 5, mode)
  if not ids:
    return []
  statement = (
    select(models.Procedure)
    .options(
      selectinload(models.Procedure.administration),
      selectinload(models.Procedure.etapes),
      selectinload(models.Procedure.pieces),
    )
    # Re-check the status: the keyword index can be a few minutes old
    .where(models.Procedure.statut_proc == "active")
    .where(models.Procedure.id_procedure.in_(ids))
  )
  by_id = {p.id_procedure: p for p in session.execute(statement).scalars().all()}
  return [by_id[pid] for pid in ids if pid in by_id][:top_k]


def build_facts(procedures, lang: str = "fr"):
  unspecified = "غير محدد" if lang == "ar" else "non spécifié"
  blocks = []
  for p in procedures:
    steps = "\n".join(
      f"{e.ordre_etape}. {pick(e.description_etape_fr, e.description_etape_ar, lang) or ''}"
      for e in sorted(p.etapes, key=lambda e: e.ordre_etape)
    )

    pieces = "\n".join(
      f" - {pick(piece.nom_piece_fr, piece.nom_piece_ar, lang)}"
      for piece in p.pieces
    )

    admin_name = (
      pick(p.administration.nom_administration_fr, p.administration.nom_administration_ar, lang)
      if p.administration else unspecified
    )

    blocks.append(
      f"PROCÉDURE: {pick(p.titre_proc_fr, p.titre_proc_ar, lang)}\n"
      f"Description: {pick(p.description_proc_fr, p.description_proc_ar, lang) or unspecified}\n"
      f"Administration: {admin_name}\n"
      f"Frais: {pick(p.frais_proc_fr, p.frais_proc_ar, lang) or unspecified}\n"
      f"Délai: {pick(p.delai_proc_fr, p.delai_proc_ar, lang) or unspecified}\n"
      f"Documents requis:\n{pieces or unspecified}\n"
      f"Étapes:\n{steps or unspecified}"
    )
  return "\n\n---\n\n".join(blocks)


def generate_answer(question: str, facts: str) -> tuple[str, dict]:
  prompt = f"""Tu es un assistant administratif marocain. Tu réponds aux
  citoyens en te basant UNIQUEMENT sur les informations officielles fournies
  ci-dessous. Tu n'inventes JAMAIS d'information.

  RÈGLES:
  - Réponds dans la MÊME LANGUE que la question de l'utilisateur.
  - Utilise UNIQUEMENT les faits fournis. Ne devine pas.
  - Si aucune procédure fournie ne correspond à la question, dis clairement
    que tu n'as pas cette information.
  - Cite le nom de l'administration comme source.

  PROCÉDURES OFFICIELLES DISPONIBLES:
  {facts}

  QUESTION DE L'UTILISATEUR:
  {question}

  RÉPONSE:"""

  response = llm_client.models.generate_content(
    model=LLM_MODEL,
    contents=prompt,
  )

  usage = response.usage_metadata
  tokens_usage = {
    "prompt_tokens": usage.prompt_token_count if usage else None,
    "output_tokens": usage.candidates_token_count if usage else None,
    "total_tokens": usage.total_token_count if usage else None,
  }
  return response.text, tokens_usage


def build_text_for_embedding(procedure) -> str:
  """Combines French and Arabic text so questions in either language match."""
  parts = [
    procedure.titre_proc_fr,
    procedure.titre_proc_ar,
    procedure.description_proc_fr,
    procedure.description_proc_ar,
  ]
  for etape in sorted(procedure.etapes, key=lambda e: e.ordre_etape):
    parts.append(etape.description_etape_fr)
    parts.append(etape.description_etape_ar)
  for piece in procedure.pieces:
    parts.append(piece.nom_piece_fr)
    parts.append(piece.nom_piece_ar)
  # Nullable columns (description, etapes) can be None, which would break join()
  return " ".join(part for part in parts if part)


def embedding_all_procedures(session):
  pending = session.query(models.Procedure).filter(
    models.Procedure.embedding.is_(None)
  ).all()
  total = len(pending)
  done, failed = 0, []

  for i, procedure in enumerate(pending, start=1):
    pid = inspect(procedure).identity[0]   # no DB access: works even if the row was deleted meanwhile
    try:
      procedure.embedding = embed_model.encode(build_text_for_embedding(procedure))
      session.commit()                     # saved right away: nothing is lost if we stop later
      done += 1
    except Exception as e:
      session.rollback()                   # cancel only this procedure, keep the others
      logger.exception("Embedding failed for procedure %s", pid)
      failed.append((pid, f"{type(e).__name__}: {e}"))
    if i % 10 == 0 or i == total:
      print(f"Embedding : {i}/{total} ({len(failed)} en erreur)", flush=True)

  keyword_search.invalidate()
  for pid, error in failed:
    print(f"  ÉCHEC {pid}: {error}")
  return done

# EMBED_BATCH = 32

# def embedding_all_procedures(session):
#   pending = session.query(models.Procedure).filter(models.Procedure.embedding.is_(None)).all()
#   done = 0
#   for start in range(0, len(pending), EMBED_BATCH):
#     batch = pending[start:start + EMBED_BATCH]
#     vectors = embed_model.encode([build_text_for_embedding(p) for p in batch],
#                                  batch_size=16, show_progress_bar=False)
#     for procedure, vector in zip(batch, vectors):
#       procedure.embedding = vector
#     session.commit()                       # saved now: an interruption only loses this batch
#     done += len(batch)
#     print(f"Embedding : {done}/{len(pending)} procédures")
#   keyword_search.invalidate()
#   return done

# def embedding_all_procedures(session):
#   all_procedures = session.query(models.Procedure).filter(
#     models.Procedure.embedding.is_(None)
#   ).all()
#   if not all_procedures:
#     return 0
#   texts = [build_text_for_embedding(p) for p in all_procedures]
#   vectors = embed_model.encode(texts, batch_size=16, show_progress_bar=False)
#   for procedure, vector in zip(all_procedures, vectors):
#     procedure.embedding = vector
#   session.commit()
#   # New procedures must also become searchable by keyword right away
#   keyword_search.invalidate()
#   print(f"{len(all_procedures)} procedures embedded and saved.")
#   return len(all_procedures)
