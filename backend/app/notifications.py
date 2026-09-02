DECISION_TEMPLATES = {
    "RECOVERY_WORKFLOW": (
        "Your payment of ₹{amount:,.0f} could not be confirmed as received by "
        "{beneficiary}. We've initiated the recovery process on your behalf. "
        "You will be notified once the reversal is complete. Reference: {txn_id}."
    ),
    "AUTO_REVERSAL": (
        "Your payment of ₹{amount:,.0f} to {beneficiary} was not successful. "
        "The amount has been automatically credited back to your account. "
        "Reference: {txn_id}."
    ),
    "MONITOR_ESCALATE": (
        "Your payment of ₹{amount:,.0f} to {beneficiary} is confirmed debited "
        "and is being processed by the settlement network. It is taking longer "
        "than usual — we are actively monitoring it and will update you shortly. "
        "Reference: {txn_id}."
    ),
    "AWAIT_NETWORK_RECONCILIATION": (
        "We're verifying the status of your payment of ₹{amount:,.0f} to "
        "{beneficiary} with the payment network. This can take up to 1 "
        "business day. We'll notify you as soon as it's resolved. "
        "Reference: {txn_id}."
    ),
}

DEFAULT_TEMPLATE = (
    "Your payment could not be confirmed. We've initiated the recovery process. "
    "Reference: {txn_id}."
)


def generate(decision: str, transaction: dict) -> str:
    template = DECISION_TEMPLATES.get(decision, DEFAULT_TEMPLATE)
    return template.format(
        amount=transaction["amount"],
        beneficiary=transaction["merchant_or_beneficiary"],
        txn_id=transaction["id"],
    )
