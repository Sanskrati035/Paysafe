export default function StatCard({ label, value, sub, tone = "default" }) {
  const toneClass = {
    default: "text-slate-100",
    danger: "text-rose-300",
    warn: "text-amber-300",
    ok: "text-emerald-300",
  }[tone];

  return (
    <div className="rounded-2xl border border-edge bg-panel/60 p-5 shadow-glow backdrop-blur">
      <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`mt-2 text-3xl font-semibold ${toneClass}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
