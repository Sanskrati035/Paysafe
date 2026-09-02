const STYLES = {
  // severity
  LOW: "bg-slate-700/50 text-slate-300 border-slate-600",
  MEDIUM: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  HIGH: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  CRITICAL: "bg-rose-600/20 text-rose-200 border-rose-500/50",

  // case status
  DETECTED: "bg-slate-700/50 text-slate-300 border-slate-600",
  CLASSIFIED: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  INVESTIGATING: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  INVESTIGATED: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  DECIDED: "bg-violet-500/10 text-violet-300 border-violet-500/30",
  RECOVERY_INITIATED: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  ESCALATED: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  RESOLVED: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  CLOSED: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",

  // SLA
  ON_TIME: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  AT_RISK: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  BREACHED: "bg-rose-500/10 text-rose-300 border-rose-500/30",
};

export default function StatusBadge({ value, className = "" }) {
  const style = STYLES[value] || "bg-slate-700/50 text-slate-300 border-slate-600";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${style} ${className}`}
    >
      {String(value || "-").replaceAll("_", " ")}
    </span>
  );
}
