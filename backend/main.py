from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv

import auth_router
import procedures_router
import conversations_router
import progress_router
import admin_router

load_dotenv()

app = FastAPI(title="Assistant Administratif Marocain")

# CORS for a separately-hosted frontend. Auth now uses a cookie, which requires
# allow_credentials=True — browsers reject that combined with a wildcard origin,
# so FRONTEND_ORIGINS must be an explicit comma-separated list (falls back to the
# local dev frontend if unset or left as "*").
origins = os.environ.get("FRONTEND_ORIGINS", "")
allow_origins = (
  [o.strip() for o in origins.split(",")]
  if origins and origins != "*"
  else ["http://localhost:5173"]
)

app.add_middleware(
  CORSMiddleware,
  allow_origins=allow_origins,
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(procedures_router.router)
app.include_router(conversations_router.router)
app.include_router(progress_router.router)
app.include_router(admin_router.router)
