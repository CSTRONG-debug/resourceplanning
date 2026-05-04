// src/components/CmicRefreshContracts.jsx
//
// Renders the "Refresh Contract Values from CMiC" button for the Forecast
// tab. Walks every local project that has a projectNumber, asks CMiC for its
// current JobBillAmt, and shows a diff. Apply step writes new values to the
// `forecast` table (where contract values live in this app — NOT on the
// projects table itself).

import React, { useState } from "react";
import { createPortal } from "react-dom";
import { RefreshCw, X, Check, Loader2, AlertCircle } from "lucide-react";
import { supabase } from "../lib/supabase";
import { fetchContractValueUpdates } from "../lib/cmic";

export default function CmicRefreshContracts({ projects, forecastData, onApplied }) {
  const [busy, setBusy] = useState(false);
  const [updates, setUpdates] = useState(null); // array of update records
  const [include, setInclude] = useState({}); // projectId -> bool
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");

  async function handleClick() {
    setError("");
    setBusy(true);
    try {
      // Only check projects that have a project number — others can't match
      // a CMiC job. Also skip projects already marked complete to save calls.
      // Inject the current contract value from the forecastData map so the
      // diff knows what we're comparing against.
      const candidates = projects
        .filter((p) => p.projectNumber && p.status !== "Complete")
        .map((p) => ({
          ...p,
          contractValue: forecastData?.[p.id]?.contractValue ?? 0,
        }));
      const result = await fetchContractValueUpdates(candidates);
      setUpdates(result);
      setInclude(
        Object.fromEntries(result.map((u) => [u.projectId, u.changed && !u.error]))
      );
    } catch (err) {
      setError(err.message || "Failed to reach CMiC.");
    } finally {
      setBusy(false);
    }
  }

  async function handleApply() {
    if (!updates) return;
    setApplying(true);
    setError("");
    try {
      const toApply = updates.filter((u) => include[u.projectId] && u.changed && !u.error);

      for (const u of toApply) {
        const existingForecast = forecastData?.[u.projectId];
        if (existingForecast?.id) {
          // Update existing forecast row.
          const { error: upErr } = await supabase
            .from("forecast")
            .update({ contract_value: Number(u.cmicValue) || 0 })
            .eq("id", existingForecast.id);
          if (upErr) throw upErr;
        } else {
          // No forecast row yet — create one with sensible defaults.
          const { error: insErr } = await supabase.from("forecast").insert({
            project_id: u.projectId,
            contract_value: Number(u.cmicValue) || 0,
            spread_rule: "even",
            actuals: {},
            redistributed_spread: {},
          });
          if (insErr) throw insErr;
        }
      }
      setUpdates(null);
      onApplied?.({ updated: toApply.length });
    } catch (err) {
      setError(err.message || "Failed to apply changes.");
    } finally {
      setApplying(false);
    }
  }

  const changedCount = updates?.filter((u) => u.changed && !u.error).length || 0;
  const errorCount = updates?.filter((u) => u.error).length || 0;
  const includedCount = Object.values(include).filter(Boolean).length;

  return (
    <>
      <button
        onClick={handleClick}
        disabled={busy}
        className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-2.5 font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
        title="Refresh contract values from CMiC"
      >
        {busy ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
        {busy ? "Checking CMiC…" : "Refresh Contract Values"}
      </button>

      {error && !updates && (
        <div className="ml-3 inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {updates && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4"
          onClick={() => { setUpdates(null); setError(""); }}
        >
          <div
            className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Contract Value Updates</h2>
                <p className="text-xs text-slate-500">
                  {changedCount} project{changedCount === 1 ? "" : "s"} differ from CMiC
                  {errorCount > 0 && ` · ${errorCount} couldn't be checked`}
                </p>
              </div>
              <button
                onClick={() => { setUpdates(null); setError(""); }}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              >
                <X size={20} />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {updates.length === 0 ? (
                <p className="text-sm italic text-slate-500">No projects to check.</p>
              ) : (
                <ul className="space-y-1">
                  {updates.map((u) => (
                    <li
                      key={u.projectId}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                        u.error
                          ? "border-red-200 bg-red-50"
                          : u.changed
                          ? "border-amber-200 bg-amber-50"
                          : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={!!include[u.projectId]}
                        onChange={(e) =>
                          setInclude((s) => ({ ...s, [u.projectId]: e.target.checked }))
                        }
                        disabled={!u.changed || !!u.error}
                      />
                      <span className="font-mono text-xs text-slate-500">{u.projectNumber}</span>
                      <span className="flex-1 truncate font-semibold">{u.name}</span>
                      {u.error ? (
                        <span className="text-xs text-red-700">Error: {u.error.slice(0, 60)}</span>
                      ) : u.changed ? (
                        <>
                          <span className="line-through text-xs text-slate-400">
                            ${Number(u.currentValue || 0).toLocaleString()}
                          </span>
                          <span className="text-xs">→</span>
                          <span className="font-mono text-sm font-bold text-emerald-700">
                            ${Number(u.cmicValue || 0).toLocaleString()}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">Unchanged</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {error && (
              <div className="shrink-0 border-t border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <footer className="flex shrink-0 items-center justify-between border-t border-slate-200 px-5 py-4">
              <div className="text-xs text-slate-500">
                Will update <strong>{includedCount}</strong> projects
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setUpdates(null); setError(""); }}
                  disabled={applying}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApply}
                  disabled={applying || includedCount === 0}
                  className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:bg-slate-300"
                >
                  {applying ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Apply changes
                </button>
              </div>
            </footer>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
