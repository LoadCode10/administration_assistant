from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy import func
from sqlalchemy.orm import Session
from database import get_db
from deps import require_admin
from extraction import extract_text_from_upload, extract_procedures_from_text
from ingestion import commit_procedures_to_db, create_procedure_manually, update_procedure
import models
import schemas

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/procedures", response_model=schemas.ProcedureOut, status_code=status.HTTP_201_CREATED)
def create_procedure(
  payload: schemas.ProcedureIn,
  db: Session = Depends(get_db),
  admin: models.User = Depends(require_admin),
):
  return create_procedure_manually(db, payload)


@router.patch("/procedures/{procedure_id}", response_model=schemas.ProcedureOut)
def edit_procedure(
  procedure_id: str,
  payload: schemas.ProcedureUpdateIn,
  db: Session = Depends(get_db),
  admin: models.User = Depends(require_admin),
):
  procedure = db.query(models.Procedure).filter_by(id_procedure=procedure_id).first()
  if procedure is None:
    raise HTTPException(status_code=404, detail="Procedure Not Found")
  return update_procedure(db, procedure, payload)


@router.delete("/procedures/{procedure_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_procedure(
  procedure_id: str,
  db: Session = Depends(get_db),
  admin: models.User = Depends(require_admin),
):
  procedure = db.query(models.Procedure).filter_by(id_procedure=procedure_id).first()
  if procedure is None:
    raise HTTPException(status_code=404, detail="Procedure Not Found")
  db.delete(procedure)
  db.commit()


@router.post("/extract", response_model=schemas.ExtractionStagingOut, status_code=status.HTTP_201_CREATED)
def upload_and_extract(
  files: list[UploadFile] = File(...),
  db: Session = Depends(get_db),
  admin: models.User = Depends(require_admin),
):
  text_blocks = []
  filenames = []
  for file in files:
    raw = file.file.read()
    text = extract_text_from_upload(file, raw)
    text_blocks.append(f"--- FILE: {file.filename} ---\n{text}")
    filenames.append(file.filename)

  combined_text = "\n\n".join(text_blocks)
  extracted_data = extract_procedures_from_text(combined_text)

  staging = models.ExtractionStaging(
    source_filenames=filenames,
    extracted_data=extracted_data,
    status=models.ExtractionStatus.pending,
    id_admin=admin.id_user,
    created_at=datetime.now(),
  )
  db.add(staging)
  db.commit()
  db.refresh(staging)
  return staging


@router.get("/extract", response_model=list[schemas.ExtractionStagingOut])
def list_extraction_stagings(
  status_filter: models.ExtractionStatus = models.ExtractionStatus.pending,
  db: Session = Depends(get_db),
  admin: models.User = Depends(require_admin),
):
  return db.query(models.ExtractionStaging).filter_by(status=status_filter).order_by(
    models.ExtractionStaging.created_at.desc()
  ).all()


@router.get("/extract/{staging_id}", response_model=schemas.ExtractionStagingOut)
def get_extraction_staging(
  staging_id: str,
  db: Session = Depends(get_db),
  admin: models.User = Depends(require_admin),
):
  staging = db.query(models.ExtractionStaging).filter_by(id_staging=staging_id).first()
  if staging is None:
    raise HTTPException(status_code=404, detail="Staging batch not found")
  return staging


@router.patch("/extract/{staging_id}", response_model=schemas.ExtractionStagingOut)
def update_extraction_staging(
  staging_id: str,
  payload: schemas.ExtractionStagingUpdateIn,
  db: Session = Depends(get_db),
  admin: models.User = Depends(require_admin),
):
  staging = db.query(models.ExtractionStaging).filter_by(id_staging=staging_id).first()
  if staging is None:
    raise HTTPException(status_code=404, detail="Staging batch not found")
  if staging.status != models.ExtractionStatus.pending:
    raise HTTPException(status_code=409, detail="Only pending staging batches can be edited")

  staging.extracted_data = [item.model_dump() for item in payload.extracted_data]
  db.commit()
  db.refresh(staging)
  return staging


