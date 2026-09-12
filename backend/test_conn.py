from sqlalchemy import text
from backend.database import engine

with engine.connect() as conn:
  result = conn.execute(text("SELECT 'connection works'"))
  print(result.scalar())

