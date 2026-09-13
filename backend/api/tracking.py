from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
import models, schemas
from core.security import get_current_user

router = APIRouter(tags=["tracking"])

def serialize_tracked_proc(tracked_proc) -> dict:
  return {
    "id_user_procedure": tracked_proc.id_user_procedure,
    "id_procedure": tracked_proc.id_procedure,
    "titre_proc": tracked_proc.procedure.titre_proc,
    "administration": tracked_proc.procedure.administration.nom_administration
                      if tracked_proc.procedure.administration else None,
    "status": tracked_proc.status,
    "statut_proc": tracked_proc.procedure.statut_proc,
    "date_obsolete": tracked_proc.procedure.date_obsolete,
    "date_debut": tracked_proc.date_debut,
    "documents": [
      {
        "id_upd": doc.id_upd,
        "id_piece": doc.id_piece,
        "nom_piece": doc.piece.nom_piece,
        "est_coche": doc.est_coche,
        "note": doc.note,
      }
      for doc in tracked_proc.documents
    ],
    "etapes": [
      {"ordre_etape": e.ordre_etape, "description_etape": e.description_etape}
      for e in sorted(tracked_proc.procedure.etapes, key=lambda e: e.ordre_etape)
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
    status = "en_cours"
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
    "nom_piece": doc.piece.nom_piece,
    "est_coche": doc.est_coche,
    "note": doc.note,
    "statut_procedure": tracked_proc.status,
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


