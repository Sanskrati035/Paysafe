"""
AI classification agent with provider abstraction.

- If ANTHROPIC_API_KEY is present in .env -> use the Claude API for
  reasoning over ambiguous free-text customer complaints.
- If no key is present -> deterministic keyword/rule based fallback runs
  automatically so the whole app always works offline / with zero setup.

Known payment codes / structured transaction states are ALWAYS handled by
the rule-based engine first (fast + deterministic). The LLM is only invoked
for genuinely ambiguous natural-language complaints when a key exists.
"""
import json
import re
from app.config import settings

# ---------------------------------------------------------------------------
# Rule-based keyword classifier (always available, zero dependencies)
# ---------------------------------------------------------------------------

RULES = [
    # (regex patterns, rail, failure_type, severity)
    (r"twice|duplicate|deducted.*(two|2).*time|double.*charg", "UPI", "duplicate_payment", "MEDIUM"),
    (r"stuck|pending|not.*(moved|updated)|processing.*long", "UPI", "timeout_pending", "MEDIUM"),
    (r"deduct(ed)?.*(but|however).*(not|didn.?t|did not).*(confirm|receiv)|debited.*no confirmation",
     "UPI", "debit_without_confirmation", "HIGH"),
    (r"imps.*(not credited|receiver.*not)|debited.*imps", "IMPS", "debited_not_credited", "HIGH"),
    (r"neft.*(fail|delay|return|not arriv|hasn.?t arriv)", "NEFT", "failed_delayed_returned", "MEDIUM"),
    (r"rtgs.*(fail|delay|stuck)", "RTGS", "failed_delayed_high_value", "CRITICAL"),
    (r"cash.*(not|didn.?t|wasn.?t|hasn.?t|never|no).*(dispens|receiv|come out|out)|"
     r"atm.*no cash|debited.*no cash|cash.*not.*(given|out)",
     "AEPS", "debited_no_cash", "HIGH"),
    (r"aeps.*(beneficiary|receiver).*not.*credit|micro.?atm.*not.*credit",
     "AEPS", "debited_beneficiary_not_credited", "HIGH"),
    (r"paid.*(but|however).*(receiver|other side|friend|vendor).*(didn.?t|did not|not).*(receiv|get)",
     "UPI", "debit_without_confirmation", "HIGH"),
]

FAILURE_LABELS = {
    "debit_without_confirmation": "UPI debit without confirmation",
    "duplicate_payment": "UPI duplicate payment",
    "timeout_pending": "UPI timeout / pending transaction",
    "debited_not_credited": "IMPS debited but receiver not credited",
    "failed_delayed_returned": "NEFT failed / delayed / returned",
    "failed_delayed_high_value": "RTGS failed / delayed high-value transfer",
    "debited_no_cash": "AEPS account debited, cash not received",
    "debited_beneficiary_not_credited": "AEPS account debited, beneficiary not credited",
}


def rule_based_classify(customer_message: str, txn_rail: str = None) -> dict:
    text = customer_message.lower()
    for pattern, rail, failure_type, severity in RULES:
        if re.search(pattern, text):
            confidence = 0.97 if txn_rail and txn_rail.upper() == rail else 0.88
            return {
                "rail": txn_rail.upper() if txn_rail else rail,
                "failure_type": failure_type,
                "confidence": confidence,
                "severity": severity,
                "reason": f"Matched pattern for '{FAILURE_LABELS[failure_type]}' in customer complaint.",
                "recommended_next_step": "INVESTIGATE",
                "source": "RULE_BASED",
            }
    # No confident rule match -> generic ambiguous complaint
    rail = (txn_rail or "UPI").upper()
    return {
        "rail": rail,
        "failure_type": "unclassified_complaint",
        "confidence": 0.4,
        "severity": "MEDIUM",
        "reason": "No high-confidence keyword pattern matched; flagged for deeper investigation.",
        "recommended_next_step": "INVESTIGATE",
        "source": "RULE_BASED",
    }


