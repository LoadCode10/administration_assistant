from collections import Counter

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
import models
from core.security import require_admin

router = APIRouter(tags=["stats"])

@router.get("/admin/stats")
def get_stats(db: Session = Depends(get_db),current_user : models.User = Depends(require_admin)):
  totals = {
    "documents": db.query(models.Extraction).count(),
    "procedures": db.query(models.Procedure).count(),
    "pieces": db.query(models.Piece).count(),
    "steps": db.query(models.Etape).count(),
    "administrations": db.query(models.Administration).count(),
  }

  status_rows = (
    db.query(models.Extraction.status, func.count(models.Extraction.id_extraction))
    .group_by(models.Extraction.status)
    .all()
  )

  status_map = {
    "approved": "published",
    "pending_review": "review",
    "extracting": "extracting",
    "failed": "failed",
  }

  by_status = {"published": 0, "review": 0, "extracting": 0, "failed": 0}
  for status, count in status_rows:
    key = status_map.get(status)
    if key:
        by_status[key] += count

  admin_rows = (
    db.query(
        models.Administration.nom_administration_fr,
        models.Administration.nom_administration_ar,
        func.count(models.Procedure.id_procedure),
    )
    .join(models.Procedure)
    .group_by(models.Administration.id_administration)
    .order_by(func.count(models.Procedure.id_procedure).desc())
    .limit(10)
    .all()
  )

  by_administration = [
    {"label": nom_fr, "label_ar": nom_ar, "value": count}
    for nom_fr, nom_ar, count in admin_rows
  ]

  date_rows = db.query(models.Extraction.date_creation).all()
  daily = Counter(
    row[0].date().isoformat() for row in date_rows if row[0] is not None
  )

  return {
    "totals": totals,
    "byStatus": by_status,
    "byAdministration": by_administration,
    "daily": dict(daily),
  }

