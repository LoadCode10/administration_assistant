import uuid
from sqlalchemy import String, DateTime, Integer, ForeignKey, Table, Column
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base
from datetime import datetime
from pgvector.sqlalchemy import Vector

document_procedure = Table(
  "document_procedure",
  Base.metadata,

  Column(
    "id_procedure",
    ForeignKey("procedures.id_procedure"),
    primary_key=True
  ),

  Column(
    "id_document",
    ForeignKey("documents.id_document"),
    primary_key=True
  ),
)

procedure_piece = Table(
  "procedure_piece",
  Base.metadata,

  Column(
    "id_procedure",
    ForeignKey("procedures.id_procedure"),
    primary_key=True
  ),

  Column(
    "id_piece",
    ForeignKey("pieces.id_piece"),
    primary_key=True
  )

)

class Administration(Base):
  __tablename__ = "administrations"

  id_administration: Mapped[str] = mapped_column(
    String, 
    primary_key=True, 
    default=lambda: str(uuid.uuid4())
  )

  nom_administration : Mapped[str] = mapped_column(
    String,
    nullable=False 
  )

  addr_administration: Mapped[str | None] = mapped_column(
    String,
    nullable=True
  )

  url_administration: Mapped[str | None] = mapped_column(
    String,
    nullable=True
  )

  procedures: Mapped[list["Procedure"]] = relationship(
    back_populates="administration"
  )

class Document(Base):
  __tablename__ = "documents"

  id_document : Mapped[str] = mapped_column(
    String,
    primary_key=True,
    default=lambda: str(uuid.uuid4())
  )

  titre_doc : Mapped[str] = mapped_column(
    String,
    nullable=False,
  )

  url_source : Mapped[str | None] = mapped_column(
    String,
    nullable=True
  )

  date_verification : Mapped[datetime] = mapped_column(
    DateTime,
    nullable=False
  )

  procedures: Mapped[list["Procedure"]] = relationship(
    secondary=document_procedure,
    back_populates="documents"
  )

class Procedure(Base):
  __tablename__ = "procedures"

  id_procedure : Mapped[str] = mapped_column(
    String,
    primary_key=True,
    default= lambda: str(uuid.uuid4())
  )

  titre_proc : Mapped[str] = mapped_column(
    String,
    nullable=False
  )

  frais_proc : Mapped[str | None] = mapped_column(
    String,
    nullable=True
  )

  delai_proc : Mapped[str | None] = mapped_column(
    String,
    nullable=True
  )

  id_administration: Mapped[str] = mapped_column(
    ForeignKey("administrations.id_administration"),
    nullable=False
  )

  administration: Mapped["Administration"] = relationship(
    back_populates="procedures"
  )

  etapes: Mapped[list["Etape"]] = relationship(
    back_populates="procedure"
  )

  pieces: Mapped[list["Piece"]] = relationship(
    secondary=procedure_piece,
    back_populates="procedures"
  )

  documents: Mapped[list["Document"]] = relationship(
    secondary=document_procedure,
    back_populates="procedures"
  )

  embedding: Mapped[list[float]] = mapped_column(
    Vector(1024), nullable=True
  )

class Piece(Base):
  __tablename__ = "pieces"

  id_piece : Mapped[str] = mapped_column(
    String,
    primary_key=True,
    default= lambda: str(uuid.uuid4())
  )

  nom_piece : Mapped[str] = mapped_column(
    String,
    nullable=False
  )

  procedures: Mapped[list["Procedure"]] = relationship(
    secondary=procedure_piece,
    back_populates="pieces"
  )

class Etape(Base):
  __tablename__ = "etapes"

  id_etape : Mapped[str] = mapped_column(
    String,
    primary_key=True,
    default= lambda: str(uuid.uuid4())
  )

  ordre_etape : Mapped[int] = mapped_column(
    Integer,
    nullable=False
  )

  description_etape: Mapped[str] = mapped_column(
    String,
    nullable=False
  )

  id_procedure: Mapped[str] = mapped_column(
    ForeignKey("procedures.id_procedure"),
    nullable=False
  )

  procedure: Mapped["Procedure"] = relationship(
    back_populates="etapes"
  )

class User(Base):
  __tablename__ = "users"

  id_user : Mapped[str] = mapped_column(
    String,
    primary_key=True,
    default=lambda: str(uuid.uuid4())
  )

  nom_user: Mapped[str] = mapped_column(
    String,
    nullable=False
  )

  prenom_user: Mapped[str] = mapped_column(
    String,
    nullable=False
  )

  email_user: Mapped[str] = mapped_column(
    String,
    nullable=False
  )

  phone_user: Mapped[str | None] = mapped_column(
    String,
    nullable=True
  )

  questions: Mapped[list["Question"]] = relationship(
    back_populates= "user"
  )

class Question(Base):
  __tablename__ = "questions"

  id_question : Mapped[str] = mapped_column(
    String,
    primary_key=True,
    default=lambda: str(uuid.uuid4())
  )

  question_language: Mapped[str | None] = mapped_column(
    String,
    nullable=True
  )

  question_content: Mapped[str] = mapped_column(
    String,
    nullable=False
  )

  question_date: Mapped[datetime] = mapped_column(
    DateTime,
    nullable=False,
    # default=datetime.now
  )

  id_user: Mapped[str | None] = mapped_column(
    ForeignKey("users.id_user"),
    nullable=True
  )

  user: Mapped["User"] = relationship(
    back_populates="questions"
  )

  reponse: Mapped["Reponse | None"] = relationship(
    back_populates="question",
    uselist=False
  )

class Reponse(Base):
  __tablename__ = "reponses"

  id_reponse : Mapped[str] = mapped_column(
    String,
    primary_key=True,
    default=lambda: str(uuid.uuid4())
  )

  reponse_language: Mapped[str] = mapped_column(
    String,
    nullable=False
  )

  reponse_content: Mapped[str] = mapped_column(
    String,
    nullable=False
  )

  reponse_date: Mapped[datetime] = mapped_column(
    DateTime,
    nullable=False
  )

  id_question: Mapped[str] = mapped_column(
    ForeignKey("questions.id_question"),
    nullable= False
  )

  question: Mapped["Question"] = relationship(
    back_populates="reponse"
  )


