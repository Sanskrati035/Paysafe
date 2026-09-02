"""All PAYSAFE REST endpoints: mock payment-network APIs, the AI agent
pipeline (classify / investigate / scan-now / events / status), case &
evidence retrieval, transactions, and human-approval of recovery actions.

NOTE: nothing in this file ever moves real money. Recovery actions are
always simulated and require human approval before their status flips to
SIMULATED_COMPLETE.
"""
import io
import json
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database.db import get_db
from app.config import settings
from app.models.models import (
    Transaction, ExceptionCase, RecoveryAction, AuditLog, Notification,
)
from app.schemas.schemas import (
    TransactionOut, ClassifyRequest, ClassifyResponse, InvestigateResponse,
    CaseOut, CaseDetailOut, RecoveryActionOut, ApproveActionRequest,
    AgentEvent, AgentStatus,
)
from app.services import mock_network, evidence_service, pdf_service
from app.agents import classifier, investigator, monitor_agent
from app.workflows import decision_engine

router = APIRouter()

# ---------------------------------------------------------------------------
# Mock payment-network APIs (simulated bank / NPCI responses)
# ---------------------------------------------------------------------------

@router.get("/mock/upi/status/{transaction_id}", tags=["mock-network"])
def mock_upi_status(transaction_id: str, db: Session = Depends(get_db)):
    return mock_network.upi_status(db, transaction_id)


@router.get("/mock/imps/status/{transaction_id}", tags=["mock-network"])
def mock_imps_status(transaction_id: str, db: Session = Depends(get_db)):
    return mock_network.imps_status(db, transaction_id)


@router.get("/mock/neft/status/{transaction_id}", tags=["mock-network"])
def mock_neft_status(transaction_id: str, db: Session = Depends(get_db)):
    return mock_network.neft_status(db, transaction_id)


@router.get("/mock/rtgs/status/{transaction_id}", tags=["mock-network"])
def mock_rtgs_status(transaction_id: str, db: Session = Depends(get_db)):
    return mock_network.rtgs_status(db, transaction_id)


@router.get("/mock/aeps/status/{transaction_id}", tags=["mock-network"])
def mock_aeps_status(transaction_id: str, db: Session = Depends(get_db)):
    return mock_network.aeps_status(db, transaction_id)


def _get_txn_or_404(db: Session, transaction_id: str) -> Transaction:
    txn = db.query(Transaction).filter_by(transaction_id=transaction_id).first()
    if not txn:
        raise HTTPException(status_code=404, detail=f"Transaction {transaction_id} not found")
    return txn


