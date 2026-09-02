"""
AI Agent Workflow Orchestrator.

Implements the 9-step pipeline described in the product spec:
 1. Create/load the simulated transaction
 2. Start the AI agent workflow
 3. Show each processing stage
 4. Display investigation findings
 5. Calculate SLA
 6. Generate evidence
 7. Recommend recovery
 8. Add case to operations queue
 9. Generate customer notification

Every step is persisted to the `cases` table and mirrored into
`audit_logs` so the whole run is independently reconstructable — this
is the single running agent instance referenced throughout the app
(see main.py `AGENT_STATUS` for its live health/heartbeat state).
"""
from datetime import datetime, timezone

from app import audit, database as db, evidence as evidence_mod, llm_agent, notifications, rule_engine, sla as sla_mod


class NotFoundError(Exception):
    pass


class ConflictError(Exception):
    pass


# ---------------------------------------------------------------- helpers

def get_transaction(transaction_id: str) -> dict:
    with db.db_cursor() as cur:
        cur.execute("SELECT * FROM transactions WHERE id = ?", (transaction_id,))
        row = cur.fetchone()
    if not row:
        raise NotFoundError(f"transaction {transaction_id} not found")
    return db.row_to_dict(row)


def get_case_by_transaction(transaction_id: str) -> dict:
    with db.db_cursor() as cur:
        cur.execute(
            "SELECT * FROM cases WHERE transaction_id = ? ORDER BY created_at DESC LIMIT 1",
            (transaction_id,),
        )
        row = cur.fetchone()
    return db.row_to_dict(row) if row else None


def get_case(case_id: str) -> dict:
    with db.db_cursor() as cur:
        cur.execute("SELECT * FROM cases WHERE id = ?", (case_id,))
        row = cur.fetchone()
    if not row:
        raise NotFoundError(f"case {case_id} not found")
    return db.row_to_dict(row)


def _touch_case(case_id: str, **fields):
    sets, params = [], []
    for k, v in fields.items():
        col = f"{k}_json" if isinstance(v, (dict, list)) else k
        sets.append(f"{col} = ?")
        params.append(db.dumps(v) if isinstance(v, (dict, list)) else v)
    sets.append("updated_at = ?")
    params.append(db.now_iso())
    params.append(case_id)
    with db.db_cursor(commit=True) as cur:
        cur.execute(f"UPDATE cases SET {', '.join(sets)} WHERE id = ?", params)


