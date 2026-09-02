from app import database as db


def log(actor: str, action: str, case_id: str = None, transaction_id: str = None, details: dict = None):
    with db.db_cursor(commit=True) as cur:
        cur.execute(
            """INSERT INTO audit_logs (id, case_id, transaction_id, actor, action, details_json, timestamp)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                db.new_id("AUD"),
                case_id,
                transaction_id,
                actor,
                action,
                db.dumps(details or {}),
                db.now_iso(),
            ),
        )


def list_logs(limit: int = 200) -> list:
    with db.db_cursor() as cur:
        cur.execute("SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ?", (limit,))
        rows = cur.fetchall()
    return [db.row_to_dict(r) for r in rows]
