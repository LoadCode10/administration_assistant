from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session
from database import get_db
from deps import require_admin
from extraction import extract_text_from_upload, extract_procedures_from_text
from ingestion import commit_procedures_to_db, create_procedure_manually, update_procedure
import models
import schemas

router = APIRouter(prefix="/admin", tags=["admin"])


# --- Manual procedure CRUD ---

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


# --- File upload -> LLM extraction -> staging for review ---

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
