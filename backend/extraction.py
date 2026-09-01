import json
from fastapi import UploadFile, HTTPException, status
from pypdf import PdfReader
from docx import Document
import io
from gemini_client import generate

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
  "proc_title": string,             // the procedure's name
  "proc_administration": string[],  // administration(s) involved; [] if none stated
  "proc_pieces": string[],          // required documents; [] if none stated
  "proc_steps": string[],           // ordered steps, each a short sentence; [] if none
  "fee": string | null              // fees exactly as stated; null if not stated
}

RULES
- Output ONLY the JSON array. No markdown, no ```json fences, no commentary.
- Keep the document's original language (French) in all extracted values.
- Never guess typical values. If the document doesn't state something,
  use null (or [] for lists).
- Extract fees exactly as written; do not convert or approximate.

DOCUMENT
<<<
{document_text}
>>>
"""


def _extract_text_from_pdf(raw: bytes) -> str:
  reader = PdfReader(io.BytesIO(raw))
  return "\n".join(page.extract_text() or "" for page in reader.pages)


def _extract_text_from_docx(raw: bytes) -> str:
  document = Document(io.BytesIO(raw))
  return "\n".join(paragraph.text for paragraph in document.paragraphs)


def _extract_text_from_json(raw: bytes) -> str:
  data = json.loads(raw.decode("utf-8"))
  return json.dumps(data, ensure_ascii=False, indent=2)


def extract_text_from_upload(file: UploadFile, raw: bytes) -> str:
  filename = (file.filename or "").lower()

  if filename.endswith(".pdf"):
    return _extract_text_from_pdf(raw)
  if filename.endswith(".docx"):
    return _extract_text_from_docx(raw)
  if filename.endswith(".json"):
    return _extract_text_from_json(raw)
  if filename.endswith(".txt"):
    return raw.decode("utf-8")

  raise HTTPException(
    status_code=status.HTTP_400_BAD_REQUEST,
    detail=f"Unsupported file type: {file.filename}",
  )


def extract_procedures_from_text(document_text: str) -> list[dict]:
  prompt = EXTRACTION_PROMPT.replace("{document_text}", document_text)
  raw = generate(prompt, response_mime_type="application/json")
  try:
    data = json.loads(raw)
  except json.JSONDecodeError:
    raise HTTPException(
      status_code=status.HTTP_502_BAD_GATEWAY,
      detail="LLM extraction did not return valid JSON",
    )
  if not isinstance(data, list):
    raise HTTPException(
      status_code=status.HTTP_502_BAD_GATEWAY,
      detail="LLM extraction did not return a JSON array",
    )
  return data
