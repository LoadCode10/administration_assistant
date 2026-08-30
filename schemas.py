from pydantic import BaseModel, ConfigDict
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
  id_procedure = str
  titre_proc = str
  administration = AdministrationOut

class AnswerOut(BaseModel):
  id_question: str
  question_content: str
  answer: str
  sources: list[SourceOut]
