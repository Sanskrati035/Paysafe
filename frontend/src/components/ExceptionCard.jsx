import { Link } from "react-router-dom";
import StatusBadge from "./StatusBadge.jsx";

const RAIL_COLORS = {
  UPI: "text-cyan-300",
  IMPS: "text-violet-300",
  NEFT: "text-amber-300",
  RTGS: "text-rose-300",
  AEPS: "text-emerald-300",
};

export default function ExceptionCard({ c }) {
  return (
    <Link
      to={`/cases/${c.case_id}`}
      className="block rounded-xl border border-edge bg-panel/50 p-4 hover:border-accent/50 hover:bg-panel/80 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold ${RAIL_COLORS[c.rail] || "text-slate-300"}`}>
              {c.rail}
            </span>
            <span className="text-sm text-slate-400">{c.transaction_id}</span>
          </div>
          <div className="mt-1 text-sm font-medium text-slate-100">
            {c.failure_type.replaceAll("_", " ")}
          </div>
          <div className="mt-1 text-xs text-slate-500 line-clamp-1">
            {c.decision_reason || c.customer_message || "Auto-detected by monitor agent"}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <StatusBadge value={c.severity} />
          <StatusBadge value={c.case_status} />
          {c.escalated && <StatusBadge value="ESCALATED" />}
        </div>
      </div>
      {c.sla && (
        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
          <span>Case {c.case_id}</span>
          <span className="flex items-center gap-2">
            SLA <StatusBadge value={c.sla.sla_status} />
          </span>
        </div>
      )}
    </Link>
  );
}
