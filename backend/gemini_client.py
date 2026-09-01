import os
from dotenv import load_dotenv
from fastapi import HTTPException, status
from google import genai
from google.genai.errors import APIError

load_dotenv()

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

MODEL = "gemini-3.6-flash"


def generate(prompt: str, response_mime_type: str | None = None) -> str:
  config = {"response_mime_type": response_mime_type} if response_mime_type else None
  try:
    response = client.models.generate_content(
      model=MODEL,
      contents=prompt,
      config=config,
    )
  except APIError as e:
    raise HTTPException(
      status_code=status.HTTP_502_BAD_GATEWAY,
      detail=f"Gemini API error: {e}",
    )
  return response.text
