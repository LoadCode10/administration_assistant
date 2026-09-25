import os
import re

from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from google import genai

import models

load_dotenv()

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


def my_retriever(session, question, top_k=3):
  q_vector = embed_model.encode(question)
  statement = (
    select(models.Procedure)
    .options(
      selectinload(models.Procedure.administration),
      selectinload(models.Procedure.etapes),
      selectinload(models.Procedure.pieces),
    )
    .where(models.Procedure.statut_proc == "active")
    .where(models.Procedure.embedding.is_not(None))
    .order_by(models.Procedure.embedding.cosine_distance(q_vector))
    .limit(top_k)
  )
  return session.execute(statement).scalars().all()


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
  all_procedures = session.query(models.Procedure).filter(
    models.Procedure.embedding.is_(None)
  ).all()
  for procedure in all_procedures:
    proc_text = build_text_for_embedding(procedure)
    procedure.embedding = embed_model.encode(proc_text)
    print(f"Embedded: {procedure.titre_proc_fr}")
  session.commit()
  print("All procedures embedded and saved.")
  return len(all_procedures)