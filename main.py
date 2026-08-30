from fastapi import FastAPI, HTTPException, Depends
from sqlalchemy.orm import Session
from database import get_db, SessionLocal
from test_llm_generation import my_retriever, build_facts
from google import genai
from dotenv import load_dotenv
from datetime import datetime
import os
import models
import schemas
import json
import uuid

load_dotenv()

app = FastAPI()

llm_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

@app.get("/procedures/{proc_id}", response_model=schemas.ProcedureOut)
def get_proc_by_id(proc_id: str, db: Session = Depends(get_db)):
  my_procedure = db.query(models.Procedure).filter_by(
    id_procedure = proc_id
  ).first()
  if my_procedure is None:
    raise HTTPException(status_code=404, detail="Procedure Not Found")
  return my_procedure

# http://localhost:8000/procedures?proc_title=association&proc_admin_name=CRI
@app.get("/procedures", response_model=list[schemas.ProcedureOut])
def list_procedures(
  proc_title: str | None = None,
  proc_admin_name: str | None = None,
  db: Session = Depends(get_db),
):
  procedures = db.query(models.Procedure)
  if proc_title is not None:
    procedures = procedures.filter(
      models.Procedure.titre_proc.ilike(f"%{proc_title}%")
    )
  if proc_admin_name is not None:
    procedures = procedures.filter(
      models.Procedure.administration.has(
        models.Administration.nom_administration.ilike(f"%{proc_admin_name}%")
      )
    )
  return procedures.all()

def generate_answer(question: str, facts: str) -> str:
  prompt = f"""Tu es un assistant administratif marocain. Tu réponds aux
  citoyens en te basant UNIQUEMENT sur les informations officielles fournies
  ci-dessous. Tu n'inventes JAMAIS d'information.

  RÈGLES:
  - Réponds dans la MÊME LANGUE que la question de l'utilisateur.
  - Utilise UNIQUEMENT les faits fournis. Ne devine pas.
  - Si aucune procédure fournie ne correspond à la question, dis clairement
    que tu n'as pas cette information.
  - Cite le nom de l'administration comme source.

  PROCÉDURES OFFICIELLES DISPONIBLES:
  {facts}

  QUESTION DE L'UTILISATEUR:
  {question}

  RÉPONSE:"""

  response = llm_client.models.generate_content(
      model="gemini-2.5-flash",
      contents=prompt,
  )
  return response.text

@app.post("/ask", response_model=schemas.AnswerOut)
def ask_question(
  payload: schemas.QuestionIn,
  db: Session = Depends(get_db)
):
  question = models.Question(
    question_content = payload.question_content,
    question_language = payload.question_language,
  )

  db.add(question)
  db.flush()

  retrieved_procedures = my_retriever(db, payload.question_content)

  if not retrieved_procedures:
    raise HTTPException(status_code=503, detail="Aucune procédure indexée.")

  facts = build_facts(retrieved_procedures)
  answer_text = generate_answer(payload.question_content, facts)

  reponse = models.Reponse(
    reponse_content = answer_text,
    reponse_language= payload.question_language,
    reponse_date = datetime.now(),
    id_question = question.id_question
  )

  db.add(reponse)
  db.commit()
  db.refresh(reponse)

  return schemas.AnswerOut(
    id_question=  question.id_question,
    question_content= question.question_content,
    answer= answer_text,
    sources= retrieved_procedures,
  )













# @app.post("/ask", response_model=schemas.QuestionOut)
# def ask_question(payload: schemas.QuestionIn, db: Session = Depends(get_db)):
#   user_question = models.Question(
#     question_language = payload.question_language,
#     question_content = payload.question_content
#   )
#   db.add(user_question)
#   db.commit()
#   db.refresh(user_question)
#   return user_question


# @app.get("/procedures", response_model=list[schemas.ProcedureOut])
# def get_procedures(db: Session = Depends(get_db)):
#   procedures = db.query(models.Procedure).all()
#   return procedures

# http://localhost:8000/procedures?proc_title=association
# @app.get("/procedures", response_model=list[schemas.ProcedureOut])
# def search_procs_by_title(proc_title: str | None = None, db: Session= Depends(get_db)):
#   procedures = db.query(models.Procedure)
#   if proc_title is not None:
#     procedures = procedures.filter(models.Procedure.titre_proc.ilike(f"%{proc_title}%"))
#   return procedures.all()

# http://localhost:8000/procedures?proc_admin_name=CRI
# @app.get("/procedures", response_model=list[schemas.ProcedureOut])
# def get_procs_by_administration(proc_admin_name: str | None = None, db: Session= Depends(get_db)):
#   procedures = db.query(models.Procedure)
#   if proc_admin_name is not None:
#     procedures = (
#       procedures
#       .join(models.Administration)
#       .filter(models.Administration.nom_administration.ilike(f"%{proc_admin_name}%"))
#     )
#   return procedures.all()




