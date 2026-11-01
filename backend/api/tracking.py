from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
import models, schemas

from core.security import get_current_user
from core.logging import record_usage
from services import agency_cache
from services.search_agent import search_agencies, reverse_geocode_cached

from core.quota import check_quota, evaluate_alerts
from services.notifier import dispatch_alerts

router = APIRouter(tags=["tracking"])

def serialize_tracked_proc(tracked_proc) -> dict:
  return {
    "id_user_procedure": tracked_proc.id_user_procedure,
    "id_procedure": tracked_proc.id_procedure,
    "titre_proc_fr": tracked_proc.procedure.titre_proc_fr,
    "titre_proc_ar": tracked_proc.procedure.titre_proc_ar,
    "id_administration": tracked_proc.procedure.id_administration,
    "administration": {
      "nom_administration_fr": tracked_proc.procedure.administration.nom_administration_fr,
      "nom_administration_ar": tracked_proc.procedure.administration.nom_administration_ar,
    } if tracked_proc.procedure.administration else None,
    "status": tracked_proc.status,
    "statut_proc": tracked_proc.procedure.statut_proc,
    "lang": tracked_proc.lang,
    "date_obsolete": tracked_proc.procedure.date_obsolete,
    "date_debut": tracked_proc.date_debut,
    "documents": [
      {
        "id_upd": doc.id_upd,
        "id_piece": doc.id_piece,
        "nom_piece_fr": doc.piece.nom_piece_fr,
        "nom_piece_ar": doc.piece.nom_piece_ar,
        "est_coche": doc.est_coche,
        "note": doc.note,
      }
      for doc in tracked_proc.documents
    ],
    "etapes": [
      {
        "ordre_etape": e.ordre_etape, "description_etape_fr": e.description_etape_fr,
        "description_etape_ar": e.description_etape_ar,
      } for e in sorted(tracked_proc.procedure.etapes, key=lambda e: e.ordre_etape)
    ],
  }

@router.post("/citizen/tracked")
def track_procedure(
  body: schemas.Trackrequest,
  current_user : models.User = Depends(get_current_user),
  db: Session = Depends(get_db)
):
  user_id = current_user.id_user

  procedure = db.query(models.Procedure).filter_by(
    id_procedure = body.id_procedure
  ).first()

  if procedure is None:
    raise HTTPException(status_code=404, detail="Procédure introuvable")

  if procedure.statut_proc != "active":
    raise HTTPException(
      status_code=409,
      detail="Cette procédure n'est plus en vigueur"
    )

  exicting = db.query(models.UserProcedure).filter_by(
    id_user = user_id,
    id_procedure = body.id_procedure
  ).first()

  if exicting is not None:
    raise HTTPException(status_code=409, detail="Procédure déjà suivie")

  tracked_procedure = models.UserProcedure(
    id_user= user_id,
    id_procedure= body.id_procedure,
    status = "en_cours",
    lang=body.lang,
  )

  db.add(tracked_procedure)

  for piece in procedure.pieces:
    tracked_procedure.documents.append(
      models.UserProcedureDocument(
        id_piece= piece.id_piece,
        est_coche = False
      )
    )

  db.commit()
  db.refresh(tracked_procedure)
  return serialize_tracked_proc(tracked_procedure)

@router.get("/citizen/tracked")
def list_tracked_procs(
  db: Session= Depends(get_db),
  current_user : models.User = Depends(get_current_user)
):
  user_id = current_user.id_user

  rows = (
    db.query(models.UserProcedure)
    .filter_by(id_user = user_id)
    .order_by(models.UserProcedure.date_debut.desc())
    .all()
  )

  return [serialize_tracked_proc(row) for row in rows]