def create_transaction(
    rail: str,
    scenario_type: str,
    amount: float,
    customer_name: str,
    customer_phone_masked: str,
    customer_account_masked: str,
    merchant_or_beneficiary: str,
    beneficiary_account_masked: str,
    complaint_text: str = None,
    status: str = "DEBITED",
) -> dict:
    rail = (rail or "").upper()
    if rail not in rule_engine.RAILS:
        raise ValueError(f"invalid payment rail: {rail}")

    txn_id = db.new_id(rail)
    now = db.now_iso()
    with db.db_cursor(commit=True) as cur:
        cur.execute(
            """INSERT INTO transactions
               (id, rail, scenario_type, amount, currency, customer_name, customer_phone_masked,
                customer_account_masked, merchant_or_beneficiary, beneficiary_account_masked,
                status, complaint_text, initiated_at, created_at)
               VALUES (?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                txn_id, rail, scenario_type, amount, customer_name, customer_phone_masked,
                customer_account_masked, merchant_or_beneficiary, beneficiary_account_masked,
                status, complaint_text, now, now,
            ),
        )
    audit.log("SYSTEM", "TRANSACTION_CREATED", transaction_id=txn_id, details={"rail": rail, "scenario_type": scenario_type})
    return get_transaction(txn_id)


def _ensure_case(transaction: dict) -> dict:
    existing = get_case_by_transaction(transaction["id"])
    if existing:
        return existing
    case_id = db.new_id("CASE")
    now = db.now_iso()
    with db.db_cursor(commit=True) as cur:
        cur.execute(
            """INSERT INTO cases (id, transaction_id, rail, scenario_type, stage, recovery_status,
                queue_status, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'CREATED', 'PENDING', 'NOT_QUEUED', ?, ?)""",
            (case_id, transaction["id"], transaction["rail"], transaction["scenario_type"], now, now),
        )
    audit.log("AI_AGENT", "CASE_CREATED", case_id=case_id, transaction_id=transaction["id"])
    return get_case(case_id)


# ---------------------------------------------------------------- steps

def step_classify(transaction: dict) -> dict:
    result = llm_agent.classify(
        transaction.get("complaint_text") or "",
        rail_hint=transaction["rail"],
        scenario_hint=transaction["scenario_type"],
    )
    return result


def step_investigate(transaction: dict, simulate_outage: bool = False) -> dict:
    return rule_engine.investigate(
        transaction["rail"], transaction["id"], transaction["scenario_type"], simulate_outage=simulate_outage
    )


def step_decide(scenario_type: str, investigation: dict) -> dict:
    decision = rule_engine.decide(scenario_type)
    decision["narration"] = llm_agent.explain_decision(scenario_type, investigation)
    return decision


def step_sla(transaction: dict) -> dict:
    return sla_mod.calculate(transaction["rail"], transaction["scenario_type"], transaction["initiated_at"])


def step_evidence(transaction: dict, investigation: dict, classification: dict, decision: dict, sla: dict) -> dict:
    return evidence_mod.generate(transaction, investigation, classification, decision, sla)


def step_recovery_recommendation(transaction: dict, decision: dict) -> dict:
    return {
        "recommended_action": decision["recommended_action"],
        "amount": transaction["amount"],
        "currency": transaction.get("currency", "INR"),
        "status": "RECOMMENDED",
        "requires_approval": decision["decision"] in ("RECOVERY_WORKFLOW", "AUTO_REVERSAL"),
    }


def step_notification(transaction: dict, decision: dict) -> str:
    return notifications.generate(decision["decision"], transaction)


# ---------------------------------------------------------------- pipeline

def run_full_pipeline(transaction_id: str, simulate_outage: bool = False) -> dict:
    """Runs steps 1-9 end to end and returns an ordered trace + final case."""
    transaction = get_transaction(transaction_id)
    case = _ensure_case(transaction)
    trace = []

    def record(stage, title, detail, duration_ms):
        step = {"stage": stage, "title": title, "status": "DONE", "detail": detail, "duration_ms": duration_ms,
                "timestamp": db.now_iso()}
        trace.append(step)
        audit.log("AI_AGENT", f"STEP_{stage}", case_id=case["id"], transaction_id=transaction_id, details=detail)
        return step

    record("TRANSACTION_LOADED", "Transaction loaded", {"transaction_id": transaction_id, "rail": transaction["rail"]}, 400)

    classification = step_classify(transaction)
    _touch_case(case["id"], stage="CLASSIFIED", classification=classification)
    record("CLASSIFIED", "AI classification", classification, 900)

    investigation = step_investigate(transaction, simulate_outage=simulate_outage)
    _touch_case(case["id"], stage="INVESTIGATED", investigation=investigation)
    record("INVESTIGATED", "Investigation findings", investigation, 1400)

    decision = step_decide(transaction["scenario_type"], investigation)
    _touch_case(case["id"], stage="DECIDED", decision=decision)
    record("DECIDED", "Decision", decision, 900)

    sla_result = step_sla(transaction)
    _touch_case(case["id"], stage="SLA_CALCULATED", sla=sla_result)
    record("SLA_CALCULATED", "SLA status", sla_result, 500)

    evidence_bundle = step_evidence(transaction, investigation, classification, decision, sla_result)
    _touch_case(case["id"], stage="EVIDENCE_GENERATED", evidence=evidence_bundle)
    record("EVIDENCE_GENERATED", "Evidence generated", {"evidence_id": evidence_bundle["evidence_id"]}, 900)

    recovery = step_recovery_recommendation(transaction, decision)
    _touch_case(case["id"], stage="RECOVERY_RECOMMENDED", recovery=recovery, recovery_status="RECOMMENDED")
    record("RECOVERY_RECOMMENDED", "Recovery recommendation", recovery, 700)

    _touch_case(case["id"], stage="QUEUED", queue_status="IN_OPERATIONS_QUEUE")
    record("QUEUED", "Added to operations queue", {"queue": "operations", "priority": _priority(sla_result)}, 400)

    notification_text = step_notification(transaction, decision)
    _touch_case(case["id"], stage="NOTIFIED", notification_text=notification_text)
    record("NOTIFIED", "Customer notification generated", {"message": notification_text}, 600)

    final_case = get_case(case["id"])
    return {"transaction": transaction, "case": final_case, "trace": trace}


def _priority(sla_result: dict) -> str:
    return {"BREACHED": "P1", "AT_RISK": "P2", "ON_TRACK": "P3"}.get(sla_result["status"], "P3")


# ---------------------------------------------------------------- recovery actions

def approve_recovery(case_id: str) -> dict:
    case = get_case(case_id)
    if case["recovery_status"] == "APPROVED":
        raise ConflictError(f"case {case_id} recovery already approved")
    if case["recovery_status"] == "REJECTED":
        raise ConflictError(f"case {case_id} recovery already rejected; cannot approve")

    recovery = case.get("recovery") or {}
    recovery["status"] = "APPROVED"
    recovery["approved_at"] = db.now_iso()
    recovery["simulated_settlement"] = {
        "amount": case.get("recovery", {}).get("amount"),
        "result": "REVERSAL_INITIATED",
        "note": "Simulated recovery only — no real funds movement occurs in this demo.",
    }
    _touch_case(case_id, recovery=recovery, recovery_status="APPROVED", stage="RESOLVED")
    audit.log("OPS_USER", "RECOVERY_APPROVED", case_id=case_id, transaction_id=case["transaction_id"], details=recovery)
    return get_case(case_id)


def reject_recovery(case_id: str, reason: str = None) -> dict:
    case = get_case(case_id)
    if case["recovery_status"] in ("APPROVED", "REJECTED"):
        raise ConflictError(f"case {case_id} recovery already {case['recovery_status'].lower()}")
    recovery = case.get("recovery") or {}
    recovery["status"] = "REJECTED"
    recovery["rejected_at"] = db.now_iso()
    recovery["reason"] = reason or "Not specified"
    _touch_case(case_id, recovery=recovery, recovery_status="REJECTED")
    audit.log("OPS_USER", "RECOVERY_REJECTED", case_id=case_id, transaction_id=case["transaction_id"], details=recovery)
    return get_case(case_id)


def escalate_case(case_id: str, reason: str = None) -> dict:
    case = get_case(case_id)
    if case["recovery_status"] == "ESCALATED":
        raise ConflictError(f"case {case_id} already escalated")
    recovery = case.get("recovery") or {}
    recovery["status"] = "ESCALATED"
    recovery["escalated_at"] = db.now_iso()
    recovery["reason"] = reason or "Manual escalation by operations"
    _touch_case(case_id, recovery=recovery, recovery_status="ESCALATED", stage="ESCALATED")
    audit.log("OPS_USER", "CASE_ESCALATED", case_id=case_id, transaction_id=case["transaction_id"], details=recovery)
    return get_case(case_id)
