import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import TypeAdapter, ValidationError
from sqlalchemy.orm import Session

from database import get_db
import models, schemas
from core.security import require_admin
from core.logging import write_log
from services.ingestion import handle_procedures
from services.rag import embedding_all_procedures

router = APIRouter(tags=["extractions"])

_procedures_adapter = TypeAdapter(list[schemas.ExtractedProcedure])


def validate_payload(payload) -> list[dict]:
  """Checks the bilingual structure and returns plain dicts ready for JSONB."""
  try:
    validated = _procedures_adapter.validate_python(payload)
  except ValidationError as e:
    first = e.errors()[0]
    location = ".".join(str(part) for part in first["loc"])
    raise HTTPException(
      status_code=422,
      detail=f"Payload invalide ({e.error_count()} erreur(s)) — {location} : {first['msg']}",
    )
  return [p.model_dump() for p in validated]


@router.get("/admin/extractions/{extraction_id}", response_model=schemas.ExtractionDetailOut)
def get_extraction(extraction_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
  extraction = db.query(models.Extraction).filter_by(
    id_extraction=extraction_id
  ).first()
  if extraction is None:
    raise HTTPException(status_code=404, detail="Extraction Introuvable")
  return extraction


@router.put("/admin/extractions/{extraction_id}", response_model=schemas.ExtractionDetailOut)
def update_extraction(
  extraction_id: str,
  request: Request,
  body: schemas.ExtractionUpdate,
  current_user: models.User = Depends(require_admin),
  db: Session = Depends(get_db),
):
  extraction = db.query(models.Extraction).filter_by(
    id_extraction=extraction_id
  ).first()

  if extraction is None:
    raise HTTPException(status_code=404, detail="Extraction introuvable")
  if extraction.status != "pending_review":
    raise HTTPException(status_code=409, detail="Extraction déjà traitée")

  # body.payload holds Pydantic objects; JSONB needs plain dicts
  extraction.payload = [p.model_dump() for p in body.payload]

  write_log(
    db, request, current_user,
    action="update_extraction_payload",
    entity_type="extraction",
    entity_id=extraction.id_extraction,
    detail=extraction.status,
  )
  db.commit()
  db.refresh(extraction)
  return extraction


@router.post("/admin/extractions/{extraction_id}/approve")
def approve_extraction(
  extraction_id: str,
  request: Request,
  current_user: models.User = Depends(require_admin),
  db: Session = Depends(get_db),
):
  extraction = db.query(models.Extraction).filter_by(
    id_extraction=extraction_id
  ).first()

  if extraction is None:
    raise HTTPException(status_code=404, detail="Extraction introuvable")
  if extraction.status != "pending_review":
    raise HTTPException(status_code=409, detail="Extraction déjà traitée")
  if not extraction.payload:
    raise HTTPException(status_code=400, detail="Aucune procédure à enregistrer")

  # Rejects old flat-format payloads before anything is written to the database
  payload = validate_payload(extraction.payload)

  result = handle_procedures(db, payload, document=extraction.document, extraction=extraction)

  embedded = embedding_all_procedures(db)

  extraction.status = "approved"
  write_log(
    db, request, current_user,
    action="approved_extraction",
    entity_type="extraction",
    entity_id=extraction.id_extraction,
    detail=f"{extraction.filename} — {result.get('created', 0)} procédures créées",
  )
  db.commit()

  return {**result, "embedded": embedded}


@router.post("/admin/imports")
async def upload_json_file(
  request: Request,
  file: UploadFile = File(...),
  source: str | None = Form(None),
  current_user: models.User = Depends(require_admin),
  db: Session = Depends(get_db),
):
  contents = await file.read()
  try:
    raw_payload = json.loads(contents.decode("utf-8"))
  except (json.JSONDecodeError, UnicodeDecodeError) as e:
    raise HTTPException(status_code=400, detail=f"Fichier JSON invalide : {e}")

  if not isinstance(raw_payload, list):
    raise HTTPException(status_code=400, detail="Le fichier doit contenir un tableau JSON")
  if not raw_payload:
    raise HTTPException(status_code=400, detail="Le fichier ne contient aucune procédure")

  payload = validate_payload(raw_payload)

  extraction = models.Extraction(
    filename=file.filename,
    status="pending_review",
    url_source=source,
    payload=payload,
  )

  db.add(extraction)
  db.flush()

  write_log(
    db, request, current_user,
    action="upload_import_json",
    entity_type="extraction",
    entity_id=extraction.id_extraction,
    detail=extraction.filename,
  )

  db.commit()
  db.refresh(extraction)

  return {
    "extraction_id": extraction.id_extraction,
    "procedure_count": len(payload),
  }