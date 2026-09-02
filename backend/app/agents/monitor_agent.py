"""
The PaySafe Monitor Agent — exactly ONE background agent instance runs for
the lifetime of the process. On a fixed interval it scans every transaction
that does not yet have an open exception case, runs it through the
classifier + decision engine, opens a case automatically when it finds a
problem, and pushes an event into an in-memory ring buffer that the frontend
polls (GET /api/agent/events) to render a live "agent is working" feed.

This models a real-time anomaly detector without needing an external queue
or websocket infra for the hackathon MVP.
"""
import asyncio
import json
from collections import deque
from datetime import datetime

from app.database.db import SessionLocal
from app.models.models import Transaction, ExceptionCase, SLATracking, AuditLog, Notification
from app.agents import classifier, investigator
from app.workflows import decision_engine
from app.config import settings


class AgentEventBus:
    def __init__(self, maxlen=200):
        self._events = deque(maxlen=maxlen)
        self._next_id = 1

    def push(self, level: str, message: str, case_id: str = None, transaction_id: str = None):
        evt = {
            "id": self._next_id,
            "timestamp": datetime.utcnow(),
            "level": level,
            "message": message,
            "case_id": case_id,
            "transaction_id": transaction_id,
        }
        self._next_id += 1
        self._events.append(evt)
        return evt

    def since(self, after_id: int = 0, limit: int = 50):
        items = [e for e in self._events if e["id"] > after_id]
        return items[-limit:]

    def latest(self, limit=50):
        return list(self._events)[-limit:]


event_bus = AgentEventBus()


class MonitorAgentState:
    def __init__(self):
        self.running = False
        self.last_scan_at = None
        self.scans_completed = 0
        self.exceptions_detected_total = 0


agent_state = MonitorAgentState()


def _open_case_for_transaction(db, txn: Transaction, customer_message: str = ""):
    """Runs full DETECT -> CLASSIFY -> INVESTIGATE -> DECIDE pipeline for a
    single transaction and persists a new ExceptionCase (idempotent)."""
    existing = db.query(ExceptionCase).filter_by(transaction_id=txn.transaction_id).first()
    if existing:
        return existing, False

    struct = classifier.structured_from_transaction(txn)
    if struct is None and not customer_message:
        return None, False  # nothing wrong detected

    if struct:
        failure_type = struct["failure_type"]
        severity = struct["severity"]
        reason = struct["reason"]
        confidence = 0.95
        source = "RULE_BASED"
    else:
        result = classifier.classify(customer_message, {"rail": txn.rail, "transaction_id": txn.transaction_id})
        failure_type = result["failure_type"]
        severity = result["severity"]
        reason = result["reason"]
        confidence = result["confidence"]
        source = result["source"]

    case = ExceptionCase(
        transaction_id=txn.transaction_id,
        rail=txn.rail,
        failure_type=failure_type,
        severity=severity,
        confidence=confidence,
        customer_message=customer_message,
        case_status="CLASSIFIED",
        detected_by="AGENT" if not customer_message else "CUSTOMER_REPORT",
    )
    db.add(case)
    db.flush()

    db.add(AuditLog(case_id=case.case_id, actor="AGENT", action="CASE_DETECTED",
                     details=json.dumps({"failure_type": failure_type, "reason": reason, "source": source})))

    # INVESTIGATE
    inv = investigator.investigate_transaction(db, txn, case=case)
    case.case_status = "INVESTIGATED"

    # DECIDE
    decision = decision_engine.decide(failure_type, inv["current_state"], inv["sla_status"], txn)
    case.case_status = decision["case_status"]
    case.recommended_action = decision["recommended_action"]
    case.decision_reason = decision["decision_reason"]
    case.escalated = decision["escalate"]
    case.escalation_reason = decision["escalation_reason"]

    sla = SLATracking(case_id=case.case_id, rail=txn.rail, sla_deadline=inv["sla_deadline"],
                       sla_status=inv["sla_status"], hours_remaining=inv["hours_remaining"])
    db.add(sla)

    if decision["recovery"]:
        from app.models.models import RecoveryAction
        db.add(RecoveryAction(
            case_id=case.case_id, action_type=decision["recovery"]["action_type"],
            description=decision["recovery"]["description"], amount=decision["recovery"]["amount"],
            status="PENDING_APPROVAL", requires_human_approval=(decision["recovery"]["action_type"] in
                                                                 ("REVERSAL", "REFUND")),
        ))
        db.add(AuditLog(case_id=case.case_id, actor="AGENT", action="RECOVERY_ACTION_PROPOSED",
                         details=json.dumps(decision["recovery"])))

    db.add(Notification(case_id=case.case_id, channel="APP",
                         message=f"We've detected an issue with your {txn.rail} transaction "
                                 f"{txn.transaction_id} and opened case {case.case_id}. "
                                 f"Current status: {case.case_status}."))
    db.add(AuditLog(case_id=case.case_id, actor="AGENT", action="DECISION_MADE",
                     details=json.dumps({"case_status": case.case_status,
                                         "recommended_action": case.recommended_action})))

    db.commit()
    db.refresh(case)
    return case, True


def run_single_scan():
    """One full sweep over all transactions without an open case. Safe to
    call repeatedly (idempotent) — used both by the background loop and by
    a manual '/api/agent/scan-now' trigger."""
    db = SessionLocal()
    found = 0
    try:
        txns = db.query(Transaction).all()
        for txn in txns:
            case, created = _open_case_for_transaction(db, txn)
            if created:
                found += 1
                level = "CRITICAL" if case.severity in ("HIGH", "CRITICAL") else "WARNING"
                event_bus.push(level,
                                f"Detected {case.failure_type.replace('_', ' ')} on {txn.rail} "
                                f"txn {txn.transaction_id} (₹{txn.amount:,.0f}) -> opened {case.case_id} "
                                f"[{case.case_status}]",
                                case_id=case.case_id, transaction_id=txn.transaction_id)
        agent_state.last_scan_at = datetime.utcnow()
        agent_state.scans_completed += 1
        agent_state.exceptions_detected_total += found
        if found == 0:
            event_bus.push("INFO", f"Scan complete — {len(txns)} transactions checked, no new exceptions.")
    finally:
        db.close()
    return found


async def monitor_loop():
    agent_state.running = True
    event_bus.push("INFO", "PaySafe monitor agent started. Watching UPI, IMPS, NEFT, RTGS, AEPS transactions.")
    while True:
        try:
            run_single_scan()
        except Exception as e:  # noqa: keep the single agent alive no matter what
            event_bus.push("CRITICAL", f"Agent scan error (recovered): {e}")
        await asyncio.sleep(settings.AGENT_SCAN_INTERVAL_SECONDS)
