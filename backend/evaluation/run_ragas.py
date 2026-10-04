"""
Step 2 of the evaluation: score the answers of a saved run with Ragas and an LLM judge.

  python evaluation/run_ragas.py evaluation/runs/answers_test.json

It reads a run made by run_rag.py (question, the 3 retrieved procedures, Gemini's answer) and
writes evaluation/runs/<run name>_scores.json: the same rows plus a "scores" field. The
original run is never modified, and Gemini is never called here.

Scores for the questions that have an answer in the database (expected_ids not empty):
  faithfulness       every claim of the answer is supported by the retrieved procedures (0-1)
  answer_relevancy   the answer addresses the question (0-1)
  context_precision  the useful procedures are ranked first among the retrieved ones (0-1)
  context_recall     the retrieved procedures contain what the reference answer needs (0-1)
For every question (including the "no_answer" ones):
  refusal            1 if the answer says it doesn't have the information, else 0
  language_match     1 if the answer is in the language of the question (no LLM call)

The judge is any OpenAI-compatible API, set in backend/.env:
  JUDGE_BASE_URL=https://api.deepseek.com
  JUDGE_MODEL=<model name from the provider's docs, NON-thinking>
  JUDGE_API_KEY=<key>
  JUDGE_EXTRA_BODY=        optional JSON sent with every call, e.g. to disable thinking mode
  JUDGE_PRICE_IN=0.15      optional, $ per 1M input tokens (cache miss), for the cost estimate
  JUDGE_PRICE_OUT=0.6      optional, $ per 1M output tokens

Safe to stop and relaunch: scores are saved after every question, and a relaunch only computes
what is missing or failed. If the balance runs out, the script saves and stops; top up and run
the same command again. The judge settings are stored in the file: relaunching with another
judge is refused, so one file is always scored by a single judge.

Options:
  --metrics faithfulness,answer_relevancy   only some metrics (default: all)
  --limit 3                                 score only the first 3 questions (to test)
  --retry-errors                            also recompute scores that failed before
"""
import argparse
import asyncio
import json
import math
import os
import re
import sys
import time
from datetime import datetime

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from dotenv import load_dotenv  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

load_dotenv(os.path.join(BACKEND_DIR, ".env"))

RAGAS_METRICS = ("faithfulness", "answer_relevancy", "context_precision", "context_recall")
ALL_METRICS = RAGAS_METRICS + ("refusal", "language_match")
SHORT = {"faithfulness": "faith", "answer_relevancy": "relev", "context_precision": "c_prec",
         "context_recall": "c_rec", "refusal": "refus", "language_match": "lang"}
EMBEDDING_MODEL = "BAAI/bge-m3"   # used by answer_relevancy, runs locally (no API call)
MAX_TOKENS = 4096                 # long answers give long lists of claims: 1024 can truncate the JSON
CALL_TIMEOUT = 180                # seconds for one metric


class StopRun(Exception):
  """An error that no retry can fix (no balance, wrong key): save and stop."""


# --------------------------------------------------------------------------------------------
# Judge
# --------------------------------------------------------------------------------------------
class Usage:
  """Counts the tokens the judge really used, to estimate the cost and detect thinking mode."""

  def __init__(self):
    self.calls = self.prompt = self.completion = self.reasoning = self.cache_hit = 0

  def add(self, usage):
    if usage is None:
      return
    self.calls += 1
    self.prompt += getattr(usage, "prompt_tokens", 0) or 0
    self.completion += getattr(usage, "completion_tokens", 0) or 0
    self.cache_hit += getattr(usage, "prompt_cache_hit_tokens", 0) or 0   # DeepSeek's field
    details = getattr(usage, "completion_tokens_details", None)
    self.reasoning += (getattr(details, "reasoning_tokens", 0) or 0) if details else 0

  def cost(self):
    price_in, price_out = os.environ.get("JUDGE_PRICE_IN"), os.environ.get("JUDGE_PRICE_OUT")
    if not (price_in and price_out):
      return None
    # cache hits are much cheaper; counting them at the full price keeps the estimate on the safe side
    return (self.prompt * float(price_in) + self.completion * float(price_out)) / 1_000_000

  def as_dict(self):
    return {"calls": self.calls, "prompt_tokens": self.prompt, "completion_tokens": self.completion,
            "reasoning_tokens": self.reasoning, "cache_hit_tokens": self.cache_hit,
            "estimated_cost_usd": round(self.cost(), 4) if self.cost() is not None else None}


