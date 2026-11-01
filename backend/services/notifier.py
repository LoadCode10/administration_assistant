"""
Sends the administrator alerts by email (SMTP).
Sending runs in a background thread, so the user's request never waits for it.
"""
import logging
import os
import smtplib
import threading
from datetime import datetime
from email.message import EmailMessage

from database import SessionLocal
import models

logger = logging.getLogger(__name__)


def _env(name: str, default: str = "") -> str:
  return os.environ.get(name, default).strip()


def email_configured() -> bool:
  return bool(_env("SMTP_HOST") and _env("ALERT_EMAIL_TO"))


def send_email(subject: str, body: str) -> None:
  msg = EmailMessage()
  msg["Subject"] = subject
  msg["From"] = _env("SMTP_FROM") or _env("SMTP_USER") or "alertes@assistant.local"
  msg["To"] = _env("ALERT_EMAIL_TO")          # several addresses: separate them with commas
  msg.set_content(body)

  host, port = _env("SMTP_HOST"), int(_env("SMTP_PORT", "587"))
  with smtplib.SMTP(host, port, timeout=15) as smtp:
    if _env("SMTP_STARTTLS", "true").lower() == "true":
      smtp.starttls()
    if _env("SMTP_USER") and _env("SMTP_PASSWORD"):
      smtp.login(_env("SMTP_USER"), _env("SMTP_PASSWORD"))
    smtp.send_message(msg)


def build_message(alert: models.Alert, user: models.User | None) -> tuple[str, str]:
  """Returns (subject, body)."""
  name = f"{user.prenom_user} {user.nom_user} ({user.userName})" if user else alert.scope_id
  if alert.threshold >= 100:
    level = "LIMITE ATTEINTE"
    effect = "Cet utilisateur est bloqué jusqu'à minuit (heure du Maroc)."
  else:
    level = f"{alert.threshold} % de la limite"
    effect = "L'utilisateur peut encore utiliser le service."

  subject = f"[Assistant RAG] Alerte jetons : {level}"
  body = (
    f"Utilisateur : {name}\n"
    f"Jour : {alert.period}\n"
    f"Consommation : {alert.used:,} / {alert.limit_value:,} jetons ({alert.threshold} %)\n"
    f"{effect}\n\n"
    f"Détail des alertes : espace administrateur > Alertes."
  ).replace(",", " ")
  return subject, body


def notify_alert(alert_id: str) -> None:
  """Sends one alert and records the result. Uses its own DB session."""
  db = SessionLocal()
  try:
    alert = db.query(models.Alert).filter_by(id_alert=alert_id).first()
    if alert is None:
      return
    user = db.query(models.User).filter_by(id_user=alert.id_user).first() if alert.id_user else None
    subject, body = build_message(alert, user)

    if not email_configured():
      alert.status, alert.error = "failed", "email non configuré dans .env"
    else:
      try:
        send_email(subject, body)
        alert.sent_email, alert.status, alert.error = True, "sent", None
        alert.sent_at = datetime.now()
      except Exception as e:
        alert.status, alert.error = "failed", f"{type(e).__name__}: {e}"
    db.commit()
    if alert.error:
      logger.warning("Alerte %s : %s", alert_id, alert.error)
  except Exception:
    logger.exception("Envoi de l'alerte %s impossible", alert_id)
  finally:
    db.close()


def dispatch_alerts(alert_ids: list[str]) -> None:
  """Call AFTER db.commit(): sends each alert in a background thread."""
  for alert_id in alert_ids:
    threading.Thread(target=notify_alert, args=(alert_id,), daemon=True).start()