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
  const [scanInProgress, setScanInProgress] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [refreshToken, setRefreshToken] = useState(0);
  const lastIdRef = useRef(0);

  useEffect(() => {
    const ticker = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(ticker);
  }, []);

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
        // Keep the dashboard responsive; this only refreshes the UI. The
        // backend controls the actual scan cadence.
        if (!cancelled) timer = setTimeout(poll, 4000);
      }
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  async function handleScanNow() {
    setScanInProgress(true);
    try {
      await api.scanNow();
      onNewEvent && onNewEvent();
      setRefreshToken((value) => value + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setScanInProgress(false);
    }
  }

  const lastScanAt = status?.last_scan_at ? new Date(status.last_scan_at).getTime() : null;
  const secondsSinceScan = lastScanAt ? Math.max(0, Math.floor((now - lastScanAt) / 1000)) : null;
  const secondsUntilScan =
    secondsSinceScan == null ? null : Math.max(0, (status?.scan_interval_seconds ?? 30) - secondsSinceScan);
  const visibleEvents = collapseIdleEvents(events);

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
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>scans: {status?.scans_completed ?? "-"}</span>
          <span>found: {status?.exceptions_detected_total ?? "-"}</span>
          <button
            onClick={handleScanNow}
            disabled={scanInProgress}
            className="rounded-md border border-edge px-2 py-1 text-slate-300 hover:border-accent/50 hover:text-accent disabled:opacity-50"
          >
            {scanInProgress ? "Scanning…" : "Scan now"}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-edge px-4 py-2 text-xs text-slate-500">
        <span>Last scan: {secondsSinceScan == null ? "waiting for first scan" : `${secondsSinceScan}s ago`}</span>
        <span>Next automatic scan: {secondsUntilScan == null ? "—" : `${secondsUntilScan}s`}</span>
      </div>
      <div className="max-h-64 overflow-y-auto px-4 py-3 space-y-2 text-xs">
        {error && <div className="text-rose-400">Agent feed error: {error}</div>}
        {events.length === 0 && !error && (
          <div className="text-slate-500">Waiting for the next scan cycle…</div>
        )}
        {visibleEvents.map((e) => (
          <div key={e.id} className="flex items-start gap-2">
            <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${LEVEL_DOT[e.level] || "bg-slate-500"}`} />
            <div>
              <span className="text-slate-500">{new Date(e.timestamp).toLocaleTimeString()}</span>{" "}
              <span className="text-slate-300">
                {e.idleCount > 1 ? `${e.idleCount} scans completed with no new exceptions.` : e.message}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function collapseIdleEvents(events) {
  let idleEvent = null;
  const visible = [];

  events.forEach((event) => {
    if (event.level === "INFO" && event.message.startsWith("Scan complete")) {
      if (idleEvent) {
        idleEvent.idleCount += 1;
      } else {
        idleEvent = { ...event, idleCount: 1 };
        visible.push(idleEvent);
      }
      return;
    }
    visible.push(event);
  });

  return visible;
}
