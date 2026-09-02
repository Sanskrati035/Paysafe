"""
Lightweight SQLite data layer. No ORM — kept intentionally simple and
transparent for a demo/prototype system. All queries are parameterised
to avoid injection. All public functions catch sqlite3.Error and raise
a DatabaseError so the API layer can return a clean 500 instead of a
stack trace / internal detail leak.
"""
import json
import os
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

from app.config import settings


class DatabaseError(Exception):
    pass


_local = threading.local()
_lock = threading.Lock()


def _ensure_dir():
    db_dir = os.path.dirname(settings.DATABASE_PATH) or "."
    os.makedirs(db_dir, exist_ok=True)


def get_conn() -> sqlite3.Connection:
    if getattr(_local, "conn", None) is None:
        _ensure_dir()
        conn = sqlite3.connect(settings.DATABASE_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        _local.conn = conn
    return _local.conn


@contextmanager
def db_cursor(commit: bool = False):
    conn = get_conn()
    cur = conn.cursor()
    try:
        yield cur
        if commit:
            with _lock:
                conn.commit()
    except sqlite3.Error as exc:
        conn.rollback()
        raise DatabaseError(f"database error: {exc}") from exc
    finally:
        cur.close()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10].upper()}"


SCHEMA = """
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    rail TEXT NOT NULL,
    scenario_type TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    customer_name TEXT NOT NULL,
    customer_phone_masked TEXT NOT NULL,
    customer_account_masked TEXT NOT NULL,
    merchant_or_beneficiary TEXT NOT NULL,
    beneficiary_account_masked TEXT NOT NULL,
    status TEXT NOT NULL,
    complaint_text TEXT,
    initiated_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cases (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL REFERENCES transactions(id),
    rail TEXT NOT NULL,
    scenario_type TEXT NOT NULL,
    stage TEXT NOT NULL,
    classification_json TEXT,
    investigation_json TEXT,
    decision_json TEXT,
    sla_json TEXT,
    evidence_json TEXT,
    recovery_status TEXT NOT NULL DEFAULT 'PENDING',
    recovery_json TEXT,
    notification_text TEXT,
    queue_status TEXT NOT NULL DEFAULT 'NOT_QUEUED',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    case_id TEXT,
    transaction_id TEXT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    details_json TEXT,
    timestamp TEXT NOT NULL
);
"""


def init_db():
    with db_cursor(commit=True) as cur:
        cur.executescript(SCHEMA)


def row_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    for k, v in list(d.items()):
        if k.endswith("_json") and v:
            try:
                d[k[: -len("_json")]] = json.loads(v)
            except (TypeError, ValueError):
                d[k[: -len("_json")]] = None
            del d[k]
        elif k.endswith("_json"):
            d[k[: -len("_json")]] = None
            del d[k]
    return d


def dumps(obj) -> str:
    return json.dumps(obj, default=str)
