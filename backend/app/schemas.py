from typing import Optional

from pydantic import BaseModel, Field


class ClassifyRequest(BaseModel):
    complaint_text: str = Field(..., min_length=3, max_length=2000)
    rail_hint: Optional[str] = None


class RejectRequest(BaseModel):
    reason: Optional[str] = None


class EscalateRequest(BaseModel):
    reason: Optional[str] = None


class ProcessRequest(BaseModel):
    simulate_outage: Optional[bool] = False


class DemoRunRequest(BaseModel):
    scenario: str
