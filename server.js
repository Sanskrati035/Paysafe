const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { buildCases } = require('./data/seed');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Load configurable SLA rules from disk (NOT hard-coded in UI)
// ---------------------------------------------------------------------------
const SLA_RULES_PATH = path.join(__dirname, 'data', 'sla_rules.json');
function loadSlaRules() {
  return JSON.parse(fs.readFileSync(SLA_RULES_PATH, 'utf-8'));
}
let slaRules = loadSlaRules();

// ---------------------------------------------------------------------------
// In-memory stores (demo). Cases seeded on boot.
// ---------------------------------------------------------------------------
let cases = buildCases(slaRules, 14);
let auditLogs = [];
let notificationsSent = [];

function addAudit(caseId, action, actor, details) {
  const entry = {
    id: 'AUD-' + randomUUID().split('-')[0].toUpperCase(),
    timestamp: Date.now(),
    caseId,
    action,
    actor,
    details
  };
  auditLogs.unshift(entry);
  return entry;
}

// seed a few historical audit entries so the log isn't empty on first load
cases.slice(0, 4).forEach(c => {
  addAudit(c.id, 'CASE_CREATED', 'ai-agent', `Case opened for ${c.transactionId} (${c.failureType}).`);
});

// ---------------------------------------------------------------------------
// SLA ENGINE
// ---------------------------------------------------------------------------
function getRuleFor(c) {
  return slaRules.rules.find(r => r.id === c.slaRuleId) || slaRules.rules[0];
}

function computeSlaStatus(c) {
  const now = Date.now();
  const remainingMs = c.slaDeadline - now;
  const rule = getRuleFor(c);
  const riskBufferMs = (rule.escalateBeforeBreachMinutes ?? slaRules.atRiskBufferMinutes ?? 60) * 60 * 1000;

  let level = 'ON_TRACK';
  if (remainingMs <= 0) level = 'BREACHED';
  else if (remainingMs <= riskBufferMs) level = 'AT_RISK';

  const abs = Math.abs(remainingMs);
  const h = Math.floor(abs / (1000 * 60 * 60));
  const m = Math.floor((abs % (1000 * 60 * 60)) / (1000 * 60));

  let label;
  if (level === 'BREACHED') label = `🚨 SLA BREACHED (${h}h ${m}m over)`;
  else if (level === 'AT_RISK') label = `⚠ SLA AT RISK — ${h}h ${m}m remaining`;
  else label = `${h}h ${m}m remaining`;

  return { level, label, remainingMs, ruleId: rule.id, ruleDescription: rule.description };
}

function serializeCase(c) {
  return { ...c, sla: computeSlaStatus(c) };
}

// Background scheduler: checks SLA status periodically, auto-escalates cases
// that are at risk / breached and still pending.
const SCHEDULER_INTERVAL_MS = 15 * 1000; // demo cadence (15s). Would be 60s+ in prod.
function runSlaSweep() {
  cases.forEach(c => {
    if (c.status !== 'Pending') return;
    const sla = computeSlaStatus(c);
    if ((sla.level === 'AT_RISK' || sla.level === 'BREACHED') && !c.escalated) {
      c.escalated = true;
      c.status = 'Escalated';
      addAudit(c.id, 'AUTO_ESCALATED', 'sla-engine',
        `Auto-escalated by SLA engine (${sla.level}). ${sla.label}`);
    }
  });
}
setInterval(runSlaSweep, SCHEDULER_INTERVAL_MS);
runSlaSweep();

