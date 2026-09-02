import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Float, Boolean, DateTime, ForeignKey, Text, Integer
)
from sqlalchemy.orm import relationship
from app.database.db import Base


def gen_id(prefix):
    return f"{prefix}_{uuid.uuid4().hex[:10].upper()}"


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    transaction_id = Column(String, unique=True, index=True, nullable=False)
    rail = Column(String, nullable=False)           # UPI / IMPS / NEFT / RTGS / AEPS
    amount = Column(Float, nullable=False)
    sender = Column(String, nullable=False)
    receiver = Column(String, nullable=False)
    sender_account = Column(String, default="")
    receiver_account = Column(String, default="")
    debit_status = Column(String, default="UNKNOWN")     # DEBITED / NOT_DEBITED
    credit_status = Column(String, default="UNKNOWN")    # CONFIRMED / NOT_CONFIRMED / FAILED
    network_status = Column(String, default="UNKNOWN")   # SUCCESS / FAILED / TIMEOUT / PENDING / RETURNED
    status = Column(String, default="PENDING")            # overall txn status
    reference_id = Column(String, default="")
    is_duplicate = Column(Boolean, default=False)
    duplicate_of = Column(String, nullable=True)
    cash_dispensed = Column(Boolean, nullable=True)  # relevant for AEPS
    timestamp = Column(DateTime, default=datetime.utcnow)

    exceptions = relationship("ExceptionCase", back_populates="transaction")


class ExceptionCase(Base):
    __tablename__ = "exceptions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    case_id = Column(String, unique=True, index=True, default=lambda: gen_id("CASE"))
    transaction_id = Column(String, ForeignKey("transactions.transaction_id"), nullable=False)
    rail = Column(String, nullable=False)
    failure_type = Column(String, nullable=False)
    severity = Column(String, default="MEDIUM")   # LOW / MEDIUM / HIGH / CRITICAL
    confidence = Column(Float, default=0.0)
    customer_message = Column(Text, default="")
    case_status = Column(String, default="DETECTED")
    # DETECTED -> CLASSIFIED -> INVESTIGATING -> INVESTIGATED -> DECIDED
    # -> RECOVERY_INITIATED -> ESCALATED -> RESOLVED -> CLOSED
    recommended_action = Column(String, default="")
    decision_reason = Column(Text, default="")
    escalated = Column(Boolean, default=False)
    escalation_reason = Column(Text, default="")
    sla_deadline = Column(DateTime, nullable=True)
    detected_by = Column(String, default="AGENT")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    transaction = relationship("Transaction", back_populates="exceptions")
    evidence = relationship("Evidence", back_populates="case", cascade="all, delete-orphan")
    recovery_actions = relationship("RecoveryAction", back_populates="case", cascade="all, delete-orphan")
    sla = relationship("SLATracking", back_populates="case", uselist=False, cascade="all, delete-orphan")
    notifications = relationship("Notification", back_populates="case", cascade="all, delete-orphan")
    audit_logs = relationship("AuditLog", back_populates="case", cascade="all, delete-orphan")


class Evidence(Base):
    __tablename__ = "evidence"

    id = Column(Integer, primary_key=True, autoincrement=True)
    case_id = Column(String, ForeignKey("exceptions.case_id"), nullable=False)
    evidence_type = Column(String, nullable=False)  # NETWORK_RESPONSE / DUPLICATE_CHECK / TIMELINE / LOG
    content = Column(Text, default="")               # JSON-serialized payload
    created_at = Column(DateTime, default=datetime.utcnow)

    case = relationship("ExceptionCase", back_populates="evidence")


class RecoveryAction(Base):
    __tablename__ = "recovery_actions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    case_id = Column(String, ForeignKey("exceptions.case_id"), nullable=False)
    action_type = Column(String, nullable=False)   # REVERSAL / REFUND / RETRY / MONITOR / ESCALATION
    description = Column(Text, default="")
    amount = Column(Float, default=0.0)
    status = Column(String, default="PENDING_APPROVAL")  # PENDING_APPROVAL / APPROVED / REJECTED / SIMULATED_COMPLETE
    requires_human_approval = Column(Boolean, default=True)
    approved_by = Column(String, nullable=True)
    approved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    case = relationship("ExceptionCase", back_populates="recovery_actions")


class SLATracking(Base):
    __tablename__ = "sla_tracking"

    id = Column(Integer, primary_key=True, autoincrement=True)
    case_id = Column(String, ForeignKey("exceptions.case_id"), nullable=False, unique=True)
    rail = Column(String, nullable=False)
    sla_deadline = Column(DateTime, nullable=False)
    sla_status = Column(String, default="ON_TIME")  # ON_TIME / AT_RISK / BREACHED
    hours_remaining = Column(Float, default=0.0)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    case = relationship("ExceptionCase", back_populates="sla")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    case_id = Column(String, ForeignKey("exceptions.case_id"), nullable=False)
    channel = Column(String, default="APP")  # SMS / EMAIL / APP
    message = Column(Text, default="")
    status = Column(String, default="SENT")
    sent_at = Column(DateTime, default=datetime.utcnow)

    case = relationship("ExceptionCase", back_populates="notifications")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    case_id = Column(String, ForeignKey("exceptions.case_id"), nullable=True)
    actor = Column(String, default="AGENT")  # AGENT / SYSTEM / HUMAN
    action = Column(String, nullable=False)
    details = Column(Text, default="")
    timestamp = Column(DateTime, default=datetime.utcnow)

    case = relationship("ExceptionCase", back_populates="audit_logs")
