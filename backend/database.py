import os
from dotenv import load_dotenv
from sqlalchemy import URL, create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

load_dotenv()

DATABASE_URL = URL.create(
  "postgresql+psycopg2",
  username=os.environ["DB_USER"],
  password=os.environ["DB_PASSWORD"],   
  host=os.environ["DB_HOST"],
  port=int(os.environ["DB_PORT"]),
  database=os.environ["DB_NAME"],
)

engine = create_engine(DATABASE_URL, echo=False)

SessionLocal = sessionmaker(bind=engine)

class Base(DeclarativeBase):
  pass

def get_db():
  db = SessionLocal()
  try:
    yield db
  finally:
    db.close()