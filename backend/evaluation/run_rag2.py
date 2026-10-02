"""
Step 1 of the evaluation: run the real RAG pipeline on every question of a dataset and save
exactly what happened (retrieved procedures, the facts sent to Gemini, the answer, timings,
tokens). No scoring here: run_ragas.py scores a saved run, analyze_results.py reads the scores.

Keeping the three steps separate means you pay for the Gemini answers once per experiment,
and can re-score or re-analyze the same answers as often as you like.

Usage (from the backend folder or inside the container):
  python evaluation/run_rag.py --dataset evaluation/datasets/golden_v1.json \
      --name baseline_vector --mode vector --top-k 3

Retrieval only (no Gemini call, no answers, takes seconds):
  python evaluation/run_rag.py --dataset evaluation/datasets/synthetic_v1.json \
      --name retrieval_vector --mode vector --retrieval-only
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


# Errors worth retrying: the service is overloaded or the rate limit is reached
TEMPORARY_ERRORS = ("503", "429", "UNAVAILABLE", "RESOURCE_EXHAUSTED", "overloaded", "high demand")


def is_temporary(message: str) -> bool:
  return any(marker.lower() in message.lower() for marker in TEMPORARY_ERRORS)


def run_one(session, item: dict, mode: str, top_k: int, retries: int = 3, retry_wait: float = 10.0,
            retrieval_only: bool = False) -> dict:
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
  # ---- 1. Retrieval: saved in the row right away, so a later Gemini failure can't erase it
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

    retrieved_ids = [p.id_procedure for p in procedures]
    row.update({
      "retrieved_ids": retrieved_ids,
      "retrieved_titles": [p.titre_proc_fr for p in procedures],
      # position of the first expected procedure, or None
      "rank": next((i for i, pid in enumerate(retrieved_ids, start=1)
                    if pid in row["expected_ids"]), None),
      "contexts": contexts,
      "retrieval_ms": round((t1 - t0) * 1000),
    })
  except Exception as e:  # keep the failure visible: never let it become a silent zero
    row["error"] = f"retrieval: {type(e).__name__}: {e}"
    return row

  if not procedures:
    row["error"] = "no_procedures_retrieved"
    return row

  if retrieval_only:  # measuring retrieval only: no Gemini call, no answer
    return row

  # ---- 2. Generation: temporary Gemini errors (overload, rate limit) are retried
  for attempt in range(1, retries + 2):
    try:
      t2 = time.perf_counter()
      answer, tokens = rag.generate_answer(question, facts)
      row.update({
        "answer": answer,
        "generation_ms": round((time.perf_counter() - t2) * 1000),
        "prompt_tokens": tokens.get("prompt_tokens"),
        "output_tokens": tokens.get("output_tokens"),
        "attempts": attempt,
      })
      return row
    except Exception as e:
      message = f"{type(e).__name__}: {e}"
      if attempt <= retries and is_temporary(message):
        wait = retry_wait * 2 ** (attempt - 1)
        print(f"    Gemini indisponible (essai {attempt}), nouvel essai dans {wait:.0f}s…")
        time.sleep(wait)
        continue
      row["error"] = f"generation: {message}"
      row["attempts"] = attempt
      return row
  return row


def main():
  parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
  parser.add_argument("--dataset", required=True)
  parser.add_argument("--name", required=True, help="experiment name, e.g. baseline_vector")
  parser.add_argument("--mode", choices=rag.RETRIEVAL_MODES, default=rag.RETRIEVAL_MODE)
  parser.add_argument("--top-k", type=int, default=3)
  parser.add_argument("--start", type=int, default=1, help="position of the first question to run (1 = first)")
  parser.add_argument("--limit", type=int, default=0, help="how many questions to run from --start (0 = all)")
  parser.add_argument("--sleep", type=float, default=1.0, help="pause between Gemini calls")
  parser.add_argument("--retrieval-only", action="store_true",
                      help="skip Gemini: measure retrieval only (fast, free, no answers in the run)")
  parser.add_argument("--retries", type=int, default=3, help="retries for temporary Gemini errors (503, 429)")
  parser.add_argument("--retry-wait", type=float, default=10.0, help="seconds before the 1st retry (doubles after)")
  parser.add_argument("--out-dir", default=os.path.join("evaluation", "runs"))
  args = parser.parse_args()

  dataset = json.load(open(args.dataset, encoding="utf-8"))
  if args.start < 1 or args.start > len(dataset):
    sys.exit(f"--start doit être entre 1 et {len(dataset)}")
  dataset = dataset[args.start - 1:]
  if args.limit:
    dataset = dataset[: args.limit]

  config = {
    "experiment_name": args.name,
    "date": datetime.now().isoformat(timespec="seconds"),
    "git_commit": git_commit(),
    "dataset": os.path.basename(args.dataset),
    "start": args.start,
    "limit": args.limit,
    "retrieval_mode": args.mode,
    "top_k": args.top_k,
    "retrieval_only": args.retrieval_only,
    "llm_model": rag.LLM_MODEL,
    "embedding_model": "BAAI/bge-m3",
  }
  os.makedirs(args.out_dir, exist_ok=True)
  out_path = os.path.join(args.out_dir, f"{args.name}.json")
  if os.path.exists(out_path):
    sys.exit(f"{out_path} existe déjà : choisis un autre --name (un run ne s'écrase jamais).")

  session = SessionLocal()
  rows = []
  for i, item in enumerate(dataset, start=args.start):
    row = run_one(session, item, args.mode, args.top_k, args.retries, args.retry_wait,
                  retrieval_only=args.retrieval_only)
    rows.append(row)
    status = row["error"] or f"rank={row['rank']}"
    print(f"[{i}/{args.start + len(dataset) - 1}] {item.get('question_id', '')} {status:<24} {item['question'][:55]}")
    json.dump({"config": config, "rows": rows}, open(out_path, "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    if not args.retrieval_only:  # the pause is only there to spare the Gemini rate limit
      time.sleep(args.sleep)

  errors = [r for r in rows if r["error"] and r["error"] != "no_procedures_retrieved"]
  print(f"\n{len(rows)} questions -> {out_path} ({len(errors)} en erreur)")
  if errors:
    print("Questions en erreur : " + ", ".join(r["question_id"] or "?" for r in errors))


if __name__ == "__main__":
  main()