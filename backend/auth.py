from passlib.context import CryptContext
from jose import jwt, JWTError
from dotenv import load_dotenv
from datetime import datetime, timedelta, timezone
import os
load_dotenv()

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")
JWT_EXPIRE_HOURS = int(os.environ.get("JWT_EXPIRE_HOURS", 168))

pwd_context = CryptContext(schemes=["bcrypt"])

def hash_password(password: str) -> str:
  return pwd_context.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
  return pwd_context.verify(plain, hashed)

def create_acces_token(data: dict) -> dict:
  payload = data.copy()
  expire = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS)
  payload["exp"] = expire
  return jwt.encode(
    payload,
    JWT_SECRET,
    algorithm=JWT_ALGORITHM
  )

def decode_acces_token(token: str) -> dict | None:
  try:
    return jwt.decode(
      token,
      JWT_SECRET,
      algorithms=[JWT_ALGORITHM]
    )
  except JWTError as e:
    print("JWT decode error:", e)
    return None