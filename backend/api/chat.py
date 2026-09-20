from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from database import get_db
import models, schemas
from core.security import get_current_user
from core.logging import write_log, record_usage
from services.rag import my_retriever, build_facts, generate_answer

router = APIRouter(tags=["chat"])

def serialize_conversation(conv) -> dict:
  return {
    "id": conv.id_conversation,
    "title": conv.titre,
    "updated_at": conv.date_maj,
    "message_count": len(conv.questions) * 2,
  }

@router.post("/ask")
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
  answer_text, tokens = generate_answer(payload.question_content, facts)

  reponse = models.Reponse(
    reponse_content = answer_text,
    reponse_date = datetime.now(),
    question = question,
  )

  reponse.procedures = retrieved_procedures
  db.add(reponse)
  conv.date_maj = datetime.now()

  record_usage(
    db,
    current_user,
    feature="chat",
    model="gemini-2.5-flash",
    tokens= tokens,
  )
  
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

@router.get("/citizen/conversations")
def list_conversations(current_user : models.User = Depends(get_current_user),db: Session= Depends(get_db)):
  user_id = current_user.id_user
  rows = (
    db.query(models.Conversation)
    .filter_by(id_user = user_id)
    .order_by(models.Conversation.date_maj.desc())
    .all()
  )
  return [serialize_conversation(conv) for conv in rows]

@router.post("/citizen/conversations")
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
  db.add(conv)
  db.flush()

  write_log(
    db, request, current_user,
    action="create_new_conversation",
    entity_type="conversation",
    entity_id=conv.id_conversation,
    detail=conv.titre,
  )
  
  db.commit()
  db.refresh(conv)
  return {"id": conv.id_conversation}

@router.get("/citizen/conversations/{conversation_id}")
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

@router.post("/citizen/conversations/{conversation_id}/messages")
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

@router.delete("/citizen/conversations/{conversation_id}", status_code=204)
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

