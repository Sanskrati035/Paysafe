"""Investigation engine: pulls transaction + mock network data, checks for
duplicates, calculates elapsed time & SLA risk, and assembles an evidence
timeline for a case."""
import json
from datetime import datetime, timedelta
from sqlalchemy.orm import Session

from app.models.models import Transaction, Evidence, AuditLog
from app.services import mock_network
from app.config import settings


def _sla_deadline_for(rail: str, started: datetime) -> datetime:
    hours = settings.SLA_HOURS.get(rail.upper(), 24)
    return started + timedelta(hours=hours)


def investigate_transaction(db: Session, txn: Transaction, case=None) -> dict:
    findings = []
    evidence_items = []

    # 1. Fetch transaction + 2. call mock network API for that rail
    network_resp = mock_network.get_status(db, txn.rail, txn.transaction_id)
    evidence_items.append({"type": "NETWORK_RESPONSE", "content": network_resp})
    findings.append(f"Fetched live status from {txn.rail} network simulator: "
                     f"debit={txn.debit_status}, credit={txn.credit_status}, "
                     f"network={txn.network_status}.")

    # 3/4. debit & credit status checks
    if txn.debit_status == "DEBITED" and txn.credit_status in ("NOT_CONFIRMED", "FAILED"):
        findings.append("Debit confirmed at source, but credit to beneficiary is NOT confirmed.")
    if txn.credit_status == "CONFIRMED":
        findings.append("Credit has been confirmed on the beneficiary side.")

    # 5. duplicate check
    dup = None
    if txn.rail.upper() == "UPI":
        dup = db.query(Transaction).filter(
            Transaction.sender == txn.sender,
            Transaction.receiver == txn.receiver,
            Transaction.amount == txn.amount,
            Transaction.transaction_id != txn.transaction_id,
        ).first()
    duplicate_check = {
        "duplicate_flagged": bool(txn.is_duplicate or dup is not None),
        "matched_transaction_id": (dup.transaction_id if dup else txn.duplicate_of),
    }
    evidence_items.append({"type": "DUPLICATE_CHECK", "content": duplicate_check})
    if duplicate_check["duplicate_flagged"]:
        findings.append(f"Potential duplicate transaction identified: {duplicate_check['matched_transaction_id']}.")

    # 6. time elapsed & 9. SLA risk
    elapsed = datetime.utcnow() - txn.timestamp
    deadline = _sla_deadline_for(txn.rail, txn.timestamp)
    remaining = (deadline - datetime.utcnow()).total_seconds() / 3600.0
    if remaining <= 0:
        sla_status = "BREACHED"
    elif remaining <= (settings.SLA_HOURS.get(txn.rail.upper(), 24) * 0.25):
        sla_status = "AT_RISK"
    else:
        sla_status = "ON_TIME"
    findings.append(f"Elapsed time since transaction: {elapsed.total_seconds()/3600:.2f}h. "
                     f"SLA remaining: {remaining:.2f}h ({sla_status}).")
    timeline = {
        "transaction_time": txn.timestamp.isoformat(),
        "investigated_at": datetime.utcnow().isoformat(),
        "sla_deadline": deadline.isoformat(),
        "elapsed_hours": round(elapsed.total_seconds() / 3600, 2),
    }
    evidence_items.append({"type": "TIMELINE", "content": timeline})

    # 8. current transaction state determination
    if txn.network_status == "SUCCESS" and txn.credit_status == "CONFIRMED" and not duplicate_check["duplicate_flagged"]:
        current_state = "RESOLVED_SUCCESSFUL"
    elif txn.network_status in ("FAILED", "RETURNED"):
        current_state = "FAILED"
    elif duplicate_check["duplicate_flagged"]:
        current_state = "DUPLICATE_DETECTED"
    elif txn.network_status in ("TIMEOUT", "PENDING") or txn.credit_status == "NOT_CONFIRMED":
        current_state = "PENDING_UNRESOLVED"
    else:
        current_state = "UNDER_REVIEW"

    result = {
        "transaction_id": txn.transaction_id,
        "investigation_status": "COMPLETE",
        "findings": findings,
        "evidence": evidence_items,
        "current_state": current_state,
        "sla_status": sla_status,
        "hours_remaining": round(remaining, 2),
        "sla_deadline": deadline,
    }

    if case is not None:
        for item in evidence_items:
            db.add(Evidence(case_id=case.case_id, evidence_type=item["type"],
                             content=json.dumps(item["content"], default=str)))
        db.add(AuditLog(case_id=case.case_id, actor="AGENT", action="INVESTIGATION_COMPLETE",
                         details=json.dumps({"current_state": current_state, "sla_status": sla_status}, default=str)))
    return result