def _get_case_or_404(db: Session, case_id: str) -> ExceptionCase:
    case = db.query(ExceptionCase).filter_by(case_id=case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found")
    return case


# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------

@router.get("/api/transactions", response_model=List[TransactionOut], tags=["transactions"])
def list_transactions(db: Session = Depends(get_db)):
    return db.query(Transaction).order_by(Transaction.timestamp.desc()).all()


@router.get("/api/transactions/{transaction_id}", response_model=TransactionOut, tags=["transactions"])
def get_transaction(transaction_id: str, db: Session = Depends(get_db)):
    return _get_txn_or_404(db, transaction_id)


# ---------------------------------------------------------------------------
# AI Agent — classify (POST /api/agent/classify)
# Runs the FULL detect->classify->investigate->decide pipeline (reusing the
# same code path the background monitor agent uses) so a customer-reported
# complaint gets a real case immediately instead of a throwaway label.
# ---------------------------------------------------------------------------

@router.post("/api/agent/classify", response_model=ClassifyResponse, tags=["agent"])
def classify_endpoint(req: ClassifyRequest, db: Session = Depends(get_db)):
    txn = _get_txn_or_404(db, req.transaction_id)

    existing = db.query(ExceptionCase).filter_by(transaction_id=txn.transaction_id).first()
    if existing:
        return ClassifyResponse(
            transaction_id=txn.transaction_id, case_id=existing.case_id, rail=existing.rail,
            failure_type=existing.failure_type, confidence=existing.confidence,
            severity=existing.severity, reason=existing.decision_reason or "Case already open.",
            recommended_next_step=existing.recommended_action or "REVIEW", source="EXISTING_CASE",
        )

    raw = classifier.classify(req.customer_message, {"rail": txn.rail, "transaction_id": txn.transaction_id})
    case, created = monitor_agent._open_case_for_transaction(db, txn, customer_message=req.customer_message)
    if not case:
        # classifier + structured check both found nothing wrong
        return ClassifyResponse(
            transaction_id=txn.transaction_id, case_id=None, rail=raw["rail"],
            failure_type=raw["failure_type"], confidence=raw["confidence"], severity=raw["severity"],
            reason=raw["reason"], recommended_next_step=raw["recommended_next_step"], source=raw["source"],
        )

    monitor_agent.event_bus.push(
        "WARNING" if case.severity in ("HIGH", "CRITICAL") else "INFO",
        f"Case {case.case_id} opened from customer complaint on {txn.transaction_id}.",
        case_id=case.case_id, transaction_id=txn.transaction_id,
    )
    return ClassifyResponse(
        transaction_id=txn.transaction_id, case_id=case.case_id, rail=case.rail,
        failure_type=case.failure_type, confidence=case.confidence, severity=case.severity,
        reason=case.decision_reason or raw["reason"], recommended_next_step=case.recommended_action or "INVESTIGATE",
        source=raw["source"],
    )


# ---------------------------------------------------------------------------
# AI Agent — investigate (POST /api/agent/investigate/{transaction_id})
# ---------------------------------------------------------------------------

@router.post("/api/agent/investigate/{transaction_id}", response_model=InvestigateResponse, tags=["agent"])
def investigate_endpoint(transaction_id: str, db: Session = Depends(get_db)):
    txn = _get_txn_or_404(db, transaction_id)
    case = db.query(ExceptionCase).filter_by(transaction_id=transaction_id).first()

    result = investigator.investigate_transaction(db, txn, case=case)

    if case:
        case.case_status = "INVESTIGATED"
        db.add(AuditLog(case_id=case.case_id, actor="AGENT", action="MANUAL_REINVESTIGATION",
                         details=json.dumps({"current_state": result["current_state"]})))
    db.commit()

    return InvestigateResponse(
        transaction_id=transaction_id, case_id=case.case_id if case else None,
        investigation_status=result["investigation_status"], findings=result["findings"],
        evidence=result["evidence"], current_state=result["current_state"],
        sla_status=result["sla_status"], hours_remaining=result["hours_remaining"],
    )


# ---------------------------------------------------------------------------
# Cases
# ---------------------------------------------------------------------------

@router.get("/api/cases", response_model=List[CaseOut], tags=["cases"])
def list_cases(
    db: Session = Depends(get_db),
    status: Optional[str] = None,
    rail: Optional[str] = None,
    escalated: Optional[bool] = None,
):
    q = db.query(ExceptionCase)
    if status:
        q = q.filter(ExceptionCase.case_status == status)
    if rail:
        q = q.filter(ExceptionCase.rail == rail.upper())
    if escalated is not None:
        q = q.filter(ExceptionCase.escalated == escalated)
    return q.order_by(ExceptionCase.created_at.desc()).all()


@router.get("/api/cases/{case_id}", response_model=CaseDetailOut, tags=["cases"])
def get_case(case_id: str, db: Session = Depends(get_db)):
    return _get_case_or_404(db, case_id)


@router.get("/api/cases/{case_id}/evidence", tags=["cases"])
def get_case_evidence(case_id: str, db: Session = Depends(get_db)):
    case = _get_case_or_404(db, case_id)
    return evidence_service.build_evidence_packet(db, case)


@router.get("/api/cases/{case_id}/evidence/pdf", tags=["cases"])
def get_case_evidence_pdf(case_id: str, db: Session = Depends(get_db)):
    case = _get_case_or_404(db, case_id)
    packet = evidence_service.build_evidence_packet(db, case)
    pdf_bytes = pdf_service.render_evidence_pdf(packet)
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{case_id}_evidence.pdf"'},
    )


# ---------------------------------------------------------------------------
# Recovery actions (human-in-the-loop approval — no real money moves here)
# ---------------------------------------------------------------------------

@router.get("/api/cases/{case_id}/recovery-actions", response_model=List[RecoveryActionOut], tags=["recovery"])
def list_recovery_actions(case_id: str, db: Session = Depends(get_db)):
    _get_case_or_404(db, case_id)
    return db.query(RecoveryAction).filter_by(case_id=case_id).order_by(RecoveryAction.created_at.desc()).all()


