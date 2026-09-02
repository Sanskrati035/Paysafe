/* ==========================================================================
   Payment Exception Recovery AI — frontend application (vanilla JS SPA)
   ========================================================================== */

const API_BASE = import.meta.env.VITE_API_URL || "https://paysafe-production.up.railway.app";

const RAIL_COLORS = {
  UPI: '#4f8cff',
  IMPS: '#35d399',
  NEFT: '#f0a93c',
  RTGS: '#ff5470',
  AEPS: '#c792ea',
};

const STAGE_LABELS = {
  TRANSACTION_LOADED: 'Transaction loaded',
  CLASSIFIED: 'AI classification',
  INVESTIGATED: 'Investigation',
  DECIDED: 'Decision',
  SLA_CALCULATED: 'SLA calculated',
  EVIDENCE_GENERATED: 'Evidence generated',
  RECOVERY_RECOMMENDED: 'Recovery recommendation',
  QUEUED: 'Added to operations queue',
  NOTIFIED: 'Customer notification',
  RECOVERY_APPROVED: 'Operations: approve recovery',
};

// ---------------------------------------------------------------- fetch helper

async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    /* no body */
  }
  if (!res.ok) {
    const detail = (body && body.detail) || `Request failed (${res.status})`;
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  return body;
}

// ---------------------------------------------------------------- router

const routes = {
  '/dashboard': renderDashboard,
  '/demo': renderDemo,
  '/transactions': renderTransactions,
  '/exceptions': renderExceptions,
  '/cases': renderCases,
  '/audit': renderAudit,
};

function navigate() {
  const hash = location.hash.replace('#', '') || '/demo';
  const base = hash.split('/').slice(0, 2).join('/') || '/demo';
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.route === base);
  });
  const fn = routes[base] || renderDemo;
  fn(hash);
}

window.addEventListener('hashchange', navigate);

// ---------------------------------------------------------------- shell chrome

function main() {
  return document.getElementById('main');
}

function setHeader(eyebrow, title, desc) {
  return `
    <div class="page-header">
      <div class="page-eyebrow">${eyebrow}</div>
      <h1 class="page-title">${title}</h1>
      <div class="page-desc">${desc}</div>
    </div>`;
}

function badgeForSla(status) {
  const map = { ON_TRACK: 'badge-green', AT_RISK: 'badge-amber', BREACHED: 'badge-red' };
  return `<span class="badge ${map[status] || 'badge-gray'}">${status || 'UNKNOWN'}</span>`;
}

function badgeForRecovery(status) {
  const map = {
    PENDING: 'badge-gray', RECOMMENDED: 'badge-blue', APPROVED: 'badge-green',
    REJECTED: 'badge-red', ESCALATED: 'badge-amber',
  };
  return `<span class="badge ${map[status] || 'badge-gray'}">${status || 'PENDING'}</span>`;
}

function fmtMoney(n) {
  if (n === undefined || n === null) return '—';
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (e) {
    return iso;
  }
}

async function refreshAgentPulse() {
  const el = document.getElementById('agent-pulse');
  if (!el) return;
  try {
    const status = await api('/api/agent/status');
    el.innerHTML = `
      <div class="agent-pulse-row"><span class="pulse-dot"></span> ${status.agent_name}</div>
      <div>1 instance running · ${status.cases_processed} cases processed</div>
      <div class="muted" style="margin-top:2px;">mode: ${status.llm_mode}</div>
    `;
  } catch (e) {
    el.innerHTML = `<div class="agent-pulse-row"><span class="pulse-dot" style="background:var(--accent-red)"></span> Agent unreachable</div>`;
  }
}

// ---------------------------------------------------------------- Dashboard

