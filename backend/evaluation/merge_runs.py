"""
Merges several partial runs (e.g. 20 questions per day) into one run file.

  python evaluation/merge_runs.py --out answers_vector_v1 \
      evaluation/runs/answers_test.json evaluation/runs/answers_p2.json evaluation/runs/answers_p3.json

Works for answer runs (run_rag.py) and for scored files (run_ragas.py, *_scores.json):

  python evaluation/merge_runs.py --out scores_vector_v1 \
      evaluation/runs/answers_test_scores.json evaluation/runs/answers_p2_scores.json

Checks before merging:
  - every part used the same setup (dataset, retrieval mode, top_k, LLM, embedding model),
    and for scored files the same judge (model, API, Ragas version); otherwise the scores
    wouldn't be comparable and the merge is refused;
  - a question present in several parts is kept once: the version WITHOUT error wins
    (no generation error and no failed score),
    so a later "retry" part can replace questions that failed earlier;
  - questions of the dataset that are still missing or in error are listed, so you know
    what to run next.
The parts are not modified. The merged run is written to evaluation/runs/<out>.json.
"""
import argparse
import json
import os
import sys

# Settings that must be identical in every part
SAME_SETUP = ("dataset", "retrieval_mode", "top_k", "llm_model", "embedding_model", "retrieval_only")


# For scored files (run_ragas.py), the judge must be the same too
SAME_JUDGE = ("model", "base_url", "extra_body", "ragas_version")


def is_ok(row):
  generated = not row.get("error") or row["error"] == "no_procedures_retrieved"
  return generated and not row.get("score_errors")


def main():
  parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
  parser.add_argument("parts", nargs="+", help="run files to merge, in any order")
  parser.add_argument("--out", required=True, help="name of the merged run, e.g. answers_vector_v1")
  parser.add_argument("--dataset", help="dataset file, to list the questions not run yet")
  parser.add_argument("--out-dir", default=os.path.join("evaluation", "runs"))
  args = parser.parse_args()

  runs = [(path, json.load(open(path, encoding="utf-8"))) for path in args.parts]

  # 1. Same setup everywhere
  ref_path, ref = runs[0]
  for path, run in runs[1:]:
    diff = {k: (ref["config"].get(k), run["config"].get(k)) for k in SAME_SETUP
            if ref["config"].get(k) != run["config"].get(k)}
    ref_judge, judge = ref["config"].get("judge") or {}, run["config"].get("judge") or {}
    diff.update({f"judge.{k}": (ref_judge.get(k), judge.get(k)) for k in SAME_JUDGE
                 if ref_judge.get(k) != judge.get(k)})
    if diff:
      sys.exit(f"Refusé : {path} n'a pas la même configuration que {ref_path} : {diff}")

  # 2. One row per question; a row without error beats a row with error
  merged, sources = {}, {}
  for path, run in runs:
    for row in run["rows"]:
      qid = row["question_id"]
      if qid not in merged or (not is_ok(merged[qid]) and is_ok(row)):
        merged[qid] = row
        sources[qid] = os.path.basename(path)

  # Keep the dataset order (s001, s002, ...) when the dataset is given
  order = None
  if args.dataset:
    order = [item["question_id"] for item in json.load(open(args.dataset, encoding="utf-8"))]
    rows = [merged[q] for q in order if q in merged]
  else:
    rows = sorted(merged.values(), key=lambda r: r["question_id"])

  config = dict(ref["config"])
  config.update({
    "experiment_name": args.out,
    "merged_from": [os.path.basename(p) for p, _ in runs],
    "parts_dates": [run["config"].get("date") for _, run in runs],
    "start": None, "limit": None,
  })

  os.makedirs(args.out_dir, exist_ok=True)
  out_path = os.path.join(args.out_dir, f"{args.out}.json")
  if os.path.exists(out_path):
    sys.exit(f"{out_path} existe déjà : choisis un autre --out.")
  json.dump({"config": config, "rows": rows}, open(out_path, "w", encoding="utf-8"),
            ensure_ascii=False, indent=2)

  errors = [r["question_id"] for r in rows if not is_ok(r)]
  config.pop("judge_usage_last_session", None)
  print(f"{len(rows)} questions fusionnées depuis {len(runs)} fichiers -> {out_path}")
  print(f"  en erreur : {len(errors)}" + (f"  ({', '.join(errors)})" if errors else ""))
  if order:
    missing = [q for q in order if q not in merged]
    print(f"  pas encore lancées : {len(missing)}" + (f"  ({missing[0]} … {missing[-1]})" if missing else ""))


if __name__ == "__main__":
  main()
