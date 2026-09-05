import requests
import certifi
import time
import json
import urllib3

urllib3.disable_warnings()

BASE = "https://idarati.ma/api/informational"
HEADERS = {"User-Agent": "Mozilla/5.0"}

def get_all_procedures_ids():
  try:
    with open("procedures_ids.json", "r", encoding="utf-8") as file:
      return json.load(file)
  except FileNotFoundError:
    return []
    
all_procedures_ids = get_all_procedures_ids()

def get_procs_ids(sub_proc_id):
  for proc in all_procedures_ids:
    if sub_proc_id == proc["sub_id"]:
      print(f"you get all procedures ids related to {proc["sub_id"]} sub_id")
      return proc["procs_ids"]
  print("Procedures IDS not found.")
  return []

def fetch_data(url):
  resp = requests.get(url, headers=HEADERS, verify=False)
  resp.raise_for_status()
  return resp.json()

def fetch_procedure_data(proc_id):
  proc_detail = fetch_data(f"{BASE}/procedures/{proc_id}")
  proc_documents = fetch_data(f"{BASE}/procedures/{proc_id}/documents")
  admin = proc_detail.get("administrationInCharge")

  return {
    "proc_title": proc_detail.get("title"),
    "proc_administration": [admin["title"]] if admin and admin.get("title") else [],
    "proc_pieces": [d["title"] for d in proc_documents if d.get("title")],
    "proc_steps": [],
    "fee": proc_detail.get("price"),
    "proc_delai": proc_detail.get("delay"),
  }

def get_procedures_data(proc_ids_array):
  procedures_data = []
  for proc_id in proc_ids_array:
    try:
      proc_data = fetch_procedure_data(proc_id)
      procedures_data.append(proc_data)
      print(f"{proc_data['proc_title']}")
    except Exception as e:
      print(f"FAILED {proc_id}: {e}")
    time.sleep(0.5)
  return procedures_data

def save_fetched_data(procedures_data):
  with open("fetched_data.json", "w", encoding="utf-8") as file:
    json.dump(procedures_data,file,ensure_ascii=False,indent=2)
  print(f"Saved {len(procedures_data)} procedures.")

if __name__ == "__main__":
  my_procs_ids = get_procs_ids("a1ae09b2-ec5c-41dc-b0b1-b0e619a2faf4")
  print(my_procs_ids)
  all_procedures_data = get_procedures_data(my_procs_ids)
  save_fetched_data(all_procedures_data)