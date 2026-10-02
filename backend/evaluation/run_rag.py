"""
Step 1 of the evaluation: run the real RAG pipeline on every question of a dataset and save
exactly what happened (retrieved procedures, the facts sent to Gemini, the answer, timings,
tokens). No scoring here: run_ragas.py scores a saved run, analyze_results.py reads the scores.

Keeping the three steps separate means you pay for the Gemini answers once per experiment,
and can re-score or re-analyze the same answers as often as you like.

Usage (from the backend folder or inside the container):
  python evaluation/run_rag.py --dataset evaluation/datasets/golden_v1.json \
      --name baseline_vector --mode vector --top-k 3
"""
import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SessionLocal  # noqa: E402
from services import rag  # noqa: E402

# build_facts joins procedure blocks with this separator. We rebuild the facts from one
# context per procedure, and check below that the result is identical to build_facts().
FACTS_SEPARATOR = "\n\n---\n\n"


def git_commit() -> str | None:
  try:
    return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True,
                                   stderr=subprocess.DEVNULL).strip()
  except (OSError, subprocess.CalledProcessError):
    return None


def run_one(session, item: dict, mode: str, top_k: int) -> dict:
  question = item["question"]
  row = {
    "question_id": item.get("question_id"),
    "question": question,
    "lang": item.get("lang") or rag.detect_lang(question),
    "category": item.get("category"),
    "expected_ids": item.get("expected_ids", []),
    "reference": item.get("reference"),
    "must_include": item.get("must_include", []),
    "error": None,
  }
  try:
    t0 = time.perf_counter()
    procedures = rag.my_retriever(session, question, top_k=top_k, mode=mode)
    t1 = time.perf_counter()

    lang = rag.detect_lang(question)
    # One string per procedure: this is what Ragas calls "retrieved_contexts"
    contexts = [rag.build_facts([p], lang) for p in procedures]
    facts = FACTS_SEPARATOR.join(contexts)
    # Guarantee the contexts are exactly the text Gemini receives
    assert facts == rag.build_facts(procedures, lang), "contexts differ from the real facts"

    answer, tokens = (None, {})
    if procedures:
      answer, tokens = rag.generate_answer(question, facts)
    t2 = time.perf_counter()

    retrieved_ids = [p.id_procedure for p in procedures]
    rank = next((i for i, pid in enumerate(retrieved_ids, start=1)
                 if pid in row["expected_ids"]), None)
    row.update({
      "retrieved_ids": retrieved_ids,
      "retrieved_titles": [p.titre_proc_fr for p in procedures],
      "rank": rank,                      # position of the first expected procedure, or None
      "contexts": contexts,
      "answer": answer,
      "retrieval_ms": round((t1 - t0) * 1000),
      "generation_ms": round((t2 - t1) * 1000),
      "prompt_tokens": tokens.get("prompt_tokens"),
      "output_tokens": tokens.get("output_tokens"),
    })
    if not procedures:
      row["error"] = "no_procedures_retrieved"
  except Exception as e:  # keep the failure visible: never let it become a silent zero
    row["error"] = f"{type(e).__name__}: {e}"
  return row


def main():
  parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
  parser.add_argument("--dataset", required=True)
  parser.add_argument("--name", required=True, help="experiment name, e.g. baseline_vector")
  parser.add_argument("--mode", choices=rag.RETRIEVAL_MODES, default=rag.RETRIEVAL_MODE)
  parser.add_argument("--top-k", type=int, default=3)
  parser.add_argument("--limit", type=int, default=0, help="only the first N questions (0 = all)")
  parser.add_argument("--sleep", type=float, default=2.0, help="pause between Gemini calls")
  parser.add_argument("--out-dir", default=os.path.join("evaluation", "runs"))
  args = parser.parse_args()

  dataset = json.load(open(args.dataset, encoding="utf-8"))
  if args.limit:
    dataset = dataset[: args.limit]

  config = {
    "experiment_name": args.name,
    "date": datetime.now().isoformat(timespec="seconds"),
    "git_commit": git_commit(),
    "dataset": os.path.basename(args.dataset),
    "retrieval_mode": args.mode,
    "top_k": args.top_k,
    "llm_model": rag.LLM_MODEL,
    "embedding_model": "BAAI/bge-m3",
  }
  os.makedirs(args.out_dir, exist_ok=True)
  out_path = os.path.join(args.out_dir, f"{args.name}.json")
  if os.path.exists(out_path):
    sys.exit(f"{out_path} existe déjà : choisis un autre --name (un run ne s'écrase jamais).")

  session = SessionLocal()
  rows = []
  for i, item in enumerate(dataset, start=1):
    row = run_one(session, item, args.mode, args.top_k)
    rows.append(row)
    status = row["error"] or f"rank={row['rank']}"
    print(f"[{i}/{len(dataset)}] {status:<28} {item['question'][:60]}")
    json.dump({"config": config, "rows": rows}, open(out_path, "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    time.sleep(args.sleep)

  errors = sum(1 for r in rows if r["error"])
  print(f"\n{len(rows)} questions -> {out_path} ({errors} en erreur)")


if __name__ == "__main__":
  main()