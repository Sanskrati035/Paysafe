"""
Simulated bank / NPCI network responses.
NOTE: This is a hackathon simulation only. No real banking/NPCI systems are
contacted and no real money ever moves. All responses below are generated
deterministically from data already stored in our own mock SQLite database.
"""
from datetime import datetime
from sqlalchemy.orm import Session
from app.models.models import Transaction


def _base_payload(txn: Transaction) -> dict:
    return {
        "transaction_id": txn.transaction_id,
        "rail": txn.rail,
        "debit_status": txn.debit_status,
        "credit_status": txn.credit_status,
        "network_status": txn.network_status,
        "amount": txn.amount,
        "timestamp": txn.timestamp.isoformat(),
        "reference_id": txn.reference_id or f"REF{txn.id:06d}",
    }


def upi_status(db: Session, transaction_id: str) -> dict:
    txn = db.query(Transaction).filter_by(transaction_id=transaction_id).first()
    if not txn:
        return {"error": "transaction not found"}
    payload = _base_payload(txn)
    payload["npci_ack"] = "ACK" if txn.network_status != "FAILED" else "NACK"
    payload["is_duplicate"] = txn.is_duplicate
    payload["duplicate_of"] = txn.duplicate_of
    return payload


def imps_status(db: Session, transaction_id: str) -> dict:
    txn = db.query(Transaction).filter_by(transaction_id=transaction_id).first()
    if not txn:
        return {"error": "transaction not found"}
    payload = _base_payload(txn)
    payload["beneficiary_bank_ack"] = "RECEIVED" if txn.credit_status == "CONFIRMED" else "NOT_RECEIVED"
    return payload


def neft_status(db: Session, transaction_id: str) -> dict:
    txn = db.query(Transaction).filter_by(transaction_id=transaction_id).first()
    if not txn:
        return {"error": "transaction not found"}
    payload = _base_payload(txn)
    payload["batch_settlement_status"] = txn.network_status
    payload["return_code"] = "R01_RETURNED" if txn.network_status == "RETURNED" else None
    return payload


def rtgs_status(db: Session, transaction_id: str) -> dict:
    txn = db.query(Transaction).filter_by(transaction_id=transaction_id).first()
    if not txn:
        return {"error": "transaction not found"}
    payload = _base_payload(txn)
    payload["priority"] = "HIGH_VALUE"
    payload["rbi_settlement_status"] = txn.network_status
    return payload


def aeps_status(db: Session, transaction_id: str) -> dict:
    txn = db.query(Transaction).filter_by(transaction_id=transaction_id).first()
    if not txn:
        return {"error": "transaction not found"}
    payload = _base_payload(txn)
    payload["cash_dispensed"] = txn.cash_dispensed
    payload["bc_agent_id"] = f"BC{(txn.id % 97):04d}"
    return payload


RAIL_HANDLERS = {
    "UPI": upi_status,
    "IMPS": imps_status,
    "NEFT": neft_status,
    "RTGS": rtgs_status,
    "AEPS": aeps_status,
}


def get_status(db: Session, rail: str, transaction_id: str) -> dict:
    handler = RAIL_HANDLERS.get(rail.upper())
    if not handler:
        return {"error": f"unsupported rail {rail}"}
    return handler(db, transaction_id)
