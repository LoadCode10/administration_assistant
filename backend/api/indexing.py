from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session

from database import get_db
import models
from core.security import require_admin
from services import indexing

router = APIRouter(tags=["indexing"])


@router.get("/admin/indexing/status")
def indexing_status(db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
  """Progress of the procedure indexing (embeddings), for the admin dashboard."""
  return indexing.get_status(db)


@router.post("/admin/indexing/run")
def run_indexing(
  background_tasks: BackgroundTasks,
  db: Session = Depends(get_db),
  current_user: models.User = Depends(require_admin),
):
  """Starts indexing the procedures that have no embedding yet (no-op if already running)."""
  status = indexing.get_status(db)
  if status["running"]:
    return {**status, "started": False, "reason": "already_running"}
  if status["pending"] == 0:
    return {**status, "started": False, "reason": "nothing_to_index"}
  background_tasks.add_task(indexing.run_indexing)
  return {**status, "started": True}
