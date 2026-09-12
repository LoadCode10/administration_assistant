from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from sqlalchemy import func
from collections import Counter
from sqlalchemy.orm import Session
from database import get_db, SessionLocal
from deps import require_admin
from llm_extracter import extract_text, extract_with_llm
from fill_db_tables import handle_procedures
from embed_procedures import embedding_all_procedures
import models
import schemas
import json
import uuid
import os
import pymupdf

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
EXTRACTIONS_DIR = "extractions"
os.makedirs(EXTRACTIONS_DIR, exist_ok=True)

# http://localhost:8000/admin/procedures?proc_title=association&proc_admin_name=CRI
@router.get("/procedures", response_model=list[schemas.ProcedureOut])
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

@router.get("/procedures/{proc_id}", response_model=schemas.ProcedureOut)
def get_proc_by_id(proc_id: str, db: Session = Depends(get_db)):
  my_procedure = db.query(models.Procedure).filter_by(
    id_procedure = proc_id
  ).first()
  if my_procedure is None:
    raise HTTPException(status_code=404, detail="Procedure Not Found")
  return my_procedure

@router.delete("/procedures/{proc_id}")
def delete_procedure(
  proc_id: str,
  db: Session= Depends(get_db),
):
  procedure = db.query(models.Procedure).filter_by(
    id_procedure = proc_id
  ).first()

  if procedure is None:
    raise HTTPException(status_code=404, detail="Procédure introuvable")
  deletion_info = {
    "deleted": procedure.titre_proc,
    "administration": procedure.administration.nom_administration if procedure.administration else None,
    "etapes": len(procedure.etapes),
    "pieces": len(procedure.pieces)
  }
  db.delete(procedure)
  db.commit()

  return deletion_info

@router.get("/documents")
def list_documents(db: Session=Depends(get_db)):
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

