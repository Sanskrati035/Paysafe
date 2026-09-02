"""
PAYSAFE — AI Payment Exception & Recovery Agent
Backend entrypoint.

Boots FastAPI, initializes the SQLite schema, seeds demo data on first run,
and starts EXACTLY ONE background monitor-agent task for the lifetime of the
process (see app/agents/monitor_agent.py). This is a hackathon simulation:
no real banking/NPCI systems are contacted and no real money ever moves.
"""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database.db import init_db, SessionLocal
from app.utils.seed import seed_if_empty
from app.agents import monitor_agent
from app.api.routes import router as api_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("paysafe")

_agent_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _agent_task

    # 1. Create tables
    init_db()

    # 2. Seed demo data (idempotent — only runs if transactions table is empty)
    db = SessionLocal()
    try:
        seeded = seed_if_empty(db)
        if seeded:
            logger.info("Seeded %d demo transactions.", seeded)
    finally:
        db.close()

    # 3. Start exactly ONE background monitor agent for the process lifetime.
    #    Guarded so a lifespan re-entry / reload never spins up a second one.
    if _agent_task is None or _agent_task.done():
        _agent_task = asyncio.create_task(monitor_agent.monitor_loop())
        logger.info("Started single background monitor agent (scan every %ss).",
                    settings.AGENT_SCAN_INTERVAL_SECONDS)

    yield

    # 4. Shutdown: stop the agent cleanly
    if _agent_task is not None:
        _agent_task.cancel()
        try:
            await _agent_task
        except asyncio.CancelledError:
            pass
        monitor_agent.agent_state.running = False
        logger.info("Monitor agent stopped.")


app = FastAPI(
    title=settings.APP_NAME,
    description=(
        "Hackathon simulation of an AI agent that detects, investigates, "
        "classifies, resolves, tracks and escalates payment exceptions "
        "across UPI, IMPS, NEFT, RTGS and AEPS. No real banking/NPCI systems "
        "are contacted and no real money is ever moved."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS if settings.CORS_ORIGINS != ["*"] else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/", tags=["health"])
def root():
    return {
        "service": settings.APP_NAME,
        "status": "ok",
        "llm_mode": "LLM" if settings.USE_LLM else "RULE_BASED_FALLBACK",
        "agent_running": monitor_agent.agent_state.running,
        "docs": "/docs",
    }


@app.get("/health", tags=["health"])
def health():
    return {"status": "healthy"}