async function renderDashboard() {
  main().innerHTML = setHeader('Overview', 'Operations Dashboard', 'Live snapshot of transactions, cases, SLA health and the AI agent processing them.') +
    `<div id="dash-body" class="loading">Loading dashboard…</div>`;
  try {
    const d = await api('/api/dashboard');
    const railRows = Object.entries(d.transactions_by_rail || {})
      .map(([rail, count]) => `<tr><td><span class="badge" style="border-color:${RAIL_COLORS[rail]}55;color:${RAIL_COLORS[rail]}">${rail}</span></td><td>${count}</td></tr>`)
      .join('');
    document.getElementById('dash-body').innerHTML = `
      <div class="grid grid-4" style="margin-bottom:18px;">
        <div class="stat-card"><div class="stat-label">Total Transactions</div><div class="stat-value">${d.total_transactions}</div></div>
        <div class="stat-card"><div class="stat-label">Total Cases</div><div class="stat-value">${d.total_cases}</div></div>
        <div class="stat-card"><div class="stat-label">In Operations Queue</div><div class="stat-value">${d.cases_in_queue}</div></div>
        <div class="stat-card"><div class="stat-label">Recoveries Approved</div><div class="stat-value">${d.cases_recovered}</div></div>
      </div>
      <div class="two-col">
        <div class="panel">
          <div class="section-title">Transactions by rail</div>
          <table><thead><tr><th>Rail</th><th>Count</th></tr></thead><tbody>${railRows || '<tr><td colspan=2 class="muted">No data yet</td></tr>'}</tbody></table>
        </div>
        <div class="panel">
          <div class="section-title">SLA breakdown</div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <div class="kv-row"><span class="k">On track</span><span class="v">${badgeForSla('ON_TRACK')} ${d.sla_breakdown.ON_TRACK}</span></div>
            <div class="kv-row"><span class="k">At risk</span><span class="v">${badgeForSla('AT_RISK')} ${d.sla_breakdown.AT_RISK}</span></div>
            <div class="kv-row"><span class="k">Breached</span><span class="v">${badgeForSla('BREACHED')} ${d.sla_breakdown.BREACHED}</span></div>
          </div>
        </div>
      </div>
      <div class="panel" style="margin-top:14px;">
        <div class="section-title">AI Agent</div>
        <div class="kv-row"><span class="k">Name</span><span class="v">${d.agent.agent_name}</span></div>
        <div class="kv-row"><span class="k">Instances running</span><span class="v">${d.agent.instances_running}</span></div>
        <div class="kv-row"><span class="k">Status</span><span class="v"><span class="badge badge-green">${d.agent.status}</span></span></div>
        <div class="kv-row"><span class="k">Uptime</span><span class="v">${Math.round(d.agent.uptime_seconds)}s</span></div>
        <div class="kv-row"><span class="k">Recent errors (real-time)</span><span class="v">${d.agent.recent_errors.length}</span></div>
      </div>`;
  } catch (e) {
    document.getElementById('dash-body').innerHTML = `<div class="panel">Could not load dashboard: ${e.message}</div>`;
  }
}

// ---------------------------------------------------------------- Transactions / Exceptions / Cases / Audit

async function renderTransactions() {
  main().innerHTML = setHeader('Ledger', 'Transactions', 'All simulated payment transactions across UPI, IMPS, NEFT, RTGS and AEPS.') +
    `<div id="list-body" class="loading">Loading…</div>`;
  try {
    const d = await api('/api/transactions');
    const rows = d.transactions.map((t) => `
      <tr>
        <td>${t.id}</td>
        <td><span class="badge" style="border-color:${RAIL_COLORS[t.rail]}55;color:${RAIL_COLORS[t.rail]}">${t.rail}</span></td>
        <td>${fmtMoney(t.amount)}</td>
        <td>${t.customer_name}</td>
        <td>${t.merchant_or_beneficiary}</td>
        <td>${t.status}</td>
        <td class="muted">${fmtTime(t.created_at)}</td>
      </tr>`).join('');
    document.getElementById('list-body').innerHTML = `
      <div class="panel"><table><thead><tr><th>Txn ID</th><th>Rail</th><th>Amount</th><th>Customer</th><th>Beneficiary</th><th>Status</th><th>Created</th></tr></thead>
      <tbody>${rows || '<tr><td colspan=7 class="muted">No transactions yet — run a Demo Mode scenario.</td></tr>'}</tbody></table></div>`;
  } catch (e) {
    document.getElementById('list-body').innerHTML = `<div class="panel">Error: ${e.message}</div>`;
  }
}

