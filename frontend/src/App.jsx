import { Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Dashboard.jsx";
import CaseDetail from "./pages/CaseDetail.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/cases/:caseId" element={<CaseDetail />} />
      <Route
        path="*"
        element={
          <div className="mx-auto max-w-2xl px-6 py-16 text-center text-slate-400">
            <h1 className="text-lg font-semibold text-slate-200">Page not found</h1>
            <p className="mt-2 text-sm">
              Try the <a href="/" className="text-accent hover:underline">dashboard</a>.
            </p>
          </div>
        }
      />
    </Routes>
  );
}
