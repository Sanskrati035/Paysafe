import { useEffect, useRef, useState } from "react";
import { api } from "../services/api.js";

const LEVEL_DOT = {
  INFO: "bg-sky-400",
  WARNING: "bg-amber-400",
  CRITICAL: "bg-rose-400",
};

export default function AgentFeed({ onNewEvent }) {
  const [status, setStatus] = useState(null);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);
  const lastIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer;

    async function poll() {
      try {
        const [st, evts] = await Promise.all([
          api.agentStatus(),
          api.agentEvents(lastIdRef.current),
        ]);
        if (cancelled) return;
        setError(null);
        setStatus(st);
        if (evts.length) {
          lastIdRef.current = evts[evts.length - 1].id;
          setEvents((prev) => [...evts, ...prev].slice(0, 40));
          onNewEvent && onNewEvent();
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) timer = setTimeout(poll, 60000);
      }
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-2xl border border-edge bg-panel/60 shadow-glow">
      <div className="flex items-center justify-between border-b border-edge px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              status?.running ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
            }`}
          />
          <span className="text-sm font-medium text-slate-200">PaySafe Monitor Agent</span>
          <span className="text-xs text-slate-500">
            ({status?.llm_mode === "LLM" ? "LLM-assisted" : "rule-based fallback"})
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>scans: {status?.scans_completed ?? "-"}</span>
          <span>found: {status?.exceptions_detected_total ?? "-"}</span>
          <button
            onClick={() => api.scanNow().catch((e) => setError(e.message))}
            className="rounded-md border border-edge px-2 py-1 text-slate-300 hover:border-accent/50 hover:text-accent"
          >
            Scan now
          </button>
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto px-4 py-3 space-y-2 text-xs">
        {error && <div className="text-rose-400">Agent feed error: {error}</div>}
        {events.length === 0 && !error && (
          <div className="text-slate-500">Waiting for the next scan cycle…</div>
        )}
        {events.map((e) => (
          <div key={e.id} className="flex items-start gap-2">
            <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${LEVEL_DOT[e.level] || "bg-slate-500"}`} />
            <div>
              <span className="text-slate-500">{new Date(e.timestamp).toLocaleTimeString()}</span>{" "}
              <span className="text-slate-300">{e.message}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
