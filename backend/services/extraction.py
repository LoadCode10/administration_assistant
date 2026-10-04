import json
import os

import pymupdf


from database import SessionLocal
import models
from services.rag import llm_client

EXTRACTIONS_DIR = "extractions"
os.makedirs(EXTRACTIONS_DIR, exist_ok=True)

EXTRACTION_PROMPT = """
  You are a precise information-extraction engine for official Moroccan
  administrative procedures. You read administrative documents and output
  structured JSON. You never invent information.

  TASK
  From the document text below, extract every administrative PROCEDURE
  into a JSON array.

  DEFINITION — what counts as ONE procedure
  A "procedure" is one complete administrative goal a citizen or business
  sets out to accomplish (for example: "creating a company"). Numbered or
  sequential actions that serve that single goal are STEPS of that one
  procedure — they are NOT separate procedures. Only split into multiple
  procedures if the document truly describes distinct, independent goals.

  OUTPUT SCHEMA
  Return ONLY a JSON array. Each element:
  {
    "proc_title": { "fr": string, "ar": string },
    "proc_description": { "fr": string, "ar": string } | null,
    "proc_administration": [{ "fr": string, "ar": string }],
    "proc_pieces": [{ "fr": string, "ar": string }],
    "proc_steps": [{ "fr": string, "ar": string }],   // in order
    "proc_law": string[],                             // original language only
    "fee": { "fr": string, "ar": string } | null,
    "proc_delai": { "fr": string, "ar": string } | null
  }

  RULES
  - Output ONLY the JSON array. No markdown, no ```json fences, no commentary.
  - Every text value must be given in French AND Arabic. Copy the text
    verbatim in the document's own language, and translate it into the other
    using official Moroccan administrative terminology, not a literal
    translation (e.g. « الشهادة السلبية » = « certificat négatif »).
  - Keep numbers, amounts, dates and legal references identical in both languages.
  - Never guess typical values. If the document doesn't state something,
    use null (or [] for lists).
  - Every element must include every key above, even when the value is null or [].

  DOCUMENT
  <<<
  {document_text}
  >>>
  """

def extract_text(file_path: str) -> str:
  with open(file_path, 'r', encoding="utf-8") as file:
    content = file.read()
  return content

def extract_pdf_text(file_path: str) -> str:
  doc = pymupdf.open(file_path)
  text = "\n".join(page.get_text() for page in doc)
  doc.close()
  if len(text.strip()) < 100:
    raise ValueError("Aucun texte extrait — le PDF est probablement scanné")
  return text

def read_document_text(file_path: str) -> str:
  ext = os.path.splitext(file_path)[1].lower()
  if ext == ".txt":
    return extract_text(file_path)
  if ext == ".pdf":
    return extract_pdf_text(file_path)
  raise ValueError(f"Format non supporté : {ext}")

def extract_with_llm(text: str) -> tuple[list, dict]:
  full_prompt = EXTRACTION_PROMPT.replace("{document_text}", text)

  response = llm_client.models.generate_content(
      model="gemini-2.5-flash",
      contents=full_prompt,
      config={"response_mime_type": "application/json"},
  )

  usage = response.usage_metadata
  tokens = {
    "prompt_tokens": usage.prompt_token_count if usage else None,
    "output_tokens": usage.candidates_token_count if usage else None,
  }

  raw = response.text

  try:
      data = json.loads(raw)
  except json.JSONDecodeError as e:
      raise ValueError(f"Réponse LLM invalide : {raw[:200]}") from e

  if not isinstance(data, list):
      raise ValueError("Le LLM n'a pas retourné un tableau JSON")

  return data, tokens

def run_extraction(extraction_id:str, file_path:str, user_id: str | None = None):
  db = SessionLocal()
  try:
    extraction = db.query(models.Extraction).filter_by(
      id_extraction = extraction_id
    ).first()

    if extraction is None:
      return
    try:
      text = read_document_text(file_path)
      procedures, tokens= extract_with_llm(text)
      extraction.payload = procedures

      extract_path = os.path.join(EXTRACTIONS_DIR, extraction.filename)
      with open(extract_path, "w", encoding="utf-8") as f:
        json.dump(procedures, f, ensure_ascii=False, indent=2)

      db.add(models.TokenUsage(
        id_user=user_id,
        feature="extraction",
        model="gemini-2.5-flash",
        prompt_tokens=tokens.get("prompt_tokens") or 0,
        output_tokens=tokens.get("output_tokens") or 0,
      ))

      extraction.status = "pending_review"
    except Exception as e:
      extraction.status = "failed"
      extraction.error_message = str(e)
    db.commit()
  finally:
    db.close()

