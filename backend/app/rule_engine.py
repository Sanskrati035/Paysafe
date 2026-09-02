"""
Deterministic rule engine.

This module is the source of truth the system can ALWAYS fall back to.
It never calls the network or an LLM, so it can never be "unavailable" —
this is the guarantee required by the spec: "If the LLM is unavailable,
the deterministic rule engine MUST continue working."
"""
from app import mock_networks

SCENARIOS = {
    "upi_debit_no_confirmation": {
        "label": "UPI / Debit Without Confirmation",
        "rail": "UPI",
        "confidence": 0.97,
        "decision": "RECOVERY_WORKFLOW",
        "decision_reason": (
            "Debit is confirmed at the remitter bank but the merchant has not "
            "confirmed credit and NPCI switch shows a TIMEOUT. Per UPI dispute "
            "rules this qualifies for a recovery / reversal workflow."
        ),
        "recommended_action": "Initiate UPI reversal (TCC/RCC) and raise NPCI dispute reference",
    },
    "upi_duplicate_payment": {
        "label": "UPI / Duplicate Payment",
        "rail": "UPI",
        "confidence": 0.95,
        "decision": "RECOVERY_WORKFLOW",
        "decision_reason": (
            "Two distinct UTRs confirm the same amount was debited twice for a "
            "single intended payment. The duplicate leg qualifies for reversal."
        ),
        "recommended_action": "Reverse the duplicate UPI leg only; retain the original successful payment",
    },
    "upi_timeout": {
        "label": "UPI / Timeout",
        "rail": "UPI",
        "confidence": 0.90,
        "decision": "AWAIT_NETWORK_RECONCILIATION",
        "decision_reason": (
            "Both debit and credit legs are UNKNOWN pending NPCI reconciliation "
            "cycle (T+1). Recovery cannot be initiated until status resolves."
        ),
        "recommended_action": "Hold for automatic reconciliation cycle; escalate if unresolved after T+1",
    },
    "imps_debit_no_credit": {
        "label": "IMPS / Debit / No Credit",
        "rail": "IMPS",
        "confidence": 0.96,
        "decision": "RECOVERY_WORKFLOW",
        "decision_reason": (
            "Remitter debit confirmed; beneficiary bank unreachable, credit not "
            "confirmed. IMPS return-timer has lapsed, qualifying for reversal."
        ),
        "recommended_action": "Initiate IMPS return/reversal via NPCI; notify beneficiary bank",
    },
    "neft_failed": {
        "label": "NEFT / Failed",
        "rail": "NEFT",
        "confidence": 0.98,
        "decision": "AUTO_REVERSAL",
        "decision_reason": (
            "Destination bank explicitly returned the NEFT credit. RBI NEFT "
            "guidelines require automatic reversal to remitter within 2 hours."
        ),
        "recommended_action": "Auto-credit remitter account per RBI NEFT return-fund guidelines",
    },
    "rtgs_delayed": {
        "label": "RTGS / Delayed",
        "rail": "RTGS",
        "confidence": 0.88,
        "decision": "MONITOR_ESCALATE",
        "decision_reason": (
            "Debit confirmed, settlement queued but delayed beyond expected "
            "window. Not yet a failure — monitor and escalate to network ops "
            "if the RTGS settlement window is breached."
        ),
        "recommended_action": "Escalate to RTGS settlement/network ops queue; do not reverse yet",
    },
    "aeps_debit_no_cash": {
        "label": "AEPS / Debit / No Cash",
        "rail": "AEPS",
        "confidence": 0.94,
        "decision": "RECOVERY_WORKFLOW",
        "decision_reason": (
            "Debit confirmed by issuer; Business Correspondent terminal logged "
            "a dispense failure, so no cash was handed to the customer."
        ),
        "recommended_action": "Initiate AEPS chargeback / credit adjustment to customer account",
    },
    "aeps_beneficiary_not_credited": {
        "label": "AEPS / Beneficiary Not Credited",
        "rail": "AEPS",
        "confidence": 0.93,
        "decision": "RECOVERY_WORKFLOW",
        "decision_reason": (
            "Switch acknowledged the debit but beneficiary credit is pending "
            "reconciliation beyond the expected AEPS settlement window."
        ),
        "recommended_action": "Raise AEPS reconciliation query with acquiring bank; prepare reversal if unresolved",
    },
}

RAILS = ["UPI", "IMPS", "NEFT", "RTGS", "AEPS"]


def classify(complaint_text: str, rail_hint: str = None, scenario_hint: str = None) -> dict:
    """Deterministic classification from complaint text / hints.

    A real system would use NLP; here we keyword-match against the known
    scenario catalogue and always return a confident, explainable result.
    """
    text = (complaint_text or "").lower()

    if scenario_hint and scenario_hint in SCENARIOS:
        key = scenario_hint
    else:
        key = _keyword_match(text) or "upi_debit_no_confirmation"

    meta = SCENARIOS[key]
    return {
        "scenario_type": key,
        "label": meta["label"],
        "rail": meta["rail"],
        "confidence": meta["confidence"],
        "method": "rule_engine",
    }


def _keyword_match(text: str) -> str:
    if "duplicate" in text or "twice" in text or "charged me two" in text:
        return "upi_duplicate_payment"
    if "aeps" in text and ("cash" in text or "dispense" in text):
        return "aeps_debit_no_cash"
    if "aeps" in text:
        return "aeps_beneficiary_not_credited"
    if "rtgs" in text:
        return "rtgs_delayed"
    if "neft" in text:
        return "neft_failed"
    if "imps" in text:
        return "imps_debit_no_credit"
    if "timeout" in text or "timed out" in text:
        return "upi_timeout"
    if "upi" in text or "paid" in text or "gpay" in text or "phonepe" in text:
        return "upi_debit_no_confirmation"
    return "upi_debit_no_confirmation"


def investigate(rail: str, transaction_id: str, scenario_type: str, simulate_outage: bool = False) -> dict:
    """Query the (mock) network and turn it into human-readable findings."""
    try:
        net = mock_networks.query_status(rail, transaction_id, scenario_type, simulate_outage=simulate_outage)
        source = "mock_network"
    except mock_networks.NetworkUnavailableError as exc:
        # Graceful degradation: fall back to the last-known scenario truth
        # table so the pipeline still produces a usable (clearly-flagged)
        # investigation result instead of crashing the workflow.
        net = {
            "rail": rail,
            "transaction_id": transaction_id,
            "debit_status": "CONFIRMED",
            "credit_status": "UNKNOWN",
            "network_status": "NETWORK_UNAVAILABLE",
            "npci_ref_status": "UNAVAILABLE",
            "raw_switch_code": "N/A",
            "degraded_reason": str(exc),
        }
        source = "fallback_cache"

    return {
        "source": source,
        "debit_status": net["debit_status"],
        "credit_status": net["credit_status"],
        "network_status": net["network_status"],
        "npci_ref_status": net["npci_ref_status"],
        "raw_switch_code": net.get("raw_switch_code"),
        "queried_at": net.get("queried_at"),
        "summary": _summarize(net),
    }


def _summarize(net: dict) -> str:
    return (
        f"Debit: {net['debit_status']} | Credit/Merchant: {net['credit_status']} | "
        f"Network: {net['network_status']}"
    )


def decide(scenario_type: str) -> dict:
    meta = SCENARIOS.get(scenario_type, SCENARIOS["upi_debit_no_confirmation"])
    return {
        "decision": meta["decision"],
        "reason": meta["decision_reason"],
        "recommended_action": meta["recommended_action"],
        "method": "rule_engine",
    }
