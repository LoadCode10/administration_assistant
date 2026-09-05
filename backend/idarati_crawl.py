import requests
import certifi
import time
import json
import urllib3

urllib3.disable_warnings()

BASE = "https://idarati.ma/api/informational"
HEADERS = {"User-Agent": "Mozilla/5.0"}

def get_idarati_data():
  try:
    with open("idarati_procedures.json","r",encoding="utf-8") as file:
      return json.load(file)
  except FileNotFoundError:
    return []

def get_sub_themes_ids(idarati_data):

  thematics_ids = []
  sub_thematic_ids = []
  for data in idarati_data:
    print(data["title"])
    print("************************")
    for sub_categorie_data in data["subCategories"]:
      print(sub_categorie_data["title"])
      print("************************")
      for thematic_data in sub_categorie_data["thematics"]:
        print(f"+ {thematic_data["id"]}: {thematic_data["title"]}")
        thematics_ids.append(
          {
            "theme_id":thematic_data["id"],
            "theme_title": thematic_data["title"]
          }
        )
        for sub_thematic_data in thematic_data["subThematics"]:
          print(f"=> {sub_thematic_data["id"]}: {sub_thematic_data["title"]}")
          sub_thematic_ids.append(sub_thematic_data["id"])
        print("--------------")

  return sub_thematic_ids

def get_procedures_ids(sub_theme_id):
  url = f"{BASE}/sub-thematics/{sub_theme_id}/procedures"
  resp = requests.get(
    url, 
    headers=HEADERS,
    verify=False
  )
  resp.raise_for_status()
  items = resp.json()
  procedures_data = {
    "sub_id": sub_theme_id,
    "procs_ids": {item["id"] for item in items}
  }
  return procedures_data

def collect_all_procedures_ids(idarati_data):
  sub_ids = get_sub_themes_ids(idarati_data)
  all_results = []
  for sub_id in sub_ids:
    try:
      result = get_procedures_ids(sub_id)
      result["procs_ids"] = list(result["procs_ids"])
      all_results.append(result)
      print(f"{sub_id}: {len(result['procs_ids'])} procedures")
    except Exception as e:
      print(f"Failed {sub_id}: {e}")
    time.sleep(0.5)
  return all_results

def save_procs_ids(all_proc_ids):
  with open("procedures_ids.json", "w", encoding="utf-8") as file:
    json.dump(all_proc_ids,file,ensure_ascii=False,indent=2)
  print(f"Saved {len(all_proc_ids)} procedure ids.")

if __name__ == "__main__":
  idarati_data = get_idarati_data()
  all_procs_ids = collect_all_procedures_ids(idarati_data)
  save_procs_ids(all_procs_ids)