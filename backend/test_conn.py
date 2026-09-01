from sqlalchemy import text
from database import engine

with engine.connect() as conn:
  result = conn.execute(text("SELECT 'connection works'"))
  print(result.scalar())

