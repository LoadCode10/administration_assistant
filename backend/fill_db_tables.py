import json
from database import SessionLocal
import models

file_path = "fetched_data.json"

def load_procedures(path=file_path):
  with open(path, "r", encoding="utf-8") as file:
    return json.load(file)


def get_or_create_administration(session, nom):
  admin = session.query(models.Administration).filter_by(nom_administration=nom).first()
  if admin is None:
    admin = models.Administration(nom_administration=nom)
    session.add(admin)
  return admin

def get_or_create_piece(session, nom):
  piece = session.query(models.Piece).filter_by(nom_piece=nom).first()
  if piece is None:
    piece = models.Piece(nom_piece=nom)
    session.add(piece)
  return piece

def handle_procedures():
  session = SessionLocal()

  try:
    all_procs_data = load_procedures()

    for proc in all_procs_data:
      # admin = get_or_create_administration(session, proc["proc_administration"][0])

      administrations = proc.get("proc_administration") or []
      admin_name = administrations[0] if administrations else "Unknown"
      admin = get_or_create_administration(session,admin_name)

      procedure = session.query(models.Procedure).filter_by(
        titre_proc=proc["proc_title"],
        id_administration=admin.id_administration
      ).first()

      if procedure is not None:
        continue

      procedure = models.Procedure(
        titre_proc = proc["proc_title"],
        frais_proc = proc["fee"],
        delai_proc = proc["proc_delai"],
        administration=admin
      )

      session.add(procedure)

      for piece_nom in proc["proc_pieces"]:
        piece = get_or_create_piece(session, piece_nom)
        procedure.pieces.append(piece)

      for i, etape_txt in enumerate(proc["proc_steps"], start=1):
        etape= models.Etape(ordre_etape=i, description_etape=etape_txt)
        procedure.etapes.append(etape)

    session.commit()
    print("All procedures persisted.")
  finally:
    session.close()

if __name__ == "__main__":
  handle_procedures()