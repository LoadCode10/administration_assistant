"""
Indexing (embedding) of procedures, with progress the admin dashboard can display.

- run_indexing()  : embeds every procedure without an embedding. Only one run at a time;
                    it loops until nothing is left, so procedures approved during a run are
                    picked up too. Safe to call from a background task or a thread.
- get_status(db)  : what the dashboard shows. The counts come from the database, so they stay
                    correct after a restart; the "running" part comes from this process.

The state lives in memory, which is fine with a single uvicorn worker (the default here).
"""
import logging
import threading
import time
from datetime import datetime

from sqlalchemy import func

import models
from database import SessionLocal
from services import rag

logger = logging.getLogger(__name__)

_lock = threading.Lock()          # prevents two indexing runs at the same time
_state = {
  "running": False,
  "started_at": None,
  "finished_at": None,
  "done": 0,                      # procedures processed in the current/last run
  "total": 0,                     # procedures to process in the current/last run
  "failed": 0,
  "last_error": None,
}
_started_monotonic = None


def _on_progress(done: int, total: int, failed: int) -> None:
  # offsets: a run can make several passes (procedures approved meanwhile)
  _state.update(done=_state["_offset"] + done, total=_state["_offset"] + total,
                failed=_state["_failed_offset"] + failed)


def run_indexing() -> bool:
  """Returns False if a run is already in progress (nothing is started then)."""
  global _started_monotonic
  if not _lock.acquire(blocking=False):
    return False
  _started_monotonic = time.monotonic()
  _state.update(running=True, started_at=datetime.now().isoformat(timespec="seconds"),
                finished_at=None, done=0, total=0, failed=0, last_error=None,
                _offset=0, _failed_offset=0)
  db = SessionLocal()
  try:
    while True:
      embedded = rag.embedding_all_procedures(db, on_progress=_on_progress)
      failed_this_pass = _state["failed"] - _state["_failed_offset"]
      _state["_offset"], _state["_failed_offset"] = _state["done"], _state["failed"]
      still_pending = db.query(func.count(models.Procedure.id_procedure)).filter(
        models.Procedure.embedding.is_(None)).scalar()
      # Another pass only for procedures approved meanwhile: stop when nothing is left,
      # or when what is left is only the procedures that just failed (no retry loop)
      if not still_pending or embedded == 0 or still_pending <= failed_this_pass:
        break
    logger.info("Indexing finished: %s procedures processed, %s failed",
                _state["done"], _state["failed"])
  except Exception as e:
    _state["last_error"] = f"{type(e).__name__}: {e}"
    logger.exception("Indexing FAILED")
  finally:
    db.close()
    _state.update(running=False, finished_at=datetime.now().isoformat(timespec="seconds"))
    _lock.release()
  return True


def start_in_thread() -> bool:
  """Starts run_indexing in a background thread (used at startup). False if already running."""
  if _lock.locked():
    return False
  threading.Thread(target=run_indexing, name="indexing", daemon=True).start()
  return True


def get_status(db) -> dict:
  total = db.query(func.count(models.Procedure.id_procedure)).filter(
    models.Procedure.statut_proc == "active").scalar() or 0
  embedded = db.query(func.count(models.Procedure.id_procedure)).filter(
    models.Procedure.statut_proc == "active", models.Procedure.embedding.is_not(None)).scalar() or 0

  status = {
    "total": total,                       # active procedures
    "embedded": embedded,                 # searchable by vector search
    "pending": total - embedded,          # not searchable yet
    "percent": round(100 * embedded / total, 1) if total else 100.0,
    "running": _state["running"],
    "run": {k: v for k, v in _state.items() if not k.startswith("_")},
    "eta_seconds": None,
  }
  if _state["running"] and _state["done"] and _started_monotonic:
    elapsed = time.monotonic() - _started_monotonic
    remaining = max(_state["total"] - _state["done"], 0)
    status["eta_seconds"] = round(elapsed / _state["done"] * remaining)
  return status
