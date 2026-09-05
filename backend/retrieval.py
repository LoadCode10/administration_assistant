from sqlalchemy import select
from sqlalchemy.orm import Session
import models
from embedding import embed_text

CONFIDENCE_DISTANCE_THRESHOLD = 0.5

SUGGESTIONS_COUNT = 3


def search_procedures(db: Session, question: str, top_k: int = SUGGESTIONS_COUNT):
  """Returns a list of (Procedure, cosine_distance) tuples, closest first."""
  q_vector = embed_text(question)
  distance = models.Procedure.embedding.cosine_distance(q_vector)
  statement = (
    select(models.Procedure, distance.label("distance"))
    .order_by(distance)
    .limit(top_k)
  )
  return list(db.execute(statement).all())


def find_match_or_suggestions(db: Session, question: str):
  """
  Pure retrieval, no LLM generation. Returns either:
    ("answer", matched_procedure)
    ("suggestions", [procedure, ...])
    ("empty", None) if the DB has no embedded procedures at all
  """
  results = search_procedures(db, question, top_k=SUGGESTIONS_COUNT)

  if not results:
    return "empty", None

  best_procedure, best_distance = results[0]

  if best_distance <= CONFIDENCE_DISTANCE_THRESHOLD:
    return "answer", best_procedure

  suggestions = [procedure for procedure, _ in results]
  return "suggestions", suggestions