// ---------------------------------------------------------------------------
// NOTIFICATION ENGINE (customer-friendly language)
// ---------------------------------------------------------------------------
const NOTIFICATION_TEMPLATES = {
  investigation_started: ({ amount, rail }) =>
    `We've noticed an issue with your ₹${amount} ${rail ? rail + ' ' : ''}payment and have started looking into it. No action is needed from you right now — we'll keep you posted.`,
  payment_successful: ({ amount }) =>
    `Good news — your ₹${amount} payment has gone through successfully.`,
  payment_failed: ({ amount }) =>
    `Your ₹${amount} payment did not go through. If any amount was debited, it will be automatically reversed to your account. Please don't attempt the payment again until we confirm.`,
  reversal_initiated: ({ amount }) =>
    `We've started reversing your ₹${amount} payment back to your account. This is usually reflected within a few hours, depending on your bank.`,
  recovery_completed: ({ amount }) =>
    `Your ₹${amount} payment issue has been resolved and the funds have been returned to your account. Thank you for your patience.`,
  escalation_required: ({ amount }) =>
    `Your ₹${amount} payment case needs a closer look from our team. We've escalated it internally and will update you as soon as we have news.`
};

function generateNotification(type, payload = {}) {
  const amount = payload.amount != null ? Number(payload.amount).toLocaleString('en-IN') : '—';
  const fn = NOTIFICATION_TEMPLATES[type];
  if (!fn) return null;
  return fn({ ...payload, amount });
}

// ---------------------------------------------------------------------------
// ROUTES
// ---------------------------------------------------------------------------

// --- Dashboard summary ---
app.get('/api/dashboard/summary', (req, res) => {
  const total = cases.length;
  const active = cases.filter(c => ['Pending', 'Escalated'].includes(c.status)).length;
  const autoResolved = cases.filter(c => c.status === 'Resolved' && c.resolvedBy === 'auto').length;
  const pendingRecovery = cases.filter(c => c.status === 'Pending').length;
  const slaStatuses = cases.map(computeSlaStatus);
  const slaAtRisk = slaStatuses.filter(s => s.level === 'AT_RISK').length;
  const slaBreached = slaStatuses.filter(s => s.level === 'BREACHED').length;

  const byRail = {};
  const byType = {};
  const byResolution = { Pending: 0, Approved: 0, Rejected: 0, Escalated: 0, Resolved: 0 };
  const byRisk = { ON_TRACK: 0, AT_RISK: 0, BREACHED: 0 };

  cases.forEach((c, i) => {
    byRail[c.rail] = (byRail[c.rail] || 0) + 1;
    byType[c.failureType] = (byType[c.failureType] || 0) + 1;
    byResolution[c.status] = (byResolution[c.status] || 0) + 1;
    byRisk[slaStatuses[i].level] = (byRisk[slaStatuses[i].level] || 0) + 1;
  });

  res.json({
    totalTransactions: 4200 + total, // illustrative baseline + live exception cases
    activeExceptions: active,
    autoResolved,
    pendingRecovery,
    slaAtRisk,
    slaBreached,
    charts: { byRail, byType, byResolution, byRisk }
  });
});

// --- Transactions (derived view from cases, illustrative) ---
app.get('/api/transactions', (req, res) => {
  res.json(cases.map(c => ({
    transactionId: c.transactionId,
    customer: c.customer,
    rail: c.rail,
    amount: c.amount,
    status: c.status === 'Resolved' ? 'Resolved' : 'Exception Flagged',
    createdAt: c.createdAt
  })));
});

// --- Exceptions / Recovery cases list ---
app.get('/api/cases', (req, res) => {
  res.json(cases.map(serializeCase));
});

app.get('/api/cases/:id', (req, res) => {
  const c = cases.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found' });
  res.json(serializeCase(c));
});

// --- Approve Recovery (simulated action) ---
app.post('/api/cases/:id/approve', (req, res) => {
  const c = cases.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found' });
  if (['Approved', 'Resolved'].includes(c.status)) {
    return res.status(409).json({ error: 'Case already actioned', case: serializeCase(c) });
  }

  c.status = 'Approved';
  c.resolvedBy = 'human';
  const simulationMessage = `₹${c.amount.toLocaleString('en-IN')} reversal initiated successfully (SIMULATED)`;
  c.lastActionMessage = simulationMessage;
  c.workflowStage = 'Resolved';
  c.workflowLog.push({ stage: 'Resolved', note: 'Recovery approved by operations; action simulated.', timestamp: Date.now() });

  const audit = addAudit(c.id, 'RECOVERY_APPROVED', req.body.actor || 'ops-agent', simulationMessage);

  // mark resolved shortly after in this simulation
  c.status = 'Resolved';

  res.json({ message: simulationMessage, case: serializeCase(c), audit });
});

