"""
Optional LLM-assisted layer.

Design contract: EVERY function here must degrade to `app.rule_engine`
on any failure (missing key, network error, timeout, malformed JSON,
non-2xx response). The caller never needs to know whether the LLM
path succeeded or fell back — it always gets a well-formed result plus
a `method` field ("llm" or "rule_engine") for transparency/audit.
"""
import json
import re

import requests

from app import rule_engine
from app.config import settings

_ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
_TIMEOUT_SECONDS = 8


def _call_anthropic(system: str, user: str) -> str:
    if not settings.llm_enabled:
        raise RuntimeError("LLM not configured")

    resp = requests.post(
        _ANTHROPIC_URL,
        headers={
            "x-api-key": settings.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": settings.ANTHROPIC_MODEL,
            "max_tokens": 500,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        },
        timeout=_TIMEOUT_SECONDS,
    )
    resp.raise_for_status()
    data = resp.json()
    parts = [b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"]
    return "\n".join(parts).strip()


def _extract_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?", "", text).strip()
    text = re.sub(r"```$", "", text).strip()
    return json.loads(text)


def classify(complaint_text: str, rail_hint: str = None, scenario_hint: str = None) -> dict:
    """Classify a customer complaint. Falls back to rule_engine on any error."""
    if not settings.llm_enabled or scenario_hint:
        # No key configured, or the demo already told us the scenario ->
        # deterministic path is both correct and free.
        return rule_engine.classify(complaint_text, rail_hint, scenario_hint)

    catalogue = ", ".join(rule_engine.SCENARIOS.keys())
    system = (
        "You are a banking payment-exception classifier. Respond ONLY with "
        "compact JSON: {\"scenario_type\": one of [" + catalogue + "], "
        "\"confidence\": number 0-1}. No prose, no markdown fences."
    )
    try:
        raw = _call_anthropic(system, complaint_text)
        parsed = _extract_json(raw)
        scenario_type = parsed["scenario_type"]
        if scenario_type not in rule_engine.SCENARIOS:
            raise ValueError(f"unknown scenario_type from LLM: {scenario_type}")
        meta = rule_engine.SCENARIOS[scenario_type]
        return {
            "scenario_type": scenario_type,
            "label": meta["label"],
            "rail": meta["rail"],
            "confidence": float(parsed.get("confidence", meta["confidence"])),
            "method": "llm",
        }
    except (requests.RequestException, ValueError, KeyError, json.JSONDecodeError, TypeError):
        # LLM API unavailable / malformed response -> deterministic fallback.
        result = rule_engine.classify(complaint_text, rail_hint, scenario_hint)
        result["method"] = "rule_engine_fallback"
        return result


def explain_decision(scenario_type: str, investigation: dict) -> str:
    """Optional natural-language narration of the recovery decision.

    Falls back to the rule engine's canned reason text on any failure —
    this text is cosmetic only and never affects the actual decision,
    which always comes from the deterministic rule engine.
    """
    base_reason = rule_engine.decide(scenario_type)["reason"]
    if not settings.llm_enabled:
        return base_reason

    system = (
        "You are a banking operations assistant. In 1-2 short sentences, "
        "explain the investigation finding and recovery decision in plain "
        "English for an operations analyst. Be factual, no speculation."
    )
    user = json.dumps({"scenario_type": scenario_type, "investigation": investigation, "base_reason": base_reason})
    try:
        raw = _call_anthropic(system, user)
        return raw if raw else base_reason
    except requests.RequestException:
        return base_reason
