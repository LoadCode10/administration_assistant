"""
Retrieval scores of one run, from the `rank` of each question (free, no LLM call).

  python evaluation/quick_stats.py evaluation/runs/retrieval_vector.json

Hit@1 : the correct procedure is the first one retrieved
Hit@3 : it is among the 3 sent to Gemini in the chat (the key number)
Hit@k : it is among the k retrieved in this run (only shown when the run used --top-k > 3)
MRR   : average of 1/rank (1 = always first, 0.5 = always second, 0 = never found)
"""
import json
import sys
from collections import defaultdict

run = json.load(open(sys.argv[1], encoding="utf-8"))
top_k = run["config"].get("top_k", 3)
rows = [r for r in run["rows"] if r["expected_ids"]]          # skip "no answer" questions
errors = [r for r in run["rows"] if r["error"] and r["error"] != "no_procedures_retrieved"]
missing_rank = [r for r in rows if "rank" not in r]            # retrieval itself failed


def show(label, group):
  n = len(group)
  ranks = [r.get("rank") for r in group]
  hit = lambda k: sum(1 for x in ranks if x and x <= k) / n  # noqa: E731
  mrr = sum(1 / x for x in ranks if x) / n
  deeper = f"  Hit@{top_k}={hit(top_k):6.1%}" if top_k > 3 else ""
  print(f"{label:<26} n={n:>3}  Hit@1={hit(1):6.1%}  Hit@3={hit(3):6.1%}{deeper}  MRR={mrr:.3f}")


cfg = run["config"]
print(f"{cfg['experiment_name']} | mode={cfg['retrieval_mode']} | top_k={top_k} | "
      f"dataset={cfg.get('dataset')} | retrieval_only={cfg.get('retrieval_only', False)}")
show("all", rows)
for key in ("lang", "category"):
  groups = defaultdict(list)
  for r in rows:
    groups[r.get(key)].append(r)
  for value, group in sorted(groups.items(), key=lambda kv: str(kv[0])):
    show(f"  {key}={value}", group)
print(f"errors: {len(errors)}" + (f" ({len(missing_rank)} without retrieval result)" if missing_rank else ""))
