from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from database import get_db
import models
from core.security import get_current_user, require_admin
from core import quota
from services import notifier

router = APIRouter(tags=["alerts"])


@router.get("/citizen/quota")
def my_quota(
  db: Session = Depends(get_db),
  current_user: models.User = Depends(get_current_user),
):
  """The logged-in user's usage today."""
  return quota.usage_snapshot(db, current_user)


@router.get("/admin/quota")
def users_quota(
  db: Session = Depends(get_db),
  current_user: models.User = Depends(require_admin),
):
  """Today's usage of the citizens closest to their limit (top 10)."""
  total = func.coalesce(func.sum(models.TokenUsage.prompt_tokens + models.TokenUsage.output_tokens), 0)
  rows = (
    db.query(models.User.id_user, models.User.userName, total.label("used"))
    .join(models.TokenUsage, models.TokenUsage.id_user == models.User.id_user)
    .filter(models.User.role != "admin")
    .filter(models.TokenUsage.date_usage >= quota._day_start_local())
    .group_by(models.User.id_user, models.User.userName)
    .order_by(total.desc())
    .limit(10)
    .all()
  )
  limit = quota.USER_DAILY_LIMIT
  return {
    "day": quota.today_morocco().isoformat(),
    "user_limit": limit,
    "thresholds": quota.THRESHOLDS,
    "email_configured": notifier.email_configured(),
    "top_users": [
      {
        "id_user": r.id_user,
        "userName": r.userName,
        "used": int(r.used),
        "percent": round(100 * int(r.used) / limit, 1) if limit else 0.0,
        "blocked": int(r.used) >= limit,
      }
      for r in rows
    ],
  }


@router.get("/admin/alerts")
def list_alerts(
  limit: int = 100,
  db: Session = Depends(get_db),
  current_user: models.User = Depends(require_admin),
):
  rows = (
    db.query(models.Alert)
    .options(joinedload(models.Alert.user))
    .order_by(models.Alert.created_at.desc())
    .limit(min(limit, 500))
    .all()
  )
  return [
    {
      "id_alert": a.id_alert,
      "user": a.user.userName if a.user else None,
      "period": a.period,
      "threshold": a.threshold,
      "used": a.used,
      "limit": a.limit_value,
      "status": a.status,
      "sent_email": a.sent_email,
      "error": a.error,
      "created_at": a.created_at,
      "sent_at": a.sent_at,
    }
    for a in rows
  ]


@router.post("/admin/alerts/{alert_id}/resend")
def resend_alert(
  alert_id: str,
  db: Session = Depends(get_db),
  current_user: models.User = Depends(require_admin),
):
  alert = db.query(models.Alert).filter_by(id_alert=alert_id).first()
  if alert is None:
    raise HTTPException(status_code=404, detail="Alerte introuvable")
  notifier.notify_alert(alert_id)
  db.refresh(alert)
  return {"status": alert.status, "sent_email": alert.sent_email, "error": alert.error}


@router.post("/admin/alerts/test")
def test_email(current_user: models.User = Depends(require_admin)):
  """Sends a test email to check the .env settings."""
  if not notifier.email_configured():
    return {"email": "non configuré"}
  try:
    notifier.send_email("[Assistant RAG] Test des alertes",
                        "Message de test : les alertes email sont bien configurées.")
    return {"email": "envoyé"}
  except Exception as e:
    return {"email": f"échec : {type(e).__name__}: {e}"}