def judge_settings():
  missing = [k for k in ("JUDGE_BASE_URL", "JUDGE_MODEL", "JUDGE_API_KEY") if not os.environ.get(k)]
  if missing:
    sys.exit(f"Ajoute {', '.join(missing)} dans backend/.env (voir l'aide en haut du script).")
  extra = os.environ.get("JUDGE_EXTRA_BODY") or None
  try:
    extra = json.loads(extra) if extra else None
  except json.JSONDecodeError:
    sys.exit("JUDGE_EXTRA_BODY doit être du JSON valide, par exemple {\"thinking\": {\"type\": \"disabled\"}}")
  return {"base_url": os.environ["JUDGE_BASE_URL"].rstrip("/"), "model": os.environ["JUDGE_MODEL"],
          "extra_body": extra}


def build_judge(settings, usage: Usage):
  from openai import AsyncOpenAI
  from ragas.llms import llm_factory

  client = AsyncOpenAI(base_url=settings["base_url"], api_key=os.environ["JUDGE_API_KEY"],
                       timeout=120, max_retries=3)   # the SDK retries 429 / 5xx / timeouts itself

  # Count the tokens of every call (Ragas and Instructor don't report them)
  original_create = client.chat.completions.create

  async def counted_create(*args, **kwargs):
    response = await original_create(*args, **kwargs)
    usage.add(getattr(response, "usage", None))
    return response

  client.chat.completions.create = counted_create

  model_args = {"temperature": 0.0, "max_tokens": MAX_TOKENS}
  if settings["extra_body"]:
    model_args["extra_body"] = settings["extra_body"]
  return llm_factory(settings["model"], client=client, **model_args)


class RefusalVerdict(BaseModel):
  refusal: int = Field(description="1 if the answer says it does not have the information or cannot "
                                   "answer, 0 if it gives an actual answer")
  reason: str = Field(description="one short sentence")


REFUSAL_PROMPT = """You check the answer of an assistant for Moroccan administrative procedures.
Question: {question}
Answer: {answer}
Does the answer say that it does not have the information, or decline to answer (refusal = 1)?
Or does it give an actual answer about a procedure, even a partial one (refusal = 0)?"""


# --------------------------------------------------------------------------------------------
# Scoring
# --------------------------------------------------------------------------------------------
_ARABIC = re.compile(r"[؀-ۿ]")
_LATIN = re.compile(r"[A-Za-zÀ-ÿ]")


def language_of(text: str) -> str:
  arabic, latin = len(_ARABIC.findall(text or "")), len(_LATIN.findall(text or ""))
  return "ar" if arabic > latin else "fr"


def error_chain(e: BaseException):
  seen = []
  while e is not None and e not in seen:
    seen.append(e)
    e = e.__cause__ or e.__context__
  return seen


def check_fatal(e: BaseException):
  """Raise StopRun for errors that retrying won't fix."""
  for err in error_chain(e):
    status = getattr(err, "status_code", None)
    text = str(err).lower()
    if status == 402 or "insufficient balance" in text or "insufficient_quota" in text:
      raise StopRun("Solde épuisé chez le fournisseur du juge : recharge puis relance la même commande.")
    if status in (401, 403) or "invalid api key" in text or "authentication" in text:
      raise StopRun(f"Clé API du juge refusée ({status}) : vérifie JUDGE_API_KEY.")
    if status == 404 or "model not exist" in text or "model_not_found" in text:
      raise StopRun(f"Modèle introuvable : vérifie JUDGE_MODEL ({err}).")


def to_number(value):
  value = getattr(value, "value", value)
  if value is None:
    return None
  value = float(value)
  return None if math.isnan(value) else round(value, 4)


