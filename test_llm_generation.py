import os
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer
from sqlalchemy import select
from google import genai
from database import SessionLocal
import models

load_dotenv()

print("Loading model...")
embed_model = SentenceTransformer("BAAI/bge-m3")
llm_client = genai.Client(
  api_key=os.environ["GEMINI_API_KEY"]
)
print("Ready.")

def my_retriever(session, question, top_k=3):
  q_vector = embed_model.encode(question)
  statement = (
    select(models.Procedure)
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

def answer_question(question):
  session = SessionLocal()
  try:
    retrieved_procedures = my_retriever(session, question)
    retrieved_facts = build_facts(retrieved_procedures)

    # print(retrieved_facts)

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
    {retrieved_facts}

    QUESTION DE L'UTILISATEUR:
    {question}

    RÉPONSE:"""

    response = llm_client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
    )
    return response.text
  finally:
    session.close()

if __name__ == "__main__":
  question = "Comment Demander le Certificat négatif ?"
  print(f"\nQuestion: {question}\n")
  print(answer_question(question))
