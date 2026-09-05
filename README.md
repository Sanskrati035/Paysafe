# PAYSAFE — AI Payment Exception & Recovery Agent

A MVP demonstrating an AI agent that **detects, classifies,
investigates, decides, recovers, tracks SLAs on, and escalates** payment
exceptions across **UPI, IMPS, NEFT, RTGS and AEPS**.

# Live Demo

[**Try PaySafe Live →**](just-insight-production-0474.up.railway.app)

> ⚠️ **Simulation only.** This project never connects to real banking/NPCI
> systems and never moves real money. All "network" responses come from a
> local mock service backed by SQLite. Every money-impacting recovery action
> is created in a `PENDING_APPROVAL` state and only becomes
> `SIMULATED_COMPLETE` after an explicit human approval click — nothing is
> auto-executed.

## Architecture at a glance

```
DETECT → CLASSIFY → INVESTIGATE → DECIDE → RECOVERY WORKFLOW
   → SLA TRACKING → ESCALATE IF REQUIRED → CUSTOMER NOTIFICATION
```

There is **exactly one background agent process** per running backend
(`app/agents/monitor_agent.py`), started once in `app/main.py`'s FastAPI
`lifespan` hook. It:

- scans every transaction on a fixed interval (`AGENT_SCAN_INTERVAL_SECONDS`,
  default 30s),
- runs each through the rule-based structured classifier
  (`app/agents/classifier.py`),
- investigates (`app/agents/investigator.py`) against the mock payment-network
  API for that rail,
- decides the recovery workflow (`app/workflows/decision_engine.py`),
- opens an `ExceptionCase` with full evidence, SLA tracking, a proposed
  recovery action, an audit trail entry, and a customer notification,
- and pushes a live event onto an in-memory ring buffer. The backend scans
  every 30 seconds by default, while the frontend refreshes the live feed
  every 4 seconds so scan progress remains visible.

A customer can also self-report a free-text complaint
(`POST /api/agent/classify`), which runs the exact same pipeline immediately
instead of waiting for the next scan.

## Project structure

```
/backend
  /app
    main.py                  FastAPI app, lifespan, single background agent
    config.py                Settings (.env driven)
    /database/db.py          SQLAlchemy engine/session
    /models/models.py        transactions, exceptions, evidence,
                              recovery_actions, sla_tracking, notifications,
                              audit_logs
    /schemas/schemas.py      Pydantic request/response models
    /services/
      mock_network.py        simulated UPI/IMPS/NEFT/RTGS/AEPS responses
      evidence_service.py    builds the evidence packet
      pdf_service.py         renders the evidence packet as a PDF
    /agents/
      classifier.py          rule-based + optional LLM classification
      investigator.py        investigation engine
      monitor_agent.py       the single background agent + event bus
    /workflows/decision_engine.py   deterministic recovery-workflow rules
    /utils/
      sla.py                 SLA status helper
      seed.py                 seeds 12 demo transactions across all 8 types
    /api/routes.py            all REST endpoints
  requirements.txt
  .env.example

/frontend
  /src
    /pages/Dashboard.jsx      stats, live agent feed, case list, complaint form
    /pages/CaseDetail.jsx     investigation, evidence, recovery approval
    /components/              StatCard, ExceptionCard, StatusBadge, AgentFeed
    /services/api.js          typed fetch wrapper for every backend route
  package.json
  vite.config.js / tailwind.config.js
```

## Running it locally

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # optional but recommended
pip install -r requirements.txt
cp .env.example .env   # optionally set ANTHROPIC_API_KEY to enable LLM-assisted
                        # classification of ambiguous complaints; leave blank
                        # to run fully offline on the deterministic fallback
uvicorn app.main:app --reload --port 8000
```

On first boot the app creates `paysafe.db` (SQLite), seeds 12 demo
transactions covering all 8 exception types (plus a few clean/successful
ones), and starts the single background monitor agent. Watch the terminal —
you'll see it detect exceptions within the first scan cycle.

API docs: http://localhost:8000/docs

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api` and `/mock`
to `http://localhost:8000`, so both must be running.

## Deployment

The backend is deployed on Railway:

- Service: https://paysafe-production.up.railway.app
- Health check: https://paysafe-production.up.railway.app/health
- API documentation: https://paysafe-production.up.railway.app/docs

The Railway service is configured from `backend/railway.toml` and starts with
`uvicorn app.main:app --host 0.0.0.0 --port $PORT`. For a separately deployed
Vite frontend, set `VITE_API_URL=https://paysafe-production.up.railway.app`
at build time. Local development can leave it unset and use the Vite proxy.

## Key endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/mock/{upi,imps,neft,rtgs,aeps}/status/{transaction_id}` | Simulated bank/NPCI network response |
| POST | `/api/agent/classify` | Classify a free-text customer complaint; opens a case |
| POST | `/api/agent/investigate/{transaction_id}` | Re-run the investigation engine |
| GET | `/api/cases` | List cases (filter by `status`, `rail`, `escalated`) |
| GET | `/api/cases/{case_id}` | Full case detail incl. transaction, recovery actions, audit log |
| GET | `/api/cases/{case_id}/evidence` | Evidence packet (JSON) |
| GET | `/api/cases/{case_id}/evidence/pdf` | Evidence packet (PDF download) |
| POST | `/api/cases/{case_id}/recovery-actions/{id}/approve` | Human approval (or rejection) of a simulated recovery action |
| GET | `/api/agent/status` / `/api/agent/events` | Live status + event feed of the single background agent |
| POST | `/api/agent/scan-now` | Manually trigger an immediate scan |
| GET | `/api/stats/dashboard` | Aggregate counts for the dashboard cards |

## AI + deterministic decisioning

PAYSAFE uses a hybrid approach rather than sending every transaction to an
LLM. This keeps money-critical decisions reliable, explainable, and
reproducible, while still using AI where natural-language reasoning adds
value.

- **Structured payment states** - debit and credit status, network status,
  duplicate indicators, and cash-dispensed status - are classified
  deterministically by `structured_from_transaction()`.
- **Customer complaints** use a rule-based classifier by default. When an
  `ANTHROPIC_API_KEY` is configured, Claude can produce structured reasoning
  for the natural-language complaint; any unavailable or invalid LLM response
  automatically falls back to the rule-based classifier, so the app works
  fully offline with zero configuration.
- **Recovery and SLA handling** remain deterministic: the resulting exception
  type and investigation evidence pass through explicit recovery-workflow and
  SLA rules before any simulated action is proposed.

In short: **LLMs help interpret language; deterministic rules govern
money-impacting decisions.**

## Known limitations (MVP scope)

- SQLite only; not built for concurrent writers at scale.
- The live agent feed uses polling, not WebSockets (simpler for demo, trivial to swap later).
- LLM classification path is untested end-to-end in this build environment
  (no network egress); the rule-based fallback path is what's exercised by
  the seed data and is what runs by default.
