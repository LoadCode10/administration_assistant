from sentence_transformers import SentenceTransformer
from database import SessionLocal
import models

print("Loading model...")
model = SentenceTransformer("BAAI/bge-m3")
print("model loaded")

def build_text_for_embedding(procedure):
  combined_parts = [procedure.titre_proc]
  for etape in procedure.etapes:
    combined_parts.append(etape.description_etape)
  for piece in procedure.pieces:
    combined_parts.append(piece.nom_piece)
  return " ".join(combined_parts)

def embedding_all_procedures(session):
  # session = SessionLocal()
  all_procedures = session.query(models.Procedure).filter(
    models.Procedure.embedding.is_(None)
  ).all()
  # all_procedures = session.query(models.Procedure).all()
  for procedure in all_procedures:
    proc_text = build_text_for_embedding(procedure)
    proc_vector = model.encode(proc_text)
    procedure.embedding = proc_vector
    print(f"Embedded: {procedure.titre_proc}")
  session.commit()
  print(f"All procedures embedded and saved.")
  return len(all_procedures)

if __name__ == "__main__":
  embedding_all_procedures()