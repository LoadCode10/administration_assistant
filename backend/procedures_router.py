from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
import models
import schemas

router = APIRouter(prefix="/procedures", tags=["procedures"])


@router.get("/{proc_id}", response_model=schemas.ProcedureOut)
def get_proc_by_id(proc_id: str, db: Session = Depends(get_db)):
  my_procedure = db.query(models.Procedure).filter_by(id_procedure=proc_id).first()
  if my_procedure is None:
    raise HTTPException(status_code=404, detail="Procedure Not Found")
  return my_procedure


@router.get("", response_model=list[schemas.ProcedureOut])
def list_procedures(
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
