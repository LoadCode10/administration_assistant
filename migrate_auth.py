from sqlalchemy import text
from database import engine, Base
import models

Base.metadata.create_all(engine)

with engine.begin() as conn:
  conn.execute(text(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR NOT NULL DEFAULT 'user'"
  ))

print("Migration complete: sessions table ready, users.role added.")
