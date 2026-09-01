import json
import uuid
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()

class Procedure(BaseModel):
  proc_id: str
  proc_title: str
  proc_pieces: list[str]
  proc_administration: str

class ProcedureAI(Procedure):
  fee: str | None
  proc_steps: list[str]

class QuestionCreate(BaseModel):
  id_user: str
  question_content: str
  question_language: str

class Question(QuestionCreate):
  id_question: str


def save_questions():
  with open("questions.json", "w") as file:
    json.dump(questions, file, indent=2, ensure_ascii=False)

def load_data(file_path: str):
  try:
    with open(file_path, 'r') as file:
      return json.load(file)
  except FileNotFoundError:
    return []

procedures = load_data("procedures.json")
questions = load_data("questions.json")

@app.get("/health")
def health_check():
  return {"status": "ok"}

@app.get('/procedures', response_model=list[Procedure])
def get_procedures(administration: str | None = None):
  if administration is None:
    return procedures
  procedures_administration = []
  for proc in procedures:
    if proc["proc_administration"] == administration:
      procedures_administration.append(proc)
  return procedures_administration
  # return [proc for proc in procedures if proc["proc_administration"] == administration]


@app.get('/procedures/{item_id}', response_model=Procedure)
def get_procedure_by_id(item_id: str):
  for proc in procedures:
    if proc["proc_id"] == item_id:
      return proc
  raise HTTPException(status_code=404, detail="Procedure Not Found")
  # return {"message": "Procedure Not Found"}
  

@app.post('/ask', response_model=Question)
def take_user_question(payload: QuestionCreate):
  question = Question(
    id_question=str(uuid.uuid4()),
    **payload.model_dump()
  )
  #The **payload.model_dump() just unpacks the client's fields into the new object so you don't retype them.
  questions.append(question.model_dump())
  save_questions()
  return question

# @app.get('/procedures', response_model=list[Procedure])
# def get_procedures_by_administration(administration: str | None=None):
#   procedures_administration = []
#   for proc in procedures:
#     if proc["proc_administration"] == administration:
#       procedures_administration.append(proc)
#   return procedures_administration


# @app.get("/items")
# def get_items():
#   return items

# @app.get("/items/{item_id}")
# def get_item_by_id(item_id: int):
#   for item in items:
#     if item["id"] == item_id:
#       return item
#   return {"error":"Item not found"}

# @app.post("/items")
# def create_item(item: dict):
#   items.append(item)
#   return {
#     "message":"item added succesfully!",
#     "item": item
#   }
