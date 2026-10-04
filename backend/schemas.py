from pydantic import BaseModel, ConfigDict, Field, field_validator, EmailStr
import re
from datetime import datetime
from typing import Literal

class PieceOut(BaseModel):
  model_config = ConfigDict(from_attributes=True)
  id_piece: str
  # nom_piece: str
  nom_piece_fr: str | None
  nom_piece_ar: str | None

class EtapeOut(BaseModel):
  model_config = ConfigDict(from_attributes=True)
  id_etape: str
  ordre_etape: int
  # description_etape: str
  description_etape_fr: str | None
  description_etape_ar: str | None

class AdministrationOut(BaseModel):
  model_config= ConfigDict(from_attributes=True)
  id_administration: str
  # nom_administration: str
  nom_administration_fr: str 
  nom_administration_ar: str
  addr_administration: str | None
  url_administration: str | None

class ProcedureOut(BaseModel):
  model_config= ConfigDict(from_attributes=True)
  id_procedure: str

  # titre_proc: str 
  # frais_proc: str | None
  # delai_proc: str | None
  titre_proc_fr: str | None
  titre_proc_ar: str | None
  frais_proc_fr: str | None
  frais_proc_ar: str | None
  delai_proc_fr: str | None
  delai_proc_ar: str | None
  description_proc_fr: str | None
  description_proc_ar: str | None

  statut_proc: str
  date_obsolete: datetime | None

  administration: AdministrationOut
  pieces: list[PieceOut]
  etapes: list[EtapeOut]

# ask API pydantic Schemas
class QuestionOut(BaseModel):
  model_config = ConfigDict(from_attributes=True)
  id_question: str
  question_content: str
  question_date: datetime

class QuestionIn(BaseModel):
  model_config = ConfigDict(populate_by_name=True)
  question_content: str = Field(alias="question")
  conversation_id: str | None = None


class SourceOut(BaseModel):
  model_config = ConfigDict(from_attributes=True)
  id_procedure : str
  titre_proc_ar : str
  titre_proc_fr : str
  administration : AdministrationOut

class AnswerOut(BaseModel):
  id_question: str
  question_content: str
  answer: str
  sources: list[SourceOut]

# GET /admin/documents API pydantic Schemas
class ExtractionSummaryOut(BaseModel):
  model_config = ConfigDict(from_attributes=True)
  id_extraction: str
  filename: str
  status: str
  procedure_count: int
  error_message: str | None

class DocumentOut(BaseModel):
  model_config = ConfigDict(from_attributes=True)
  id_document: str
  titre_doc: str
  url_source: str | None
  date_upload: datetime
  extraction: ExtractionSummaryOut | None

class ExtractionDetailOut(BaseModel):
  model_config = ConfigDict(from_attributes=True)
  id_extraction: str
  filename: str
  status: str
  payload: list[dict] | None
  procedure_count: int
  date_creation: datetime
  id_document: str | None
  error_message: str | None

class BilingualText(BaseModel):
  model_config = ConfigDict(str_strip_whitespace=True)
  fr: str = Field(min_length=1)
  ar: str = Field(min_length=1)

class ExtractedProcedure(BaseModel):
  proc_title: BilingualText
  proc_description: BilingualText | None = None
  proc_administration: list[BilingualText] = Field(default_factory=list)
  proc_pieces: list[BilingualText] = Field(default_factory=list)
  proc_steps: list[BilingualText] = Field(default_factory=list)
  proc_law: list[str] = Field(default_factory=list)
  fee: BilingualText | None = None
  proc_delai: BilingualText | None = None

class ExtractionUpdate(BaseModel):
  # payload: list[dict]
  payload: list[ExtractedProcedure]

class AdministrationUpdate(BaseModel):
  nom_administration_ar: str 
  nom_administration_fr: str 
  addr_administration: str | None = None
  url_administration: str | None = None

class Trackrequest(BaseModel):
  id_procedure: str
  lang: Literal["fr", "ar"] = "fr"

class DocumentUpdate(BaseModel):
  est_coche: bool | None = None
  note: str | None = None

class UserCreate(BaseModel):
  nom_user : str = Field(min_length=2, max_length=50)
  prenom_user : str = Field(min_length=2, max_length=50)
  userName : str = Field(min_length=2, max_length=30)
  phone_user : str | None = Field(default=None, min_length=2, max_length=50)
  email_user : EmailStr
  password : str = Field(min_length=8, max_length=72)

  @field_validator("userName")
  @classmethod
  def username_format(cls, v: str) -> str:
    if not re.fullmatch(r"[a-zA-Z0-9_.-]+", v):
      raise ValueError("Seuls lettres, chiffres, . _ - sont autorisés")
    return v.lower()

  @field_validator("phone_user")
  @classmethod
  def phone_format(cls, v: str | None) -> str | None:
    if v and not re.fullmatch(r"[0-9+\s()-]{8,20}", v):
      raise ValueError("Numéro de téléphone invalide")
    return v

class UserLogin(BaseModel):
  userName: str
  password: str