// --- Reject ---
app.post('/api/cases/:id/reject', (req, res) => {
  const c = cases.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found' });
  c.status = 'Rejected';
  const reason = req.body.reason || 'No reason provided';
  c.lastActionMessage = `Recovery rejected: ${reason}`;
  const audit = addAudit(c.id, 'RECOVERY_REJECTED', req.body.actor || 'ops-agent', reason);
  res.json({ message: c.lastActionMessage, case: serializeCase(c), audit });
});

// --- Escalate (manual) ---
app.post('/api/cases/:id/escalate', (req, res) => {
  const c = cases.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found' });
  c.status = 'Escalated';
  c.escalated = true;
  const reason = req.body.reason || 'Manual escalation by operations agent';
  const audit = addAudit(c.id, 'MANUAL_ESCALATION', req.body.actor || 'ops-agent', reason);
  res.json({ message: 'Case escalated', case: serializeCase(c), audit });
});

// --- Evidence ---
app.get('/api/cases/:id/evidence', (req, res) => {
  const c = cases.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found' });
  const items = [
    { label: 'Transaction Ledger Entry', status: c.evidenceStatus !== 'Missing' ? 'Available' : 'Missing' },
    { label: 'Rail Network Response Log', status: c.evidenceStatus === 'Complete' ? 'Available' : 'Partial' },
    { label: 'Beneficiary Bank Acknowledgement', status: c.evidenceStatus === 'Complete' ? 'Available' : 'Missing' },
    { label: 'Customer Complaint Record', status: 'Available' },
    { label: 'Duplicate Transaction Check', status: c.evidenceStatus !== 'Missing' ? 'Available' : 'Missing' }
  ];
  res.json({ caseId: c.id, evidenceStatus: c.evidenceStatus, items });
});

// --- SLA rules (read-only exposure of config) ---
app.get('/api/sla-rules', (req, res) => {
  res.json(slaRules);
});

// --- Audit logs ---
app.get('/api/audit-logs', (req, res) => {
  res.json(auditLogs);
});

// --- Notifications ---
app.post('/api/notifications/generate', (req, res) => {
  const { type, amount, transactionId, caseId } = req.body || {};
  const validTypes = Object.keys(NOTIFICATION_TEMPLATES);
  if (!type || !validTypes.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
  }
  const message = generateNotification(type, { amount, transactionId });
  const record = {
    id: 'NOTIF-' + randomUUID().split('-')[0].toUpperCase(),
    type,
    caseId: caseId || null,
    transactionId: transactionId || null,
    message,
    timestamp: Date.now()
  };
  notificationsSent.unshift(record);
  if (caseId) addAudit(caseId, 'NOTIFICATION_SENT', 'notification-engine', `[${type}] ${message}`);
  res.json(record);
});

app.get('/api/notifications', (req, res) => {
  res.json(notificationsSent);
});

// --- AI Agent live workflow view ---
const AGENT_STAGES = [
  { key: 'Detecting', icon: '🔍', label: 'Detecting' },
  { key: 'Classifying', icon: '🧠', label: 'Classifying' },
  { key: 'Investigating', icon: '🔎', label: 'Investigating' },
  { key: 'Evaluating Recovery', icon: '⚖', label: 'Evaluating Recovery' },
  { key: 'Checking SLA', icon: '⏱', label: 'Checking SLA' },
  { key: 'Generating Evidence', icon: '📄', label: 'Generating Evidence' },
  { key: 'Human Approval', icon: '👨‍💼', label: 'Human Approval' },
  { key: 'Resolved', icon: '✅', label: 'Resolved' }
];

app.get('/api/agent/stages', (req, res) => res.json(AGENT_STAGES));

