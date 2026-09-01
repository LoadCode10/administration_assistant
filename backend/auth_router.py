import os
from datetime import datetime, timedelta
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session
from database import get_db
from deps import get_current_user
import models
import schemas
from security import (
  hash_password,
  verify_password,
  generate_session_token,
  hash_token,
  SESSION_EXPIRE_HOURS,
  SESSION_COOKIE_NAME,
)

router = APIRouter(prefix="/auth", tags=["auth"])

COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"


@router.post("/register", response_model=schemas.UserOut, status_code=status.HTTP_201_CREATED)
def register(payload: schemas.UserRegisterIn, db: Session = Depends(get_db)):
  existing = db.query(models.User).filter_by(email_user=payload.email_user).first()
  if existing is not None:
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

  user = models.User(
    nom_user=payload.nom_user,
    prenom_user=payload.prenom_user,
    email_user=payload.email_user,
    phone_user=payload.phone_user,
    hashed_password=hash_password(payload.password),
    role=models.UserRole.user,
  )
  db.add(user)
  db.commit()
  db.refresh(user)
  return user


@router.post("/login", response_model=schemas.UserOut)
def login(payload: schemas.UserLoginIn, response: Response, db: Session = Depends(get_db)):
  user = db.query(models.User).filter_by(email_user=payload.email_user).first()
  if user is None or not verify_password(payload.password, user.hashed_password):
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail="Incorrect email or password",
    )

  raw_token = generate_session_token()
  session = models.Session(
    token_hash=hash_token(raw_token),
    id_user=user.id_user,
    expires_at=datetime.now() + timedelta(hours=SESSION_EXPIRE_HOURS),
  )
  db.add(session)
  db.commit()

  response.set_cookie(
    key=SESSION_COOKIE_NAME,
    value=raw_token,
    httponly=True,
    samesite="lax",
    secure=COOKIE_SECURE,
    max_age=SESSION_EXPIRE_HOURS * 3600,
    path="/",
  )
  return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
  response: Response,
  session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
  db: Session = Depends(get_db),
):
  if session_token is not None:
    db.query(models.Session).filter_by(token_hash=hash_token(session_token)).delete()
    db.commit()
  response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")


@router.get("/me", response_model=schemas.UserOut)
def me(current_user: models.User = Depends(get_current_user)):
  return current_user
