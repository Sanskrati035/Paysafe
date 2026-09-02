"""
Synthetic demo data only. No real customers, accounts, or PII.
"""
import random

from app import workflow

DEMO_SCENARIOS = {
    "upi_debit_no_confirmation": {
        "button_label": "UPI Debit Without Confirmation",
        "rail": "UPI",
        "amount": 5000,
        "complaint_text": (
            "I paid ₹5,000 through UPI but my account was debited and the "
            "merchant hasn't received the money."
        ),
        "merchant": "QuickMart Retail",
        "primary": True,
    },
    "upi_duplicate_payment": {
        "button_label": "UPI Duplicate Payment",
        "rail": "UPI",
        "amount": 1200,
        "complaint_text": "I was charged twice for the same ₹1,200 UPI order — two debits for one purchase.",
        "merchant": "FreshGrocer App",
    },
    "upi_timeout": {
        "button_label": "UPI Timeout",
        "rail": "UPI",
        "amount": 750,
        "complaint_text": "My UPI payment of ₹750 timed out — I don't know if it went through.",
        "merchant": "CityCabs",
    },
    "imps_debit_no_credit": {
        "button_label": "IMPS Debit / No Credit",
        "rail": "IMPS",
        "amount": 15000,
        "complaint_text": "I sent ₹15,000 via IMPS to my brother, it debited from my account but he never received it.",
        "merchant": "Rohan Sharma (P2P)",
    },
    "neft_failed": {
        "button_label": "NEFT Failed",
        "rail": "NEFT",
        "amount": 42000,
        "complaint_text": "My NEFT transfer of ₹42,000 to my landlord failed but I haven't got my money back.",
        "merchant": "Priya Housing Services",
    },
    "rtgs_delayed": {
        "button_label": "RTGS Delayed",
        "rail": "RTGS",
        "amount": 350000,
        "complaint_text": "My RTGS payment of ₹3,50,000 for a property deal is stuck and has not settled.",
        "merchant": "Sunrise Realty Pvt Ltd",
    },
    "aeps_debit_no_cash": {
        "button_label": "AEPS Debit / No Cash",
        "rail": "AEPS",
        "amount": 2000,
        "complaint_text": "I tried to withdraw ₹2,000 using AEPS at a kiosk, my account was debited but no cash came out.",
        "merchant": "Village BC Kiosk #114",
    },
    "aeps_beneficiary_not_credited": {
        "button_label": "AEPS Beneficiary Not Credited",
        "rail": "AEPS",
        "amount": 3000,
        "complaint_text": "I sent ₹3,000 via AEPS to my mother's account but she says it never arrived.",
        "merchant": "Sunita Devi (AEPS transfer)",
    },
}

_FAKE_CUSTOMERS = [
    ("Anita R.", "+91-XXXXX-41209", "XXXXXX7734"),
    ("Vikram S.", "+91-XXXXX-88213", "XXXXXX2210"),
    ("Fatima K.", "+91-XXXXX-55021", "XXXXXX9981"),
    ("Devendra P.", "+91-XXXXX-30044", "XXXXXX5567"),
]


def make_demo_transaction(scenario_key: str) -> dict:
    meta = DEMO_SCENARIOS[scenario_key]
    customer = random.choice(_FAKE_CUSTOMERS)
    return workflow.create_transaction(
        rail=meta["rail"],
        scenario_type=scenario_key,
        amount=meta["amount"],
        customer_name=customer[0],
        customer_phone_masked=customer[1],
        customer_account_masked=customer[2],
        merchant_or_beneficiary=meta["merchant"],
        beneficiary_account_masked="XXXXXX" + str(random.randint(1000, 9999)),
        complaint_text=meta["complaint_text"],
        status="DEBITED",
    )


def seed_baseline(n_per_scenario: int = 1):
    """Populate a handful of resolved/pending baseline cases so dashboard
    and list endpoints have realistic-looking content on first boot."""
    for key in DEMO_SCENARIOS:
        for _ in range(n_per_scenario):
            txn = make_demo_transaction(key)
            workflow.run_full_pipeline(txn["id"])
