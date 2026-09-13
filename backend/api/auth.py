from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from database import get_db
import models, schemas

from core.security import (
  hash_password, verify_password, create_acces_token,
  get_current_user,JWT_EXPIRE_HOURS,
)
from core.logging import write_log

from core.limiter import limiter

router = APIRouter(tags=["auth"])

@router.post("/auth/register")
@limiter.limit("3/hour")
def register_user(
  request: Request,
  user_inputs: schemas.UserCreate,
  db: Session= Depends(get_db)
):
  existing = db.query(models.User).filter_by(
    userName = user_inputs.userName 
  ).first()
  if existing is not None:
    write_log(
      db, request, None, action="register_failed",
      detail=f"Nom d'utilisateur déjà pris : {user_inputs.userName}"
    )
    db.commit()
    raise HTTPException(status_code=409, detail="already exist")

  existing = db.query(models.User).filter_by(
    email_user = user_inputs.email_user
  ).first()
  if existing is not None:
    write_log(
      db, request, None, action="register_failed",
      detail=f"Email déjà utilisé : {user_inputs.email_user}"
    )
    db.commit()
    raise HTTPException(status_code=409, detail="already used")

  new_user = models.User(
    nom_user = user_inputs.nom_user,
    prenom_user = user_inputs.prenom_user,
    userName = user_inputs.userName,
    phone_user = user_inputs.phone_user,
    email_user = user_inputs.email_user,
    password_hash = hash_password(user_inputs.password),
  )

  db.add(new_user)
  db.flush()

  write_log(
    db, request, new_user, action="register",
    entity_type="user", entity_id=new_user.id_user,
    detail=f"{new_user.userName} registred"
  )

  db.commit()
  db.refresh(new_user)

  return {
    "message": "Compte créé avec succès",
    "id_user" : new_user.id_user
  }

@router.post("/auth/login")
@limiter.limit("5/minute")
def login_user(
  request: Request,
  credentials: schemas.UserLogin,
  response: Response,
  db: Session= Depends(get_db)
):
  foundedUser = db.query(models.User).filter_by(
    userName = credentials.userName
  ).first()
  if foundedUser is None or not foundedUser.password_hash:
    write_log(
      db, request, None, action="login_failed",
      detail=f"Utilisateur inconnu : {credentials.userName}"
    )
    db.commit()
    raise HTTPException(status_code=401, detail="Identifiants incorrects")

  verified = verify_password(credentials.password, foundedUser.password_hash)
  if not verified:
    write_log(
      db, request, None, action="login_failed",
      detail="Mot de passe incorrect"
    )
    db.commit()
    raise HTTPException(status_code=401, detail="Identifiants incorrects")

  token = create_acces_token(
    {
      "sub": foundedUser.id_user,
      "role": foundedUser.role
    }
  )

  response.set_cookie(
    key="access_token",
    value=token,
    httponly=True,
    samesite="lax",
    max_age=JWT_EXPIRE_HOURS * 3600,
    path="/",
  )

  write_log(
    db, request, foundedUser, action="login",
    entity_type="user", entity_id=foundedUser.id_user, detail="user login"
  )
  db.commit()

  return{
    "user": {
      "id_user": foundedUser.id_user,
      "nom_user": foundedUser.nom_user,
      "prenom_user": foundedUser.prenom_user,
      "email_user": foundedUser.email_user,
      "role": foundedUser.role,
    }
  }

@router.get("/citizen/me")
def get_me(current_user: models.User = Depends(get_current_user)):
  return {
    "id_user": current_user.id_user,
    "nom_user": current_user.nom_user,
    "prenom_user": current_user.prenom_user,
    "email_user": current_user.email_user,
    "role": current_user.role,
  }

@router.post("/auth/logout", status_code=204)
def logout(
  request: Request,
  response: Response,
  current_user: models.User = Depends(get_current_user),
  db: Session= Depends(get_db)
):
  write_log(
    db, request, current_user, action="logout",
    entity_type="user", entity_id=current_user.id_user,
    detail="user logout"
  )
  db.commit()
  response.delete_cookie("access_token", path="/")