@router.post("/extract/{staging_id}/validate", response_model=list[schemas.ProcedureOut])
def validate_extraction_staging(
  staging_id: str,
  db: Session = Depends(get_db),
  admin: models.User = Depends(require_admin),
):
  staging = db.query(models.ExtractionStaging).filter_by(id_staging=staging_id).first()
  if staging is None:
    raise HTTPException(status_code=404, detail="Staging batch not found")
  if staging.status != models.ExtractionStatus.pending:
    raise HTTPException(status_code=409, detail="Staging batch already processed")

  created_procedures = commit_procedures_to_db(db, staging.extracted_data)

  staging.status = models.ExtractionStatus.validated
  staging.validated_at = datetime.now()
  db.commit()

  return created_procedures


@router.post("/extract/{staging_id}/reject", response_model=schemas.ExtractionStagingOut)
def reject_extraction_staging(
  staging_id: str,
  db: Session = Depends(get_db),
  admin: models.User = Depends(require_admin),
):
  staging = db.query(models.ExtractionStaging).filter_by(id_staging=staging_id).first()
  if staging is None:
    raise HTTPException(status_code=404, detail="Staging batch not found")
  if staging.status != models.ExtractionStatus.pending:
    raise HTTPException(status_code=409, detail="Staging batch already processed")

  staging.status = models.ExtractionStatus.rejected
  db.commit()
  db.refresh(staging)
  return staging


@router.get("/stats", response_model=schemas.AdminStatsOut)
def get_admin_stats(
  db: Session = Depends(get_db),
  admin: models.User = Depends(require_admin),
):
  since = datetime.now() - timedelta(days=7)

  reponses_last_7_days = (
    db.query(models.Reponse.response_type, func.count(models.Reponse.id_reponse))
    .join(models.Question)
    .filter(models.Question.question_date >= since)
    .group_by(models.Reponse.response_type)
    .all()
  )
  reponse_counts = {response_type: count for response_type, count in reponses_last_7_days}

  top_row = (
    db.query(
      models.UserProcedure.id_procedure,
      func.count(models.UserProcedure.id_user_procedure).label("times_started"),
    )
    .group_by(models.UserProcedure.id_procedure)
    .order_by(func.count(models.UserProcedure.id_user_procedure).desc())
    .first()
  )
  top_procedure = None
  if top_row is not None:
    top_id_procedure, times_started = top_row
    top = db.query(models.Procedure).filter_by(id_procedure=top_id_procedure).first()
    if top is not None:
      top_procedure = schemas.TopProcedureOut(
        id_procedure=top.id_procedure,
        titre_proc=top.titre_proc,
        times_started=times_started,
      )

  return schemas.AdminStatsOut(
    total_procedures=db.query(models.Procedure).count(),
    total_administrations=db.query(models.Administration).count(),
    procedures_missing_embedding=db.query(models.Procedure).filter(
      models.Procedure.embedding.is_(None)
    ).count(),
    total_users=db.query(models.User).count(),
    total_admins=db.query(models.User).filter_by(role=models.UserRole.admin).count(),
    pending_extraction_batches=db.query(models.ExtractionStaging).filter_by(
      status=models.ExtractionStatus.pending
    ).count(),
    questions_last_7_days=db.query(models.Question).filter(
      models.Question.question_date >= since
    ).count(),
    direct_answers_last_7_days=reponse_counts.get(models.ResponseType.answer, 0),
    suggestions_last_7_days=reponse_counts.get(models.ResponseType.suggestions, 0),
    procedures_in_progress=db.query(models.UserProcedure).filter_by(
      status=models.UserProcedureStatus.en_cours
    ).count(),
    procedures_completed=db.query(models.UserProcedure).filter_by(
      status=models.UserProcedureStatus.termine
    ).count(),
    top_procedure=top_procedure,
  )