def structured_from_transaction(txn) -> dict:
    """Deterministic classification directly off known transaction state
    (used by the monitor agent when there is no free-text complaint)."""
    rail = txn.rail.upper()
    if rail == "UPI":
        if txn.is_duplicate:
            return dict(failure_type="duplicate_payment", severity="MEDIUM",
                        reason="Duplicate reference/transaction detected against an existing successful payment.")
        if txn.debit_status == "DEBITED" and txn.credit_status == "NOT_CONFIRMED":
            return dict(failure_type="debit_without_confirmation", severity="HIGH",
                        reason="Debit confirmed by issuing bank but no credit confirmation received from NPCI.")
        if txn.network_status in ("TIMEOUT", "PENDING"):
            return dict(failure_type="timeout_pending", severity="MEDIUM",
                        reason="Transaction has remained in PENDING/TIMEOUT state beyond expected window.")
    elif rail == "IMPS":
        if txn.debit_status == "DEBITED" and txn.credit_status != "CONFIRMED":
            return dict(failure_type="debited_not_credited", severity="HIGH",
                        reason="Sender account debited but beneficiary bank has not confirmed credit.")
    elif rail == "NEFT":
        if txn.network_status in ("FAILED", "RETURNED", "DELAYED"):
            return dict(failure_type="failed_delayed_returned", severity="MEDIUM",
                        reason=f"NEFT batch settlement reported status={txn.network_status}.")
    elif rail == "RTGS":
        if txn.network_status in ("FAILED", "DELAYED", "PENDING"):
            return dict(failure_type="failed_delayed_high_value", severity="CRITICAL",
                        reason=f"High-value RTGS transfer status={txn.network_status}; tight 2-hour SLA window.")
    elif rail == "AEPS":
        if txn.debit_status == "DEBITED" and txn.cash_dispensed is False:
            return dict(failure_type="debited_no_cash", severity="HIGH",
                        reason="Micro-ATM/BC agent reports cash NOT dispensed despite successful debit.")
        if txn.debit_status == "DEBITED" and txn.credit_status != "CONFIRMED" and txn.cash_dispensed is None:
            return dict(failure_type="debited_beneficiary_not_credited", severity="HIGH",
                        reason="AEPS transaction debited but beneficiary credit not confirmed.")
    return None


# ---------------------------------------------------------------------------
# LLM provider (only used for ambiguous free text, only if API key present)
# ---------------------------------------------------------------------------

def llm_classify(customer_message: str, txn_context: dict) -> dict:
    """Calls Claude for reasoning over an ambiguous complaint. Only invoked
    when settings.USE_LLM is True. Falls back to rule-based on any error."""
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=settings.LLM_API_KEY)
        system = (
            "You are a payments exception classification engine for an Indian "
            "payments company. Classify the customer's complaint into exactly one "
            "of these failure_type values: debit_without_confirmation, "
            "duplicate_payment, timeout_pending, debited_not_credited, "
            "failed_delayed_returned, failed_delayed_high_value, debited_no_cash, "
            "debited_beneficiary_not_credited, unclassified_complaint. "
            "Also pick rail from UPI, IMPS, NEFT, RTGS, AEPS. "
            "Respond ONLY with strict JSON: "
            '{"rail":"","failure_type":"","confidence":0.0,"severity":"LOW|MEDIUM|HIGH|CRITICAL",'
            '"reason":"","recommended_next_step":"INVESTIGATE|MONITOR|ESCALATE"}'
        )
        user = f"Known transaction context: {json.dumps(txn_context)}\nCustomer complaint: {customer_message}"
        resp = client.messages.create(
            model=settings.LLM_MODEL,
            max_tokens=400,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        text = text.strip().strip("`")
        if text.startswith("json"):
            text = text[4:]
        data = json.loads(text)
        data["source"] = "LLM"
        return data
    except Exception as e:  # noqa: broad-except - always degrade gracefully
        fallback = rule_based_classify(customer_message, txn_context.get("rail"))
        fallback["reason"] += f" (LLM unavailable, used rule-based fallback: {e})"
        return fallback


def classify(customer_message: str, txn_context: dict) -> dict:
    if settings.USE_LLM and len(customer_message.strip()) > 0:
        return llm_classify(customer_message, txn_context)
    return rule_based_classify(customer_message, txn_context.get("rail"))