app.get('/api/agent/live/:caseId', (req, res) => {
  const c = cases.find(x => x.id === req.params.caseId);
  if (!c) return res.status(404).json({ error: 'Case not found' });
  const currentIndex = AGENT_STAGES.findIndex(s => s.key === c.workflowStage);
  const stages = AGENT_STAGES.map((s, i) => {
    const logEntry = c.workflowLog.find(l => l.stage === s.key);
    return {
      ...s,
      status: i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'pending',
      note: logEntry ? logEntry.note : null,
      timestamp: logEntry ? logEntry.timestamp : null
    };
  });
  res.json({ caseId: c.id, transactionId: c.transactionId, stages });
});

// simulate a fresh case running through the agent pipeline live (for the demo page)
app.post('/api/agent/simulate', (req, res) => {
  const rule = slaRules.rules[Math.floor(Math.random() * slaRules.rules.length)];
  const now = Date.now();
  const amount = Math.floor((Math.random() * 48000 + 500) / 10) * 10;
  const confidence = Math.floor(Math.random() * 40) + 60;
  const severity = confidence > 90 ? 'Low' : confidence > 78 ? 'Medium' : confidence > 68 ? 'High' : 'Critical';
  const evidenceStatus = ['Complete', 'Complete', 'Partial', 'Missing'][Math.floor(Math.random() * 4)];

  const c = {
    id: 'CASE-' + Math.floor(2000 + Math.random() * 8000),
    transactionId: 'TXN' + randomUUID().split('-')[0].toUpperCase(),
    customer: req.body.customer || 'Demo Customer',
    rail: rule.rail,
    amount,
    failureType: rule.failureType,
    slaRuleId: rule.id,
    severity,
    agentConfidence: confidence,
    investigationResult: 'Investigation in progress...',
    recommendedAction: 'Pending evaluation',
    evidenceStatus,
    status: 'Pending',
    createdAt: now,
    slaDeadline: now + rule.slaHours * 60 * 60 * 1000,
    escalated: false,
    workflowStage: 'Detecting',
    workflowLog: [{ stage: 'Detecting', note: `${rule.rail} transaction identified.`, timestamp: now }]
  };
  cases.unshift(c);
  addAudit(c.id, 'CASE_CREATED', 'ai-agent', `New case opened for ${c.transactionId} (${c.failureType}).`);
  res.json(serializeCase(c));
});

// advance a case one stage at a time (used by the AI Agent Live View demo)
const STAGE_NOTES = {
  'Classifying': (c) => `Exception classified as "${c.failureType}".`,
  'Investigating': (c) => {
    const notes = [
      'Debit confirmed at source.',
      'Beneficiary credit not confirmed.',
      'Duplicate transaction check completed.',
      'Rail network response log retrieved.'
    ];
    return notes[Math.floor(Math.random() * notes.length)];
  },
  'Evaluating Recovery': (c) => 'Recovery workflow recommended based on similar historical cases.',
  'Checking SLA': (c) => `SLA rule ${c.slaRuleId} applied.`,
  'Generating Evidence': (c) => `Evidence bundle compiled — status: ${c.evidenceStatus}.`,
  'Human Approval': (c) => 'Awaiting operations approval.',
  'Resolved': (c) => 'Case resolved and closed.'
};

app.post('/api/agent/advance/:caseId', (req, res) => {
  const c = cases.find(x => x.id === req.params.caseId);
  if (!c) return res.status(404).json({ error: 'Case not found' });
  const idx = AGENT_STAGES.findIndex(s => s.key === c.workflowStage);
  if (idx >= AGENT_STAGES.length - 1) return res.json(serializeCase(c));
  const nextStage = AGENT_STAGES[idx + 1].key;
  const noteFn = STAGE_NOTES[nextStage];
  const note = noteFn ? noteFn(c) : `${nextStage} completed.`;
  c.workflowStage = nextStage;
  c.workflowLog.push({ stage: nextStage, note, timestamp: Date.now() });

  if (nextStage === 'Investigating') c.investigationResult = note;
  if (nextStage === 'Evaluating Recovery') c.recommendedAction = 'Initiate reversal to source account';

  res.json(serializeCase(c));
});

