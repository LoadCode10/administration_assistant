from datetime import datetime
from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.orm import Session as DbSession
from database import get_db
from security import hash_token, SESSION_COOKIE_NAME
import models


def get_current_user(
  session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
  db: DbSession = Depends(get_db),
) -> models.User:
  if session_token is None:
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail="Not authenticated",
    )

  session = db.query(models.Session).filter_by(
    token_hash=hash_token(session_token)
  ).first()

  if session is None or session.expires_at < datetime.now():
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail="Invalid or expired session",
    )

  return session.user


def require_admin(
  current_user: models.User = Depends(get_current_user),
) -> models.User:
  if current_user.role != models.UserRole.admin:
    raise HTTPException(
      status_code=status.HTTP_403_FORBIDDEN,
      detail="Admin access required",
    )
  return current_user
