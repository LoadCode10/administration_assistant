from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from database import get_db
import models
from core.security import require_admin
from core.logging import write_log
from services import agency_cache

router = APIRouter(tags=["agency-cache"])


@router.get("/admin/agency-cache")
def list_agency_cache(
  db: Session = Depends(get_db),
  current_user: models.User = Depends(require_admin),
):
  """Cache statistics + entries, most used first (for the admin dashboard)."""
  rows = (
    db.query(models.AgencyCache)
    .order_by(models.AgencyCache.hits.desc(), models.AgencyCache.created_at.desc())
    .limit(200)
    .all()
  )
  return {
    "stats": agency_cache.stats(db),
    "entries": [
      {
        "id_cache": r.id_cache,
        "id_administration": r.id_administration,
        "administration_fr": r.administration.nom_administration_fr if r.administration else None,
        "administration_ar": r.administration.nom_administration_ar if r.administration else None,
        "ville": r.city_label,
        "hits": r.hits,
        "created_at": r.created_at,
        "expires_at": r.expires_at,
        "last_hit_at": r.last_hit_at,
      }
      for r in rows
    ],
  }


@router.delete("/admin/agency-cache")
def clear_agency_cache(
  request: Request,
  admin_id: str | None = None,
  city: str | None = None,
  expired_only: bool = False,
  db: Session = Depends(get_db),
  current_user: models.User = Depends(require_admin),
):
  """No parameter: empties the whole cache. admin_id / city: targeted. expired_only: cleanup."""
  if expired_only:
    deleted = agency_cache.purge_expired(db)
  else:
    deleted = agency_cache.clear(db, admin_id=admin_id, city=city)
  write_log(
    db, request, current_user,
    action="clear_agency_cache",
    entity_type="agency_cache",
    entity_id=admin_id,
    detail=f"{deleted} entrée(s) supprimée(s)" + (f" · ville={city}" if city else ""),
  )
  db.commit()
  return {"deleted": deleted}