@router.post("/documents", response_model=schemas.DocumentOut)
async def upload_document(
  background_tasks: BackgroundTasks,
  file: UploadFile = File(...),
  titre: str | None = Form(None),
  url_source: str | None = Form(None),
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
  db.commit()
  db.refresh(document)

  background_tasks.add_task(
    run_extraction,
    extraction.id_extraction,
    stored_path
  )

  return document

@router.delete("/documents/{item_id}")
def delete_document(item_id: str, db: Session=Depends(get_db)):
  document = db.query(models.Document).filter_by(
    id_document=item_id
  ).first()

  if document is not None:
    deleted_count = len(document.procedures)
    name = document.titre_doc

    for procedure in list(document.procedures):
      db.delete(procedure)

    if document.stored_path and os.path.exists(document.stored_path):
      os.remove(document.stored_path)

    db.delete(document)
    db.commit()
    return {"deleted": name, "kind": "document", "procedures": deleted_count}

  extraction = db.query(models.Extraction).filter_by(
    id_extraction=item_id
  ).first()

  if extraction is not None:
    deleted_count = len(extraction.procedures)
    name = extraction.filename

    for procedure in list(extraction.procedures):
      db.delete(procedure)

    db.delete(extraction)
    db.commit()
    return {"deleted": name, "kind": "import", "procedures": deleted_count}

  raise HTTPException(status_code=404, detail="Introuvable")


def read_document_text(file_path: str) -> str:
  ext = os.path.splitext(file_path)[1].lower()
  if ext == ".txt":
    return extract_text(file_path)
  if ext == ".pdf":
    return extract_pdf_text(file_path)
  raise ValueError(f"Format non supporté : {ext}")

def extract_pdf_text(file_path: str) -> str:
  doc = pymupdf.open(file_path)
  text = "\n".join(page.get_text() for page in doc)
  doc.close()
  if len(text.strip()) < 100:
    raise ValueError("Aucun texte extrait — le PDF est probablement scanné")
  return text

def run_extraction(extraction_id:str, file_path:str):
  db = SessionLocal()

  try:
    extraction = db.query(models.Extraction).filter_by(
      id_extraction = extraction_id
    ).first()

    if extraction is None:
      return
    try:
      text = read_document_text(file_path)
      procedures= extract_with_llm(text)
      extraction.payload = procedures

      extract_path = os.path.join(EXTRACTIONS_DIR, extraction.filename)
      with open(extract_path, "w", encoding="utf-8") as f:
        json.dump(procedures, f, ensure_ascii=False, indent=2)

      extraction.status = "pending_review"
    except Exception as e:
      extraction.status = "failed"
      extraction.error_message = str(e)
  finally:
    db.commit()
    db.close()

@router.get("/extractions/{extraction_id}", response_model=schemas.ExtractionDetailOut)
def get_extraction(extraction_id: str, db:Session= Depends(get_db)):
  extraction = db.query(models.Extraction).filter_by(
    id_extraction = extraction_id
  ).first()
  if extraction is None:
    raise HTTPException(status_code=404, detail="Extraction Introuvable")
  return extraction


@router.put("/extractions/{extraction_id}", response_model=schemas.ExtractionDetailOut)
def update_extraction(
  extraction_id: str,
  body: schemas.ExtractionUpdate,
  db: Session = Depends(get_db),
):
  extraction = db.query(models.Extraction).filter_by(
    id_extraction = extraction_id
  ).first()

  if extraction is None:
    raise HTTPException(status_code=404, detail="Extraction introuvable")
  if extraction.status != "pending_review":
    raise HTTPException(status_code=409, detail="Extraction déjà traitée")

  extraction.payload = body.payload
  db.commit()
  db.refresh(extraction)
  return extraction


@router.post("/extractions/{extraction_id}/approve")
def approve_extraction(
  extraction_id : str,
  db: Session= Depends(get_db),
):
  extraction = db.query(models.Extraction).filter_by(
    id_extraction = extraction_id
  ).first()

  if extraction is None:
    raise HTTPException(status_code=404, detail="Extraction introuvable")
  if extraction.status != "pending_review":
    raise HTTPException(status_code=409, detail="Extraction déjà traitée")
  if not extraction.payload:
    raise HTTPException(status_code=400, detail="Aucune procédure à enregistrer")

  result = handle_procedures(db, extraction.payload, document=extraction.document, extraction=extraction)

  embedded = embedding_all_procedures(db)

  extraction.status = "approved"
  db.commit()

  return{**result, "embedded": embedded}


@router.post("/imports")
async def upload_json_file(
  file: UploadFile = File(...),
  source: str | None = Form(None),
  db: Session = Depends(get_db),
):
  contents = await file.read()
  try:
    payload = json.loads(contents.decode("utf-8"))
  except (json.JSONDecodeError, UnicodeDecodeError) as e:
    raise HTTPException(status_code=400, detail=f"Fichier JSON invalide : {e}")

  if not isinstance(payload, list):
    raise HTTPException(status_code=400, detail="Le fichier doit contenir un tableau JSON")
  if not payload:
    raise HTTPException(status_code=400, detail="Le fichier ne contient aucune procédure")

  for i,proc in enumerate(payload):
    if not isinstance(proc, dict):
      raise HTTPException(status_code=400, detail=f"Entrée {i + 1} : objet attendu")
    if not proc.get("proc_title"):
      raise HTTPException(status_code=400, detail=f"Entrée {i + 1} : titre manquant")

  extraction = models.Extraction(
    filename = file.filename,
    status = "pending_review",
    url_source = source,
    payload= payload,
  )

  db.add(extraction)
  db.commit()
  db.refresh(extraction)

  return{
    "extraction_id": extraction.id_extraction,
    "procedure_count": len(payload),
  }


@router.get("/administrations")
def list_administrations(db: Session = Depends(get_db)):
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


@router.put("/administrations/{admin_id}", response_model=schemas.AdministrationOut)
def update_administration(
  admin_id: str,
  body: schemas.AdministrationUpdate,
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

  db.commit()
  db.refresh(administration)

  return administration


@router.get("/stats")
def get_stats(db: Session = Depends(get_db)):
  totals = {
    "documents": db.query(models.Extraction).count(),
    "procedures": db.query(models.Procedure).count(),
    "pieces": db.query(models.Piece).count(),
    "steps": db.query(models.Etape).count(),
    "administrations": db.query(models.Administration).count(),
  }

  status_rows = (
    db.query(models.Extraction.status, func.count(models.Extraction.id_extraction))
    .group_by(models.Extraction.status)
    .all()
  )

  status_map = {
    "approved": "published",
    "pending_review": "review",
    "extracting": "extracting",
    "failed": "failed",
  }

  by_status = {"published": 0, "review": 0, "extracting": 0, "failed": 0}
  for status, count in status_rows:
    key = status_map.get(status)
    if key:
        by_status[key] += count

  admin_rows = (
    db.query(
        models.Administration.nom_administration,
        func.count(models.Procedure.id_procedure),
    )
    .join(models.Procedure)
    .group_by(models.Administration.id_administration)
    .order_by(func.count(models.Procedure.id_procedure).desc())
    .limit(10)
    .all()
  )

  by_administration = [
    {"label": name, "value": count} for name, count in admin_rows
  ]

  date_rows = db.query(models.Extraction.date_creation).all()
  daily = Counter(
    row[0].date().isoformat() for row in date_rows if row[0] is not None
  )

  return {
    "totals": totals,
    "byStatus": by_status,
    "byAdministration": by_administration,
    "daily": dict(daily),
  }
