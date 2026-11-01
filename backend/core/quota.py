"""
Daily token limit per user.

  - limit     : TOKEN_LIMIT_USER_DAILY tokens per user per day (admins are exempt)
  - alerts    : at TOKEN_ALERT_RATIO (e.g. 0.8 -> 80 %) and at 100 %
  - "today"   : the current day in Africa/Casablanca, whatever the container's time zone
"""
import os
from datetime import date, datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

import models

TZ = ZoneInfo("Africa/Casablanca")
USER_DAILY_LIMIT = int(os.environ.get("TOKEN_LIMIT_USER_DAILY", 50000))
WARN_RATIO = float(os.environ.get("TOKEN_ALERT_RATIO", 0.8))
THRESHOLDS = sorted({int(round(WARN_RATIO * 100)), 100})          # e.g. [80, 100]


def today_morocco() -> date:
  return datetime.now(TZ).date()


def _day_start_local() -> datetime:
  """Midnight in Casablanca, converted to the container's local time (naive),
  because TokenUsage.date_usage is written with datetime.now() (naive, container time)."""
  start = datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0)
  return start.astimezone().replace(tzinfo=None)


def tokens_today(db: Session, user_id: str) -> int:
  """Tokens used by this user since midnight (Morocco time)."""
  total = func.coalesce(
    func.sum(models.TokenUsage.prompt_tokens + models.TokenUsage.output_tokens), 0
  )
  return int(
    db.query(total)
    .filter(models.TokenUsage.id_user == user_id)
    .filter(models.TokenUsage.date_usage >= _day_start_local())
    .scalar() or 0
  )


def usage_snapshot(db: Session, user: models.User) -> dict:
  """The user's usage today (for the frontend progress bar)."""
  used = tokens_today(db, user.id_user)
  if user.role == "admin":
    return {"day": today_morocco().isoformat(), "used": used, "limit": None,
            "percent": None, "remaining": None, "exempt": True}
  return {
    "day": today_morocco().isoformat(),
    "used": used,
    "limit": USER_DAILY_LIMIT,
    "percent": round(100 * used / USER_DAILY_LIMIT, 1) if USER_DAILY_LIMIT else 0.0,
    "remaining": max(USER_DAILY_LIMIT - used, 0),
    "exempt": False,
  }


def check_quota(db: Session, user: models.User | None) -> None:
  """Call BEFORE a Gemini call. Raises 429 if the user has reached the limit.
  Admins are never blocked."""
  if user is None or user.role == "admin":
    return
  if tokens_today(db, user.id_user) >= USER_DAILY_LIMIT:
    raise HTTPException(
      status_code=429,
      detail="Vous avez atteint votre limite quotidienne d'utilisation. Réessayez demain.",
    )


def evaluate_alerts(db: Session, user_id: str | None, is_admin: bool = False) -> list[str]:
  """Call AFTER recording the usage (and a db.flush()).
  Creates the thresholds this user crossed today that don't exist yet, and returns
  the id of the one to email (only the highest new one)."""
  if user_id is None or is_admin:
    return []

  used = tokens_today(db, user_id)
  day = today_morocco()
  created: list[tuple[int, str]] = []

  for pct in THRESHOLDS:
    if USER_DAILY_LIMIT and used >= USER_DAILY_LIMIT * pct / 100:
      stmt = (
        insert(models.Alert)
        .values(kind="token_user", scope_id=user_id, id_user=user_id, period=day,
                threshold=pct, used=used, limit_value=USER_DAILY_LIMIT,
                status="pending", created_at=datetime.now())
        .on_conflict_do_nothing(constraint="uq_alert_once")
        .returning(models.Alert.id_alert)
      )
      row = db.execute(stmt).first()
      if row is not None:                      # None = this alert already exists today
        created.append((pct, row[0]))

  if not created:
    return []

  created.sort()
  *lower, (top_pct, top_id) = created
  for _pct, alert_id in lower:                 # 80 % and 100 % crossed at once: one email only
    db.query(models.Alert).filter_by(id_alert=alert_id).update(
      {"status": "skipped", "error": f"remplacée par l'alerte {top_pct} %"})
  return [top_id]