class Scorer:
  def __init__(self, judge, metrics):
    from ragas.metrics.collections import (AnswerRelevancy, ContextPrecisionWithReference,
                                           ContextRecall, Faithfulness)
    self.judge = judge
    self.metrics = metrics
    self.ragas = {}
    if "faithfulness" in metrics:
      self.ragas["faithfulness"] = Faithfulness(llm=judge)
    if "answer_relevancy" in metrics:
      from ragas.embeddings import HuggingFaceEmbeddings
      print(f"Chargement de {EMBEDDING_MODEL} pour answer_relevancy…", flush=True)
      self.ragas["answer_relevancy"] = AnswerRelevancy(
        llm=judge, embeddings=HuggingFaceEmbeddings(model=EMBEDDING_MODEL, use_api=False))
    if "context_precision" in metrics:
      self.ragas["context_precision"] = ContextPrecisionWithReference(llm=judge)
    if "context_recall" in metrics:
      self.ragas["context_recall"] = ContextRecall(llm=judge)

  def applicable(self, row):
    """Metrics that make sense for this row."""
    answerable = bool(row.get("expected_ids"))
    names = []
    for name in self.metrics:
      if name in RAGAS_METRICS and not answerable:
        continue   # "no answer" questions: no correct content to judge, only the refusal
      if name in ("context_precision", "context_recall") and not row.get("reference"):
        continue
      names.append(name)
    return names

  async def compute(self, name, row):
    q, answer, contexts = row["question"], row["answer"], row.get("contexts") or []
    if name == "language_match":
      return 1.0 if language_of(answer) == row.get("lang") else 0.0
    if name == "refusal":
      verdict = await self.judge.agenerate(REFUSAL_PROMPT.format(question=q, answer=answer), RefusalVerdict)
      return 1.0 if int(verdict.refusal) == 1 else 0.0
    metric = self.ragas[name]
    if name == "faithfulness":
      return to_number(await metric.ascore(user_input=q, response=answer, retrieved_contexts=contexts))
    if name == "answer_relevancy":
      return to_number(await metric.ascore(user_input=q, response=answer))
    if name == "context_precision":
      return to_number(await metric.ascore(user_input=q, reference=row["reference"], retrieved_contexts=contexts))
    if name == "context_recall":
      return to_number(await metric.ascore(user_input=q, retrieved_contexts=contexts, reference=row["reference"]))
    raise ValueError(name)

  async def score(self, name, row, attempts=3):
    for attempt in range(1, attempts + 1):
      try:
        return await asyncio.wait_for(self.compute(name, row), timeout=CALL_TIMEOUT), None
      except StopRun:
        raise
      except Exception as e:  # noqa: BLE001
        check_fatal(e)
        message = f"{type(e).__name__}: {str(e)[:300]}"
        if attempt == attempts:
          return None, message
        await asyncio.sleep(5 * attempt)


