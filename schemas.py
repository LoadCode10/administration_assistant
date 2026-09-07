from pydantic import BaseModel, ConfigDict, Field
from datetime import datetime

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
  titre_proc : str
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

class ExtractionUpdate(BaseModel):
  payload: list[dict]

class AdministrationUpdate(BaseModel):
  nom_administration: str 
  addr_administration: str | None
  url_administration: str | None

class Trackrequest(BaseModel):
  id_procedure: str

class DocumentUpdate(BaseModel):
  est_coche: bool | None = None
  note: str | None = None