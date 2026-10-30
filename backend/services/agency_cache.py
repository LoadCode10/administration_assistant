"""
Cache of the "closest offices" search results (cache-aside pattern).

  key    : (id_administration, normalized city name)
  value  : the result of search_agencies (texte, sources, source_officielle_trouvee)
  expiry : AGENCY_CACHE_TTL_DAYS days (30 by default)

Flow: look in the cache -> hit: return it, no Gemini call
                        -> miss: call the agent, save the result, return it
"""
import os
import re
import unicodedata
import uuid
from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

import models

TTL_DAYS = int(os.environ.get("AGENCY_CACHE_TTL_DAYS", 30))

# "Préfecture de Casablanca", "Province d'El Jadida", "Commune de Salé" -> the city itself
_PREFIXES = re.compile(r"^(prefecture|province|commune|ville|arrondissement)\s+(de\s+|du\s+|d'\s*)?")


def city_key(city: str) -> str:
  """'  CASABLANCA ', 'Casablanca', 'Préfecture de Casablanca' -> 'casablanca'."""
  s = unicodedata.normalize("NFKD", (city or "").strip().lower())
  s = "".join(ch for ch in s if not unicodedata.combining(ch))   # é -> e, Arabic harakat removed
  s = s.replace("’", "'").replace("-", " ")
  s = _PREFIXES.sub("", s)
  return re.sub(r"\s+", " ", s).strip()


def get_cached(db: Session, admin_id: str, key: str) -> models.AgencyCache | None:
  """Returns the non-expired entry, or None. Counts the hit (the caller commits)."""
  row = (
    db.query(models.AgencyCache)
    .filter(
      models.AgencyCache.id_administration == admin_id,
      models.AgencyCache.city_key == key,
      models.AgencyCache.expires_at > datetime.now(),
    )
    .first()
  )
  if row is not None:
    row.hits += 1
    row.last_hit_at = datetime.now()
  return row


def save(db: Session, admin_id: str, key: str, city_label: str, result: dict) -> None:
  """Insert, or replace the existing entry for (administration, city). The caller commits."""
  now = datetime.now()
  stmt = insert(models.AgencyCache).values(
    id_cache=str(uuid.uuid4()),
    id_administration=admin_id,
    city_key=key,
    city_label=city_label,
    result=result,
    hits=0,
    created_at=now,
    expires_at=now + timedelta(days=TTL_DAYS),
  )
  # Two citizens searching the same city at the same moment: no duplicate, no crash
  stmt = stmt.on_conflict_do_update(
    constraint="uq_agency_cache_admin_city",
    set_={
      "city_label": stmt.excluded.city_label,
      "result": stmt.excluded.result,
      "created_at": stmt.excluded.created_at,
      "expires_at": stmt.excluded.expires_at,
    },
  )
  db.execute(stmt)


def clear(db: Session, admin_id: str | None = None, city: str | None = None) -> int:
  """Deletes entries: all, one administration, or one (administration, city). Returns the count."""
  query = db.query(models.AgencyCache)
  if admin_id:
    query = query.filter(models.AgencyCache.id_administration == admin_id)
  if city:
    query = query.filter(models.AgencyCache.city_key == city_key(city))
  return query.delete(synchronize_session=False)


def purge_expired(db: Session) -> int:
  return (
    db.query(models.AgencyCache)
    .filter(models.AgencyCache.expires_at <= datetime.now())
    .delete(synchronize_session=False)
  )


def stats(db: Session) -> dict:
  now = datetime.now()
  total = db.query(func.count(models.AgencyCache.id_cache)).scalar() or 0
  active = db.query(func.count(models.AgencyCache.id_cache)).filter(models.AgencyCache.expires_at > now).scalar() or 0
  hits = db.query(func.coalesce(func.sum(models.AgencyCache.hits), 0)).scalar() or 0
  return {"entries": total, "active": active, "expired": total - active, "searches_saved": int(hits), "ttl_days": TTL_DAYS}