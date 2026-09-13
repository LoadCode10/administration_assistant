import os
from datetime import datetime, timedelta, timezone

from fastapi import Cookie, Depends, HTTPException
from sqlalchemy.orm import Session
from passlib.context import CryptContext
from jose import jwt, JWTError
from dotenv import load_dotenv

from database import get_db
import models

load_dotenv()

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")
JWT_EXPIRE_HOURS = int(os.environ.get("JWT_EXPIRE_HOURS", 168))

pwd_context = CryptContext(schemes=["bcrypt"])

def hash_password(password: str) -> str:
  return pwd_context.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
  return pwd_context.verify(plain, hashed)

def create_acces_token(data: dict) -> str:
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
  except JWTError:
    return None

def get_current_user(
  access_token: str | None = Cookie(default=None),
  db: Session = Depends(get_db)
) -> models.User:
  
  if not access_token:
    raise HTTPException(status_code=401, detail="Non authentifié")

  payload = decode_acces_token(access_token)
  if payload is None:
    raise HTTPException(status_code=401, detail="Session invalide ou expirée")

  user = db.query(models.User).filter_by(
    id_user = payload.get("sub")
  ).first()
  if user is None:
    raise HTTPException(status_code=401, detail="Utilisateur introuvable")
  
  return user

def require_admin(current_user: models.User= Depends(get_current_user)) -> models.User:
  if current_user.role != "admin":
    raise HTTPException(status_code=403, detail="Accès réservé aux administrateurs")
  return current_user