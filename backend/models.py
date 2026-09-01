import uuid
import enum
from sqlalchemy import String, DateTime, Integer, Boolean, ForeignKey, Table, Column, Enum, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base
from datetime import datetime
from pgvector.sqlalchemy import Vector


class UserRole(str, enum.Enum):
  admin = "admin"
  user = "user"


class UserProcedureStatus(str, enum.Enum):
  en_cours = "en_cours"
  termine = "termine"


class ExtractionStatus(str, enum.Enum):
  pending = "pending"
  validated = "validated"
  rejected = "rejected"


class ResponseType(str, enum.Enum):
  answer = "answer"
  suggestions = "suggestions"

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
    back_populates="procedure",
    cascade="all, delete-orphan"
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

  user_procedures: Mapped[list["UserProcedure"]] = relationship(
    back_populates="procedure",
    cascade="all, delete-orphan"
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

  user_procedure_etapes: Mapped[list["UserProcedureEtape"]] = relationship(
    back_populates="etape",
    cascade="all, delete-orphan"
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

  hashed_password: Mapped[str] = mapped_column(
    String,
    nullable=False
  )

  role: Mapped[UserRole] = mapped_column(
    Enum(UserRole, name="user_role"),
    nullable=False,
    default=UserRole.user,
    server_default=UserRole.user.value,
  )

  questions: Mapped[list["Question"]] = relationship(
    back_populates= "user"
  )

  user_procedures: Mapped[list["UserProcedure"]] = relationship(
    back_populates="user",
    cascade="all, delete-orphan"
  )

  conversations: Mapped[list["Conversation"]] = relationship(
    back_populates="user",
    cascade="all, delete-orphan"
  )

  sessions: Mapped[list["Session"]] = relationship(
    back_populates="user",
    cascade="all, delete-orphan"
  )


class Session(Base):
  __tablename__ = "sessions"

  id_session: Mapped[str] = mapped_column(
    String,
    primary_key=True,
    default=lambda: str(uuid.uuid4())
  )

  token_hash: Mapped[str] = mapped_column(
    String,
    nullable=False,
    unique=True,
    index=True,
  )

  id_user: Mapped[str] = mapped_column(
    ForeignKey("users.id_user"),
    nullable=False
  )

  created_at: Mapped[datetime] = mapped_column(
    DateTime,
    nullable=False,
    default=datetime.now,
  )

  expires_at: Mapped[datetime] = mapped_column(
    DateTime,
    nullable=False
  )

  user: Mapped["User"] = relationship(
    back_populates="sessions"
  )

class Conversation(Base):
  __tablename__ = "conversations"

  id_conversation: Mapped[str] = mapped_column(
    String,
    primary_key=True,
    default=lambda: str(uuid.uuid4())
  )

  id_user: Mapped[str] = mapped_column(
    ForeignKey("users.id_user"),
    nullable=False
  )

  title: Mapped[str | None] = mapped_column(
    String,
    nullable=True
  )

  created_at: Mapped[datetime] = mapped_column(
    DateTime,
    nullable=False,
    default=datetime.now,
  )

  updated_at: Mapped[datetime] = mapped_column(
    DateTime,
    nullable=False,
    default=datetime.now,
  )

  user: Mapped["User"] = relationship(
    back_populates="conversations"
  )

  questions: Mapped[list["Question"]] = relationship(
    back_populates="conversation",
    cascade="all, delete-orphan",
    order_by="Question.question_date",
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

  id_conversation: Mapped[str] = mapped_column(
    ForeignKey("conversations.id_conversation"),
    nullable=False
  )

  user: Mapped["User"] = relationship(
    back_populates="questions"
  )

  conversation: Mapped["Conversation"] = relationship(
    back_populates="questions"
  )

  reponse: Mapped["Reponse | None"] = relationship(
    back_populates="question",
    uselist=False,
    cascade="all, delete-orphan",
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

  response_type: Mapped[ResponseType] = mapped_column(
    Enum(ResponseType, name="response_type"),
    nullable=False,
    default=ResponseType.answer,
  )

  id_procedure: Mapped[str | None] = mapped_column(
    ForeignKey("procedures.id_procedure"),
    nullable=True
  )

  suggested_procedure_ids: Mapped[list[str] | None] = mapped_column(
    JSON,
    nullable=True
  )

  id_question: Mapped[str] = mapped_column(
    ForeignKey("questions.id_question"),
    nullable= False
  )

  question: Mapped["Question"] = relationship(
    back_populates="reponse"
  )

  procedure: Mapped["Procedure | None"] = relationship()


class UserProcedure(Base):
  __tablename__ = "user_procedures"

  id_user_procedure: Mapped[str] = mapped_column(
    String,
    primary_key=True,
    default=lambda: str(uuid.uuid4())
  )

  id_user: Mapped[str] = mapped_column(
    ForeignKey("users.id_user"),
    nullable=False
  )

  id_procedure: Mapped[str] = mapped_column(
    ForeignKey("procedures.id_procedure"),
    nullable=False
  )

  status: Mapped[UserProcedureStatus] = mapped_column(
    Enum(UserProcedureStatus, name="user_procedure_status"),
    nullable=False,
    default=UserProcedureStatus.en_cours,
    server_default=UserProcedureStatus.en_cours.value,
  )

  started_at: Mapped[datetime] = mapped_column(
    DateTime,
    nullable=False,
    default=datetime.now,
  )

  completed_at: Mapped[datetime | None] = mapped_column(
    DateTime,
    nullable=True
  )

  user: Mapped["User"] = relationship(
    back_populates="user_procedures"
  )

  procedure: Mapped["Procedure"] = relationship(
    back_populates="user_procedures"
  )

  etapes: Mapped[list["UserProcedureEtape"]] = relationship(
    back_populates="user_procedure",
    cascade="all, delete-orphan"
  )

  pieces: Mapped[list["UserProcedurePiece"]] = relationship(
    back_populates="user_procedure",
    cascade="all, delete-orphan"
  )


class UserProcedureEtape(Base):
  __tablename__ = "user_procedure_etapes"

  id_user_procedure_etape: Mapped[str] = mapped_column(
    String,
    primary_key=True,
    default=lambda: str(uuid.uuid4())
  )

  id_user_procedure: Mapped[str] = mapped_column(
    ForeignKey("user_procedures.id_user_procedure"),
    nullable=False
  )

  id_etape: Mapped[str] = mapped_column(
    ForeignKey("etapes.id_etape"),
    nullable=False
  )

  is_done: Mapped[bool] = mapped_column(
    Boolean,
    nullable=False,
    default=False,
    server_default="false",
  )

  done_at: Mapped[datetime | None] = mapped_column(
    DateTime,
    nullable=True
  )

  user_procedure: Mapped["UserProcedure"] = relationship(
    back_populates="etapes"
  )

  etape: Mapped["Etape"] = relationship(
    back_populates="user_procedure_etapes"
  )


class UserProcedurePiece(Base):
  __tablename__ = "user_procedure_pieces"

  id_user_procedure_piece: Mapped[str] = mapped_column(
    String,
    primary_key=True,
    default=lambda: str(uuid.uuid4())
  )

  id_user_procedure: Mapped[str] = mapped_column(
    ForeignKey("user_procedures.id_user_procedure"),
    nullable=False
  )

  id_piece: Mapped[str] = mapped_column(
    ForeignKey("pieces.id_piece"),
    nullable=False
  )

  is_done: Mapped[bool] = mapped_column(
    Boolean,
    nullable=False,
    default=False,
    server_default="false",
  )

  done_at: Mapped[datetime | None] = mapped_column(
    DateTime,
    nullable=True
  )

  user_procedure: Mapped["UserProcedure"] = relationship(
    back_populates="pieces"
  )

  piece: Mapped["Piece"] = relationship()


class ExtractionStaging(Base):
  __tablename__ = "extraction_stagings"

  id_staging: Mapped[str] = mapped_column(
    String,
    primary_key=True,
    default=lambda: str(uuid.uuid4())
  )

  source_filenames: Mapped[list[str]] = mapped_column(
    JSON,
    nullable=False,
  )

  extracted_data: Mapped[list[dict]] = mapped_column(
    JSON,
    nullable=False,
  )

  status: Mapped[ExtractionStatus] = mapped_column(
    Enum(ExtractionStatus, name="extraction_status"),
    nullable=False,
    default=ExtractionStatus.pending,
    server_default=ExtractionStatus.pending.value,
  )

  id_admin: Mapped[str] = mapped_column(
    ForeignKey("users.id_user"),
    nullable=False
  )

  created_at: Mapped[datetime] = mapped_column(
    DateTime,
    nullable=False,
    default=datetime.now,
  )

  validated_at: Mapped[datetime | None] = mapped_column(
    DateTime,
    nullable=True
  )

  admin: Mapped["User"] = relationship()