// ---------------------------------------------------------------------------
// Compatibility / convenience endpoints for demo frontend
// These provide a small compatibility layer for the React UI which expects
// agent/classify, agent/investigate, agent/status, agent/events and scan-now.
// ---------------------------------------------------------------------------

app.post('/api/agent/classify', (req, res) => {
  // Accepts { transaction_id, customer_message } and returns a lightweight
  // classification + case creation payload used by the UI.
  const { transaction_id, customer_message } = req.body || {};
  const rule = slaRules.rules[Math.floor(Math.random() * slaRules.rules.length)];
  const now = Date.now();
  const amount = Math.floor((Math.random() * 48000 + 500) / 10) * 10;
  const confidence = Math.floor(Math.random() * 40) + 60; // 60-99
  const severity = confidence > 90 ? 'Low' : confidence > 78 ? 'Medium' : confidence > 68 ? 'High' : 'Critical';

  const c = {
    id: 'CASE-' + Math.floor(2000 + Math.random() * 8000),
    transactionId: transaction_id || ('TXN' + randomUUID().split('-')[0].toUpperCase()),
    customer: 'Report - ' + (transaction_id || 'anonymous'),
    rail: rule.rail,
    amount,
    failureType: rule.failureType,
    slaRuleId: rule.id,
    severity,
    agentConfidence: confidence,
    investigationResult: 'Investigation in progress...',
    recommendedAction: 'Pending evaluation',
    evidenceStatus: 'Partial',
    status: 'Pending',
    createdAt: now,
    slaDeadline: now + rule.slaHours * 60 * 60 * 1000,
    escalated: false,
    workflowStage: 'Detecting',
    workflowLog: [{ stage: 'Detecting', note: `${rule.rail} transaction identified.`, timestamp: now }]
  };
  cases.unshift(c);
  addAudit(c.id, 'CASE_CREATED', 'ai-agent', `New case opened for ${c.transactionId} (user reported).`);

  res.json({
    rail: c.rail,
    failure_type: c.failureType,
    confidence: c.agentConfidence / 100,
    case_id: c.id,
  });
});

app.post('/api/agent/investigate/:transactionId', (req, res) => {
  const txn = req.params.transactionId;
  const c = cases.find(x => x.transactionId === txn || x.id === txn || x.transaction_id === txn);
  if (!c) {
    return res.status(404).json({ error: 'Case not found' });
  }
  // Return a simulated investigation result
  const now = Date.now();
  const sla = computeSlaStatus(c);
  const findings = [
    'Debit entry present in source ledger.',
    'Beneficiary credit not yet observed.',
    'Network response shows timeout.'
  ];
  const result = {
    current_state: c.workflowStage || 'Investigating',
    sla_status: sla.level,
    hours_remaining: Math.max(0, (c.slaDeadline - now) / (1000 * 60 * 60)),
    findings,
  };
  addAudit(c.id, 'INVESTIGATION_RUN', 'ai-agent', 'Investigation re-run via UI');
  res.json(result);
});

app.get('/api/agent/status', (req, res) => {
  res.json({ running: true });
});

app.get('/api/agent/events', (req, res) => {
  // Return a small slice of audit logs as agent events
  const after = Number(req.query.after || 0);
  const limit = Number(req.query.limit || 50);
  const slice = auditLogs.slice(0, limit).map(a => ({ id: a.id, type: a.action, caseId: a.caseId, ts: a.timestamp }));
  res.json(slice);
});

app.post('/api/agent/scan-now', (req, res) => {
  try {
    runSlaSweep();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/config', (req, res) => {
  res.json({ schedulerIntervalMs: SCHEDULER_INTERVAL_MS });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Operations Dashboard backend running on http://localhost:${PORT}`);
  console.log(`SLA sweep running every ${SCHEDULER_INTERVAL_MS / 1000}s`);
});
