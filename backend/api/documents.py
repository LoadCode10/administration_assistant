import os
import uuid

from fastapi import (
  APIRouter, BackgroundTasks, Depends, File, Form,
  HTTPException, Request, UploadFile,
)
from sqlalchemy.orm import Session

from database import get_db
import models, schemas
from core.security import require_admin
from core.logging import write_log
from services.extraction import run_extraction

router = APIRouter(tags=["documents"])

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.get("/admin/documents")
def list_documents(db: Session=Depends(get_db), current_user : models.User = Depends(require_admin)):
  documents = (
        db.query(models.Document)
        .order_by(models.Document.date_upload.desc())
        .all()
    )

  orphan_extractions = (
      db.query(models.Extraction)
      .filter(models.Extraction.id_document.is_(None))
      .order_by(models.Extraction.date_creation.desc())
      .all()
  )

  items = []

  for doc in documents:
    items.append({
      "id_document": doc.id_document,
      "titre_doc": doc.titre_doc,
      "url_source": doc.url_source,
      "date_upload": doc.date_upload,
      "kind": "document",
      "extraction": {
          "id_extraction": doc.extraction.id_extraction,
          "filename": doc.extraction.filename,
          "status": doc.extraction.status,
          "procedure_count": doc.extraction.procedure_count,
          "error_message": doc.extraction.error_message,
      } if doc.extraction else None,
    })

  for extraction in orphan_extractions:
    items.append({
      "id_document": extraction.id_extraction,   # the id the row acts on
      "titre_doc": extraction.filename,
      "url_source": None,
      "date_upload": extraction.date_creation,
      "kind": "import",
      "extraction": {
          "id_extraction": extraction.id_extraction,
          "filename": extraction.filename,
          "status": extraction.status,
          "procedure_count": extraction.procedure_count,
          "error_message": extraction.error_message,
      },
    })

  items.sort(key=lambda item: item["date_upload"], reverse=True)
  return items


@router.post("/admin/documents", response_model=schemas.DocumentOut)
async def upload_document(
  background_tasks: BackgroundTasks,
  request: Request,
  file: UploadFile = File(...),
  titre: str | None = Form(None),
  url_source: str | None = Form(None),
  current_user : models.User = Depends(require_admin),
  db: Session = Depends(get_db),
):
  doc_id = str(uuid.uuid4())
  ext = os.path.splitext(file.filename)[1]
  stored_path = os.path.join(UPLOAD_DIR, f"{doc_id}{ext}")

  contents = await file.read()
  with open(stored_path, "wb") as f:
    f.write(contents)

  document = models.Document(
    id_document = doc_id,
    titre_doc = titre or file.filename,
    url_source= url_source,
    stored_path= stored_path
  )

  extraction = models.Extraction(
    filename= f"extraction_{os.path.splitext(file.filename)[0]}.json",
    status= "extracting",
    document= document
  )

  db.add(document)
  db.add(extraction)
  db.flush()

  write_log(
    db, request, current_user,
    action="upload_document",
    entity_type="document",
    entity_id=document.id_document,
    detail=document.titre_doc,
  )
  
  db.commit()
  db.refresh(document)

  background_tasks.add_task(
    run_extraction, 
    extraction.id_extraction,
    stored_path,
    current_user.id_user,
  )

  return document


@router.delete("/admin/documents/{item_id}")
def delete_document(
  item_id: str,
  request: Request,
  db: Session = Depends(get_db),
  current_user: models.User = Depends(require_admin),
):
  document = db.query(models.Document).filter_by(
    id_document=item_id
  ).first()

  if document is not None:
    name = document.titre_doc
    deleted_count = len(document.procedures)
    tracked_removed = 0

    for procedure in list(document.procedures):
      for tracking in list(procedure.tracked_by):
        db.delete(tracking)
        tracked_removed += 1
      db.delete(procedure)

    if document.stored_path and os.path.exists(document.stored_path):
      os.remove(document.stored_path)

    write_log(
      db, request, current_user,
      action="delete_document",
      entity_type="document",
      entity_id=document.id_document,
      detail=f"{name} — {deleted_count} procédures, {tracked_removed} suivis supprimés",
    )

    db.delete(document)
    db.commit()

    return {
      "deleted": name,
      "kind": "document",
      "procedures": deleted_count,
      "tracked_removed": tracked_removed,
    }

  extraction = db.query(models.Extraction).filter_by(
    id_extraction=item_id
  ).first()

  if extraction is not None:
    name = extraction.filename
    deleted_count = len(extraction.procedures)
    tracked_removed = 0

    for procedure in list(extraction.procedures):
      for tracking in list(procedure.tracked_by):
        db.delete(tracking)
        tracked_removed += 1
      db.delete(procedure)

    write_log(
      db, request, current_user,
      action="delete_import_extraction",
      entity_type="extraction",
      entity_id=extraction.id_extraction,
      detail=f"{name} — {deleted_count} procédures, {tracked_removed} suivis supprimés",
    )

    db.delete(extraction)
    db.commit()

    return {
      "deleted": name,
      "kind": "import",
      "procedures": deleted_count,
      "tracked_removed": tracked_removed,
    }

  raise HTTPException(status_code=404, detail="Introuvable")


