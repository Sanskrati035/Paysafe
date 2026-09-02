"""
Evidence bundle generation.

Produces a structured, tamper-evident-looking (hash-stamped) JSON bundle
that operations/compliance can attach to a dispute filing. No real PII —
all customer data in this system is synthetic (see seed_data.py).
"""
import hashlib
from datetime import datetime, timezone


def generate(transaction: dict, investigation: dict, classification: dict, decision: dict, sla: dict) -> dict:
    bundle_core = {
        "transaction_id": transaction["id"],
        "rail": transaction["rail"],
        "amount": transaction["amount"],
        "currency": transaction.get("currency", "INR"),
        "customer_account_masked": transaction["customer_account_masked"],
        "beneficiary_account_masked": transaction["beneficiary_account_masked"],
        "initiated_at": transaction["initiated_at"],
        "classification": classification,
        "investigation": investigation,
        "decision": decision,
        "sla": sla,
    }
    fingerprint = hashlib.sha256(str(bundle_core).encode("utf-8")).hexdigest()[:16].upper()
    return {
        "evidence_id": f"EVD-{fingerprint}",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "integrity_hash": fingerprint,
        **bundle_core,
        "artifacts": [
            {"type": "debit_confirmation", "status": investigation.get("debit_status")},
            {"type": "network_log", "status": investigation.get("network_status")},
            {"type": "merchant_beneficiary_status", "status": investigation.get("credit_status")},
            {"type": "npci_reference", "status": investigation.get("npci_ref_status")},
        ],
    }
