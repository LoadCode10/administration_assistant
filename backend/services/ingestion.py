from sqlalchemy import or_
from sqlalchemy.orm import Session

import models

# Used when the document names no administration (Procedure.id_administration is NOT NULL)
DEFAULT_ADMIN_FR = "Administration non spécifiée"
DEFAULT_ADMIN_AR = "إدارة غير محددة"


def get_text(data: dict | None, lang: str) -> str | None:
    """Returns the value for one language, or None so nullable columns stay NULL."""
    if not data:
        return None
    value = (data.get(lang) or "").strip()
    return value or None


def get_or_create_administration(session: Session, nom_fr: str, nom_ar: str):
    # Match on FR *or* AR: the LLM often phrases one of the two translations
    # slightly differently from one document to the next.
    admin = session.query(models.Administration).filter(
        or_(
            models.Administration.nom_administration_fr == nom_fr,
            models.Administration.nom_administration_ar == nom_ar,
        )
    ).first()

    if admin is None:
        admin = models.Administration(
            nom_administration_fr=nom_fr,
            nom_administration_ar=nom_ar,
        )
        session.add(admin)
        # Flush so the uuid default is applied and admin.id_administration isn't None
        session.flush()
    return admin


def get_or_create_piece(session: Session, nom_fr: str, nom_ar: str):
    piece = session.query(models.Piece).filter(
        or_(
            models.Piece.nom_piece_fr == nom_fr,
            models.Piece.nom_piece_ar == nom_ar,
        )
    ).first()

    if piece is None:
        piece = models.Piece(nom_piece_fr=nom_fr, nom_piece_ar=nom_ar)
        session.add(piece)
        session.flush()
    return piece


def get_or_create_law(session: Session, texte: str):
    # Loi has a single column: texte_loi (laws are kept in their original language)
    loi = session.query(models.Loi).filter_by(texte_loi=texte).first()

    if loi is None:
        loi = models.Loi(texte_loi=texte)
        session.add(loi)
        session.flush()
    return loi


def handle_procedures(session: Session, procedures_data: list[dict], document=None, extraction=None):
    """
    Expects a payload already validated with schemas.ExtractedProcedure
    (every text field is a {"fr": ..., "ar": ...} pair, proc_law is list[str]).
    Does not commit: the calling endpoint commits once, so a failure rolls everything back.
    """
    created = 0
    skipped = 0

    for proc in procedures_data:

        # 1. Administration (the model supports one per procedure: the first one is used)
        administrations = proc.get("proc_administration") or []
        admin_data = administrations[0] if administrations else None
        admin_fr = get_text(admin_data, "fr") or DEFAULT_ADMIN_FR
        admin_ar = get_text(admin_data, "ar") or DEFAULT_ADMIN_AR
        admin = get_or_create_administration(session, admin_fr, admin_ar)

        # 2. Procedure — skip duplicates (same FR title, same administration)
        titre_data = proc.get("proc_title")
        titre_fr = get_text(titre_data, "fr")
        titre_ar = get_text(titre_data, "ar")

        existing = session.query(models.Procedure).filter_by(
            titre_proc_fr=titre_fr,
            id_administration=admin.id_administration,
        ).first()

        if existing is not None:
            skipped += 1
            continue

        frais_data = proc.get("fee")
        delai_data = proc.get("proc_delai")
        desc_data = proc.get("proc_description")

        procedure = models.Procedure(
            titre_proc_fr=titre_fr,
            titre_proc_ar=titre_ar,
            frais_proc_fr=get_text(frais_data, "fr"),
            frais_proc_ar=get_text(frais_data, "ar"),
            delai_proc_fr=get_text(delai_data, "fr"),
            delai_proc_ar=get_text(delai_data, "ar"),
            description_proc_fr=get_text(desc_data, "fr"),
            description_proc_ar=get_text(desc_data, "ar"),
            administration=admin,
        )
        session.add(procedure)

        if document is not None:
            procedure.documents.append(document)

        if extraction is not None:
            procedure.extraction = extraction

        # 3. Pièces justificatives
        for piece_data in proc.get("proc_pieces") or []:
            piece_fr = get_text(piece_data, "fr")
            piece_ar = get_text(piece_data, "ar")
            if piece_fr and piece_ar:
                piece = get_or_create_piece(session, piece_fr, piece_ar)
                if piece not in procedure.pieces:
                    procedure.pieces.append(piece)

        # 4. Lois (plain strings, original language)
        for texte in proc.get("proc_law") or []:
            texte = (texte or "").strip()
            if texte:
                loi = get_or_create_law(session, texte)
                if loi not in procedure.lois:
                    procedure.lois.append(loi)

        # 5. Étapes — ordre_etape follows the order given by the LLM
        ordre = 1
        for etape_data in proc.get("proc_steps") or []:
            etape_fr = get_text(etape_data, "fr")
            etape_ar = get_text(etape_data, "ar")
            if etape_fr and etape_ar:
                procedure.etapes.append(models.Etape(
                    ordre_etape=ordre,
                    description_etape_fr=etape_fr,
                    description_etape_ar=etape_ar,
                ))
                ordre += 1

        created += 1

    session.flush()
    print(f"Insertion terminée. Créées : {created} | Ignorées (doublons) : {skipped}")
    return {"created": created, "skipped": skipped}