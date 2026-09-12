import os
import secrets
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session
from database import get_db
from deps import get_current_user, hash_token
from security import hash_password, verify_password
import models
import schemas

router = APIRouter(prefix="/auth", tags=["auth"])

SESSION_EXPIRE_HOURS = 24
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"

@router.post("/register", response_model=schemas.UserOut, status_code=201)
def register(payload: schemas.RegisterIn, db: Session = Depends(get_db)):
  existing = db.query(models.User).filter_by(email_user=payload.email).first()
  if existing is not None:
    raise HTTPException(status_code=409, detail="Cet email est déjà utilisé")

  user = models.User(
    nom_user=payload.nom,
    prenom_user=payload.prenom,
    email_user=payload.email,
    password_hash=hash_password(payload.password),
    role=models.UserRole.user.value,
  )
  db.add(user)
  db.commit()
  db.refresh(user)
  return user

@router.post("/login", response_model=schemas.UserOut)
def login(payload: schemas.LoginIn, response: Response, db: Session = Depends(get_db)):
  user = db.query(models.User).filter_by(email_user=payload.email).first()

  if user is None or not user.password_hash or not verify_password(payload.password, user.password_hash):
    raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect")

  token = secrets.token_urlsafe(32)
  session = models.UserSession(
    token_hash=hash_token(token),
    id_user=user.id_user,
    expires_at=datetime.now() + timedelta(hours=SESSION_EXPIRE_HOURS),
  )
  db.add(session)
  db.commit()

  response.set_cookie(
    key="session_token",
    value=token,
    httponly=True,
    samesite="lax",
    secure=COOKIE_SECURE,
    max_age=SESSION_EXPIRE_HOURS * 3600,
  )
  return user

@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
  token = request.cookies.get("session_token")
  if token:
    db.query(models.UserSession).filter_by(token_hash=hash_token(token)).delete()
    db.commit()
  response.delete_cookie("session_token")

@router.get("/me", response_model=schemas.UserOut)
def me(user: models.User = Depends(get_current_user)):
  return user
