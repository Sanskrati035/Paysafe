const API = '';
const state = {
  page: 'dashboard',
  cases: [],
  transactions: [],
  auditLogs: [],
  slaRules: null,
  summary: null,
  charts: {},
  agentCurrentCase: null,
  evidenceCaseId: null,
  pendingAction: null // { type: 'reject'|'escalate', caseId }
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function fmtINR(n) { return '₹' + Number(n).toLocaleString('en-IN'); }
function fmtTime(ts) {
  return new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function severityBadgeClass(sev) {
  return { Low: 'ok', Medium: 'info', High: 'warn', Critical: 'crit' }[sev] || 'neutral';
}
function statusBadgeClass(status) {
  return {
    Pending: 'info', Approved: 'ok', Resolved: 'ok', Rejected: 'crit', Escalated: 'warn'
  }[status] || 'neutral';
}
function slaClass(level) { return level; }

async function api(path, opts) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

function toast(title, body, kind = 'ok') {
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<div class="toast-title">${title}</div><div class="toast-body">${body}</div>`;
  stack.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(() => el.remove(), 300); }, 4200);
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
const PAGE_TITLES = {
  dashboard: 'Dashboard', transactions: 'Transactions', exceptions: 'Exceptions',
  agent: 'AI Agent Live View', recovery: 'Recovery Queue', sla: 'SLA Monitor',
  evidence: 'Evidence', audit: 'Audit Logs'
};

document.getElementById('nav').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item');
  if (!btn) return;
  navigate(btn.dataset.page);
});

function navigate(page) {
  state.page = page;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  document.getElementById('pageTitle').textContent = PAGE_TITLES[page];
  render();
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
async function loadAll() {
  const [summary, cases, transactions, auditLogs, slaRules] = await Promise.all([
    api('/api/dashboard/summary'), api('/api/cases'), api('/api/transactions'),
    api('/api/audit-logs'), api('/api/sla-rules')
  ]);
  state.summary = summary; state.cases = cases; state.transactions = transactions;
  state.auditLogs = auditLogs; state.slaRules = slaRules;
}

async function refreshCases() {
  state.cases = await api('/api/cases');
}

// ---------------------------------------------------------------------------
// Render dispatcher
// ---------------------------------------------------------------------------
function render() {
  const el = document.getElementById('pageContent');
  const renderers = {
    dashboard: renderDashboard, transactions: renderTransactions, exceptions: renderExceptions,
    agent: renderAgent, recovery: renderRecovery, sla: renderSla, evidence: renderEvidencePage,
    audit: renderAudit
  };
  el.innerHTML = renderers[state.page]();
  afterRender[state.page] && afterRender[state.page]();
}

// ===========================================================================
// DASHBOARD
// ===========================================================================
function renderDashboard() {
  const s = state.summary;
  return `
  <div class="grid kpi-grid">
    ${kpi('Total Transactions', s.totalTransactions.toLocaleString('en-IN'))}
    ${kpi('Active Exceptions', s.activeExceptions, s.activeExceptions > 0 ? 'warn' : 'ok')}
    ${kpi('Auto-Resolved', s.autoResolved, 'ok')}
    ${kpi('Pending Recovery', s.pendingRecovery, s.pendingRecovery > 0 ? 'warn' : 'ok')}
    ${kpi('SLA At Risk', s.slaAtRisk, s.slaAtRisk > 0 ? 'warn' : 'ok')}
    ${kpi('SLA Breached', s.slaBreached, s.slaBreached > 0 ? 'crit' : 'ok')}
  </div>
  <div class="grid charts-row">
    <div class="chart-card"><h4>Exceptions by Rail</h4><canvas id="chartRail"></canvas></div>
    <div class="chart-card"><h4>Exceptions by Type</h4><canvas id="chartType"></canvas></div>
    <div class="chart-card"><h4>Resolution Status</h4><canvas id="chartResolution"></canvas></div>
    <div class="chart-card"><h4>SLA Risk</h4><canvas id="chartRisk"></canvas></div>
  </div>
  <div class="section-title">Recent Cases</div>
  <div class="panel">${casesTable(state.cases.slice(0, 6))}</div>
  `;
}
function kpi(label, value, cls = '') {
  return `<div class="kpi-card"><div class="kpi-label">${label}</div><div class="kpi-value ${cls}">${value}</div></div>`;
}

function drawDashboardCharts() {
  const s = state.summary.charts;
  const palette = ['#4C8BF5', '#34D399', '#F5A623', '#F0576B', '#9B8CFF', '#5D6784'];
  const commonOpts = (labelsColor = '#8C96AE') => ({
    plugins: { legend: { position: 'bottom', labels: { color: labelsColor, font: { size: 10.5 }, boxWidth: 8, padding: 8 } } },
    scales: { x: { display: false }, y: { display: false } }
  });

  destroyCharts();
  state.charts.rail = new Chart(document.getElementById('chartRail'), {
    type: 'doughnut',
    data: { labels: Object.keys(s.byRail), datasets: [{ data: Object.values(s.byRail), backgroundColor: palette, borderWidth: 0 }] },
    options: { plugins: commonOpts().plugins, cutout: '62%' }
  });
  state.charts.type = new Chart(document.getElementById('chartType'), {
    type: 'bar',
    data: { labels: Object.keys(s.byType).map(t => t.length > 14 ? t.slice(0, 14) + '…' : t), datasets: [{ data: Object.values(s.byType), backgroundColor: '#4C8BF5', borderRadius: 4 }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#5D6784', font: { size: 9 } }, grid: { color: '#1A2438' } }, y: { ticks: { color: '#8C96AE', font: { size: 9.5 } }, grid: { display: false } } } }
  });
  state.charts.resolution = new Chart(document.getElementById('chartResolution'), {
    type: 'doughnut',
    data: { labels: Object.keys(s.byResolution), datasets: [{ data: Object.values(s.byResolution), backgroundColor: ['#4C8BF5', '#34D399', '#F0576B', '#F5A623', '#9B8CFF'], borderWidth: 0 }] },
    options: { plugins: commonOpts().plugins, cutout: '62%' }
  });
  state.charts.risk = new Chart(document.getElementById('chartRisk'), {
    type: 'doughnut',
    data: { labels: ['On Track', 'At Risk', 'Breached'], datasets: [{ data: [s.byRisk.ON_TRACK || 0, s.byRisk.AT_RISK || 0, s.byRisk.BREACHED || 0], backgroundColor: ['#34D399', '#F5A623', '#F0576B'], borderWidth: 0 }] },
    options: { plugins: commonOpts().plugins, cutout: '62%' }
  });
}
function destroyCharts() { Object.values(state.charts).forEach(c => c && c.destroy()); state.charts = {}; }

function casesTable(cases) {
  if (!cases.length) return emptyState('No cases to show');
  return `<table><thead><tr>
    <th>Case ID</th><th>Transaction</th><th>Customer</th><th>Rail</th><th>Amount</th>
    <th>Failure</th><th>Severity</th><th>Status</th><th>SLA</th>
  </tr></thead><tbody>
  ${cases.map(c => `<tr>
    <td class="mono">${c.id}</td>
    <td class="mono muted">${c.transactionId}</td>
    <td>${c.customer}</td>
    <td><span class="badge info">${c.rail}</span></td>
    <td class="mono">${fmtINR(c.amount)}</td>
    <td class="muted">${c.failureType}</td>
    <td><span class="badge ${severityBadgeClass(c.severity)}">${c.severity}</span></td>
    <td><span class="badge ${statusBadgeClass(c.status)}">${c.status}</span></td>
    <td><span class="sla-chip ${slaClass(c.sla.level)}">${c.sla.level === 'ON_TRACK' ? 'On track' : c.sla.level.replace('_', ' ')}</span></td>
  </tr>`).join('')}
  </tbody></table>`;
}
function emptyState(msg) { return `<div class="empty-state"><div class="icon">◌</div>${msg}</div>`; }

// ===========================================================================
// TRANSACTIONS
// ===========================================================================
function renderTransactions() {
  return `
  <div class="filter-bar">
    <input id="txSearch" placeholder="Search customer or transaction ID..." />
  </div>
  <div class="panel"><table><thead><tr>
    <th>Transaction ID</th><th>Customer</th><th>Rail</th><th>Amount</th><th>Status</th><th>Created</th>
  </tr></thead><tbody id="txBody"></tbody></table></div>`;
}
function drawTransactions() {
  const body = document.getElementById('txBody');
  const search = document.getElementById('txSearch');
  const paint = () => {
    const q = (search.value || '').toLowerCase();
    const rows = state.transactions.filter(t => !q || t.customer.toLowerCase().includes(q) || t.transactionId.toLowerCase().includes(q));
    body.innerHTML = rows.length ? rows.map(t => `<tr>
      <td class="mono">${t.transactionId}</td>
      <td>${t.customer}</td>
      <td><span class="badge info">${t.rail}</span></td>
      <td class="mono">${fmtINR(t.amount)}</td>
      <td><span class="badge ${t.status === 'Resolved' ? 'ok' : 'warn'}">${t.status}</span></td>
      <td class="muted mono">${fmtTime(t.createdAt)}</td>
    </tr>`).join('') : `<tr><td colspan="6">${emptyState('No matching transactions')}</td></tr>`;
  };
  search.addEventListener('input', paint);
  paint();
}

// ===========================================================================
// EXCEPTIONS
// ===========================================================================
function renderExceptions() {
  return `
  <div class="filter-bar">
    <select id="filRail"><option value="">All rails</option>${railOptions()}</select>
    <select id="filSeverity"><option value="">All severities</option>${['Low','Medium','High','Critical'].map(s=>`<option value="${s}">${s}</option>`).join('')}</select>
    <select id="filSla"><option value="">All SLA states</option><option value="ON_TRACK">On track</option><option value="AT_RISK">At risk</option><option value="BREACHED">Breached</option></select>
  </div>
  <div class="panel" id="excTableWrap"></div>`;
}
function railOptions() {
  const rails = [...new Set(state.cases.map(c => c.rail))];
  return rails.map(r => `<option value="${r}">${r}</option>`).join('');
}
function drawExceptions() {
  const wrap = document.getElementById('excTableWrap');
  const railSel = document.getElementById('filRail');
  const sevSel = document.getElementById('filSeverity');
  const slaSel = document.getElementById('filSla');
  const paint = () => {
    let rows = state.cases;
    if (railSel.value) rows = rows.filter(c => c.rail === railSel.value);
    if (sevSel.value) rows = rows.filter(c => c.severity === sevSel.value);
    if (slaSel.value) rows = rows.filter(c => c.sla.level === slaSel.value);
    wrap.innerHTML = casesTable(rows);
  };
  [railSel, sevSel, slaSel].forEach(s => s.addEventListener('change', paint));
  paint();
}

// ===========================================================================
// RECOVERY QUEUE (Human-in-the-loop)
// ===========================================================================
function renderRecovery() {
  const cases = state.cases.filter(c => ['Pending', 'Escalated'].includes(c.status));
  if (!cases.length) return emptyState('No cases awaiting recovery decisions right now.');
  return `<div class="case-grid">${cases.map(caseCard).join('')}</div>`;
}
function caseCard(c) {
  return `
  <div class="case-card ${c.status === 'Escalated' ? 'escalated' : ''}" data-case="${c.id}">
    <div class="case-head">
      <div>
        <div class="case-id">${c.id} <span class="badge ${statusBadgeClass(c.status)}" style="margin-left:8px;">${c.status}</span> <span class="sla-chip ${slaClass(c.sla.level)}" style="margin-left:6px;">${c.sla.label}</span></div>
        <div class="case-sub">${c.transactionId} · ${c.customer} · opened ${fmtTime(c.createdAt)}</div>
      </div>
      <div><span class="badge ${severityBadgeClass(c.severity)}">${c.severity} severity</span></div>
    </div>
    <div class="case-fields">
      <div><div class="field-label">Rail</div><div class="field-value">${c.rail}</div></div>
      <div><div class="field-label">Amount</div><div class="field-value mono">${fmtINR(c.amount)}</div></div>
      <div><div class="field-label">Failure</div><div class="field-value">${c.failureType}</div></div>
      <div><div class="field-label">Agent Confidence</div><div class="field-value mono">${c.agentConfidence}%</div></div>
      <div><div class="field-label">Evidence Status</div><div class="field-value"><span class="badge ${c.evidenceStatus === 'Complete' ? 'ok' : c.evidenceStatus === 'Partial' ? 'warn' : 'crit'}">${c.evidenceStatus}</span></div></div>
      <div><div class="field-label">SLA Rule</div><div class="field-value mono">${c.sla.ruleId}</div></div>
    </div>
    <div class="case-note"><strong>Investigation:</strong> ${c.investigationResult}<br/><strong>Recommended action:</strong> ${c.recommendedAction}</div>
    <div class="btn-row">
      <button class="btn primary" data-action="approve" data-case="${c.id}">✓ Approve Recovery</button>
      <button class="btn danger" data-action="reject" data-case="${c.id}">✕ Reject</button>
      <button class="btn warn" data-action="escalate" data-case="${c.id}">⤴ Escalate</button>
      <button class="btn ghost" data-action="evidence" data-case="${c.id}">▤ View Evidence</button>
    </div>
    ${c.lastActionMessage ? `<div class="last-action">✓ ${c.lastActionMessage}</div>` : ''}
  </div>`;
}
function drawRecovery() {
  document.querySelectorAll('#pageContent [data-action]').forEach(btn => {
    btn.addEventListener('click', () => handleCaseAction(btn.dataset.action, btn.dataset.case));
  });
}

async function handleCaseAction(action, caseId) {
  if (action === 'evidence') { openEvidence(caseId); return; }
  if (action === 'approve') { await doApprove(caseId); return; }
  if (action === 'reject') { openReasonModal('reject', caseId); return; }
  if (action === 'escalate') { openReasonModal('escalate', caseId); return; }
}

async function doApprove(caseId) {
  try {
    const result = await api(`/api/cases/${caseId}/approve`, { method: 'POST', body: JSON.stringify({ actor: 'ops.analyst@recon' }) });
    toast('Recovery approved', result.message, 'ok');
    await api('/api/notifications/generate', { method: 'POST', body: JSON.stringify({ type: 'reversal_initiated', amount: result.case.amount, transactionId: result.case.transactionId, caseId }) });
    await refreshCases();
    await refreshSummary();
    render();
  } catch (e) { toast('Action failed', e.message, 'danger'); }
}

function openReasonModal(type, caseId) {
  state.pendingAction = { type, caseId };
  const title = type === 'reject' ? 'Reject Recovery' : 'Escalate Case';
  const btnLabel = type === 'reject' ? 'Confirm Rejection' : 'Confirm Escalation';
  const btnClass = type === 'reject' ? 'danger' : 'warn';
  document.getElementById('modalBody').innerHTML = `
    <button class="modal-close" id="modalCloseBtn">✕</button>
    <h3>${title}</h3>
    <div class="modal-sub">${caseId}</div>
    <textarea class="reason-input" id="reasonInput" placeholder="Reason (optional)..."></textarea>
    <div class="btn-row"><button class="btn ${btnClass}" id="confirmActionBtn">${btnLabel}</button></div>
  `;
  document.getElementById('modalOverlay').classList.add('open');
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  document.getElementById('confirmActionBtn').addEventListener('click', confirmPendingAction);
}
function closeModal() { document.getElementById('modalOverlay').classList.remove('open'); state.pendingAction = null; }

async function confirmPendingAction() {
  const { type, caseId } = state.pendingAction;
  const reason = document.getElementById('reasonInput').value;
  try {
    const result = await api(`/api/cases/${caseId}/${type}`, { method: 'POST', body: JSON.stringify({ reason, actor: 'ops.analyst@recon' }) });
    toast(type === 'reject' ? 'Case rejected' : 'Case escalated', result.message, type === 'reject' ? 'danger' : 'warn');
    if (type === 'escalate') {
      const c = result.case;
      await api('/api/notifications/generate', { method: 'POST', body: JSON.stringify({ type: 'escalation_required', amount: c.amount, transactionId: c.transactionId, caseId }) });
    }
    closeModal();
    await refreshCases(); await refreshSummary(); render();
  } catch (e) { toast('Action failed', e.message, 'danger'); }
}

async function openEvidence(caseId) {
  const data = await api(`/api/cases/${caseId}/evidence`);
  document.getElementById('modalBody').innerHTML = `
    <button class="modal-close" id="modalCloseBtn">✕</button>
    <h3>Evidence Bundle</h3>
    <div class="modal-sub">${data.caseId} · overall status: <strong>${data.evidenceStatus}</strong></div>
    ${data.items.map(i => `<div class="evidence-row"><span>${i.label}</span><span class="badge ${i.status === 'Available' ? 'ok' : i.status === 'Partial' ? 'warn' : 'crit'}">${i.status}</span></div>`).join('')}
  `;
  document.getElementById('modalOverlay').classList.add('open');
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
}
document.getElementById('modalOverlay').addEventListener('click', (e) => { if (e.target.id === 'modalOverlay') closeModal(); });

// ===========================================================================
// SLA MONITOR
// ===========================================================================
function renderSla() {
  const sorted = [...state.cases].sort((a, b) => a.sla.remainingMs - b.sla.remainingMs);
  return `
  <div class="grid kpi-grid" style="grid-template-columns:repeat(3,1fr);">
    ${kpi('On Track', state.cases.filter(c=>c.sla.level==='ON_TRACK').length, 'ok')}
    ${kpi('At Risk', state.cases.filter(c=>c.sla.level==='AT_RISK').length, 'warn')}
    ${kpi('Breached', state.cases.filter(c=>c.sla.level==='BREACHED').length, 'crit')}
  </div>
  <div class="section-title">Live SLA Countdown — sorted by urgency</div>
  <div class="panel">${slaTable(sorted)}</div>
  <div class="section-title">Configurable SLA Rules <span class="muted" style="font-weight:400;font-size:11.5px;">(from sla_rules.json — not hard-coded in UI)</span></div>
  <div class="panel">${slaRulesTable()}</div>
  `;
}
function slaTable(cases) {
  if (!cases.length) return emptyState('No active cases');
  return `<table><thead><tr><th>Case ID</th><th>Customer</th><th>Rail</th><th>Failure</th><th>Status</th><th>SLA Countdown</th></tr></thead><tbody>
  ${cases.map(c => `<tr>
    <td class="mono">${c.id}</td><td>${c.customer}</td><td><span class="badge info">${c.rail}</span></td>
    <td class="muted">${c.failureType}</td>
    <td><span class="badge ${statusBadgeClass(c.status)}">${c.status}</span></td>
    <td><span class="sla-chip ${slaClass(c.sla.level)}">${c.sla.label}</span></td>
  </tr>`).join('')}</tbody></table>`;
}
function slaRulesTable() {
  const rules = state.slaRules.rules;
  return `<table><thead><tr><th>Rule ID</th><th>Rail</th><th>Failure Type</th><th>SLA Window</th><th>Escalate Before Breach</th><th>Reference</th></tr></thead><tbody>
  ${rules.map(r => `<tr>
    <td class="mono">${r.id}</td><td><span class="badge info">${r.rail}</span></td>
    <td class="muted">${r.failureType}</td>
    <td class="mono">${r.slaHours}h</td>
    <td class="mono">${r.escalateBeforeBreachMinutes}m</td>
    <td class="muted">${r.referenceFramework}</td>
  </tr>`).join('')}</tbody></table>`;
}
let slaTimer = null;
function startSlaTicker() {
  if (slaTimer) clearInterval(slaTimer);
  slaTimer = setInterval(async () => {
    if (state.page !== 'sla' && state.page !== 'dashboard' && state.page !== 'recovery' && state.page !== 'exceptions') return;
    await refreshCases();
    await refreshSummary();
    render();
  }, 20000);
}

// ===========================================================================
// EVIDENCE PAGE
// ===========================================================================
function renderEvidencePage() {
  return `
  <div class="filter-bar">
    <select id="evCaseSelect">${state.cases.map(c => `<option value="${c.id}">${c.id} — ${c.transactionId}</option>`).join('')}</select>
  </div>
  <div class="panel" id="evPanelWrap" style="padding:18px;"></div>`;
}
async function drawEvidencePage() {
  const sel = document.getElementById('evCaseSelect');
  const paint = async () => {
    const data = await api(`/api/cases/${sel.value}/evidence`);
    document.getElementById('evPanelWrap').innerHTML = `
      <div style="margin-bottom:12px;font-size:13px;">Overall status: <span class="badge ${data.evidenceStatus === 'Complete' ? 'ok' : data.evidenceStatus === 'Partial' ? 'warn' : 'crit'}">${data.evidenceStatus}</span></div>
      ${data.items.map(i => `<div class="evidence-row"><span>${i.label}</span><span class="badge ${i.status === 'Available' ? 'ok' : i.status === 'Partial' ? 'warn' : 'crit'}">${i.status}</span></div>`).join('')}
    `;
  };
  sel.addEventListener('change', paint);
  if (state.cases.length) paint();
  else document.getElementById('evPanelWrap').innerHTML = emptyState('No cases available');
}

// ===========================================================================
// AUDIT LOGS
// ===========================================================================
function renderAudit() {
  return `<div class="panel">${state.auditLogs.length ? state.auditLogs.map(a => `
    <div class="audit-item">
      <div class="audit-time">${fmtTime(a.timestamp)}</div>
      <div class="audit-action">${a.action.replace(/_/g,' ')}</div>
      <div class="audit-actor">${a.actor}</div>
      <div class="audit-details">${a.caseId ? `<span class="mono muted">${a.caseId}</span> — ` : ''}${a.details}</div>
    </div>`).join('') : emptyState('No audit entries yet')}</div>`;
}

// ===========================================================================
// AI AGENT LIVE VIEW
// ===========================================================================
const STAGE_ICONS = { Detecting:'🔍', Classifying:'🧠', Investigating:'🔎', 'Evaluating Recovery':'⚖', 'Checking SLA':'⏱', 'Generating Evidence':'📄', 'Human Approval':'👨‍💼', Resolved:'✅' };

function renderAgent() {
  return `
  <div class="filter-bar">
    <select id="agentCaseSelect">
      <option value="">— select a case —</option>
      ${state.cases.map(c => `<option value="${c.id}">${c.id} — ${c.transactionId} (${c.workflowStage})</option>`).join('')}
    </select>
    <button class="btn primary" id="simulateBtn">▶ Simulate New Complaint</button>
    <button class="btn" id="advanceBtn" disabled>⏭ Advance Stage</button>
  </div>
  <div class="pipeline-wrap">
    <div class="pipeline" id="pipelineCol"></div>
    <div class="agent-side">
      <div class="agent-case-summary" id="agentSummary">${emptyState('Select or simulate a case to watch the agent work through it.')}</div>
      <div class="section-title" style="margin-top:0;">Operational Log</div>
      <div class="agent-log" id="agentLog"></div>
    </div>
  </div>`;
}

async function drawAgent() {
  const sel = document.getElementById('agentCaseSelect');
  const advanceBtn = document.getElementById('advanceBtn');
  const simulateBtn = document.getElementById('simulateBtn');

  if (state.agentCurrentCase) sel.value = state.agentCurrentCase;

  async function loadCase(caseId) {
    state.agentCurrentCase = caseId;
    if (!caseId) {
      document.getElementById('pipelineCol').innerHTML = '';
      document.getElementById('agentSummary').innerHTML = emptyState('Select or simulate a case to watch the agent work through it.');
      document.getElementById('agentLog').innerHTML = '';
      advanceBtn.disabled = true;
      return;
    }
    const live = await api(`/api/agent/live/${caseId}`);
    const c = state.cases.find(x => x.id === caseId) || (await api(`/api/cases/${caseId}`));
    advanceBtn.disabled = live.stages.every(s => s.status !== 'current') ? true : false;

    document.getElementById('pipelineCol').innerHTML = live.stages.map((s, i) => `
      <div class="stage ${s.status}">
        <div class="stage-icon-col">
          <div class="stage-icon">${s.icon}</div>
          ${i < live.stages.length - 1 ? '<div class="stage-line"></div>' : ''}
        </div>
        <div class="stage-body">
          <div class="stage-label">${s.label}</div>
          ${s.note ? `<div class="stage-note">${s.note}</div>` : (s.status === 'current' ? '<div class="stage-note muted">Working…</div>' : '')}
          ${s.timestamp ? `<div class="stage-time">${fmtTime(s.timestamp)}</div>` : ''}
        </div>
      </div>`).join('');

    document.getElementById('agentSummary').innerHTML = `
      <div class="case-head">
        <div>
          <div class="case-id">${c.id}</div>
          <div class="case-sub">${c.transactionId} · ${c.customer} · ${c.rail}</div>
        </div>
        <span class="badge ${severityBadgeClass(c.severity)}">${c.severity}</span>
      </div>
      <div class="case-fields" style="margin-top:10px;">
        <div><div class="field-label">Amount</div><div class="field-value mono">${fmtINR(c.amount)}</div></div>
        <div><div class="field-label">Agent Confidence</div><div class="field-value mono">${c.agentConfidence}%</div></div>
        <div><div class="field-label">Current Stage</div><div class="field-value">${c.workflowStage}</div></div>
        <div><div class="field-label">Evidence</div><div class="field-value">${c.evidenceStatus}</div></div>
      </div>`;

    document.getElementById('agentLog').innerHTML = c.workflowLog.slice().reverse().map(l =>
      `<div class="agent-log-line"><span class="ts">${fmtTime(l.timestamp)}</span>${STAGE_ICONS[l.stage] || ''} ${l.note}</div>`
    ).join('');
  }

  sel.addEventListener('change', () => loadCase(sel.value));
  advanceBtn.addEventListener('click', async () => {
    if (!state.agentCurrentCase) return;
    await api(`/api/agent/advance/${state.agentCurrentCase}`, { method: 'POST' });
    await refreshCases();
    await loadCase(state.agentCurrentCase);
  });
  simulateBtn.addEventListener('click', async () => {
    const c = await api('/api/agent/simulate', { method: 'POST', body: JSON.stringify({}) });
    await refreshCases();
    render(); // rebuild select with new option
    document.getElementById('agentCaseSelect').value = c.id;
    state.agentCurrentCase = c.id;
    await drawAgent();
    toast('New complaint received', `${c.transactionId} · ${fmtINR(c.amount)} · ${c.rail}`, 'ok');
  });

  if (state.agentCurrentCase) await loadCase(state.agentCurrentCase);
}

// ---------------------------------------------------------------------------
// Post-render hooks
// ---------------------------------------------------------------------------
const afterRender = {
  dashboard: drawDashboardCharts,
  transactions: drawTransactions,
  exceptions: drawExceptions,
  recovery: drawRecovery,
  sla: () => {},
  evidence: drawEvidencePage,
  audit: () => {},
  agent: drawAgent
};

async function refreshSummary() { state.summary = await api('/api/dashboard/summary'); }

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------
function tickClock() {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString('en-IN', { hour12: false });
}
setInterval(tickClock, 1000);
tickClock();

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async function boot() {
  await loadAll();
  render();
  startSlaTicker();
})();