async function renderExceptions() {
  main().innerHTML = setHeader('Triage', 'Exceptions', 'Every case the AI agent has classified as a payment exception, with current stage and SLA status.') +
    `<div id="list-body" class="loading">Loading…</div>`;
  try {
    const d = await api('/api/exceptions');
    const rows = d.exceptions.map((c) => `
      <tr>
        <td><a href="#/cases/${c.id}">${c.id}</a></td>
        <td>${c.transaction_id}</td>
        <td><span class="badge" style="border-color:${RAIL_COLORS[c.rail]}55;color:${RAIL_COLORS[c.rail]}">${c.rail}</span></td>
        <td>${c.stage}</td>
        <td>${c.sla ? badgeForSla(c.sla.status) : '—'}</td>
        <td>${badgeForRecovery(c.recovery_status)}</td>
      </tr>`).join('');
    document.getElementById('list-body').innerHTML = `
      <div class="panel"><table><thead><tr><th>Case</th><th>Txn</th><th>Rail</th><th>Stage</th><th>SLA</th><th>Recovery</th></tr></thead>
      <tbody>${rows || '<tr><td colspan=6 class="muted">No exceptions yet — run a Demo Mode scenario.</td></tr>'}</tbody></table></div>`;
  } catch (e) {
    document.getElementById('list-body').innerHTML = `<div class="panel">Error: ${e.message}</div>`;
  }
}

async function renderCases(hash) {
  const parts = hash.split('/').filter(Boolean);
  if (parts.length >= 2) {
    return renderCaseDetail(parts[1]);
  }
  main().innerHTML = setHeader('Queue', 'Operations Cases', 'Cases queued for operations review and recovery approval.') +
    `<div id="list-body" class="loading">Loading…</div>`;
  try {
    const d = await api('/api/cases');
    const rows = d.cases.map((c) => `
      <tr>
        <td><a href="#/cases/${c.id}">${c.id}</a></td>
        <td>${c.transaction_id}</td>
        <td>${c.decision ? c.decision.decision : '—'}</td>
        <td>${badgeForRecovery(c.recovery_status)}</td>
        <td>${c.queue_status}</td>
        <td class="muted">${fmtTime(c.updated_at)}</td>
      </tr>`).join('');
    document.getElementById('list-body').innerHTML = `
      <div class="panel"><table><thead><tr><th>Case</th><th>Txn</th><th>Decision</th><th>Recovery</th><th>Queue</th><th>Updated</th></tr></thead>
      <tbody>${rows || '<tr><td colspan=6 class="muted">No cases yet — run a Demo Mode scenario.</td></tr>'}</tbody></table></div>`;
  } catch (e) {
    document.getElementById('list-body').innerHTML = `<div class="panel">Error: ${e.message}</div>`;
  }
}

async function renderCaseDetail(caseId) {
  main().innerHTML = setHeader('Case detail', caseId, 'Full investigation trail, evidence and recovery decision.') +
    `<div id="case-body" class="loading">Loading…</div>`;
  try {
    const c = await api(`/api/cases/${caseId}`);
    document.getElementById('case-body').innerHTML = renderCasePanels(c) + `
      <div class="recover-actions">
        <button class="btn btn-green" data-action="approve">Approve Recovery</button>
        <button class="btn btn-red" data-action="reject">Reject</button>
        <button class="btn" data-action="escalate">Escalate</button>
      </div>`;
    document.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api(`/api/recovery/${caseId}/${btn.dataset.action}`, { method: 'POST', body: btn.dataset.action === 'approve' ? undefined : JSON.stringify({}) });
          renderCaseDetail(caseId);
        } catch (e) {
          alert(e.message);
        }
      });
    });
  } catch (e) {
    document.getElementById('case-body').innerHTML = `<div class="panel">Error: ${e.message}</div>`;
  }
}

