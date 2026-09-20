from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

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

  token_rows = (
    db.query(
      models.TokenUsage.id_user,
      func.coalesce(func.sum(models.TokenUsage.prompt_tokens), 0),
      func.coalesce(func.sum(models.TokenUsage.output_tokens), 0),
    )
    .group_by(models.TokenUsage.id_user)
    .all()
  )

  tokens_par_user = {
    id_user: {"prompt": prompt, "output": output, "total": prompt + output}
    for id_user, prompt, output in token_rows
  }

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
      "tokens": tokens_par_user.get(
        user.id_user, {"prompt": 0, "output": 0, "total": 0}
      ),
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

  token_row = (
    db.query(
      func.coalesce(func.sum(models.TokenUsage.prompt_tokens), 0),
      func.coalesce(func.sum(models.TokenUsage.output_tokens), 0),
      func.count(models.TokenUsage.id_usage),
    )
    .filter(models.TokenUsage.id_user == user_id)
    .first()
  )

  prompt_tokens, output_tokens, nb_appels = token_row

  feature_rows = (
    db.query(
      models.TokenUsage.feature,
      func.coalesce(
        func.sum(models.TokenUsage.prompt_tokens + models.TokenUsage.output_tokens), 0
      ),
      func.count(models.TokenUsage.id_usage),
    )
    .filter(models.TokenUsage.id_user == user_id)
    .group_by(models.TokenUsage.feature)
    .all()
  )
  
  return {
    "id_user": user.id_user,
    "nom_user": user.nom_user,
    "prenom_user": user.prenom_user,
    "email_user": user.email_user,
    "userName_user": user.userName,
    "role_user": user.role,
    "creation_date": user.creation_date,
    "tracked_procs": [
      {
        "id_up": tp.id_user_procedure,
        "status": tp.status,
        "titre_proc": tp.procedure.titre_proc,
        "administration": tp.procedure.administration.nom_administration
                          if tp.procedure.administration else None,
      }
      for tp in user.tracked
    ],
    "tracked_count": len(user.tracked),
    "tokens": {
      "prompt": prompt_tokens,
      "output": output_tokens,
      "total": prompt_tokens + output_tokens,
      "nb_appels": nb_appels,
    },
    "tokens_par_feature": [
      {"feature": feature, "total": total, "nb_appels": nb}
      for feature, total, nb in feature_rows
    ],
  }

@router.get("/admin/tokens/daily")
def tokens_by_user_daily(
  days: int = 30,
  top: int = 10,
  current_user: models.User = Depends(require_admin),
  db: Session = Depends(get_db),
):
  since = datetime.now() - timedelta(days=days)

  # 1. les plus gros consommateurs sur la période
  total_col = func.coalesce(
    func.sum(models.TokenUsage.prompt_tokens + models.TokenUsage.output_tokens), 0
  )

  top_rows = (
    db.query(models.TokenUsage.id_user, total_col.label("total"))
    .filter(models.TokenUsage.date_usage >= since)
    .filter(models.TokenUsage.id_user.isnot(None))
    .group_by(models.TokenUsage.id_user)
    .order_by(total_col.desc())
    .limit(top)
    .all()
  )

  top_ids = [row[0] for row in top_rows]
  totaux = {row[0]: row[1] for row in top_rows}

  if not top_ids:
    return {"series": [], "days": days}

  # 2. détail quotidien, uniquement pour ces utilisateurs
  rows = (
    db.query(
      models.TokenUsage.id_user,
      models.User.userName,
      func.date(models.TokenUsage.date_usage).label("jour"),
      func.coalesce(func.sum(models.TokenUsage.prompt_tokens), 0).label("prompt"),
      func.coalesce(func.sum(models.TokenUsage.output_tokens), 0).label("output"),
    )
    .join(models.User, models.User.id_user == models.TokenUsage.id_user)
    .filter(models.TokenUsage.date_usage >= since)
    .filter(models.TokenUsage.id_user.in_(top_ids))
    .group_by(
      models.TokenUsage.id_user,
      models.User.userName,
      func.date(models.TokenUsage.date_usage),
    )
    .all()
  )

  # 3. remplir les jours sans activité avec des zéros
  jours = [(since + timedelta(days=i)).date() for i in range(days + 1)]

  par_user = {}
  for id_user, username, jour, prompt, output in rows:
    par_user.setdefault(id_user, {"userName": username, "jours": {}})
    par_user[id_user]["jours"][jour] = {"prompt": prompt, "output": output}

  series = []
  for id_user in top_ids:
    data = par_user.get(id_user)
    if data is None:
      continue
    points = []
    for jour in jours:
      valeurs = data["jours"].get(jour, {"prompt": 0, "output": 0})
      points.append({
        "date": jour.isoformat(),
        "prompt": valeurs["prompt"],
        "output": valeurs["output"],
        "total": valeurs["prompt"] + valeurs["output"],
      })
    series.append({
      "id_user": id_user,
      "userName": data["userName"],
      "total": totaux[id_user],
      "points": points,
    })

  return {"series": series, "days": days}