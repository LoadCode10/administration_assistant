from sqlalchemy.orm import Session
import models
from embedding import embed_procedure


def get_or_create_administration(db: Session, nom: str) -> models.Administration:
  admin = db.query(models.Administration).filter_by(nom_administration=nom).first()
  if admin is None:
    admin = models.Administration(nom_administration=nom)
    db.add(admin)
    db.flush()
  return admin


def get_or_create_piece(db: Session, nom: str) -> models.Piece:
  piece = db.query(models.Piece).filter_by(nom_piece=nom).first()
  if piece is None:
    piece = models.Piece(nom_piece=nom)
    db.add(piece)
    db.flush()
  return piece


def commit_procedures_to_db(db: Session, procedures_data: list[dict]) -> list[models.Procedure]:
  created_procedures = []

  for proc in procedures_data:
    administrations = proc.get("proc_administration") or []
    admin_name = administrations[0] if administrations else "Unknown"
    admin = get_or_create_administration(db, admin_name)

    procedure = models.Procedure(
      titre_proc=proc["proc_title"],
      frais_proc=proc.get("fee"),
      delai_proc=proc.get("proc_delai"),
      administration=admin,
    )
    db.add(procedure)

    for piece_nom in proc.get("proc_pieces") or []:
      piece = get_or_create_piece(db, piece_nom)
      procedure.pieces.append(piece)

    for i, etape_txt in enumerate(proc.get("proc_steps") or [], start=1):
      etape = models.Etape(ordre_etape=i, description_etape=etape_txt)
      procedure.etapes.append(etape)

    db.flush()
    embed_procedure(procedure)
    created_procedures.append(procedure)

  db.commit()
  for procedure in created_procedures:
    db.refresh(procedure)

  return created_procedures


def create_procedure_manually(db: Session, payload) -> models.Procedure:
  admin = get_or_create_administration(db, payload.nom_administration)

  procedure = models.Procedure(
    titre_proc=payload.titre_proc,
    frais_proc=payload.frais_proc,
    delai_proc=payload.delai_proc,
    administration=admin,
  )
  db.add(procedure)

  for piece_nom in payload.pieces:
    procedure.pieces.append(get_or_create_piece(db, piece_nom))

  for i, etape_txt in enumerate(payload.etapes, start=1):
    procedure.etapes.append(models.Etape(ordre_etape=i, description_etape=etape_txt))

  db.flush()
  embed_procedure(procedure)
  db.commit()
  db.refresh(procedure)
  return procedure


def update_procedure(db: Session, procedure: models.Procedure, payload) -> models.Procedure:
  if payload.titre_proc is not None:
    procedure.titre_proc = payload.titre_proc
  if payload.frais_proc is not None:
    procedure.frais_proc = payload.frais_proc
  if payload.delai_proc is not None:
    procedure.delai_proc = payload.delai_proc
  if payload.nom_administration is not None:
    procedure.administration = get_or_create_administration(db, payload.nom_administration)
  if payload.pieces is not None:
    procedure.pieces = [get_or_create_piece(db, nom) for nom in payload.pieces]
  if payload.etapes is not None:
    procedure.etapes = [
      models.Etape(ordre_etape=i, description_etape=txt)
      for i, txt in enumerate(payload.etapes, start=1)
    ]

  db.flush()
  embed_procedure(procedure)
  db.commit()
  db.refresh(procedure)
  return procedure
