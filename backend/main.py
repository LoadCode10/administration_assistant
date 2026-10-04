import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from core.limiter import limiter
from api import (
  auth, users, tracking, logs, administrations, procedures, chat, documents, stats, extractions, indexing
)
from services import indexing as indexing_service

# Without this, logger.info/exception from background tasks (embedding) is silently dropped
logging.basicConfig(level=logging.INFO)

@asynccontextmanager
async def lifespan(app: FastAPI):
  # ---- startup: runs once, before the first request
  # Procedures left without an embedding (backend restarted mid-run) are picked up again
  if os.environ.get("INDEX_ON_STARTUP", "true").lower() == "true":
    indexing_service.start_in_thread()

  yield   # the application runs here

  # ---- shutdown: nothing to do for now


app = FastAPI(lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
  CORSMiddleware,
  allow_origins=["http://127.0.0.1:5500", "http://localhost:5500"],
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(logs.router)
app.include_router(tracking.router)
app.include_router(administrations.router)
app.include_router(procedures.router)
app.include_router(chat.router)
app.include_router(extractions.router)
app.include_router(documents.router)
app.include_router(stats.router)
app.include_router(indexing.router)






