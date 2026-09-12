import enum
import uuid
from sqlalchemy import String, DateTime, Integer, Boolean, ForeignKey, Table, Column
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB
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

procedure_loi = Table(
  "procedure_loi",
  Base.metadata,
  Column("id_procedure", ForeignKey("procedures.id_procedure"), primary_key=True),
  Column("id_loi", ForeignKey("lois.id_loi"), primary_key=True),
)

reponse_procedure = Table(
  "reponse_procedure",
  Base.metadata,
  Column("id_reponse", ForeignKey("reponses.id_reponse"), primary_key=True),
  Column("id_procedure", ForeignKey("procedures.id_procedure"), primary_key=True),
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

  # date_verification : Mapped[datetime] = mapped_column(
  #   DateTime,
  #   default=datetime.now
  # )

  date_upload : Mapped[datetime] = mapped_column(
    DateTime,
    default=datetime.now
  )

  procedures: Mapped[list["Procedure"]] = relationship(
    secondary=document_procedure,
    back_populates="documents"
  )

  extraction: Mapped["Extraction | None"] = relationship(
    back_populates="document",
    uselist=False,
    cascade="all, delete-orphan"
  ) 

  stored_path: Mapped[str | None] = mapped_column(
    String,
    nullable=True
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

  description_proc: Mapped[str | None] = mapped_column(
    String,
    nullable=True
  )

  lois: Mapped[list["Loi"]] = relationship(
    secondary=procedure_loi, back_populates="procedures"
  )

  id_administration: Mapped[str] = mapped_column(
    ForeignKey("administrations.id_administration"),
    nullable=False
  )

  id_extraction: Mapped[str | None] = mapped_column(
    ForeignKey("extractions.id_extraction"), nullable=True
  )

  extraction: Mapped["Extraction | None"] = relationship(
    back_populates="procedures"
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
    back_populates="procedures",
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

class UserRole(str, enum.Enum):
  admin = "admin"
  user = "user"

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

  phone_user: Mapped[str | None] = mapped_column(
    String,
    nullable=True
  )

  email_user: Mapped[str] = mapped_column(
    String,
    nullable=False,
    unique=True
  )

  password_hash: Mapped[str | None] = mapped_column(
    String,
    nullable=True
  )

  role: Mapped[str] = mapped_column(
    String,
    nullable=False,
    default=UserRole.user.value
  )

  questions: Mapped[list["Question"]] = relationship(
    back_populates= "user"
  )

  conversations: Mapped[list["Conversation"]] = relationship(
    back_populates= "user"
  )

  tracked: Mapped[list["UserProcedure"]] = relationship(
    back_populates="user"
  )

  sessions: Mapped[list["UserSession"]] = relationship(
    back_populates="user",
    cascade="all, delete-orphan"
  )

class Question(Base):
  __tablename__ = "questions"

  id_question : Mapped[str] = mapped_column(
    String,
    primary_key=True,
    default=lambda: str(uuid.uuid4())
  )

  question_content: Mapped[str] = mapped_column(
    String,
    nullable=False
  )

  question_date: Mapped[datetime] = mapped_column(
    DateTime,
    nullable=False,
    default=datetime.now
  )

  id_user: Mapped[str | None] = mapped_column(
    ForeignKey("users.id_user"),
    nullable=True
  )

  user: Mapped["User | None"] = relationship(
    back_populates="questions"
  )

  reponse: Mapped["Reponse | None"] = relationship(
    back_populates="question",
    uselist=False,
    cascade="all, delete-orphan"
  )

  id_conversation: Mapped[str | None] = mapped_column(
    ForeignKey("conversations.id_conversation"),
    nullable=True
  )

  conversation : Mapped["Conversation | None"] = relationship(
    back_populates="questions"
  )

class Reponse(Base):
  __tablename__ = "reponses"

  id_reponse : Mapped[str] = mapped_column(
    String,
    primary_key=True,
    default=lambda: str(uuid.uuid4())
  )

  # reponse_language: Mapped[str] = mapped_column(
  #   String,
  #   nullable=False
  # )

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

  procedures: Mapped[list["Procedure"]] = relationship(
    secondary=reponse_procedure
  )

class Extraction(Base):
  __tablename__ = "extractions"

  id_extraction: Mapped[str] = mapped_column(
    String,
    primary_key=True,
    default=lambda: str(uuid.uuid4())
  )

  filename: Mapped[str] = mapped_column(
    String,
    nullable=False
  )

  status: Mapped[str] = mapped_column(
    String,
    nullable=False,
    default="extracting"
  )

  url_source : Mapped[str | None] = mapped_column(
    String,
    nullable=True
  )

  payload: Mapped[list | None] = mapped_column(
    JSONB,
    nullable=True
  )

  error_message: Mapped[str | None] = mapped_column(
    String,
    nullable=True
  )

  date_creation: Mapped[datetime] = mapped_column(
    DateTime,
    default=datetime.now
  )

  id_document: Mapped[str | None] = mapped_column(
    ForeignKey("documents.id_document"),
    nullable=True
  )

  document: Mapped["Document | None"] = relationship(
    back_populates="extraction"
  )

  procedures: Mapped[list["Procedure"]] = relationship(back_populates="extraction")

  @property
  def procedure_count(self) -> int:
    return len(self.payload) if self.payload else 0

class Loi(Base):
  __tablename__ = "lois"

  id_loi: Mapped[str] = mapped_column(
      String, primary_key=True, default=lambda: str(uuid.uuid4())
  )
  texte_loi: Mapped[str] = mapped_column(String, nullable=False)

  procedures: Mapped[list["Procedure"]] = relationship(
      secondary=procedure_loi, back_populates="lois"
  )

class Conversation(Base):
  __tablename__ = "conversations"

  id_conversation: Mapped[str] = mapped_column(
    String,
    primary_key=True,
    default=lambda: str(uuid.uuid4())
  )

  titre: Mapped[str | None] = mapped_column(
    String,
    nullable=True
  )

  date_creation: Mapped[datetime] = mapped_column(
    DateTime,
    default=datetime.now
  )

  date_maj: Mapped[datetime] = mapped_column(
    DateTime,
    default=datetime.now
  )

  id_user: Mapped[str | None] = mapped_column(
    ForeignKey("users.id_user"),
    nullable=True
  )

  user: Mapped["User | None"] = relationship(
    back_populates="conversations"
  )

  questions: Mapped[list["Question"]] = relationship(
    back_populates="conversation",
    cascade="all, delete-orphan"
  )

class UserProcedure(Base):
  __tablename__ = "user_procedures"

  id_user_procedure: Mapped[str] = mapped_column(
    String,
    primary_key=True,
    default= lambda: str(uuid.uuid4())
  )

  status: Mapped[str] = mapped_column(
    String,
    nullable=False,
    default="en_cours"
  )

  date_debut: Mapped[datetime] = mapped_column(
    DateTime,
    default=datetime.now
  )

  id_user: Mapped[str] = mapped_column(
    ForeignKey("users.id_user"),
    nullable= False
  )

  id_procedure: Mapped[str] = mapped_column(
    ForeignKey("procedures.id_procedure"),
    nullable=False
  )

  user: Mapped["User"] = relationship(back_populates="tracked")

  procedure: Mapped["Procedure"] = relationship()

  documents: Mapped[list["UserProcedureDocument"]] = relationship(
    back_populates="user_procedure", cascade="all, delete-orphan"
  )

class UserProcedureDocument(Base):
  __tablename__ = "user_procedure_documents"

  id_upd: Mapped[str] = mapped_column(
      String, primary_key=True, default=lambda: str(uuid.uuid4())
  )
  est_coche: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
  note: Mapped[str | None] = mapped_column(String, nullable=True)
  date_coche: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

  id_user_procedure: Mapped[str] = mapped_column(
      ForeignKey("user_procedures.id_user_procedure"), nullable=False
  )
  id_piece: Mapped[str] = mapped_column(ForeignKey("pieces.id_piece"), nullable=False)

  user_procedure: Mapped["UserProcedure"] = relationship(back_populates="documents")

  piece: Mapped["Piece"] = relationship()

class UserSession(Base):
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
    index=True
  )

  id_user: Mapped[str] = mapped_column(
    ForeignKey("users.id_user"),
    nullable=False
  )

  created_at: Mapped[datetime] = mapped_column(
    DateTime,
    default=datetime.now
  )

  expires_at: Mapped[datetime] = mapped_column(
    DateTime,
    nullable=False
  )

  user: Mapped["User"] = relationship(back_populates="sessions")
