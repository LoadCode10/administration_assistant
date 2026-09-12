from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from database import get_db
from deps import get_current_user
from test_llm_generation import my_retriever, build_facts
from google import genai
from dotenv import load_dotenv
from datetime import datetime
import os
import models
import schemas
import auth_router
import admin_router

load_dotenv()

app = FastAPI()

CORS_ORIGINS = os.environ.get(
  "CORS_ORIGINS", "http://localhost:5500,http://127.0.0.1:5500,http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000"
).split(",")

app.add_middleware(
  CORSMiddleware,
  allow_origins=CORS_ORIGINS,
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(admin_router.router)

llm_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])



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
      model="gemini-3.6-flash",
      contents=prompt,
  )
  return response.text

@app.post("/ask")
def ask_question(
  payload: schemas.QuestionIn,
  current_user: models.User = Depends(get_current_user),
  db: Session = Depends(get_db),
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

# User(Citizen) Dashboard endpoints:
def serialize_tracked_proc(tracked_proc) -> dict:
  return {
    "id_user_procedure": tracked_proc.id_user_procedure,
    "id_procedure": tracked_proc.id_procedure,
    "titre_proc": tracked_proc.procedure.titre_proc,
    "administration": tracked_proc.procedure.administration.nom_administration
                      if tracked_proc.procedure.administration else None,
    "status": tracked_proc.status,
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
  current_user: models.User = Depends(get_current_user),
  db: Session = Depends(get_db),
):
  user_id = current_user.id_user

  procedure = db.query(models.Procedure).filter_by(
    id_procedure = body.id_procedure
  ).first()

  if procedure is None:
    raise HTTPException(status_code=404, detail="Procédure introuvable")

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
  current_user: models.User = Depends(get_current_user),
  db: Session = Depends(get_db),
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
  current_user: models.User = Depends(get_current_user),
  db: Session = Depends(get_db),
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
def untrack_procedure(
  id_user_procedure: str,
  current_user: models.User = Depends(get_current_user),
  db: Session = Depends(get_db),
):
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
def list_conversations(
  current_user: models.User = Depends(get_current_user),
  db: Session = Depends(get_db),
):
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
  current_user: models.User = Depends(get_current_user),
  db: Session = Depends(get_db),
):
  user_id = current_user.id_user
  conv = models.Conversation(id_user = user_id)
  db.add(conv)
  db.commit()
  db.refresh(conv)
  return {"id": conv.id_conversation}

@app.get("/citizen/conversations/{conversation_id}")
def get_conversation(
  conversation_id: str,
  current_user: models.User = Depends(get_current_user),
  db: Session = Depends(get_db),
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
  conversation_id: str,
  payload: schemas.QuestionIn,
  current_user: models.User = Depends(get_current_user),
  db: Session = Depends(get_db),
):
  payload.conversation_id = conversation_id
  return ask_question(payload, current_user, db)

@app.delete("/citizen/conversations/{conversation_id}", status_code=204)
def delete_conversation(
  conversation_id: str,
  current_user: models.User = Depends(get_current_user),
  db: Session = Depends(get_db),
):
  user_id = current_user.id_user

  conv = db.query(models.Conversation).filter_by(
      id_conversation=conversation_id
  ).first()
  if conv is None:
      raise HTTPException(status_code=404, detail="Discussion introuvable")
  if conv.id_user != user_id:
      raise HTTPException(status_code=403, detail="Accès refusé")

  db.delete(conv)
  db.commit()