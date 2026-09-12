import json
from database import SessionLocal
import models as models

file_path = "procedures.json"

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

def get_or_create_law(session, text):
  loi = session.query(models.Loi).filter_by(texte_loi=text).first()
  if loi is None:
    loi = models.Loi(texte_loi=text)
    session.add(loi)
  return loi

def handle_procedures(session, procedures_data: list[dict], document=None, extraction=None):
  # session = SessionLocal()
  created = 0
  skipped = 0
  
    # all_procs_data = load_procedures()
  all_procs_data = procedures_data
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
      skipped += 1
      continue

    procedure = models.Procedure(
      titre_proc = proc["proc_title"],
      frais_proc = proc["fee"],
      delai_proc = proc["proc_delai"],
      description_proc=proc.get("proc_description"),
      administration=admin
    )

    session.add(procedure)

    if document is not None:
      procedure.documents.append(document)

    if extraction is not None:
      procedure.extraction = extraction

    for piece_nom in proc["proc_pieces"]:
      piece = get_or_create_piece(session, piece_nom)
      if piece not in procedure.pieces:
        procedure.pieces.append(piece)

    for texte in proc["proc_law"]:
      loi = get_or_create_law(session, texte)
      if loi not in procedure.lois:
        procedure.lois.append(loi)

    for i, etape_txt in enumerate(proc["proc_steps"], start=1):
      etape= models.Etape(ordre_etape=i, description_etape=etape_txt)
      procedure.etapes.append(etape)

    created += 1

  session.commit()
  print("All procedures persisted.")
  return {"created": created, "skipped": skipped}
  

if __name__ == "__main__":
  print(handle_procedures())