@router.post(
    "/api/cases/{case_id}/recovery-actions/{action_id}/approve",
    response_model=RecoveryActionOut, tags=["recovery"],
)
def approve_recovery_action(
    case_id: str, action_id: int, req: ApproveActionRequest, db: Session = Depends(get_db)
):
    case = _get_case_or_404(db, case_id)
    action = db.query(RecoveryAction).filter_by(id=action_id, case_id=case_id).first()
    if not action:
        raise HTTPException(status_code=404, detail="Recovery action not found for this case")
    if action.status not in ("PENDING_APPROVAL",):
        raise HTTPException(status_code=400, detail=f"Action already {action.status}; cannot re-approve")

    action.approved_by = req.approved_by
    action.approved_at = datetime.utcnow()

    if req.approve:
        # SIMULATION ONLY: no real bank/NPCI call is made. This models what
        # would happen after a human ops approver signs off.
        action.status = "SIMULATED_COMPLETE"
        if action.action_type in ("REVERSAL", "REFUND"):
            case.case_status = "RESOLVED"
        elif action.action_type == "ESCALATION":
            case.case_status = "ESCALATED"
            case.escalated = True
        db.add(Notification(
            case_id=case.case_id, channel="APP",
            message=f"Your case {case.case_id} has been updated: {action.action_type} approved and simulated "
                    f"as complete by {req.approved_by}.",
        ))
        db.add(AuditLog(case_id=case.case_id, actor="HUMAN", action="RECOVERY_ACTION_APPROVED",
                         details=json.dumps({"action_id": action_id, "action_type": action.action_type,
                                              "approved_by": req.approved_by, "note": req.note})))
    else:
        action.status = "REJECTED"
        db.add(AuditLog(case_id=case.case_id, actor="HUMAN", action="RECOVERY_ACTION_REJECTED",
                         details=json.dumps({"action_id": action_id, "approved_by": req.approved_by,
                                              "note": req.note})))

    db.commit()
    db.refresh(action)
    return action


# ---------------------------------------------------------------------------
# Agent monitoring — the single background agent's live feed & controls
# ---------------------------------------------------------------------------

@router.get("/api/agent/status", response_model=AgentStatus, tags=["agent"])
def agent_status():
    return AgentStatus(
        running=monitor_agent.agent_state.running,
        llm_mode="LLM" if settings.USE_LLM else "RULE_BASED_FALLBACK",
        last_scan_at=monitor_agent.agent_state.last_scan_at,
        scans_completed=monitor_agent.agent_state.scans_completed,
        exceptions_detected_total=monitor_agent.agent_state.exceptions_detected_total,
        scan_interval_seconds=settings.AGENT_SCAN_INTERVAL_SECONDS,
    )


@router.get("/api/agent/events", response_model=List[AgentEvent], tags=["agent"])
def agent_events(after: int = Query(0), limit: int = Query(50, le=200)):
    return monitor_agent.event_bus.since(after, limit)


@router.post("/api/agent/scan-now", tags=["agent"])
def agent_scan_now():
    found = monitor_agent.run_single_scan()
    return {"new_exceptions_found": found}


# ---------------------------------------------------------------------------
# Dashboard stats
# ---------------------------------------------------------------------------

@router.get("/api/stats/dashboard", tags=["stats"])
def dashboard_stats(db: Session = Depends(get_db)):
    from app.models.models import SLATracking

    total_cases = db.query(ExceptionCase).count()
    escalated = db.query(ExceptionCase).filter_by(escalated=True).count()
    resolved = db.query(ExceptionCase).filter(
        ExceptionCase.case_status.in_(["RESOLVED", "CLOSED"])
    ).count()
    open_cases = total_cases - resolved

    from sqlalchemy import func
    rail_rows = db.query(ExceptionCase.rail, func.count(ExceptionCase.id)).group_by(ExceptionCase.rail).all()
    by_rail = {rail: count for rail, count in rail_rows}

    status_rows = db.query(ExceptionCase.case_status, func.count(ExceptionCase.id)).group_by(
        ExceptionCase.case_status
    ).all()
    by_status = {status: count for status, count in status_rows}

    sla_breached = db.query(SLATracking).filter_by(sla_status="BREACHED").count()
    sla_at_risk = db.query(SLATracking).filter_by(sla_status="AT_RISK").count()

    amount_at_risk = 0.0
    open_case_txns = db.query(Transaction.amount).join(
        ExceptionCase, ExceptionCase.transaction_id == Transaction.transaction_id
    ).filter(~ExceptionCase.case_status.in_(["RESOLVED", "CLOSED"])).all()
    amount_at_risk = sum(a for (a,) in open_case_txns)

    return {
        "total_transactions": db.query(Transaction).count(),
        "total_cases": total_cases,
        "open_cases": open_cases,
        "resolved_cases": resolved,
        "escalated_cases": escalated,
        "sla_breached": sla_breached,
        "sla_at_risk": sla_at_risk,
        "amount_at_risk": amount_at_risk,
        "cases_by_rail": by_rail,
        "cases_by_status": by_status,
    }
