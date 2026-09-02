import json
from sqlalchemy.orm import Session
from app.models.models import ExceptionCase, Transaction, Evidence, AuditLog


def build_evidence_packet(db: Session, case: ExceptionCase) -> dict:
    txn = db.query(Transaction).filter_by(transaction_id=case.transaction_id).first()
    evidence_rows = db.query(Evidence).filter_by(case_id=case.case_id).order_by(Evidence.created_at).all()
    audit_rows = db.query(AuditLog).filter_by(case_id=case.case_id).order_by(AuditLog.timestamp).all()

    packet = {
        "case_id": case.case_id,
        "transaction_id": case.transaction_id,
        "payment_rail": case.rail,
        "amount": txn.amount if txn else None,
        "customer_complaint": case.customer_message,
        "transaction_timestamp": txn.timestamp.isoformat() if txn else None,
        "debit_status": txn.debit_status if txn else None,
        "credit_status": txn.credit_status if txn else None,
        "network_status": txn.network_status if txn else None,
        "failure_type": case.failure_type,
        "case_status": case.case_status,
        "investigation_timeline": [
            {"type": e.evidence_type, "content": json.loads(e.content) if e.content else {}, "at": e.created_at.isoformat()}
            for e in evidence_rows
        ],
        "sla_deadline": case.sla.sla_deadline.isoformat() if case.sla else None,
        "sla_status": case.sla.sla_status if case.sla else None,
        "recommended_recovery_action": case.recommended_action,
        "decision_reason": case.decision_reason,
        "agent_confidence": case.confidence,
        "escalated": case.escalated,
        "escalation_reason": case.escalation_reason,
        "audit_history": [
            {"actor": a.actor, "action": a.action, "details": a.details, "timestamp": a.timestamp.isoformat()}
            for a in audit_rows
        ],
    }
    return packet
