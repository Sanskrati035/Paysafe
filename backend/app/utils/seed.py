"""Seed the SQLite DB with realistic demo transactions covering all 8
exception types plus a couple of clean/successful transactions, so the
dashboard has real variety on first boot."""
from datetime import datetime, timedelta
from sqlalchemy.orm import Session

from app.models.models import Transaction


def _hrs_ago(h):
    return datetime.utcnow() - timedelta(hours=h)


SEED_TRANSACTIONS = [
    # 1. UPI — debit without confirmation
    dict(transaction_id="TXN_UPI_001", rail="UPI", amount=5000, sender="Rohit Sharma",
         receiver="Aman Traders", sender_account="XXXX-4521", receiver_account="XXXX-9981",
         debit_status="DEBITED", credit_status="NOT_CONFIRMED", network_status="TIMEOUT",
         status="EXCEPTION", reference_id="REF100231", timestamp=_hrs_ago(20)),

    # 2. UPI — duplicate payment (paired with a successful original)
    dict(transaction_id="TXN_UPI_002A", rail="UPI", amount=500, sender="Priya Nair",
         receiver="Swiggy Foods", sender_account="XXXX-1120", receiver_account="XXXX-7743",
         debit_status="DEBITED", credit_status="CONFIRMED", network_status="SUCCESS",
         status="SUCCESS", reference_id="REF100450", timestamp=_hrs_ago(5)),
    dict(transaction_id="TXN_UPI_002", rail="UPI", amount=500, sender="Priya Nair",
         receiver="Swiggy Foods", sender_account="XXXX-1120", receiver_account="XXXX-7743",
         debit_status="DEBITED", credit_status="CONFIRMED", network_status="SUCCESS",
         status="EXCEPTION", reference_id="REF100451", is_duplicate=True,
         duplicate_of="TXN_UPI_002A", timestamp=_hrs_ago(5)),

    # 3. UPI — timeout / pending
    dict(transaction_id="TXN_UPI_003", rail="UPI", amount=1200, sender="Karan Mehta",
         receiver="Big Bazaar", sender_account="XXXX-3345", receiver_account="XXXX-2290",
         debit_status="DEBITED", credit_status="NOT_CONFIRMED", network_status="PENDING",
         status="EXCEPTION", reference_id="REF100512", timestamp=_hrs_ago(1)),

    # 4. IMPS — debited but receiver not credited
    dict(transaction_id="TXN_IMPS_004", rail="IMPS", amount=15000, sender="Sneha Gupta",
         receiver="Vikram Rao", sender_account="XXXX-7788", receiver_account="XXXX-4432",
         debit_status="DEBITED", credit_status="NOT_CONFIRMED", network_status="PENDING",
         status="EXCEPTION", reference_id="REF200871", timestamp=_hrs_ago(23)),

    # 5. NEFT — failed / delayed / returned
    dict(transaction_id="TXN_NEFT_005", rail="NEFT", amount=42000, sender="Anil Kapoor Traders",
         receiver="Global Suppliers Pvt Ltd", sender_account="XXXX-5567", receiver_account="XXXX-8801",
         debit_status="DEBITED", credit_status="FAILED", network_status="RETURNED",
         status="EXCEPTION", reference_id="REF300921", timestamp=_hrs_ago(30)),

    # 6. RTGS — failed / delayed high-value transfer
    dict(transaction_id="TXN_RTGS_006", rail="RTGS", amount=850000, sender="Sunrise Exports Ltd",
         receiver="Metro Steel Corp", sender_account="XXXX-9012", receiver_account="XXXX-6654",
         debit_status="DEBITED", credit_status="NOT_CONFIRMED", network_status="DELAYED",
         status="EXCEPTION", reference_id="REF400118", timestamp=_hrs_ago(1.5)),

    # 7. AEPS — account debited but cash not received
    dict(transaction_id="TXN_AEPS_007", rail="AEPS", amount=2000, sender="Geeta Devi",
         receiver="BC Agent Kiosk #114", sender_account="XXXX-3321", receiver_account="BC114",
         debit_status="DEBITED", credit_status="CONFIRMED", network_status="SUCCESS",
         status="EXCEPTION", reference_id="REF500233", cash_dispensed=False, timestamp=_hrs_ago(10)),

    # 8. AEPS — account debited but beneficiary not credited
    dict(transaction_id="TXN_AEPS_008", rail="AEPS", amount=3500, sender="Ramesh Yadav",
         receiver="Fund Transfer - Beneficiary A/C", sender_account="XXXX-6612", receiver_account="XXXX-2201",
         debit_status="DEBITED", credit_status="NOT_CONFIRMED", network_status="PENDING",
         status="EXCEPTION", reference_id="REF500901", cash_dispensed=None, timestamp=_hrs_ago(18)),

    # 9. Clean successful UPI transaction (control / no exception)
    dict(transaction_id="TXN_UPI_009", rail="UPI", amount=250, sender="Divya Iyer",
         receiver="Zomato", sender_account="XXXX-4471", receiver_account="XXXX-9902",
         debit_status="DEBITED", credit_status="CONFIRMED", network_status="SUCCESS",
         status="SUCCESS", reference_id="REF100889", timestamp=_hrs_ago(2)),

    # 10. Clean successful NEFT transaction (control / no exception)
    dict(transaction_id="TXN_NEFT_010", rail="NEFT", amount=18000, sender="Meera Patel",
         receiver="HDFC Home Loans", sender_account="XXXX-7712", receiver_account="XXXX-1145",
         debit_status="DEBITED", credit_status="CONFIRMED", network_status="SUCCESS",
         status="SUCCESS", reference_id="REF300456", timestamp=_hrs_ago(40)),

    # 11. RTGS approaching SLA breach (near 2h window) — stress-tests SLA engine
    dict(transaction_id="TXN_RTGS_011", rail="RTGS", amount=1250000, sender="Orion Logistics",
         receiver="Coastal Cement Ltd", sender_account="XXXX-8834", receiver_account="XXXX-3390",
         debit_status="DEBITED", credit_status="NOT_CONFIRMED", network_status="PENDING",
         status="EXCEPTION", reference_id="REF400556", timestamp=_hrs_ago(1.9)),

    # 12. IMPS successful (control)
    dict(transaction_id="TXN_IMPS_012", rail="IMPS", amount=8000, sender="Farhan Ali",
         receiver="Nisha Kapoor", sender_account="XXXX-2298", receiver_account="XXXX-5567",
         debit_status="DEBITED", credit_status="CONFIRMED", network_status="SUCCESS",
         status="SUCCESS", reference_id="REF200902", timestamp=_hrs_ago(6)),
]


def seed_if_empty(db: Session):
    if db.query(Transaction).count() > 0:
        return 0
    for row in SEED_TRANSACTIONS:
        db.add(Transaction(**row))
    db.commit()
    return len(SEED_TRANSACTIONS)
