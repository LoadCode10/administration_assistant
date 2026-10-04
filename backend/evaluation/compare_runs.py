"""
Compares two retrieval runs question by question.

  python evaluation/compare_runs.py evaluation/runs/retrieval_vector_v2.json evaluation/runs/retrieval_keyword_v2.json

For each question with a known answer, it checks whether the correct procedure is in the
top k (default 3, what Gemini receives) in run A and in run B, and sorts the questions into:

  both      : found by A and by B
  only A    : found by A, missed by B
  only B    : found by B, missed by A   <- what B could bring to A (e.g. in a hybrid)
  neither   : missed by both            <- no fusion of A and B can fix these

The overall Hit@k difference comes only from "only A" vs "only B". The sign test below says
whether that difference is larger than what chance alone would produce on this many questions.

Options:
  --k 5           compare on Hit@5 instead of Hit@3
  --show only_b   list the questions of one group (only_a, only_b, neither, all)
"""
import argparse
import json
from math import comb


def load(path):
  run = json.load(open(path, encoding="utf-8"))
  rows = {r["question_id"]: r for r in run["rows"] if r.get("expected_ids")}
  return run["config"]["experiment_name"], rows


def hit(row, k):
  rank = row.get("rank")
  return bool(rank and rank <= k)


def sign_test(a_only, b_only):
  """Two-sided exact sign test (McNemar): probability of a split at least this uneven by chance."""
  n = a_only + b_only
  if n == 0:
    return 1.0
  low = min(a_only, b_only)
  p = 2 * sum(comb(n, i) for i in range(low + 1)) / 2 ** n
  return min(p, 1.0)


def describe(row, k):
  rank = row.get("rank")
  where = f"rank {rank}" if rank else "not found"
  return f"{where:<10}| top {k}: " + " / ".join((row.get("retrieved_titles") or [])[:k])


def main():
  parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
  parser.add_argument("run_a")
  parser.add_argument("run_b")
  parser.add_argument("--k", type=int, default=3)
  parser.add_argument("--show", choices=("only_a", "only_b", "neither", "all"))
  args = parser.parse_args()

  name_a, rows_a = load(args.run_a)
  name_b, rows_b = load(args.run_b)
  common = [qid for qid in rows_a if qid in rows_b]
  if len(common) < max(len(rows_a), len(rows_b)):
    print(f"Attention : {len(common)} questions en commun seulement "
          f"({len(rows_a)} dans A, {len(rows_b)} dans B).")

  groups = {"both": [], "only_a": [], "only_b": [], "neither": []}
  for qid in common:
    a, b = hit(rows_a[qid], args.k), hit(rows_b[qid], args.k)
    key = "both" if a and b else "only_a" if a else "only_b" if b else "neither"
    groups[key].append(qid)

  n = len(common)
  pct = lambda x: f"{x:>3} ({x / n:5.1%})"  # noqa: E731
  print(f"A = {name_a}\nB = {name_b}\nHit@{args.k} sur {n} questions\n")
  print(f"  both      {pct(len(groups['both']))}")
  print(f"  only A    {pct(len(groups['only_a']))}")
  print(f"  only B    {pct(len(groups['only_b']))}")
  print(f"  neither   {pct(len(groups['neither']))}")
  hit_a = len(groups["both"]) + len(groups["only_a"])
  hit_b = len(groups["both"]) + len(groups["only_b"])
  print(f"\n  Hit@{args.k} A = {hit_a / n:.1%}   Hit@{args.k} B = {hit_b / n:.1%}")
  print(f"  Plafond si on combinait parfaitement A et B : {(n - len(groups['neither'])) / n:.1%}")

  p = sign_test(len(groups["only_a"]), len(groups["only_b"]))
  verdict = "différence réelle" if p < 0.05 else "pas de différence prouvée (peut être du hasard)"
  print(f"  Sign test : p = {p:.3f} -> {verdict}")

  shown = ("only_a", "only_b", "neither") if args.show == "all" else (args.show,) if args.show else ()
  for key in shown:
    label = {"only_a": f"trouvées par A seulement ({name_a})",
             "only_b": f"trouvées par B seulement ({name_b})",
             "neither": "manquées par les deux"}[key]
    print(f"\n--- {label} : {len(groups[key])}")
    for qid in groups[key]:
      ra, rb = rows_a[qid], rows_b[qid]
      print(f"\n{qid} [{ra.get('lang')}, {ra.get('category')}] {ra['question']}")
      print(f"   A: {describe(ra, args.k)}")
      print(f"   B: {describe(rb, args.k)}")


if __name__ == "__main__":
  main()
