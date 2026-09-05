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


app.include_router(procedures_router.router)
app.include_router(conversations_router.router)
app.include_router(progress_router.router)
app.include_router(admin_router.router)
app.include_router(auth_router.router)