function renderCasePanels(c) {
  return `
    <div class="two-col">
      <div class="panel">
        <div class="section-title">Classification</div>
        ${c.classification ? kv(c.classification) : '<div class="muted">Not yet classified</div>'}
      </div>
      <div class="panel">
        <div class="section-title">Investigation</div>
        ${c.investigation ? kv(c.investigation) : '<div class="muted">Not yet investigated</div>'}
      </div>
      <div class="panel">
        <div class="section-title">Decision</div>
        ${c.decision ? kv(c.decision) : '<div class="muted">Pending</div>'}
      </div>
      <div class="panel">
        <div class="section-title">SLA</div>
        ${c.sla ? kv(c.sla) : '<div class="muted">Pending</div>'}
      </div>
      <div class="panel">
        <div class="section-title">Evidence</div>
        ${c.evidence ? `<div class="mono" style="font-size:12px;">${c.evidence.evidence_id}</div><div class="muted" style="margin-top:6px;">Generated ${fmtTime(c.evidence.generated_at)}</div>` : '<div class="muted">Pending</div>'}
      </div>
      <div class="panel">
        <div class="section-title">Recovery</div>
        ${c.recovery ? kv(c.recovery) : '<div class="muted">Pending</div>'}
      </div>
    </div>
    <div class="panel" style="margin-top:14px;">
      <div class="section-title">Customer notification</div>
      <div class="notification-bubble"><div class="from">Bank → Customer</div>${c.notification_text || 'Not yet generated'}</div>
    </div>`;
}

function kv(obj) {
  return Object.entries(obj)
    .filter(([k]) => !['method'].includes(k))
    .map(([k, v]) => `<div class="kv-row"><span class="k">${k.replace(/_/g, ' ')}</span><span class="v">${typeof v === 'object' ? JSON.stringify(v) : v}</span></div>`)
    .join('');
}

async function renderAudit() {
  main().innerHTML = setHeader('Trail', 'Audit Logs', 'Every action the AI agent and operations team have taken, in order.') +
    `<div id="list-body" class="loading">Loading…</div>`;
  try {
    const d = await api('/api/audit-logs?limit=100');
    const rows = d.audit_logs.map((l) => `
      <tr>
        <td class="muted">${fmtTime(l.timestamp)}</td>
        <td>${l.actor}</td>
        <td>${l.action}</td>
        <td>${l.case_id || '—'}</td>
      </tr>`).join('');
    document.getElementById('list-body').innerHTML = `
      <div class="panel"><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Case</th></tr></thead>
      <tbody>${rows || '<tr><td colspan=4 class="muted">No activity yet.</td></tr>'}</tbody></table></div>`;
  } catch (e) {
    document.getElementById('list-body').innerHTML = `<div class="panel">Error: ${e.message}</div>`;
  }
}

// ---------------------------------------------------------------- Demo Mode

let demoRunning = false;

async function renderDemo() {
  main().innerHTML = setHeader('Live simulation', 'Demo Mode', 'Trigger any of the 8 supported exception scenarios and watch the AI agent classify, investigate, decide, and resolve it end to end — in under 30 seconds.') +
    `<div id="demo-grid" class="demo-grid loading">Loading scenarios…</div>
     <div id="demo-console"></div>`;

  try {
    const d = await api('/api/demo/scenarios');
    const grid = document.getElementById('demo-grid');
    grid.classList.remove('loading');
    grid.innerHTML = d.scenarios.map((s) => `
      <button class="scenario-card ${s.primary ? 'primary' : ''}" style="--rail-color:${RAIL_COLORS[s.rail]}" data-scenario="${s.key}">
        <span class="scenario-rail-tag">${s.rail}</span>
        <span class="scenario-name">${s.label}</span>
        ${s.primary ? '<span class="scenario-primary-tag">★ Primary demo scenario</span>' : ''}
      </button>`).join('');

    grid.querySelectorAll('.scenario-card').forEach((card) => {
      card.addEventListener('click', () => runDemoScenario(card.dataset.scenario, card));
    });

    document.getElementById('demo-console').innerHTML = `<div class="console-empty">Select a scenario above to start the AI agent workflow.</div>`;
  } catch (e) {
    document.getElementById('demo-grid').innerHTML = `<div class="panel">Could not load scenarios: ${e.message}</div>`;
  }
}

