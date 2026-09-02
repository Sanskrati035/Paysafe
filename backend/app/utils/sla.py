from datetime import datetime


def sla_status_for(deadline: datetime, sla_hours: float) -> tuple:
    """Returns (status, hours_remaining)."""
    remaining = (deadline - datetime.utcnow()).total_seconds() / 3600.0
    if remaining <= 0:
        return "BREACHED", round(remaining, 2)
    if remaining <= sla_hours * 0.25:
        return "AT_RISK", round(remaining, 2)
    return "ON_TIME", round(remaining, 2)
