from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, Form, BackgroundTasks, Response, Request, Cookie
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func
from collections import Counter
from sqlalchemy.orm import Session, joinedload
from database import get_db, SessionLocal
from test_llm_generation import my_retriever, build_facts
from llm_extracter import extract_text, extract_with_llm
from fill_db_tables import get_or_create_administration, get_or_create_piece, get_or_create_law, handle_procedures
from embed_procedures import build_text_for_embedding, embedding_all_procedures
from auth import hash_password, verify_password, create_acces_token, decode_acces_token, JWT_EXPIRE_HOURS
from google import genai
from dotenv import load_dotenv
from datetime import datetime
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import os
import models as models
import schemas as schemas
import json
import uuid
import pymupdf

load_dotenv()

app = FastAPI()

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
  CORSMiddleware,
  allow_origins=["http://127.0.0.1:5500", "http://localhost:5500"],
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)

llm_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

def get_current_user(
  access_token: str | None = Cookie(default=None),
  db: Session = Depends(get_db)
) -> models.User:
  
  if not access_token:
    raise HTTPException(status_code=401, detail="Non authentifié")

  payload = decode_acces_token(access_token)
  if payload is None:
    raise HTTPException(status_code=401, detail="Session invalide ou expirée")

  user = db.query(models.User).filter_by(
    id_user = payload.get("sub")
  ).first()
  if user is None:
    raise HTTPException(status_code=401, detail="Utilisateur introuvable")
  
  return user

def require_admin(current_user: models.User= Depends(get_current_user)) -> models.User:
  if current_user.role != "admin":
    raise HTTPException(status_code=403, detail="Accès réservé aux administrateurs")
  return current_user


@app.get("/procedures/{proc_id}", response_model=schemas.ProcedureOut)
def get_proc_by_id(proc_id: str, db: Session = Depends(get_db)):
  my_procedure = db.query(models.Procedure).filter_by(
    id_procedure = proc_id
  ).first()
  if my_procedure is None:
    raise HTTPException(status_code=404, detail="Procedure Not Found")
  return my_procedure

# http://localhost:8000/procedures?proc_title=association&proc_admin_name=CRI
@app.get("/admin/procedures", response_model=list[schemas.ProcedureOut])
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

@app.delete("/admin/procedures/{proc_id}")
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

@app.patch("/admin/procedures/{proc_id}/obsolete")
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

def generate_answer(question: str, facts: str) -> str:
  prompt = f"""Tu es un assistant administratif marocain. Tu réponds aux
  citoyens en te basant UNIQUEMENT sur les informations officielles fournies
  ci-dessous. Tu n'inventes JAMAIS d'information.

  RÈGLES:
  - Réponds dans la MÊME LANGUE que la question de l'utilisateur.
  - Utilise UNIQUEMENT les faits fournis. Ne devine pas.
  - Si aucune procédure fournie ne correspond à la question, dis clairement
    que tu n'as pas cette information.
  - Cite le nom de l'administration comme source.

  PROCÉDURES OFFICIELLES DISPONIBLES:
  {facts}

  QUESTION DE L'UTILISATEUR:
  {question}

  RÉPONSE:"""

  response = llm_client.models.generate_content(
      model="gemini-2.5-flash",
      contents=prompt,
  )
  return response.text

@app.post("/ask")
def ask_question(
  payload: schemas.QuestionIn,
  current_user : models.User = Depends(get_current_user),
  db: Session = Depends(get_db)
):
  user_id = current_user.id_user
  if payload.conversation_id:
    conv = db.query(models.Conversation).filter_by(
      id_conversation = payload.conversation_id
    ).first()

    if conv is None:
      raise HTTPException(status_code=404, detail="Discussion introuvable")
    if conv.id_user != user_id:
      raise HTTPException(status_code=403, detail="Accès refusé") 
  else:
    conv = models.Conversation(id_user=user_id)
    db.add(conv)
    db.flush()

  if not conv.titre:
    conv.titre = payload.question_content[:80]  

  question = models.Question(
    question_content = payload.question_content,
    id_user = user_id,
    conversation = conv,
  )

  db.add(question)
  db.flush()

  retrieved_procedures = my_retriever(db, payload.question_content)

  if not retrieved_procedures:
    raise HTTPException(status_code=503, detail="Aucune procédure indexée.")

  facts = build_facts(retrieved_procedures)
  answer_text = generate_answer(payload.question_content, facts)

  reponse = models.Reponse(
    reponse_content = answer_text,
    reponse_date = datetime.now(),
    question = question
  )

  reponse.procedures = retrieved_procedures
  db.add(reponse)
  conv.date_maj = datetime.now()
  db.commit()
  db.refresh(reponse)

  return {
    "id_question": question.id_question,
    "conversation_id": conv.id_conversation,
    "answer": answer_text,
    "sources": [
      {
        "id_procedure": p.id_procedure,
        "titre_proc": p.titre_proc,
        "administration": {
          "nom_administration": p.administration.nom_administration
                                if p.administration else None
        },
      }
      for p in retrieved_procedures
    ],
  }

