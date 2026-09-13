from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
import models
from core.security import require_admin

router = APIRouter(tags=["users"])

@router.get("/admin/users")
def list_all_users(current_user : models.User = Depends(require_admin),db: Session= Depends(get_db)):
  users_row = (
    db.query(models.User)
    .order_by(models.User.creation_date.desc())
    .all()
  )
  users = []
  for user in users_row:
    users.append({
      "id_user": user.id_user,
      "nom_user": user.nom_user,
      "prenom_user": user.prenom_user,
      "email_user": user.email_user,
      "userName_user": user.userName,
      "role_user": user.role,
      "creation_date": user.creation_date,
      "tracked_count": len(user.tracked),
      "conversations_count": len(user.conversations),
    })

  return users

@router.get("/admin/users/{user_id}")
def list_user_infos(
  user_id: str,
  current_user : models.User = Depends(require_admin),
  db: Session= Depends(get_db)
):
  user = db.query(models.User).filter_by(
    id_user = user_id
  ).first()

  if user is None:
    raise HTTPException(status_code=404, detail="Utilisateur introuvable")
  
  return({
    "id_user": user.id_user,
    "nom_user": user.nom_user,
    "prenom_user": user.prenom_user,
    "email_user": user.email_user,
    "userName_user": user.userName,
    "role_user": user.role,
    "creation_date": user.creation_date,
    "tracked_procs":[
      {
        "id_up": tp.id_user_procedure,
        "status": tp.status,
        "titre_proc": tp.procedure.titre_proc,
        "administration": tp.procedure.administration.nom_administration if tp.procedure.administration else None,
      } for tp in user.tracked
    ] ,
    "tracked_count": len(user.tracked)
  })