"""
SLA policy engine.

Windows below are simplified, illustrative approximations of common
Indian payment-rail dispute/resolution norms (NPCI/RBI circulars) for
demo purposes — NOT legal or compliance guidance.
"""
from datetime import datetime, timedelta, timezone

# investigation-response SLA window, in minutes, per rail
SLA_WINDOWS_MINUTES = {
    "UPI": 60,
    "IMPS": 60,
    "NEFT": 120,
    "RTGS": 30,
    "AEPS": 60,
}

# scenarios that are inherently high risk of breach even early in the window
HIGH_RISK_SCENARIOS = {
    "upi_debit_no_confirmation",
    "imps_debit_no_credit",
    "aeps_debit_no_cash",
    "aeps_beneficiary_not_credited",
    "rtgs_delayed",
}


def calculate(rail: str, scenario_type: str, initiated_at_iso: str) -> dict:
    window_minutes = SLA_WINDOWS_MINUTES.get(rail, 60)
    try:
        initiated_at = datetime.fromisoformat(initiated_at_iso)
    except ValueError:
        initiated_at = datetime.now(timezone.utc)

    deadline = initiated_at + timedelta(minutes=window_minutes)
    now = datetime.now(timezone.utc)
    minutes_elapsed = max(0.0, (now - initiated_at).total_seconds() / 60)
    minutes_remaining = (deadline - now).total_seconds() / 60

    if minutes_remaining <= 0:
        status = "BREACHED"
    elif scenario_type in HIGH_RISK_SCENARIOS or minutes_remaining <= window_minutes * 0.5:
        status = "AT_RISK"
    else:
        status = "ON_TRACK"

    return {
        "rail": rail,
        "sla_window_minutes": window_minutes,
        "initiated_at": initiated_at.isoformat(),
        "deadline": deadline.isoformat(),
        "minutes_elapsed": round(minutes_elapsed, 2),
        "minutes_remaining": round(minutes_remaining, 2),
        "status": status,
    }
