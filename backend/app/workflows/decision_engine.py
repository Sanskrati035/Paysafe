"""Deterministic decision engine mapping (rail, failure_type, investigation
state) -> recovery workflow + case status. All money-impacting actions are
created as SIMULATED recovery actions that require explicit human approval
(see RecoveryAction.requires_human_approval) — this system never moves real
money on its own."""
from datetime import datetime

DECISIONS = {
    # failure_type -> function(current_state, sla_status, txn) -> dict
}


def decide(failure_type: str, current_state: str, sla_status: str, txn) -> dict:
    """Returns dict: case_status, recommended_action, decision_reason,
    escalate(bool), escalation_reason, recovery: {action_type, description,
    amount, requires_human_approval} or None"""

    rail = txn.rail.upper()

    # ---- UPI: debit without confirmation ----
    if failure_type == "debit_without_confirmation":
        if current_state == "FAILED":
            return dict(case_status="DECIDED", recommended_action="INITIATE_REVERSAL",
                        decision_reason="Debit confirmed, network reports FAILED -> auto-reversal workflow recommended.",
                        escalate=False, escalation_reason="",
                        recovery=dict(action_type="REVERSAL", amount=txn.amount,
                                      description="Reverse debited amount back to sender since credit never confirmed."))
        if current_state == "PENDING_UNRESOLVED":
            return dict(case_status="DECIDED", recommended_action="CONTINUE_MONITORING",
                        decision_reason="Still within SLA window; continue monitoring before reversal.",
                        escalate=(sla_status == "AT_RISK"),
                        escalation_reason="Approaching SLA deadline with no resolution." if sla_status == "AT_RISK" else "",
                        recovery=dict(action_type="MONITOR", amount=0,
                                      description="Re-check network status every scan cycle until resolved or SLA breached."))
        if current_state == "RESOLVED_SUCCESSFUL":
            return dict(case_status="RESOLVED", recommended_action="NOTIFY_CUSTOMER",
                        decision_reason="Credit later confirmed successful; no recovery action required.",
                        escalate=False, escalation_reason="", recovery=None)
        return dict(case_status="ESCALATED", recommended_action="ESCALATE_TO_OPS",
                    decision_reason="Unresolved after investigation window.", escalate=True,
                    escalation_reason="No conclusive network status after investigation.",
                    recovery=dict(action_type="ESCALATION", amount=0,
                                  description="Escalate to payments ops team for manual bank-side reconciliation."))

    # ---- UPI: duplicate payment ----
    if failure_type == "duplicate_payment":
        return dict(case_status="DECIDED", recommended_action="REFUND_DUPLICATE_LEG",
                    decision_reason="Duplicate reference/transaction confirmed against an existing successful payment.",
                    escalate=False, escalation_reason="",
                    recovery=dict(action_type="REFUND", amount=txn.amount,
                                  description="Refund the duplicate leg of the payment; requires human approval before execution."))

    # ---- UPI: timeout / pending ----
    if failure_type == "timeout_pending":
        if current_state == "RESOLVED_SUCCESSFUL":
            return dict(case_status="RESOLVED", recommended_action="NOTIFY_CUSTOMER",
                        decision_reason="Transaction settled successfully after timeout window.",
                        escalate=False, escalation_reason="", recovery=None)
        if current_state == "FAILED":
            return dict(case_status="DECIDED", recommended_action="INITIATE_REVERSAL",
                        decision_reason="Timeout resolved as FAILED at network -> reverse debit.",
                        escalate=False, escalation_reason="",
                        recovery=dict(action_type="REVERSAL", amount=txn.amount,
                                      description="Reverse debited amount since final network status is FAILED."))
        return dict(case_status="DECIDED", recommended_action="CONTINUE_MONITORING",
                    decision_reason="Prevent customer retry; continue automatic monitoring until network confirms final state.",
                    escalate=(sla_status != "ON_TIME"), escalation_reason="SLA risk on pending timeout case." if sla_status != "ON_TIME" else "",
                    recovery=dict(action_type="MONITOR", amount=0,
                                  description="Poll network status; block duplicate customer-initiated retries."))

    # ---- IMPS: debited, receiver not credited ----
    if failure_type == "debited_not_credited":
        escalate = current_state in ("PENDING_UNRESOLVED", "UNDER_REVIEW") and sla_status != "ON_TIME"
        return dict(case_status="ESCALATED" if escalate else "DECIDED",
                    recommended_action="ESCALATE_TO_OPS" if escalate else "INITIATE_REVERSAL",
                    decision_reason="IMPS beneficiary bank has not confirmed credit despite confirmed debit.",
                    escalate=escalate,
                    escalation_reason="SLA risk on unresolved IMPS credit confirmation." if escalate else "",
                    recovery=dict(action_type="REVERSAL" if not escalate else "ESCALATION", amount=txn.amount,
                                  description="Reverse debit or escalate to beneficiary bank via NPCI dispute desk."))

    # ---- NEFT ----
    if failure_type == "failed_delayed_returned":
        return dict(case_status="DECIDED", recommended_action="INITIATE_REVERSAL",
                    decision_reason=f"NEFT batch reports {current_state}; recommend reversal/return-fund workflow.",
                    escalate=(sla_status != "ON_TIME"),
                    escalation_reason="NEFT approaching/at SLA breach." if sla_status != "ON_TIME" else "",
                    recovery=dict(action_type="REVERSAL", amount=txn.amount,
                                  description="Return funds to remitter per NEFT return-fund procedure (R-code)."))

    # ---- RTGS ----
    if failure_type == "failed_delayed_high_value":
        escalate = True  # RTGS is always high priority per spec
        return dict(case_status="ESCALATED", recommended_action="ESCALATE_TO_OPS",
                    decision_reason="High-value RTGS transfer flagged; auto-escalated per priority policy, 2h SLA window.",
                    escalate=escalate, escalation_reason="High-value transfer requires immediate human review.",
                    recovery=dict(action_type="ESCALATION", amount=txn.amount,
                                  description="Escalate to RTGS settlement desk for urgent manual tracing."))

    # ---- AEPS: debited, cash not received ----
    if failure_type == "debited_no_cash":
        return dict(case_status="DECIDED", recommended_action="INITIATE_REVERSAL",
                    decision_reason="BC agent/micro-ATM confirms cash was NOT dispensed despite successful debit.",
                    escalate=False, escalation_reason="",
                    recovery=dict(action_type="REVERSAL", amount=txn.amount,
                                  description="Reverse the debited amount back to the customer's account."))

    # ---- AEPS: beneficiary not credited ----
    if failure_type == "debited_beneficiary_not_credited":
        escalate = current_state != "RESOLVED_SUCCESSFUL"
        return dict(case_status="ESCALATED" if escalate else "RESOLVED",
                    recommended_action="ESCALATE_TO_OPS" if escalate else "NOTIFY_CUSTOMER",
                    decision_reason="AEPS beneficiary credit could not be verified from network simulator.",
                    escalate=escalate,
                    escalation_reason="Beneficiary credit unverifiable; needs manual reconciliation with issuer bank." if escalate else "",
                    recovery=dict(action_type="ESCALATION", amount=txn.amount,
                                  description="Escalate to AEPS reconciliation desk for beneficiary bank confirmation.") if escalate else None)

    # ---- fallback ----
    return dict(case_status="ESCALATED", recommended_action="ESCALATE_TO_OPS",
                decision_reason="Unrecognized/ambiguous failure type; routed to human review.",
                escalate=True, escalation_reason="Unclassified complaint could not be auto-decided.",
                recovery=dict(action_type="ESCALATION", amount=0,
                              description="Manual triage required by ops team."))