@app.get("/admin/documents")
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

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
EXTRACTIONS_DIR = "extractions"
os.makedirs(EXTRACTIONS_DIR, exist_ok=True)

@app.post("/admin/documents", response_model=schemas.DocumentOut)
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

  write_log(
    db, request, current_user,
    action="upload_document",
    entity_type="document",
    entity_id=document.id_document,
    detail=document.titre_doc,
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

@app.delete("/admin/documents/{item_id}")
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

@app.get("/admin/extractions/{extraction_id}", response_model=schemas.ExtractionDetailOut)
def get_extraction(extraction_id: str, db:Session= Depends(get_db),current_user : models.User = Depends(require_admin)):
  extraction = db.query(models.Extraction).filter_by(
    id_extraction = extraction_id
  ).first()
  if extraction is None:
    raise HTTPException(status_code=404, detail="Extraction Introuvable")
  return extraction


@app.put("/admin/extractions/{extraction_id}", response_model=schemas.ExtractionDetailOut)
def update_extraction(
  extraction_id: str,
  request: Request,
  body: schemas.ExtractionUpdate,
  current_user : models.User = Depends(require_admin),
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

@app.post("/admin/extractions/{extraction_id}/approve")
def approve_extraction(
  extraction_id : str,
  request: Request,
  current_user : models.User = Depends(require_admin),
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
  write_log(
    db, request, current_user,
    action="approved_extraction",
    entity_type="extraction",
    entity_id=extraction.id_extraction,
    detail=extraction.status,
  )
  db.commit()

  return{**result, "embedded": embedded}

@app.post("/admin/imports")
async def upload_json_file(
  request: Request,
  file: UploadFile = File(...),
  source: str | None = Form(None),
  current_user : models.User = Depends(require_admin),
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

  write_log(
    db, request, current_user,
    action="upload_import_json",
    entity_type="extraction",
    entity_id=extraction.id_extraction,
    detail=extraction.status,
  )

  db.add(extraction)
  db.commit()
  db.refresh(extraction)

  return{
    "extraction_id": extraction.id_extraction,
    "procedure_count": len(payload),
  }


@app.get("/admin/administrations")
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


@app.put("/admin/administrations/{admin_id}", response_model=schemas.AdministrationOut)
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


@app.get("/admin/stats")
def get_stats(db: Session = Depends(get_db),current_user : models.User = Depends(require_admin)):
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

@app.post("/citizen/tracked")
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

@app.get("/citizen/tracked")
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

@app.patch("/citizen/tracked/documents/{id_upd}")
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

@app.delete("/citizen/tracked/{id_user_procedure}", status_code=204)
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

def serialize_conversation(conv) -> dict:
  return {
    "id": conv.id_conversation,
    "title": conv.titre,
    "updated_at": conv.date_maj,
    "message_count": len(conv.questions) * 2,
   }

@app.get("/citizen/conversations")
def list_conversations(current_user : models.User = Depends(get_current_user),db: Session= Depends(get_db)):
  user_id = current_user.id_user
  rows = (
    db.query(models.Conversation)
    .filter_by(id_user = user_id)
    .order_by(models.Conversation.date_maj.desc())
    .all()
  )
  return [serialize_conversation(conv) for conv in rows]

@app.post("/citizen/conversations")
def create_conversation(
  request: Request,
  payload: schemas.QuestionIn | None = None,
  current_user : models.User = Depends(get_current_user),
  db: Session= Depends(get_db)
):
  user_id = current_user.id_user
  if payload and payload.question_content:
    return ask_question(payload, current_user, db)
  conv = models.Conversation(id_user = user_id)
  write_log(
    db, request, current_user,
    action="create_new_conversation",
    entity_type="conversation",
    entity_id=conv.id_conversation,
    detail=conv.titre,
  )
  db.add(conv)
  db.commit()
  db.refresh(conv)
  return {"id": conv.id_conversation}

@app.get("/citizen/conversations/{conversation_id}")
def get_conversation(
  conversation_id: str,
  current_user : models.User = Depends(get_current_user),
  db: Session= Depends(get_db)
):
  user_id = current_user.id_user

  conv = db.query(models.Conversation).filter_by(
    id_conversation = conversation_id
  ).first()

  if conv is None:
    raise HTTPException(status_code=404, detail="Discussion introuvable")
  if conv.id_user != user_id:
    raise HTTPException(status_code=403, detail="Accès refusé")

  messages = []
  for question in sorted(conv.questions, key=lambda q:q.question_date):
    messages.append({
      "role": "user",
      "content": question.question_content,
      "created_at": question.question_date,
      "sources": [],
    })
    if question.reponse:
      messages.append({
        "role": "assistant",
        "content": question.reponse.reponse_content,
        "created_at": question.reponse.reponse_date,
        "sources": [
          {
            "id_procedure": p.id_procedure,
            "titre_proc": p.titre_proc,
            "administration": p.administration.nom_administration
                              if p.administration else None,
          }
          for p in question.reponse.procedures
        ],
      })

  return {
    "id": conv.id_conversation,
    "title": conv.titre,
    "messages": messages,
  }

@app.post("/citizen/conversations/{conversation_id}/messages")
def post_message(
  request: Request,
  conversation_id: str,
  payload: schemas.QuestionIn,
  current_user : models.User = Depends(get_current_user),
  db: Session = Depends(get_db),
):
  payload.conversation_id = conversation_id
  write_log(
    db, request, current_user,
    action="messages_answers_conv",
    entity_type="conversation",
    entity_id=conversation_id,
  )
  return ask_question(payload,current_user, db)

@app.delete("/citizen/conversations/{conversation_id}", status_code=204)
def delete_conversation(request: Request,conversation_id: str,current_user : models.User = Depends(get_current_user), db: Session = Depends(get_db)):
  user_id = current_user.id_user

  conv = db.query(models.Conversation).filter_by(
      id_conversation=conversation_id
  ).first()
  if conv is None:
      raise HTTPException(status_code=404, detail="Discussion introuvable")
  if conv.id_user != user_id:
      raise HTTPException(status_code=403, detail="Accès refusé")

  write_log(
    db, request, current_user,
    action="delete_conversation",
    entity_type="conversation",
    entity_id=conv.id_conversation,
    detail=conv.titre,
  )
  db.delete(conv)
  db.commit()

# Monitoring Endpoints for admin (users/logs)
@app.get("/admin/users")
def list_all_users(current_user : models.User = Depends(require_admin),db: Session= Depends(get_db)):
  users_row = (
    db.query(models.User)
    .order_by(models.User.creation_date.desc())
    .all()
  )
  users = []
  for user in users_row:
    users.append({
      "id_user": user.id_user,
      "nom_user": user.nom_user,
      "prenom_user": user.prenom_user,
      "email_user": user.email_user,
      "userName_user": user.userName,
      "role_user": user.role,
      "creation_date": user.creation_date,
      "tracked_count": len(user.tracked),
      "conversations_count": len(user.conversations),
    })

  return users

@app.get("/admin/users/{user_id}")
def list_user_infos(
  user_id: str,
  current_user : models.User = Depends(require_admin),
  db: Session= Depends(get_db)
):
  user = db.query(models.User).filter_by(
    id_user = user_id
  ).first()

  if user is None:
    raise HTTPException(status_code=404, detail="Utilisateur introuvable")
  
  return({
    "id_user": user.id_user,
    "nom_user": user.nom_user,
    "prenom_user": user.prenom_user,
    "email_user": user.email_user,
    "userName_user": user.userName,
    "role_user": user.role,
    "creation_date": user.creation_date,
    "tracked_procs":[
      {
        "id_up": tp.id_user_procedure,
        "status": tp.status,
        "titre_proc": tp.procedure.titre_proc,
        "administration": tp.procedure.administration.nom_administration if tp.procedure.administration else None,
      } for tp in user.tracked
    ] ,
    "tracked_count": len(user.tracked)
  })

def get_client_ip(request: Request) -> str | None:
  forwarded = request.headers.get("x-forwarded-for")
  if forwarded:
    return forwarded.split(",")[0].strip()
  return request.client.host if request.client else None

def write_log(db, request, user, action, entity_type=None, entity_id=None, detail=None):
  db.add(models.Log(
    id_user=user.id_user if user else None,
    user_role= user.role if user else None,
    action=action,
    entity_type=entity_type,
    entity_id=entity_id,
    detail=detail,
    ip_address=get_client_ip(request),
    user_agent=request.headers.get("user-agent"),
    method=request.method,
    path=str(request.url.path),
  ))

@app.get("/admin/logs")
def list_logs(
  action: str | None = None,
  user_id: str | None = None,
  limit: int = 100,
  current_user: models.User = Depends(require_admin),
  db: Session = Depends(get_db),
):
  query = db.query(models.Log)

  if action is not None:
    query = query.filter(models.Log.action == action)
  if user_id is not None:
    query = query.filter(models.Log.id_user == user_id)

  rows = (
    query
    .order_by(models.Log.date_log.desc())
    .limit(limit)
    .all()
  )

  return [{
    "id_log": log.id_log,
    "action": log.action,
    "entity_type": log.entity_type,
    "entity_id": log.entity_id,
    "detail": log.detail,
    "ip_address": log.ip_address,
    "user_agent": log.user_agent,
    "method": log.method,
    "path": log.path,
    "date_log": log.date_log,
    "user_role": log.user_role,
    "user": {
      "id_user": log.user.id_user,
      "userName": log.user.userName,
      "role": log.user.role,
    } if log.user else None,
  } for log in rows]
# Authentication Endpoints (admin/citizen)
@app.post("/auth/register")
@limiter.limit("3/hour")
def register_user(
  request: Request,
  user_inputs: schemas.UserCreate,
  db: Session= Depends(get_db)
):
  existing = db.query(models.User).filter_by(
    userName = user_inputs.userName 
  ).first()
  if existing is not None:
    write_log(
      db, request, None, action="register_failed",
      detail=f"Nom d'utilisateur déjà pris : {user_inputs.userName}"
    )
    db.commit()
    raise HTTPException(status_code=409, detail="already exist")

  existing = db.query(models.User).filter_by(
    email_user = user_inputs.email_user
  ).first()
  if existing is not None:
    write_log(
      db, request, None, action="register_failed",
      detail=f"Email déjà utilisé : {user_inputs.email_user}"
    )
    db.commit()
    raise HTTPException(status_code=409, detail="already used")

  new_user = models.User(
    nom_user = user_inputs.nom_user,
    prenom_user = user_inputs.prenom_user,
    userName = user_inputs.userName,
    phone_user = user_inputs.phone_user,
    email_user = user_inputs.email_user,
    password_hash = hash_password(user_inputs.password),
  )

  db.add(new_user)
  db.flush()

  write_log(
    db, request, new_user, action="register",
    entity_type="user", entity_id=new_user.id_user,
    detail=f"{new_user.userName} registred"
  )

  db.commit()
  db.refresh(new_user)

  return {
    "message": "Compte créé avec succès",
    "id_user" : new_user.id_user
  }

@app.post("/auth/login")
@limiter.limit("5/minute")
def login_user(
  request: Request,
  credentials: schemas.UserLogin,
  response: Response,
  db: Session= Depends(get_db)
):
  foundedUser = db.query(models.User).filter_by(
    userName = credentials.userName
  ).first()
  if foundedUser is None or not foundedUser.password_hash:
    write_log(
      db, request, None, action="login_failed",
      detail=f"Utilisateur inconnu : {credentials.userName}"
    )
    db.commit()
    raise HTTPException(status_code=401, detail="Identifiants incorrects")

  verified = verify_password(credentials.password, foundedUser.password_hash)
  if not verified:
    write_log(
      db, request, None, action="login_failed",
      detail="Mot de passe incorrect"
    )
    db.commit()
    raise HTTPException(status_code=401, detail="Identifiants incorrects")

  token = create_acces_token(
    {
      "sub": foundedUser.id_user,
      "role": foundedUser.role
    }
  )

  response.set_cookie(
    key="access_token",
    value=token,
    httponly=True,
    samesite="lax",
    max_age=JWT_EXPIRE_HOURS * 3600,
    path="/",
  )

  write_log(
    db, request, foundedUser, action="login",
    entity_type="user", entity_id=foundedUser.id_user, detail="user login"
  )
  db.commit()

  return{
    "user": {
      "id_user": foundedUser.id_user,
      "nom_user": foundedUser.nom_user,
      "prenom_user": foundedUser.prenom_user,
      "email_user": foundedUser.email_user,
      "role": foundedUser.role,
    }
  }

@app.get("/citizen/me")
def get_me(current_user: models.User = Depends(get_current_user)):
  return {
    "id_user": current_user.id_user,
    "nom_user": current_user.nom_user,
    "prenom_user": current_user.prenom_user,
    "email_user": current_user.email_user,
    "role": current_user.role,
  }


@app.post("/auth/logout", status_code=204)
def logout(
  request: Request,
  response: Response,
  current_user: models.User = Depends(get_current_user),
  db: Session= Depends(get_db)
):
  write_log(
    db, request, current_user, action="logout",
    entity_type="user", entity_id=current_user.id_user,
    detail="user logout"
  )
  db.commit()
  response.delete_cookie("access_token", path="/")