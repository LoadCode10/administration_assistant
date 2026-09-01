from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import get_db
from deps import get_current_user
import models
import schemas

router = APIRouter(tags=["progress"])


def _percent_complete(user_procedure: models.UserProcedure) -> float:
  total = len(user_procedure.etapes) + len(user_procedure.pieces)
  if total == 0:
    return 100.0
  done = sum(1 for e in user_procedure.etapes if e.is_done)
  done += sum(1 for p in user_procedure.pieces if p.is_done)
  return round(done / total * 100, 2)


def _is_fully_complete(user_procedure: models.UserProcedure) -> bool:
  return all(e.is_done for e in user_procedure.etapes) and all(
    p.is_done for p in user_procedure.pieces
  )


def _refresh_status(user_procedure: models.UserProcedure) -> None:
  if _is_fully_complete(user_procedure):
    user_procedure.status = models.UserProcedureStatus.termine
    user_procedure.completed_at = user_procedure.completed_at or datetime.now()
  else:
    user_procedure.status = models.UserProcedureStatus.en_cours
    user_procedure.completed_at = None


def _to_out(user_procedure: models.UserProcedure) -> schemas.UserProcedureOut:
  return schemas.UserProcedureOut(
    id_user_procedure=user_procedure.id_user_procedure,
    status=user_procedure.status,
    started_at=user_procedure.started_at,
    completed_at=user_procedure.completed_at,
    procedure=user_procedure.procedure,
    etapes=user_procedure.etapes,
    pieces=user_procedure.pieces,
    percent_complete=_percent_complete(user_procedure),
  )


def _get_owned_user_procedure(
  db: Session, user_procedure_id: str, current_user: models.User
) -> models.UserProcedure:
  user_procedure = db.query(models.UserProcedure).filter_by(
    id_user_procedure=user_procedure_id
  ).first()
  if user_procedure is None:
    raise HTTPException(status_code=404, detail="Not found")
  if user_procedure.id_user != current_user.id_user:
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your procedure")
  return user_procedure


@router.post("/procedures/{procedure_id}/start", response_model=schemas.UserProcedureOut)
def start_procedure(
  procedure_id: str,
  db: Session = Depends(get_db),
  current_user: models.User = Depends(get_current_user),
):
  procedure = db.query(models.Procedure).filter_by(id_procedure=procedure_id).first()
  if procedure is None:
    raise HTTPException(status_code=404, detail="Procedure Not Found")

  user_procedure = models.UserProcedure(
    id_user=current_user.id_user,
    id_procedure=procedure.id_procedure,
    status=models.UserProcedureStatus.en_cours,
    started_at=datetime.now(),
  )
  db.add(user_procedure)
  db.flush()

  for etape in procedure.etapes:
    db.add(models.UserProcedureEtape(
      id_user_procedure=user_procedure.id_user_procedure,
      id_etape=etape.id_etape,
      is_done=False,
    ))

  for piece in procedure.pieces:
    db.add(models.UserProcedurePiece(
      id_user_procedure=user_procedure.id_user_procedure,
      id_piece=piece.id_piece,
      is_done=False,
    ))

  db.commit()
  db.refresh(user_procedure)
  return _to_out(user_procedure)


@router.get("/me/procedures", response_model=list[schemas.UserProcedureHistoryOut])
def list_my_procedures(
  db: Session = Depends(get_db),
  current_user: models.User = Depends(get_current_user),
):
  user_procedures = db.query(models.UserProcedure).filter_by(
    id_user=current_user.id_user
  ).order_by(models.UserProcedure.started_at.desc()).all()

  return [
    schemas.UserProcedureHistoryOut(
      id_user_procedure=up.id_user_procedure,
      status=up.status,
      started_at=up.started_at,
      completed_at=up.completed_at,
      procedure=up.procedure,
      percent_complete=_percent_complete(up),
    )
    for up in user_procedures
  ]


@router.get("/me/procedures/{user_procedure_id}", response_model=schemas.UserProcedureOut)
def get_my_procedure(
  user_procedure_id: str,
  db: Session = Depends(get_db),
  current_user: models.User = Depends(get_current_user),
):
  user_procedure = _get_owned_user_procedure(db, user_procedure_id, current_user)
  return _to_out(user_procedure)


@router.patch(
  "/me/procedures/{user_procedure_id}/etapes/{etape_id}",
  response_model=schemas.UserProcedureOut,
)
def toggle_etape(
  user_procedure_id: str,
  etape_id: str,
  payload: schemas.UserProcedureEtapeUpdateIn,
  db: Session = Depends(get_db),
  current_user: models.User = Depends(get_current_user),
):
  user_procedure = _get_owned_user_procedure(db, user_procedure_id, current_user)

  user_procedure_etape = next(
    (e for e in user_procedure.etapes if e.id_etape == etape_id), None
  )
  if user_procedure_etape is None:
    raise HTTPException(status_code=404, detail="Etape not found in this procedure")

  user_procedure_etape.is_done = payload.is_done
  user_procedure_etape.done_at = datetime.now() if payload.is_done else None

  db.flush()
  db.refresh(user_procedure)

  _refresh_status(user_procedure)

  db.commit()
  db.refresh(user_procedure)
  return _to_out(user_procedure)


@router.patch(
  "/me/procedures/{user_procedure_id}/pieces/{piece_id}",
  response_model=schemas.UserProcedureOut,
)
def toggle_piece(
  user_procedure_id: str,
  piece_id: str,
  payload: schemas.UserProcedurePieceUpdateIn,
  db: Session = Depends(get_db),
  current_user: models.User = Depends(get_current_user),
):
  user_procedure = _get_owned_user_procedure(db, user_procedure_id, current_user)

  user_procedure_piece = next(
    (p for p in user_procedure.pieces if p.id_piece == piece_id), None
  )
  if user_procedure_piece is None:
    raise HTTPException(status_code=404, detail="Piece not found in this procedure")

  user_procedure_piece.is_done = payload.is_done
  user_procedure_piece.done_at = datetime.now() if payload.is_done else None

  db.flush()
  db.refresh(user_procedure)

  _refresh_status(user_procedure)

  db.commit()
  db.refresh(user_procedure)
  return _to_out(user_procedure)
