from pydantic import BaseModel, ConfigDict, EmailStr
from datetime import datetime
from typing import Literal
from models import UserRole, UserProcedureStatus, ExtractionStatus

class PieceOut(BaseModel):
  model_config = ConfigDict(from_attributes=True)
  id_piece: str
  nom_piece: str

class EtapeOut(BaseModel):
  model_config = ConfigDict(from_attributes=True)
  id_etape: str
  ordre_etape: int
  description_etape: str

class AdministrationOut(BaseModel):
  model_config= ConfigDict(from_attributes=True)
  id_administration: str
  nom_administration: str
  addr_administration: str | None
  url_administration: str | None

class ProcedureOut(BaseModel):
  model_config= ConfigDict(from_attributes=True)
  id_procedure: str
  titre_proc: str
  frais_proc: str | None
  delai_proc: str | None
  administration: AdministrationOut
  pieces: list[PieceOut]
  etapes: list[EtapeOut]

class ProcedureIn(BaseModel):
  titre_proc: str
  frais_proc: str | None = None
  delai_proc: str | None = None
  nom_administration: str
  pieces: list[str] = []
  etapes: list[str] = []

class ProcedureUpdateIn(BaseModel):
  titre_proc: str | None = None
  frais_proc: str | None = None
  delai_proc: str | None = None
  nom_administration: str | None = None
  pieces: list[str] | None = None
  etapes: list[str] | None = None

class QuestionOut(BaseModel):
  model_config = ConfigDict(from_attributes=True)
  id_question: str
  question_language: str | None
  question_content: str
  question_date: datetime

class QuestionIn(BaseModel):
  question_content: str
  question_language: str | None = None


class SourceOut(BaseModel):
  model_config = ConfigDict(from_attributes=True)
  id_procedure: str
  titre_proc: str
  administration: AdministrationOut

class ProcedureSuggestion(BaseModel):
  model_config = ConfigDict(from_attributes=True)
  id_procedure: str
  titre_proc: str


# --- Conversations / messages ---

class MessageIn(BaseModel):
  question_content: str
  question_language: str | None = None

class MessageEditIn(BaseModel):
  question_content: str

class MessageOut(BaseModel):
  model_config = ConfigDict(from_attributes=True)
  id_question: str
  question_content: str
  question_date: datetime
  type: Literal["answer", "suggestions"]
  procedure: ProcedureOut | None = None
  suggestions: list[ProcedureSuggestion] = []

class ConversationOut(BaseModel):
  model_config = ConfigDict(from_attributes=True)
  id_conversation: str
  title: str | None
  created_at: datetime
  updated_at: datetime

class ConversationDetailOut(BaseModel):
  model_config = ConfigDict(from_attributes=True)
  id_conversation: str
  title: str | None
  created_at: datetime
  updated_at: datetime
  messages: list[MessageOut]


# --- Auth ---

class UserRegisterIn(BaseModel):
  nom_user: str
  prenom_user: str
  email_user: EmailStr
  phone_user: str | None = None
  password: str

class UserLoginIn(BaseModel):
  email_user: EmailStr
  password: str

class UserOut(BaseModel):
  model_config = ConfigDict(from_attributes=True)
  id_user: str
  nom_user: str
  prenom_user: str
  email_user: str
  phone_user: str | None
  role: UserRole


# --- Progress tracking ---

class UserProcedureEtapeOut(BaseModel):
  model_config = ConfigDict(from_attributes=True)
  id_user_procedure_etape: str
  id_etape: str
  is_done: bool
  done_at: datetime | None
  etape: EtapeOut

class UserProcedureEtapeUpdateIn(BaseModel):
  is_done: bool

class UserProcedurePieceOut(BaseModel):
  model_config = ConfigDict(from_attributes=True)
  id_user_procedure_piece: str
  id_piece: str
  is_done: bool
  done_at: datetime | None
  piece: PieceOut

class UserProcedurePieceUpdateIn(BaseModel):
  is_done: bool

class UserProcedureOut(BaseModel):
  model_config = ConfigDict(from_attributes=True)
  id_user_procedure: str
  status: UserProcedureStatus
  started_at: datetime
  completed_at: datetime | None
  procedure: ProcedureOut
  etapes: list[UserProcedureEtapeOut]
  pieces: list[UserProcedurePieceOut]
  percent_complete: float

class UserProcedureHistoryOut(BaseModel):
  model_config = ConfigDict(from_attributes=True)
  id_user_procedure: str
  status: UserProcedureStatus
  started_at: datetime
  completed_at: datetime | None
  procedure: ProcedureOut
  percent_complete: float


# --- Admin ingestion / extraction staging ---

class ExtractedProcedure(BaseModel):
  proc_title: str
  proc_administration: list[str] = []
  proc_pieces: list[str] = []
  proc_steps: list[str] = []
  fee: str | None = None

class ExtractionStagingOut(BaseModel):
  model_config = ConfigDict(from_attributes=True)
  id_staging: str
  source_filenames: list[str]
  extracted_data: list[dict]
  status: ExtractionStatus
  created_at: datetime
  validated_at: datetime | None

class ExtractionStagingUpdateIn(BaseModel):
  extracted_data: list[ExtractedProcedure]
