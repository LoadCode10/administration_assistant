"""
Fills `expected_ids` in an evaluation dataset from `expected_titles`, using YOUR database.

Procedure ids are created when an import is approved, so they can't be known in advance and
they change if the database is reset. Run this once after importing the procedures, and
again after any reset:

  python evaluation/fill_expected_ids.py evaluation/datasets/synthetic_v1.json

The file is updated in place (a .bak copy is kept). Nothing is guessed: a title that isn't
found exactly (after normalizing spaces, case and apostrophes) is reported, not matched loosely.
"""
import json
import os
import re
import shutil
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import models  # noqa: E402
from database import SessionLocal  # noqa: E402


def norm(title: str) -> str:
  t = unicodedata.normalize("NFC", title or "").replace("’", "'").replace("‘", "'")
  return re.sub(r"\s+", " ", t).strip().lower()


def main():
  if len(sys.argv) != 2:
    sys.exit("usage: python evaluation/fill_expected_ids.py <dataset.json>")
  path = sys.argv[1]
  dataset = json.load(open(path, encoding="utf-8"))

  session = SessionLocal()
  by_title: dict[str, list[str]] = {}
  for pid, title in session.query(models.Procedure.id_procedure, models.Procedure.titre_proc_fr):
    by_title.setdefault(norm(title), []).append(pid)

  missing, duplicated, filled = [], [], 0
  for item in dataset:
    titles = item.get("expected_titles") or []
    ids = []
    for title in titles:
      found = by_title.get(norm(title), [])
      if not found:
        missing.append((item.get("question_id"), title))
      if len(found) > 1:
        duplicated.append((item.get("question_id"), title, len(found)))
      ids.extend(found)
    item["expected_ids"] = list(dict.fromkeys(ids))  # keep order, drop repeats
    filled += bool(ids)

  shutil.copyfile(path, path + ".bak")
  json.dump(dataset, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

  negatives = sum(1 for x in dataset if not x.get("expected_titles"))
  print(f"{filled} questions filled, {negatives} 'no answer' questions (left empty), "
        f"{len(missing)} titles not found -> {path}")
  for qid, title in missing:
    print(f"  NOT FOUND  {qid}: {title}")
  for qid, title, n in duplicated:
    print(f"  {n} procedures share this title (all ids kept)  {qid}: {title}")
  if missing:
    print("Missing titles: import that file, or check whether an admin renamed the procedure.")


if __name__ == "__main__":
  main()
