from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from database import get_db
import models, schemas
from core.security import require_admin
from core.logging import write_log

router = APIRouter(tags=["procedures"])


@router.get("/admin/procedures", response_model=list[schemas.ProcedureOut])
def list_procedures(
  current_user : models.User = Depends(require_admin),
  proc_title: str | None = None,
  proc_admin_name: str | None = None,
  db: Session = Depends(get_db),
):
  procedures = db.query(models.Procedure)
  if proc_title is not None:
    procedures = procedures.filter(
      models.Procedure.titre_proc.ilike(f"%{proc_title}%")
    )
  if proc_admin_name is not None:
    procedures = procedures.filter(
      models.Procedure.administration.has(
        models.Administration.nom_administration.ilike(f"%{proc_admin_name}%")
      )
    )
  return procedures.all()

@router.delete("/admin/procedures/{proc_id}")
def delete_procedure(
  proc_id: str,
  request: Request,
  db: Session= Depends(get_db),
  current_user : models.User = Depends(require_admin)
):
  procedure = db.query(models.Procedure).filter_by(
    id_procedure = proc_id
  ).first()

  if procedure is None:
    raise HTTPException(status_code=404, detail="Procédure introuvable")

  if procedure.tracked_by:
    raise HTTPException(
      status_code=409,
      detail=f"{len(procedure.tracked_by)} citoyen(s) suivent cette procédure. Marquez-la obsolète."
    )
  
  deletion_info = {
    "deleted": procedure.titre_proc,
    "administration": procedure.administration.nom_administration if procedure.administration else None,
    "etapes": len(procedure.etapes),
    "pieces": len(procedure.pieces)
  }

  write_log(
    db, request, current_user,
    action="delete_procedure",
    entity_type="procedure",
    entity_id=proc_id,
    detail=procedure.titre_proc,
  )

  db.delete(procedure)
  db.commit()

  return deletion_info

@router.patch("/admin/procedures/{proc_id}/obsolete")
def mark_obsolete(proc_id: str, request: Request,
current_user: models.User = Depends(require_admin),db: Session = Depends(get_db)):
  procedure = db.query(models.Procedure).filter_by(id_procedure=proc_id).first()
  if procedure is None:
    raise HTTPException(status_code=404, detail="Procédure introuvable")

  procedure.statut_proc = "obsolete"
  procedure.date_obsolete = datetime.now()

  write_log(db, request, current_user, action="mark_obsolete",
    entity_type="procedure", entity_id=proc_id,
    detail=procedure.titre_proc)
  db.commit()
  return {"affected_users": len(procedure.tracked_by)}