@router.patch("/citizen/tracked/documents/{id_upd}")
def update_tracked_proc_document(
  id_upd: str,
  body: schemas.DocumentUpdate,
  current_user : models.User = Depends(get_current_user),
  db: Session= Depends(get_db)
):
  user_id = current_user.id_user

  doc = db.query(models.UserProcedureDocument).filter_by(
    id_upd = id_upd
  ).first()

  if doc is None:
    raise HTTPException(status_code=404, detail="Document introuvable")
  if doc.user_procedure.id_user != user_id:
    raise HTTPException(status_code=403, detail="Accès refusé")

  fields = body.model_dump(exclude_unset=True)
  if "est_coche" in fields:
    doc.est_coche = fields["est_coche"]
    doc.date_coche = datetime.now() if fields["est_coche"] else None
  if "note" in fields:
    doc.note = fields["note"]

  tracked_proc = doc.user_procedure
  all_checked = all(d.est_coche for d in tracked_proc.documents)
  tracked_proc.status = "termine" if all_checked else "en_cours"

  db.commit()
  db.refresh(doc)

  return{
    "id_upd": doc.id_upd,
    "id_piece": doc.id_piece,
    "nom_piece_fr": doc.piece.nom_piece_fr,
    "nom_piece_ar": doc.piece.nom_piece_ar,
    "est_coche": doc.est_coche,
    "note": doc.note,
    "statut_procedure": tracked_proc.status,
    "lang": tracked_proc.lang,
  }

@router.delete("/citizen/tracked/{id_user_procedure}", status_code=204)
def untrack_procedure(id_user_procedure: str,current_user : models.User = Depends(get_current_user) ,db: Session = Depends(get_db)):
  user_id = current_user.id_user

  tracked_proc = db.query(models.UserProcedure).filter_by(
      id_user_procedure=id_user_procedure
  ).first()
  if tracked_proc is None:
      raise HTTPException(status_code=404, detail="Suivi introuvable")
  if tracked_proc.id_user != user_id:
      raise HTTPException(status_code=403, detail="Accès refusé")

  db.delete(tracked_proc)
  db.commit()

def _nearby_response(administration, ville: str, result: dict, cached: bool, cached_at):
  return {
    "administration": {
      "nom_administration_fr": administration.nom_administration_fr,
      "nom_administration_ar": administration.nom_administration_ar,
    },
    "ville": ville,
    "texte": result.get("texte", ""),
    "sources": result.get("sources", []),
    "verifie": result.get("source_officielle_trouvee", False),
    "cached": cached,                 # True: answer served from the cache, no tokens used
    "cached_at": cached_at,           # when the search was really done
  }

@router.get("/citizen/administrations/{admin_id}/nearby")
def find_nearby_agencies(
  admin_id: str,
  lat: float,
  lon: float,
  refresh: bool = False,              # admin only: force a new search
  current_user: models.User = Depends(get_current_user),
  db: Session = Depends(get_db),
):
  administration = db.query(models.Administration).filter_by(
    id_administration=admin_id
  ).first()
  if administration is None:
    raise HTTPException(status_code=404, detail="Administration introuvable")

  # 1. Coordinates -> city (cached in memory, rounded to ~1 km)
  ville = reverse_geocode_cached(lat, lon)
  if ville is None:
    raise HTTPException(status_code=502, detail="Localisation non reconnue")
  key = agency_cache.city_key(ville)

  # 2. Cache hit: same administration + same city -> stored answer, no Gemini call
  force_refresh = refresh and current_user.role == "admin"
  if not force_refresh:
    hit = agency_cache.get_cached(db, admin_id, key)
    if hit is not None:
      db.commit()                     # saves the hits counter
      return _nearby_response(administration, hit.city_label, hit.result, True, hit.created_at)

  # 3. Cache miss: real search with the AI agent
  check_quota(db, current_user)
  try:
    result = search_agencies(
      administration.nom_administration_fr,
      administration.url_administration or "",
      ville,
    )
  except Exception:
    raise HTTPException(status_code=502, detail="La recherche des agences a échoué. Réessayez plus tard.")

  tokens = result.pop("tokens", {})   # not stored in the cache
  record_usage(db, current_user, feature="agencies", model="gemini-2.5-flash", tokens=tokens)

  # 4. Store only a real answer (an empty one would be served for 30 days)
  if result.get("texte"):
    agency_cache.save(db, admin_id, key, ville, result)

  # 5. Alerts, then commit, then emails in the background
  db.flush()
  alert_ids = evaluate_alerts(db, current_user.id_user, current_user.role == "admin")
  db.commit()
  dispatch_alerts(alert_ids)
  
  return _nearby_response(administration, ville, result, False, datetime.now()) 