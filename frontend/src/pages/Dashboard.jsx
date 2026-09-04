import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api.js";
import StatCard from "../components/StatCard.jsx";
import ExceptionCard from "../components/ExceptionCard.jsx";
import AgentFeed from "../components/AgentFeed.jsx";

const RAILS = ["ALL", "UPI", "IMPS", "NEFT", "RTGS", "AEPS"];

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [cases, setCases] = useState([]);
  const [rail, setRail] = useState("ALL");
  const [escalatedOnly, setEscalatedOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [complaint, setComplaint] = useState({ transaction_id: "", customer_message: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const load = useCallback(async () => {
    try {
      const params = {};
      if (rail !== "ALL") params.rail = rail;
      if (escalatedOnly) params.escalated = "true";
      const [s, c] = await Promise.all([api.dashboardStats(), api.listCases(params)]);
      setStats(s);
      setCases(c);
      setError(null);
      setLastRefreshed(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [rail, escalatedOnly]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleReportComplaint(e) {
    e.preventDefault();
    if (!complaint.transaction_id || !complaint.customer_message) return;
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const res = await api.classify(complaint.transaction_id, complaint.customer_message);
      setSubmitResult(res);
      await load();
    } catch (e) {
      setSubmitResult({ error: e.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            PAY<span className="text-accent">SAFE</span>
          </h1>
          <p className="text-sm text-slate-400">
            AI Payment Exception &amp; Recovery Agent — UPI · IMPS · NEFT · RTGS · AEPS
          </p>
        </div>
        <div className="text-xs rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300 px-3 py-1.5">
          Hackathon simulation — no real banking/NPCI systems, no real money moves
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          Couldn't reach the backend at <code>/api/...</code>: {error}. Make sure the demo backend is
          running (see README) and the dev server proxy is configured to point to it.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
        <StatCard label="Transactions" value={stats?.total_transactions ?? "-"} />
        <StatCard label="Total Cases" value={stats?.total_cases ?? "-"} />
        <StatCard label="Open Cases" value={stats?.open_cases ?? "-"} tone="warn" />
        <StatCard label="Resolved" value={stats?.resolved_cases ?? "-"} tone="ok" />
        <StatCard label="Escalated" value={stats?.escalated_cases ?? "-"} tone="danger" />
        <StatCard label="SLA At Risk" value={stats?.sla_at_risk ?? "-"} tone="warn" />
        <StatCard label="SLA Breached" value={stats?.sla_breached ?? "-"} tone="danger" />
      </div>

      <div className="-mt-3 text-right text-xs text-slate-500">
        Last refreshed: {lastRefreshed ? lastRefreshed.toLocaleTimeString() : "—"}
      </div>

      <AgentFeed onNewEvent={load} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {RAILS.map((r) => (
                <button
                  key={r}
                  onClick={() => setRail(r)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                    rail === r
                      ? "border-accent/50 bg-accent/10 text-accent"
                      : "border-edge text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={escalatedOnly}
                onChange={(e) => setEscalatedOnly(e.target.checked)}
                className="accent-accent"
              />
              Escalated only
            </label>
          </div>

          <div className="space-y-3">
            {loading && <div className="text-sm text-slate-500">Loading cases…</div>}
            {!loading && cases.length === 0 && (
              <div className="rounded-xl border border-edge bg-panel/50 px-4 py-8 text-center text-sm text-slate-500">
                No exception cases match this filter yet.
              </div>
            )}
            {cases.map((c) => (
              <ExceptionCard key={c.case_id} c={c} />
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-edge bg-panel/60 p-5 shadow-glow">
            <h2 className="text-sm font-semibold text-slate-100">Report a complaint</h2>
            <p className="mt-1 text-xs text-slate-500">
              Simulates a customer reporting an issue in natural language. Runs the full
              detect → classify → investigate → decide pipeline.
            </p>
            <form onSubmit={handleReportComplaint} className="mt-4 space-y-3">
              <input
                value={complaint.transaction_id}
                onChange={(e) => setComplaint((p) => ({ ...p, transaction_id: e.target.value }))}
                placeholder="Transaction ID, e.g. TXN_UPI_003"
                className="w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 text-sm outline-none focus:border-accent/50"
              />
              <textarea
                value={complaint.customer_message}
                onChange={(e) => setComplaint((p) => ({ ...p, customer_message: e.target.value }))}
                placeholder="e.g. I paid but the receiver didn't get the money"
                rows={3}
                className="w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 text-sm outline-none focus:border-accent/50"
              />
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-accent/90 px-3 py-2 text-sm font-medium text-ink hover:bg-accent disabled:opacity-50"
              >
                {submitting ? "Classifying…" : "Submit complaint"}
              </button>
            </form>
            {submitResult && (
              <div className="mt-3 rounded-lg border border-edge bg-ink/40 p-3 text-xs">
                {submitResult.error ? (
                  <span className="text-rose-400">{submitResult.error}</span>
                ) : (
                  <>
                    <div className="text-slate-400">
                      {submitResult.rail} · {submitResult.failure_type?.replaceAll("_", " ")} ·{" "}
                      conf {submitResult.confidence?.toFixed?.(2)}
                    </div>
                    {submitResult.case_id && (
                      <Link
                        to={`/cases/${submitResult.case_id}`}
                        className="mt-1 inline-block text-accent hover:underline"
                      >
                        View case {submitResult.case_id} →
                      </Link>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