const PIPELINE_ORDER = [
  'TRANSACTION_LOADED', 'CLASSIFIED', 'INVESTIGATED', 'DECIDED', 'SLA_CALCULATED',
  'EVIDENCE_GENERATED', 'RECOVERY_RECOMMENDED', 'QUEUED', 'NOTIFIED', 'RECOVERY_APPROVED',
];

async function runDemoScenario(scenarioKey, cardEl) {
  if (demoRunning) return;
  demoRunning = true;

  document.querySelectorAll('.scenario-card').forEach((c) => c.classList.remove('running'));
  cardEl.classList.add('running');
  document.querySelectorAll('.scenario-card').forEach((c) => (c.disabled = true));

  const consoleEl = document.getElementById('demo-console');
  const startedAt = performance.now();

  consoleEl.innerHTML = `
    <div class="timer-banner"><span>Running <b id="demo-scenario-name">${scenarioKey}</b> through the AI agent pipeline…</span><span id="demo-timer">0.0s</span></div>
    <div class="console-wrap">
      <div class="panel">
        <div class="section-title">Agent pipeline</div>
        <div id="pipeline" class="pipeline"></div>
      </div>
      <div>
        <div class="panel" style="margin-bottom:14px;">
          <div class="section-title">Live agent log</div>
          <div id="log-feed" class="log-feed"></div>
        </div>
        <div id="result-cards" class="result-cards"></div>
      </div>
    </div>`;

  const pipelineEl = document.getElementById('pipeline');
  pipelineEl.innerHTML = PIPELINE_ORDER.map((stage) => `
    <div class="pipeline-node" data-stage="${stage}">
      <div class="node-dot">•</div>
      <div class="node-body">
        <div class="node-title">${STAGE_LABELS[stage]}</div>
        <div class="node-detail"></div>
      </div>
    </div>`).join('');

  const timerEl = document.getElementById('demo-timer');
  const timerInterval = setInterval(() => {
    timerEl.textContent = ((performance.now() - startedAt) / 1000).toFixed(1) + 's';
  }, 100);

  try {
    const result = await api('/api/demo/run', { method: 'POST', body: JSON.stringify({ scenario: scenarioKey }) });
    document.getElementById('demo-scenario-name').textContent = result.transaction.id;
    await animateTrace(result.trace);
    renderResultCards(result.case, result.transaction);
  } catch (e) {
    logLine(`ERROR: ${e.message}`, true);
  } finally {
    clearInterval(timerInterval);
    document.querySelectorAll('.scenario-card').forEach((c) => (c.disabled = false));
    cardEl.classList.remove('running');
    demoRunning = false;
    refreshAgentPulse();
  }
}

