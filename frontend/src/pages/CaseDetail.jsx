import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../services/api.js";
import StatusBadge from "../components/StatusBadge.jsx";

export default function CaseDetail() {
  const { caseId } = useParams();
  const [caseData, setCaseData] = useState(null);
  const [evidence, setEvidence] = useState(null);
  const [error, setError] = useState(null);
  const [investigating, setInvestigating] = useState(false);
  const [investigateResult, setInvestigateResult] = useState(null);
  const [approving, setApproving] = useState(null);
  const [fallbackApproved, setFallbackApproved] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [confirmingAction, setConfirmingAction] = useState(false);
  const [approvalSuccess, setApprovalSuccess] = useState(null);

  const load = useCallback(async () => {
    try {
      const c = await api.getCase(caseId);
      setCaseData(c);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [caseId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleInvestigate() {
    if (!caseData) return;
    setInvestigating(true);
    try {
      const res = await api.investigate(caseData.transaction_id);
      setInvestigateResult(res);
      await load();
      return true;
    } catch (e) {
      setInvestigateResult({ error: e.message });
      return false;
    } finally {
      setInvestigating(false);
    }
  }

  async function handleLoadEvidence() {
    try {
      const ev = await api.getEvidence(caseId);
      setEvidence(ev);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleApprove(actionId, approve) {
    setApproving(actionId);
    try {
      await api.approveRecoveryAction(caseId, actionId, {
        approved_by: "ops_manager@paysafe",
        approve,
        note: approve ? "Approved via PAYSAFE dashboard (simulated)." : "Rejected via PAYSAFE dashboard.",
      });
      await load();
      if (approve) setApprovalSuccess("Recovery action approved and simulated successfully.");
    } catch (e) {
      setError(e.message);
    } finally {
      setApproving(null);
    }
  }

  async function handleFallbackApprove() {
    setApproving("fallback");
    try {
      const investigated = await handleInvestigate();
      if (!investigated) return;

      // There is no recovery-action record to approve, so model the human
      // approval locally after the investigation has completed.
      setCaseData((previous) =>
        previous
          ? {
              ...previous,
              case_status: "RESOLVED",
              audit_logs: [
                ...(previous.audit_logs || []),
                {
                  timestamp: new Date().toISOString(),
                  actor: "HUMAN",
                  action: "RECOVERY_ACTION_APPROVED (SIMULATED)",
                },
              ],
            }
          : previous,
      );
      setFallbackApproved(true);
      setApprovalSuccess("Recovery action approved and simulated successfully. Case status is RESOLVED.");
    } finally {
      setApproving(null);
    }
  }

  async function confirmRecoveryAction() {
    if (!confirmation) return;
    setConfirmingAction(true);
    try {
      if (confirmation.kind === "fallback") {
        await handleFallbackApprove();
      } else {
        await handleApprove(confirmation.action.id, confirmation.approve);
      }
      setConfirmation(null);
    } finally {
      setConfirmingAction(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <Link to="/" className="text-sm text-accent hover:underline">
          ← Back to dashboard
        </Link>
        <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      </div>
    );
  }

  if (!caseData) {
    return <div className="mx-auto max-w-4xl px-6 py-10 text-sm text-slate-500">Loading case…</div>;
  }

  const c = caseData;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <Link to="/" className="text-sm text-accent hover:underline">
        ← Back to dashboard
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>{c.case_id}</span>
            <span>·</span>
            <span>{c.transaction_id}</span>
          </div>
          <h1 className="mt-1 text-xl font-semibold text-slate-100">
            {c.rail} — {c.failure_type.replaceAll("_", " ")}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge value={c.severity} />
          <StatusBadge value={c.case_status} />
          {c.sla && <StatusBadge value={c.sla.sla_status} />}
          {c.escalated && <StatusBadge value="ESCALATED" />}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Transaction summary */}
          <section className="rounded-2xl border border-edge bg-panel/60 p-5">
            <h2 className="text-sm font-semibold text-slate-200">Transaction</h2>
            {c.transaction ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <Info label="Amount" value={`₹${c.transaction.amount.toLocaleString("en-IN")}`} />
                <Info label="Sender" value={c.transaction.sender} />
                <Info label="Receiver" value={c.transaction.receiver} />
                <Info label="Reference ID" value={c.transaction.reference_id || "-"} />
                <Info label="Debit Status" value={c.transaction.debit_status} />
                <Info label="Credit Status" value={c.transaction.credit_status} />
                <Info label="Network Status" value={c.transaction.network_status} />
                <Info label="Timestamp" value={new Date(c.transaction.timestamp).toLocaleString()} />
              </dl>
            ) : (
              <div className="mt-2 text-xs text-slate-500">Transaction details unavailable.</div>
            )}
          </section>

          {/* Decision */}
          <section className="rounded-2xl border border-edge bg-panel/60 p-5">
            <h2 className="text-sm font-semibold text-slate-200">Agent decision</h2>
            <p className="mt-2 text-sm text-slate-300">{c.decision_reason || "Not yet decided."}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>Recommended action:</span>
              <span className="rounded-full border border-edge px-2 py-1 text-slate-300">
                {c.recommended_action || "-"}
              </span>
              <span>Confidence: {(c.confidence * 100).toFixed(0)}%</span>
            </div>
            {c.escalated && (
              <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                Escalated: {c.escalation_reason}
              </div>
            )}
            {c.customer_message && (
              <div className="mt-3 rounded-lg border border-edge bg-ink/40 px-3 py-2 text-xs text-slate-400">
                Customer said: "{c.customer_message}"
              </div>
            )}
          </section>

          {/* Investigate */}
          <section className="rounded-2xl border border-edge bg-panel/60 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200">Investigation</h2>
              <button
                onClick={handleInvestigate}
                disabled={investigating}
                className="rounded-lg border border-edge px-3 py-1.5 text-xs text-slate-300 hover:border-accent/50 hover:text-accent disabled:opacity-50"
              >
                {investigating ? "Investigating…" : "Re-run investigation"}
              </button>
            </div>
            {investigateResult && !investigateResult.error && (
              <div className="mt-3 space-y-2">
                <div className="text-xs text-slate-500">
                  State: <span className="text-slate-300">{investigateResult.current_state}</span> · SLA:{" "}
                  <StatusBadge value={investigateResult.sla_status} />{" "}
                  {investigateResult.hours_remaining != null && (
                    <span>({investigateResult.hours_remaining.toFixed(1)}h remaining)</span>
                  )}
                </div>
                <ul className="space-y-1 text-xs text-slate-400 list-disc list-inside">
                  {investigateResult.findings.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
            {investigateResult?.error && (
              <div className="mt-2 text-xs text-rose-400">{investigateResult.error}</div>
            )}
          </section>

          {/* Recovery actions */}
          <section className="rounded-2xl border border-edge bg-panel/60 p-5">
            <h2 className="text-sm font-semibold text-slate-200">Recovery actions (simulated — human approval required)</h2>
            <div className="mt-3 space-y-3">
              {approvalSuccess && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                  {approvalSuccess}
                </div>
              )}
              {(!c.recovery_actions || c.recovery_actions.length === 0) && (
                <div className="rounded-lg border border-edge bg-ink/40 p-3">
                  <p className="text-xs text-slate-500">No recovery action proposed yet.</p>
                  <button
                    onClick={() => setConfirmation({ kind: "fallback", approve: true })}
                    disabled={approving === "fallback" || investigating || fallbackApproved}
                    className="mt-3 rounded-md bg-emerald-500/90 px-3 py-1.5 text-xs font-medium text-ink hover:bg-emerald-400 disabled:opacity-50"
                  >
                    {approving === "fallback" ? "Investigating…" : "Approve Recovery Action"}
                  </button>
                  {fallbackApproved && (
                    <div className="mt-2 text-xs text-emerald-300">
                      Recovery approval simulated — case status updated to RESOLVED.
                    </div>
                  )}
                </div>
              )}
              {c.recovery_actions?.map((a) => (
                <div key={a.id} className="rounded-lg border border-edge bg-ink/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium text-slate-200">{a.action_type}</div>
                    <div className="flex items-center gap-2">
                      <StatusBadge value={a.status} />
                      {a.status === "PENDING_APPROVAL" && (
                        <button
                          onClick={() => setConfirmation({ kind: "action", action: a, approve: true })}
                          disabled={approving === a.id}
                          className="rounded-md bg-emerald-500/90 px-3 py-1.5 text-xs font-medium text-ink hover:bg-emerald-400 disabled:opacity-50"
                        >
                          Approve Recovery Action
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{a.description}</p>
                  {a.amount > 0 && (
                    <p className="mt-1 text-xs text-slate-500">Amount: ₹{a.amount.toLocaleString("en-IN")}</p>
                  )}
                  {a.status === "PENDING_APPROVAL" && (
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={() => setConfirmation({ kind: "action", action: a, approve: false })}
                        disabled={approving === a.id}
                        className="rounded-md border border-edge px-3 py-1.5 text-xs text-slate-300 hover:border-rose-500/50 hover:text-rose-300 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                  {a.approved_by && (
                    <p className="mt-2 text-xs text-slate-500">
                      {a.status === "REJECTED" ? "Rejected" : "Approved"} by {a.approved_by} on{" "}
                      {new Date(a.approved_at).toLocaleString()}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          {/* Evidence packet */}
          <section className="rounded-2xl border border-edge bg-panel/60 p-5">
            <h2 className="text-sm font-semibold text-slate-200">Evidence packet</h2>
            <div className="mt-3 flex flex-col gap-2">
              <button
                onClick={handleLoadEvidence}
                className="rounded-lg border border-edge px-3 py-2 text-xs text-slate-300 hover:border-accent/50 hover:text-accent"
              >
                Load evidence JSON
              </button>
              <a
                href={api.getEvidencePdfUrl(caseId)}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-accent/90 px-3 py-2 text-center text-xs font-medium text-ink hover:bg-accent"
              >
                Download Evidence PDF
              </a>
            </div>
            {evidence && (
              <pre className="mt-3 max-h-80 overflow-auto rounded-lg border border-edge bg-ink/60 p-3 text-[10px] leading-relaxed text-slate-400">
                {JSON.stringify(evidence, null, 2)}
              </pre>
            )}
          </section>

          {/* Audit log */}
          <section className="rounded-2xl border border-edge bg-panel/60 p-5">
            <h2 className="text-sm font-semibold text-slate-200">Audit history</h2>
            <div className="mt-3 space-y-2 text-xs">
              {c.audit_logs?.length ? (
                [...c.audit_logs].reverse().map((a, i) => (
                  <div key={i} className="border-l-2 border-edge pl-3">
                    <div className="text-slate-500">
                      {new Date(a.timestamp).toLocaleString()} · {a.actor}
                    </div>
                    <div className="text-slate-300">{a.action}</div>
                  </div>
                ))
              ) : (
                <div className="text-slate-500">No audit entries yet.</div>
              )}
            </div>
          </section>

          {/* Notifications */}
          <section className="rounded-2xl border border-edge bg-panel/60 p-5">
            <h2 className="text-sm font-semibold text-slate-200">Customer notifications</h2>
            <div className="mt-3 space-y-2 text-xs">
              {c.notifications?.length ? (
                c.notifications.map((n, i) => (
                  <div key={i} className="rounded-lg border border-edge bg-ink/40 p-2">
                    <div className="text-slate-500">
                      {n.channel} · {new Date(n.sent_at).toLocaleString()}
                    </div>
                    <div className="text-slate-300">{n.message}</div>
                  </div>
                ))
              ) : (
                <div className="text-slate-500">No notifications sent yet.</div>
              )}
            </div>
          </section>
        </div>
      </div>
      {confirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 px-4">
          <div className="w-full max-w-md rounded-2xl border border-edge bg-panel p-5 shadow-glow">
            <h2 className="text-base font-semibold text-slate-100">
              {confirmation.approve ? "Confirm recovery approval" : "Confirm recovery rejection"}
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              {confirmation.approve ? "This simulated action will update the case workflow." : "This simulated action will reject the proposed recovery."}
            </p>
            <dl className="mt-4 space-y-2 rounded-lg border border-edge bg-ink/40 p-3 text-xs">
              <ModalInfo label="Action" value={confirmation.action?.action_type || "Recovery approval"} />
              <ModalInfo label="Rail" value={c.rail} />
              <ModalInfo label="Amount" value={`₹${(confirmation.action?.amount || c.transaction?.amount || c.amount || 0).toLocaleString("en-IN")}`} />
            </dl>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmation(null)}
                disabled={confirmingAction}
                className="rounded-md border border-edge px-3 py-1.5 text-xs text-slate-300 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmRecoveryAction}
                disabled={confirmingAction}
                className={`rounded-md px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-50 ${confirmation.approve ? "bg-emerald-500/90 hover:bg-emerald-400" : "bg-rose-400 hover:bg-rose-300"}`}
              >
                {confirmingAction ? "Processing…" : confirmation.approve ? "Approve (simulate)" : "Reject"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-200">{value}</dd>
    </div>
  );
}

function ModalInfo({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right text-slate-200">{value}</dd>
    </div>
  );
}
