from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
import models, schemas
from core.security import require_admin
from core.logging import write_log

router = APIRouter(tags=["administrations"])

@router.get("/admin/administrations")
def list_administrations(db: Session = Depends(get_db),current_user : models.User = Depends(require_admin),):
  rows = (
    db.query(
        models.Administration,
        func.count(models.Procedure.id_procedure).label("procedure_count"),
    )
    .outerjoin(models.Procedure)
    .group_by(models.Administration.id_administration)
    .order_by(models.Administration.nom_administration)
    .all()
  )

  return [{
    "id_administration": admin.id_administration,
    "nom_administration": admin.nom_administration,
    "addr_administration": admin.addr_administration,
    "url_administration": admin.url_administration,
    "procedure_count": count,
  } for admin, count in rows]


@router.put("/admin/administrations/{admin_id}", response_model=schemas.AdministrationOut)
def update_administration(
  admin_id: str,
  request: Request,
  body: schemas.AdministrationUpdate,
  current_user : models.User = Depends(require_admin),
  db: Session= Depends(get_db),
):
  administration = db.query(models.Administration).filter_by( id_administration = admin_id).first()

  if administration is None:
    raise HTTPException(status_code=404, detail="Administration Introuvable")

  duplicate = db.query(models.Administration).filter(
        models.Administration.nom_administration == body.nom_administration,
        models.Administration.id_administration != admin_id,
    ).first()

  if duplicate is not None:
    raise HTTPException(
        status_code=409,
        detail="Une autre administration porte déjà ce nom",
    )

  administration.nom_administration = body.nom_administration
  administration.addr_administration = body.addr_administration
  administration.url_administration = body.url_administration

  write_log(
    db, request, current_user,
    action="modifier_administration_infos",
    entity_type="administration",
    entity_id=administration.id_administration,
    detail=administration.nom_administration,
  )

  db.commit()
  db.refresh(administration)

  return administration