# --------------------------------------------------------------------------------------------
# Run
# --------------------------------------------------------------------------------------------
def save(path, data):
  tmp = path + ".tmp"
  with open(tmp, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
  os.replace(tmp, path)   # never leaves a half-written file


def mean(values):
  values = [v for v in values if v is not None]
  return (sum(values) / len(values), len(values)) if values else (None, 0)


def print_summary(rows, metrics):
  def line(label, group):
    parts = []
    for m in metrics:
      avg, n = mean([r.get("scores", {}).get(m) for r in group])
      if n:
        parts.append(f"{SHORT.get(m, m)}={avg:.3f}")
    if parts:
      print(f"  {label:<30} n={len(group):<4} " + "  ".join(parts))

  answerable = [r for r in rows if r.get("expected_ids") and r.get("scores")]
  negatives = [r for r in rows if not r.get("expected_ids") and r.get("scores")]
  print("\nRésumé (moyennes sur les questions notées) :")
  line("questions avec réponse", answerable)
  for lang in ("fr", "ar"):
    line(f"  lang={lang}", [r for r in answerable if r.get("lang") == lang])
  line("  procédure trouvée (top 3)", [r for r in answerable if r.get("rank") and r["rank"] <= 3])
  line("  procédure manquée", [r for r in answerable if not (r.get("rank") and r["rank"] <= 3)])
  if negatives:
    avg, n = mean([r["scores"].get("refusal") for r in negatives])
    if n:
      print(f"  questions hors sujet : refus correct = {avg:.0%} (n={n})")
  avg, n = mean([r["scores"].get("refusal") for r in answerable])
  if n:
    print(f"  questions avec réponse : refus à tort = {avg:.0%} (n={n})")


async def main_async(args):
  import ragas

  run = json.load(open(args.run, encoding="utf-8"))
  if run["config"].get("retrieval_only"):
    sys.exit("Ce run a été fait avec --retrieval-only : il n'y a pas de réponses à noter.")
  metrics = [m.strip() for m in args.metrics.split(",")] if args.metrics else list(ALL_METRICS)
  unknown = [m for m in metrics if m not in ALL_METRICS]
  if unknown:
    sys.exit(f"Métriques inconnues : {unknown}. Choix possibles : {', '.join(ALL_METRICS)}")

  settings = judge_settings()
  judge_config = {"model": settings["model"], "base_url": settings["base_url"],
                  "extra_body": settings["extra_body"], "temperature": 0.0,
                  "ragas_version": ragas.__version__, "embedding_model": EMBEDDING_MODEL}

  base = os.path.splitext(os.path.basename(args.run))[0]
  out_path = args.out or os.path.join(os.path.dirname(args.run), f"{base}_scores.json")

  # Resume an existing scores file, or start a new one from the run
  if os.path.exists(out_path):
    data = json.load(open(out_path, encoding="utf-8"))
    previous = data["config"].get("judge", {})
    changed = {k: (previous.get(k), judge_config[k]) for k in ("model", "base_url", "extra_body", "ragas_version")
               if previous.get(k) != judge_config[k]}
    if changed:
      sys.exit(f"{out_path} a été noté avec un autre juge {changed}. Un fichier = un seul juge : "
               f"utilise --out pour un nouveau fichier.")
    print(f"Reprise de {out_path}")
  else:
    data = {"config": dict(run["config"]), "rows": [dict(r) for r in run["rows"]]}
    data["config"]["scored_from"] = os.path.basename(args.run)
  data["config"]["judge"] = judge_config
  data["config"]["metrics"] = sorted(set(data["config"].get("metrics", [])) | set(metrics))
  data["config"]["scoring_date"] = datetime.now().isoformat(timespec="seconds")

  usage = Usage()
  scorer = Scorer(build_judge(settings, usage), metrics)

  # Questions whose generation failed have no answer: nothing to score
  todo = [r for r in data["rows"] if r.get("answer")]
  skipped = len(data["rows"]) - len(todo)
  if args.limit:
    todo = todo[: args.limit]

  stopped = None
  started = time.perf_counter()
  for i, row in enumerate(todo, start=1):
    row.setdefault("scores", {})
    row.setdefault("score_errors", {})
    for name in scorer.applicable(row):
      done = row["scores"].get(name) is not None
      failed = name in row["score_errors"]
      if done or (failed and not args.retry_errors):
        continue
      try:
        value, error = await scorer.score(name, row)
      except StopRun as e:
        stopped = str(e)
        break
      if error:
        row["score_errors"][name] = error
      else:
        row["scores"][name] = value
        row["score_errors"].pop(name, None)
    data["config"]["judge_usage_last_session"] = usage.as_dict()
    save(out_path, data)

    shown = " ".join(f"{SHORT.get(k, k)}={v:.2f}" for k, v in row["scores"].items() if v is not None)
    errs = f"  ({len(row['score_errors'])} erreur(s))" if row["score_errors"] else ""
    print(f"[{i}/{len(todo)}] {row['question_id']} {shown}{errs}", flush=True)

    # Thinking mode makes every call much more expensive: stop after the first question
    if i == 1 and usage.reasoning and not args.allow_thinking:
      stopped = (f"Le juge a utilisé {usage.reasoning} tokens de raisonnement (mode thinking) : "
                 f"coût multiplié. Choisis un modèle non-thinking ou désactive-le avec JUDGE_EXTRA_BODY "
                 f"(ou relance avec --allow-thinking si c'est voulu).")
    if stopped:
      break
    if args.sleep:
      await asyncio.sleep(args.sleep)

  u = usage.as_dict()
  minutes = (time.perf_counter() - started) / 60
  cost = f", coût estimé ≈ ${u['estimated_cost_usd']}" if u["estimated_cost_usd"] is not None else ""
  print(f"\nAppels au juge : {u['calls']} | tokens entrée {u['prompt_tokens']} "
        f"(dont cache {u['cache_hit_tokens']}), sortie {u['completion_tokens']}, "
        f"raisonnement {u['reasoning_tokens']}{cost} | {minutes:.1f} min")
  print(f"-> {out_path}")
  if skipped:
    print(f"{skipped} question(s) sans réponse dans le run (erreur de génération) : non notées.")
  errors = sorted({f"{r['question_id']}:{m}" for r in data["rows"] for m in r.get("score_errors", {})})
  if errors:
    print(f"Scores en erreur ({len(errors)}) : {', '.join(errors[:20])}{' …' if len(errors) > 20 else ''}"
          f"\n  -> relance avec --retry-errors pour les recalculer.")
  print_summary(data["rows"], [m for m in ALL_METRICS if m in data["config"]["metrics"]])
  if stopped:
    print(f"\nARRÊT : {stopped}")
    sys.exit(2)


def main():
  parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
  parser.add_argument("run", help="a run file made by run_rag.py (with answers)")
  parser.add_argument("--metrics", help=f"comma-separated, default: {','.join(ALL_METRICS)}")
  parser.add_argument("--limit", type=int, default=0, help="score only the first N questions (test)")
  parser.add_argument("--retry-errors", action="store_true", help="recompute scores that failed before")
  parser.add_argument("--sleep", type=float, default=0.0, help="pause between questions (seconds)")
  parser.add_argument("--allow-thinking", action="store_true", help="don't stop if the judge uses thinking mode")
  parser.add_argument("--out", help="output file (default: <run>_scores.json next to the run)")
  args = parser.parse_args()
  asyncio.run(main_async(args))


if __name__ == "__main__":
  main()
