// Empty locally so Vite proxies requests. Railway injects this during the
// frontend build, allowing the separately deployed backend to receive API calls.
const BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch (_) {
      /* ignore parse error, keep statusText */
    }
    throw new Error(`${res.status} ${detail}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res;
}

function transformCase(c) {
  // Normalize backend case shape to the frontend's expected keys
  return {
    case_id: c.id || c.case_id,
    transaction_id: c.transactionId || c.transaction_id,
    rail: c.rail,
    amount: c.amount,
    failure_type: c.failureType || c.failure_type || "UNKNOWN",
    case_status: c.status || c.case_status || "Pending",
    severity: c.severity,
    escalated: c.escalated || false,
    sla: c.sla
      ? {
          sla_status: c.sla.level,
          label: c.sla.label,
          remainingMs: c.sla.remainingMs,
        }
      : null,
    decision_reason: c.investigationResult || c.recommendedAction || c.lastActionMessage || null,
    recommended_action: c.recommendedAction || c.recommended_action || null,
    confidence: (c.agentConfidence ?? c.confidence ?? null) / (c.agentConfidence ? 100 : 1),
    customer_message: c.customerMessage || c.customer_message || null,
    recovery_actions: c.recoveryActions || c.recovery_actions || [],
    audit_logs: c.auditLogs || c.audit_logs || [],
    notifications: c.notifications || c.notifications_sent || [],
    escalation_reason: c.escalationReason || c.escalation_reason || null,
    transaction: c.transaction || null,
    workflow_log: c.workflowLog || c.workflow_log || [],
    // keep original payload for any additional consumers
    _raw: c,
  };
}

export const api = {
  // dashboard / transactions
  dashboardStats: () => req("/api/stats/dashboard"),
  listTransactions: () => req("/api/transactions"),
  getTransaction: (id) => req(`/api/transactions/${id}`),

  // cases
  listCases: async (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    const res = await req(`/api/cases${qs ? `?${qs}` : ""}`);
    // backend returns an array of case objects — normalize shape for UI
    return Array.isArray(res) ? res.map(transformCase) : [];
  },
  getCase: async (caseId) => {
    const res = await req(`/api/cases/${caseId}`);
    return transformCase(res);
  },
  getEvidence: (caseId) => req(`/api/cases/${caseId}/evidence`),
  getEvidencePdfUrl: (caseId) => `${BASE}/api/cases/${caseId}/evidence/pdf`,
  listRecoveryActions: (caseId) => req(`/api/cases/${caseId}/recovery-actions`),
  approveRecoveryAction: (caseId, actionId, body) =>
    req(`/api/cases/${caseId}/recovery-actions/${actionId}/approve`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // agent
  classify: (transactionId, customerMessage) =>
    req("/api/agent/classify", {
      method: "POST",
      body: JSON.stringify({ transaction_id: transactionId, customer_message: customerMessage }),
    }),
  investigate: (transactionId) => req(`/api/agent/investigate/${transactionId}`, { method: "POST" }),
  agentStatus: () => req("/api/agent/status"),
  agentEvents: (afterId = 0) => req(`/api/agent/events?after=${afterId}&limit=50`),
  scanNow: () => req("/api/agent/scan-now", { method: "POST" }),

  // mock network (rarely called directly from UI, exposed for transparency/demo)
  mockStatus: (rail, transactionId) => req(`/mock/${rail.toLowerCase()}/status/${transactionId}`),
};
