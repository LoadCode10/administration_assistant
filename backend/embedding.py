from sentence_transformers import SentenceTransformer
import models

_model: SentenceTransformer | None = None


def get_embedding_model() -> SentenceTransformer:
  global _model
  if _model is None:
    _model = SentenceTransformer("BAAI/bge-m3")
  return _model


def build_text_for_embedding(procedure: "models.Procedure") -> str:
  combined_parts = [procedure.titre_proc]
  for etape in procedure.etapes:
    combined_parts.append(etape.description_etape)
  for piece in procedure.pieces:
    combined_parts.append(piece.nom_piece)
  return " ".join(combined_parts)


def embed_text(text: str):
  return get_embedding_model().encode(text)


def embed_procedure(procedure: "models.Procedure") -> None:
  procedure.embedding = embed_text(build_text_for_embedding(procedure))
