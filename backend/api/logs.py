from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload

from database import get_db
import models
from core.security import require_admin

router = APIRouter(tags=["logs"])

@router.get("/admin/logs")
def list_logs(
  action: str | None = None,
  user_id: str | None = None,
  limit: int = Query(default=100, le=500),
  current_user: models.User = Depends(require_admin),
  db: Session = Depends(get_db),
):
  query = db.query(models.Log).options(joinedload(models.Log.user))

  if action is not None:
    query = query.filter(models.Log.action == action)
  if user_id is not None:
    query = query.filter(models.Log.id_user == user_id)

  rows = (
    query
    .order_by(models.Log.date_log.desc())
    .limit(limit)
    .all()
  )

  return [{
    "id_log": log.id_log,
    "action": log.action,
    "entity_type": log.entity_type,
    "entity_id": log.entity_id,
    "detail": log.detail,
    "ip_address": log.ip_address,
    "user_agent": log.user_agent,
    "method": log.method,
    "path": log.path,
    "date_log": log.date_log,
    "user_role": log.user_role,
    "user": {
      "id_user": log.user.id_user,
      "userName": log.user.userName,
      "role": log.user.role,
    } if log.user else None,
  } for log in rows]