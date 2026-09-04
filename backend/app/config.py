import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    APP_NAME = "PaySafe - AI Payment Exception & Recovery Agent"
    DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./paysafe.db")
    LLM_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
    LLM_MODEL = os.getenv("LLM_MODEL", "claude-sonnet-4-6")
    USE_LLM = bool(LLM_API_KEY)
    AGENT_SCAN_INTERVAL_SECONDS = int(os.getenv("AGENT_SCAN_INTERVAL_SECONDS", "60"))
    CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")

    # SLA windows (in hours) per payment rail — used to compute deadlines & breach risk
    SLA_HOURS = {
        "UPI": 24,
        "IMPS": 24,
        "NEFT": 48,
        "RTGS": 2,     # high value, tight SLA
        "AEPS": 24,
    }

settings = Settings()
