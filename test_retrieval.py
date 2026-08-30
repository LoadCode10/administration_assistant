from sentence_transformers import SentenceTransformer
from sqlalchemy import select
from database import SessionLocal
import models

print("Loading model...")
model = SentenceTransformer("BAAI/bge-m3")
print("Model loaded")

def retrieve_matched_proc(question, top_k=3):
  question_vector = model.encode(question)

  session = SessionLocal()
  try:
    stmt = (
      select(models.Procedure)
      .order_by(models.Procedure.embedding.cosine_distance(question_vector))
      .limit(top_k)
    )

    results = session.execute(stmt).scalars().all()
    return results
  finally:
    session.close()

if __name__ == "__main__":
  user_question = "كيفية إنشاء شركة أو مقاولة بالمغرب"
  print(f"\nQuestion: {user_question}")
  matched_procedures = retrieve_matched_proc(user_question)
  for i, proc in enumerate(matched_procedures, start=1):
    print(f"{i}. {proc.titre_proc}")