function logLine(text, hl = false) {
  const feed = document.getElementById('log-feed');
  if (!feed) return;
  const div = document.createElement('div');
  div.className = 'log-line' + (hl ? ' hl' : '');
  const ts = new Date().toLocaleTimeString('en-IN', { hour12: false });
  div.innerHTML = `<span class="ts">${ts}</span>${text}`;
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function animateTrace(trace) {
  for (const step of trace) {
    const node = document.querySelector(`.pipeline-node[data-stage="${step.stage}"]`);
    if (node) {
      node.classList.add('active');
    }
    logLine(`${STAGE_LABELS[step.stage] || step.title} — ${summarizeDetail(step.detail)}`);
    // pace the animation but keep the whole run comfortably under 30s
    const wait = Math.min(step.duration_ms || 400, 1200);
    await sleep(wait);
    if (node) {
      node.classList.remove('active');
      node.classList.add('done');
      node.querySelector('.node-dot').textContent = '✓';
      node.querySelector('.node-detail').textContent = summarizeDetail(step.detail);
    }
  }
  logLine('Pipeline complete.', true);
}

function summarizeDetail(detail) {
  if (!detail) return '';
  if (typeof detail === 'string') return detail;
  if (detail.summary) return detail.summary;
  if (detail.message) return detail.message;
  if (detail.label) return `${detail.label} (${Math.round((detail.confidence || 0) * 100)}%)`;
  if (detail.decision) return `${detail.decision} — ${detail.recommended_action || ''}`;
  if (detail.status && detail.minutes_remaining !== undefined) return `${detail.status} · ${detail.minutes_remaining}m remaining`;
  if (detail.evidence_id) return detail.evidence_id;
  if (detail.recommended_action) return detail.recommended_action;
  if (detail.priority) return `priority ${detail.priority}`;
  if (detail.result) return detail.result;
  return JSON.stringify(detail).slice(0, 90);
}

function renderResultCards(c, txn) {
  const wrap = document.getElementById('result-cards');
  const sla = c.sla || {};
  const decision = c.decision || {};
  const investigation = c.investigation || {};
  const recovery = c.recovery || {};

  wrap.innerHTML = `
    <div class="result-card">
      <h4>Customer complaint</h4>
      <div class="mono" style="font-size:12.5px;color:var(--text-primary);">"${txn.complaint_text || ''}"</div>
    </div>
    <div class="result-card">
      <h4>AI classification</h4>
      <div class="kv-row"><span class="k">Scenario</span><span class="v">${(c.classification || {}).label || '—'}</span></div>
      <div class="kv-row"><span class="k">Confidence</span><span class="v">${Math.round(((c.classification || {}).confidence || 0) * 100)}%</span></div>
    </div>
    <div class="result-card">
      <h4>Investigation</h4>
      <div class="kv-row"><span class="k">Debit</span><span class="v">${investigation.debit_status || '—'}</span></div>
      <div class="kv-row"><span class="k">Merchant / Beneficiary credit</span><span class="v">${investigation.credit_status || '—'}</span></div>
      <div class="kv-row"><span class="k">Network status</span><span class="v">${investigation.network_status || '—'}</span></div>
    </div>
    <div class="result-card">
      <h4>Decision</h4>
      <div class="mono" style="font-size:12.5px;">${decision.decision || '—'}</div>
      <div class="muted" style="margin-top:6px;font-size:12.5px;">${decision.reason || ''}</div>
    </div>
    <div class="result-card">
      <h4>SLA</h4>
      <div class="kv-row"><span class="k">Status</span><span class="v">${badgeForSla(sla.status)}</span></div>
      <div class="kv-row"><span class="k">Window</span><span class="v">${sla.sla_window_minutes || '—'} min</span></div>
    </div>
    <div class="result-card">
      <h4>Evidence</h4>
      <div class="mono" style="font-size:12px;">${(c.evidence || {}).evidence_id || 'pending'}</div>
    </div>
    <div class="result-card">
      <h4>Operations</h4>
      <div class="kv-row"><span class="k">Queue</span><span class="v">${c.queue_status}</span></div>
      <div class="kv-row"><span class="k">Recovery</span><span class="v">${badgeForRecovery(c.recovery_status)}</span></div>
      <div class="kv-row"><span class="k">Recommended action</span><span class="v">${recovery.recommended_action || '—'}</span></div>
      ${recovery.simulated_settlement ? `<div class="kv-row"><span class="k">Simulated recovery</span><span class="v">${fmtMoney(recovery.simulated_settlement.amount)} — ${recovery.simulated_settlement.result}</span></div>` : ''}
    </div>
    <div class="result-card">
      <h4>Customer notification</h4>
      <div class="notification-bubble"><div class="from">Bank → Customer</div>${c.notification_text || ''}</div>
    </div>
    <div style="display:flex;justify-content:flex-end;">
      <a class="btn" href="#/cases/${c.id}">Open full case →</a>
    </div>`;
}

// ---------------------------------------------------------------- boot

document.addEventListener('DOMContentLoaded', () => {
  navigate();
  refreshAgentPulse();
  setInterval(refreshAgentPulse, 15000);
});
