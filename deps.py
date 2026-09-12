import hashlib
from datetime import datetime
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from database import get_db
import models

def hash_token(token: str) -> str:
  return hashlib.sha256(token.encode()).hexdigest()

def get_current_user(request: Request, db: Session = Depends(get_db)) -> models.User:
  token = request.cookies.get("session_token")
  if not token:
    raise HTTPException(status_code=401, detail="Non authentifié")

  session = db.query(models.UserSession).filter_by(
    token_hash=hash_token(token)
  ).first()

  if session is None or session.expires_at < datetime.now():
    raise HTTPException(status_code=401, detail="Session invalide ou expirée")

  return session.user

def require_admin(user: models.User = Depends(get_current_user)) -> models.User:
  if user.role != models.UserRole.admin:
    raise HTTPException(status_code=403, detail="Accès réservé aux administrateurs")
  return user
