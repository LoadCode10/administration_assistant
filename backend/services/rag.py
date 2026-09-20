import os

from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer
from sqlalchemy import select
from sqlalchemy.orm import Session
from google import genai

import models

load_dotenv()

print("Chargement du modèle d'embedding...")
embed_model = SentenceTransformer("BAAI/bge-m3")
print("Modèle chargé.")

llm_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

def my_retriever(session, question, top_k=3):
  q_vector = embed_model.encode(question)
  statement = (
    select(models.Procedure)
    .where(models.Procedure.statut_proc == "active")
    .order_by(models.Procedure.embedding.cosine_distance(q_vector))
    .limit(top_k)
  )
  return session.execute(statement).scalars().all()

def build_facts(procedures):
  blocks = []
  for p in procedures:

    steps = "\n".join(
      f"{e.ordre_etape}. {e.description_etape}"
      for e in sorted(p.etapes, key=lambda e: e.ordre_etape)
    )

    pieces = "\n".join(
      f" -{piece.nom_piece}"
      for piece in p.pieces
    )

    blocks.append(
      f"PROCÉDURE: {p.titre_proc}\n"
      f"Administration: {p.administration.nom_administration}\n"
      f"Frais: {p.frais_proc or 'non spécifié'}\n"
      f"Délai: {p.delai_proc or 'non spécifié'}\n"
      f"Documents requis:\n{pieces}\n"
      f"Étapes:\n{steps}"
    )
  return "\n\n---\n\n".join(blocks)

def generate_answer(question: str, facts: str) -> str:
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
      model="gemini-2.5-flash",
      contents=prompt,
  )

  usage = response.usage_metadata
  tokens_usage = {
    "prompt_tokens": usage.prompt_token_count if usage else None,
    "output_tokens": usage.candidates_token_count if usage else None,
    "total_tokens": usage.total_token_count if usage else None,
  }
  return response.text, tokens_usage

def build_text_for_embedding(procedure):
  combined_parts = [procedure.titre_proc]
  for etape in procedure.etapes:
    combined_parts.append(etape.description_etape)
  for piece in procedure.pieces:
    combined_parts.append(piece.nom_piece)
  return " ".join(combined_parts)

def embedding_all_procedures(session):
  all_procedures = session.query(models.Procedure).filter(
    models.Procedure.embedding.is_(None)
  ).all()
  for procedure in all_procedures:
    proc_text = build_text_for_embedding(procedure)
    proc_vector = embed_model.encode(proc_text)
    procedure.embedding = proc_vector
    print(f"Embedded: {procedure.titre_proc}")
  session.commit()
  print(f"All procedures embedded and saved.")
  return len(all_procedures)