from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import get_db
from deps import get_current_user
from retrieval import find_match_or_suggestions
import models
import schemas

router = APIRouter(prefix="/conversations", tags=["conversations"])


def _get_owned_conversation(
  db: Session, conversation_id: str, current_user: models.User
) -> models.Conversation:
  conversation = db.query(models.Conversation).filter_by(
    id_conversation=conversation_id
  ).first()
  if conversation is None:
    raise HTTPException(status_code=404, detail="Conversation not found")
  if conversation.id_user != current_user.id_user:
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your conversation")
  return conversation


def _generate_reponse_for_question(db: Session, question: models.Question) -> models.Reponse:
  match_type, data = find_match_or_suggestions(db, question.question_content)

  if match_type == "empty":
    raise HTTPException(status_code=503, detail="Aucune procédure indexée.")

  if match_type == "answer":
    matched_procedure = data
    reponse = models.Reponse(
      reponse_content=matched_procedure.titre_proc,
      reponse_language=question.question_language or "fr",
      reponse_date=datetime.now(),
      response_type=models.ResponseType.answer,
      id_procedure=matched_procedure.id_procedure,
      id_question=question.id_question,
    )
  else:
    suggestions = data
    suggestion_titles = " | ".join(p.titre_proc for p in suggestions)
    reponse = models.Reponse(
      reponse_content=f"Suggestions: {suggestion_titles}",
      reponse_language=question.question_language or "fr",
      reponse_date=datetime.now(),
      response_type=models.ResponseType.suggestions,
      suggested_procedure_ids=[p.id_procedure for p in suggestions],
      id_question=question.id_question,
    )

  db.add(reponse)
  db.flush()
  return reponse


def _build_message_out(db: Session, question: models.Question) -> schemas.MessageOut:
  reponse = question.reponse

  if reponse.response_type == models.ResponseType.answer:
    return schemas.MessageOut(
      id_question=question.id_question,
      question_content=question.question_content,
      question_date=question.question_date,
      type="answer",
      procedure=reponse.procedure,
      suggestions=[],
    )

  ids = reponse.suggested_procedure_ids or []
  procedures = db.query(models.Procedure).filter(models.Procedure.id_procedure.in_(ids)).all()
  by_id = {p.id_procedure: p for p in procedures}
  ordered = [by_id[i] for i in ids if i in by_id]
  return schemas.MessageOut(
    id_question=question.id_question,
    question_content=question.question_content,
    question_date=question.question_date,
    type="suggestions",
    procedure=None,
    suggestions=ordered,
  )


@router.post("", response_model=schemas.ConversationOut, status_code=status.HTTP_201_CREATED)
def create_conversation(
  db: Session = Depends(get_db),
  current_user: models.User = Depends(get_current_user),
):
  conversation = models.Conversation(id_user=current_user.id_user)
  db.add(conversation)
  db.commit()
  db.refresh(conversation)
  return conversation


@router.get("", response_model=list[schemas.ConversationOut])
def list_conversations(
  db: Session = Depends(get_db),
  current_user: models.User = Depends(get_current_user),
):
  return db.query(models.Conversation).filter_by(
    id_user=current_user.id_user
  ).order_by(models.Conversation.updated_at.desc()).all()


@router.get("/{conversation_id}", response_model=schemas.ConversationDetailOut)
def get_conversation(
  conversation_id: str,
  db: Session = Depends(get_db),
  current_user: models.User = Depends(get_current_user),
):
  conversation = _get_owned_conversation(db, conversation_id, current_user)
  messages = [_build_message_out(db, q) for q in conversation.questions]
  return schemas.ConversationDetailOut(
    id_conversation=conversation.id_conversation,
    title=conversation.title,
    created_at=conversation.created_at,
    updated_at=conversation.updated_at,
    messages=messages,
  )


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(
  conversation_id: str,
  db: Session = Depends(get_db),
  current_user: models.User = Depends(get_current_user),
):
  conversation = _get_owned_conversation(db, conversation_id, current_user)
  db.delete(conversation)
  db.commit()


@router.post("/{conversation_id}/messages", response_model=schemas.MessageOut)
def send_message(
  conversation_id: str,
  payload: schemas.MessageIn,
  db: Session = Depends(get_db),
  current_user: models.User = Depends(get_current_user),
):
  conversation = _get_owned_conversation(db, conversation_id, current_user)

  question = models.Question(
    question_content=payload.question_content,
    question_language=payload.question_language,
    question_date=datetime.now(),
    id_user=current_user.id_user,
    id_conversation=conversation.id_conversation,
  )
  db.add(question)
  db.flush()

  _generate_reponse_for_question(db, question)

  if conversation.title is None:
    conversation.title = payload.question_content[:60]
  conversation.updated_at = datetime.now()

  db.commit()
  db.refresh(question)
  return _build_message_out(db, question)


@router.patch("/{conversation_id}/questions/{question_id}", response_model=schemas.MessageOut)
def edit_message(
  conversation_id: str,
  question_id: str,
  payload: schemas.MessageEditIn,
  db: Session = Depends(get_db),
  current_user: models.User = Depends(get_current_user),
):
  conversation = _get_owned_conversation(db, conversation_id, current_user)
  question = next((q for q in conversation.questions if q.id_question == question_id), None)
  if question is None:
    raise HTTPException(status_code=404, detail="Message not found")

  question.question_content = payload.question_content
  if question.reponse is not None:
    db.delete(question.reponse)
    db.flush()

  _generate_reponse_for_question(db, question)
  conversation.updated_at = datetime.now()

  db.commit()
  db.refresh(question)
  return _build_message_out(db, question)


@router.delete("/{conversation_id}/questions/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_message(
  conversation_id: str,
  question_id: str,
  db: Session = Depends(get_db),
  current_user: models.User = Depends(get_current_user),
):
  conversation = _get_owned_conversation(db, conversation_id, current_user)
  question = next((q for q in conversation.questions if q.id_question == question_id), None)
  if question is None:
    raise HTTPException(status_code=404, detail="Message not found")

  db.delete(question)
  db.commit()
