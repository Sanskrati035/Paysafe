from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel


class TransactionOut(BaseModel):
    transaction_id: str
    rail: str
    amount: float
    sender: str
    receiver: str
    sender_account: str = ""
    receiver_account: str = ""
    debit_status: str
    credit_status: str
    network_status: str
    status: str
    reference_id: str = ""
    is_duplicate: bool = False
    duplicate_of: Optional[str] = None
    cash_dispensed: Optional[bool] = None
    timestamp: datetime

    class Config:
        from_attributes = True


class ClassifyRequest(BaseModel):
    transaction_id: str
    customer_message: str


class ClassifyResponse(BaseModel):
    transaction_id: str
    case_id: Optional[str] = None
    rail: str
    failure_type: str
    confidence: float
    severity: str
    reason: str
    recommended_next_step: str
    source: str  # "RULE_BASED" or "LLM"


class InvestigateResponse(BaseModel):
    transaction_id: str
    case_id: Optional[str] = None
    investigation_status: str
    findings: List[str]
    evidence: List[dict]
    current_state: str
    sla_status: str
    hours_remaining: Optional[float] = None


class RecoveryActionOut(BaseModel):
    id: int
    case_id: str
    action_type: str
    description: str
    amount: float
    status: str
    requires_human_approval: bool
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class AuditLogOut(BaseModel):
    actor: str
    action: str
    details: str
    timestamp: datetime

    class Config:
        from_attributes = True


class NotificationOut(BaseModel):
    channel: str
    message: str
    status: str
    sent_at: datetime

    class Config:
        from_attributes = True


class SLAOut(BaseModel):
    rail: str
    sla_deadline: datetime
    sla_status: str
    hours_remaining: float

    class Config:
        from_attributes = True


class CaseOut(BaseModel):
    case_id: str
    transaction_id: str
    rail: str
    failure_type: str
    severity: str
    confidence: float
    customer_message: str
    case_status: str
    recommended_action: str
    decision_reason: str
    escalated: bool
    escalation_reason: str
    detected_by: str
    created_at: datetime
    updated_at: datetime
    sla: Optional[SLAOut] = None

    class Config:
        from_attributes = True


class CaseDetailOut(CaseOut):
    transaction: Optional[TransactionOut] = None
    recovery_actions: List[RecoveryActionOut] = []
    audit_logs: List[AuditLogOut] = []
    notifications: List[NotificationOut] = []


class ApproveActionRequest(BaseModel):
    approved_by: str = "ops_manager@paysafe"
    approve: bool = True
    note: Optional[str] = ""


class AgentEvent(BaseModel):
    id: int
    timestamp: datetime
    level: str          # INFO / WARNING / CRITICAL
    message: str
    case_id: Optional[str] = None
    transaction_id: Optional[str] = None


class AgentStatus(BaseModel):
    running: bool
    llm_mode: str
    last_scan_at: Optional[datetime]
    scans_completed: int
    exceptions_detected_total: int
    scan_interval_seconds: int
