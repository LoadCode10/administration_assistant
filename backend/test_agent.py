import os
import json

import requests
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])


def resolve_redirect(uri: str) -> str:
  """Les URI de grounding sont des redirections Google : on suit pour connaître
  le domaine réel de la source."""
  try:
    resp = requests.head(uri, allow_redirects=True, timeout=10)
    return resp.url
  except requests.RequestException:
    return uri


def search_agencies(administration_nom: str, site_officiel: str, ville: str) -> dict:
  print(f"Recherche des agences {administration_nom} à {ville}...")

  prompt = f"""
  Recherche les implantations de « {administration_nom} » au Maroc, en particulier
  à {ville} et dans ses environs.

  Utilise en priorité le site officiel : {site_officiel}

  Si cette administration ne dispose que d'un seul siège national, indique-le
  clairement et donne uniquement cette adresse. N'invente pas d'agences locales.

  Si elle dispose d'un réseau d'agences, liste celles situées à {ville} ou à
  proximité. Pour chaque implantation, indique :
  - le nom de l'agence
  - l'adresse complète
  - le numéro de téléphone si disponible
  - les horaires d'ouverture si disponibles

  N'invente aucune information. Si une donnée est absente, dis-le explicitement.
  """

  response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents=prompt,
    config=types.GenerateContentConfig(
      tools=[types.Tool(google_search=types.GoogleSearch())]
    ),
  )

  web_sources = []
  if response.candidates:
    candidate = response.candidates[0]
    if candidate.grounding_metadata and candidate.grounding_metadata.grounding_chunks:
      for chunk in candidate.grounding_metadata.grounding_chunks:
        if chunk.web:
          real_url = resolve_redirect(chunk.web.uri)
          web_sources.append({
            "title": chunk.web.title,
            "uri": real_url,
            "officielle": site_officiel in real_url,
          })

  return {
    "texte": response.text,
    "sources": web_sources,
    "source_officielle_trouvee": any(s["officielle"] for s in web_sources),
  }


def structure_agencies(texte: str) -> list:
  """Deuxième appel : transforme le texte en JSON. La recherche et le mode JSON
  ne peuvent pas être combinés dans un même appel."""
  prompt = f"""
  Transforme le texte ci-dessous en tableau JSON. Chaque élément :
  {{
    "nom_agence": string,
    "adresse": string,
    "ville": string,
    "telephone": string | null,
    "horaires": string | null
  }}

  Ne retourne que le tableau JSON, sans commentaire.
  N'invente rien : si une information est absente du texte, mets null.

  TEXTE
  <
  {texte}
  >>>
  """

  response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents=prompt,
    config={"response_mime_type": "application/json"},
  )

  try:
    data = json.loads(response.text)
  except json.JSONDecodeError:
    return []

  return data if isinstance(data, list) else []


if __name__ == "__main__":
  result = search_agencies("CNSS", "cnss.ma", "Rabat")

  print("\n--- Texte ---")
  print(result["texte"])

  print("\n--- Sources ---")
  for s in result["sources"]:
    marque = "✓ officielle" if s["officielle"] else "✗ non officielle"
    print(f"{marque} — {s['title']} — {s['uri']}")

  print(f"\nSource officielle trouvée : {result['source_officielle_trouvee']}")

  if result["source_officielle_trouvee"]:
    print("\n--- JSON structuré ---")
    print(json.dumps(structure_agencies(result["texte"]), indent=2, ensure_ascii=False))
  else:
    print("\nAucune source officielle — résultat non exploitable.")


