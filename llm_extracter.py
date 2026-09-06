import json
import uuid
import os
from dotenv import load_dotenv
load_dotenv()
from google import genai

def extract_text(file_path):
  with open(file_path, 'r', encoding="utf-8") as file:
    content = file.read()
  return content

def save_extracted_proc(data_proc):
  with open("extracted_procs.json", 'w', encoding="utf-8") as file:
    json.dump(data_proc,file, indent=2, ensure_ascii=False)

# PROMPT = """
#   You are a precise information-extraction engine for official Moroccan
#   administrative procedures. You read administrative documents and output
#   structured JSON. You never invent information.

#   TASK
#   From the document text below, extract every administrative PROCEDURE
#   into a JSON array.

#   DEFINITION — what counts as ONE procedure
#   A "procedure" is one complete administrative goal a citizen or business
#   sets out to accomplish (for example: "creating a company"). Numbered or
#   sequential actions that serve that single goal are STEPS of that one
#   procedure — they are NOT separate procedures. Only split into multiple
#   procedures if the document truly describes distinct, independent goals.

#   OUTPUT SCHEMA
#   Return ONLY a JSON array. Each element:
#   {
#     "proc_title": string,             // the procedure's name
#     "proc_administration": string[],  // administration(s) involved; [] if none stated
#     "proc_pieces": string[],          // required documents; [] if none stated
#     "proc_steps": string[],           // ordered steps, each a short sentence; [] if none
#     "fee": string | null              // fees exactly as stated; null if not stated
#   }

#   RULES
#   - Output ONLY the JSON array. No markdown, no ```json fences, no commentary.
#   - Keep the document's original language (French) in all extracted values.
#   - Never guess typical values. If the document doesn't state something,
#     use null (or [] for lists).
#   - Extract fees exactly as written; do not convert or approximate.

#   DOCUMENT
#   <<<
#   {paste the document text here}
#   >>>
# """

# client = genai.Client(api_key = os.environ["GEMINI_API_KEY"])

# document_text = extract_text("creation_entreprise.txt")

# full_prompt = PROMPT.replace("{paste the document text here}", document_text)

# response = client.models.generate_content(
#   model="gemini-2.5-flash",
#   contents=full_prompt,
#   config={"response_mime_type": "application/json"}
# )

# raw = response.text
# print(f"the type of raw is: {type(raw)}")
# print("################")

# cleaned = raw.strip()
# if cleaned.startswith("```"):
#     cleaned = cleaned.removeprefix("```json").removeprefix("```").removesuffix("```").strip()

# try:
#     data = json.loads(cleaned)
#     print(f"the type of data is: {type(data)}")
# except json.JSONDecodeError as e:
#     print("Parsing failed. Raw model output was:")
#     print(raw)
#     raise e

# data = json.loads(raw)
# print(f"The type of data is: {type(data)}")
# print("################")
# print(json.dumps(data, indent=2, ensure_ascii=False))
# save_extracted_proc(data)
# print("File successfully saved!")


def extract_with_llm(text: str) -> str:
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
      "proc_title": string,               // the procedure's name
      "proc_description": string | null,  // one-sentence summary of its purpose
      "proc_administration": string[],    // administration(s) involved; [] if none stated
      "proc_pieces": string[],            // required documents; [] if none stated
      "proc_steps": string[],             // ordered steps, each a short sentence; [] if none
      "proc_law": string[],               // legal texts cited; [] if none stated
      "fee": string | null,               // fees exactly as stated; null if not stated
      "proc_delai": string | null         // processing time as stated; null if not stated
    }

    RULES
    - Output ONLY the JSON array. No markdown, no ```json fences, no commentary.
    - Keep the document's original language in all extracted values. Do not translate.
    - Never guess typical values. If the document doesn't state something,
      use null (or [] for lists).
    - Extract fees and delays exactly as written; do not convert or approximate.
    - Every element must include every key above, even when the value is null or [].

    DOCUMENT
    <
    {document_text}
    >>>
    """

  full_prompt = EXTRACTION_PROMPT.replace("{document_text}", text)

  client = genai.Client(api_key = os.environ["GEMINI_API_KEY"])

  response = client.models.generate_content(
      model="gemini-2.5-flash",
      contents=full_prompt,
      config={"response_mime_type": "application/json"},
  )

  raw = response.text

  try:
      data = json.loads(raw)
  except json.JSONDecodeError as e:
      raise ValueError(f"Réponse LLM invalide : {raw[:200]}") from e

  if not isinstance(data, list):
      raise ValueError("Le LLM n'a pas retourné un tableau JSON")

  return data