"""
Mock payment-rail network endpoints.

In production these would be real switch / NPCI / bank-core integrations.
Here each function *deterministically* simulates the network response for
a given scenario_type so the demo is 100% reproducible, while still
exposing a `simulate_outage` flag so the "unavailable mock network"
error-handling path (see main.py) can be exercised on demand.
"""
import random

# scenario_type -> simulated network payload per rail family
_SCENARIOS = {
    "upi_debit_no_confirmation": {
        "debit_status": "CONFIRMED",
        "credit_status": "NOT_CONFIRMED",
        "network_status": "TIMEOUT",
        "npci_ref_status": "NO_RESPONSE",
    },
    "upi_duplicate_payment": {
        "debit_status": "CONFIRMED_TWICE",
        "credit_status": "CONFIRMED_TWICE",
        "network_status": "SUCCESS",
        "npci_ref_status": "TWO_DISTINCT_UTRS",
    },
    "upi_timeout": {
        "debit_status": "UNKNOWN",
        "credit_status": "UNKNOWN",
        "network_status": "TIMEOUT",
        "npci_ref_status": "NO_RESPONSE",
    },
    "imps_debit_no_credit": {
        "debit_status": "CONFIRMED",
        "credit_status": "NOT_CONFIRMED",
        "network_status": "BENEFICIARY_BANK_UNREACHABLE",
        "npci_ref_status": "PENDING_RETURN",
    },
    "neft_failed": {
        "debit_status": "CONFIRMED",
        "credit_status": "FAILED",
        "network_status": "RETURNED_BY_DEST_BANK",
        "npci_ref_status": "N/A_RBI_NEFT",
    },
    "rtgs_delayed": {
        "debit_status": "CONFIRMED",
        "credit_status": "DELAYED",
        "network_status": "SETTLEMENT_QUEUE_BACKLOG",
        "npci_ref_status": "N/A_RBI_RTGS",
    },
    "aeps_debit_no_cash": {
        "debit_status": "CONFIRMED",
        "credit_status": "N/A",
        "network_status": "BC_TERMINAL_DISPENSE_FAILURE",
        "npci_ref_status": "NO_RESPONSE",
    },
    "aeps_beneficiary_not_credited": {
        "debit_status": "CONFIRMED",
        "credit_status": "NOT_CONFIRMED",
        "network_status": "SWITCH_ACK_ONLY",
        "npci_ref_status": "PENDING_RECON",
    },
}

RAIL_ENDPOINTS = {
    "UPI": "upi",
    "IMPS": "imps",
    "NEFT": "neft",
    "RTGS": "rtgs",
    "AEPS": "aeps",
}


class NetworkUnavailableError(Exception):
    """Raised to simulate a mock network / upstream switch outage."""


def query_status(rail: str, transaction_id: str, scenario_type: str, simulate_outage: bool = False) -> dict:
    rail = (rail or "").upper()
    if rail not in RAIL_ENDPOINTS:
        raise ValueError(f"invalid payment rail: {rail}")

    if simulate_outage:
        raise NetworkUnavailableError(f"{rail} mock network endpoint is currently unavailable")

    payload = _SCENARIOS.get(scenario_type)
    if payload is None:
        # Unknown / generic transaction -> assume a clean, fully settled txn
        payload = {
            "debit_status": "CONFIRMED",
            "credit_status": "CONFIRMED",
            "network_status": "SUCCESS",
            "npci_ref_status": "SETTLED",
        }

    return {
        "rail": rail,
        "transaction_id": transaction_id,
        "queried_at": _now(),
        **payload,
        "raw_switch_code": _fake_switch_code(rail, scenario_type),
    }


def _fake_switch_code(rail: str, scenario_type: str) -> str:
    seed = f"{rail}-{scenario_type}"
    rng = random.Random(seed)
    return f"{rail[:2]}{rng.randint(100, 999)}"


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()
