// src/components/CmicPullWipEarned.jsx
//
// Renders the "Pull WIP Earned Revenue" button for the Forecast tab. Pulls
// the CURRENT calendar month's posted WIP and reads each job's earned
// revenue, then writes it into that project's forecast `actuals` map keyed by
// the current month (e.g. "2026-06") — the same store inline cell edits and
// the CSV import write to, so it renders as a locked green "actual" cell.
//
// We deliberately do NOT recompute the redistributed spread here. In this app
// `computeProjectSpread` derives redistribution from `actuals` on every render
// (the persisted redistributed_spread column is just a cache), so once the
// parent reloads via onApplied the remaining months re-spread automatically.
// Writing actuals is therefore sufficient and keeps spread math in one place.
//
// Near-clone of CmicRefreshContracts: diff → checklist → apply, plus a
// completion summary.

import React, { useState } from "react";
import { createPortal } from "react-dom";
import { TrendingUp, X, Check, Loader2, AlertCircle } from "lucide-react";
import { supabase } from "../lib/supabase";
import { fetchWipEarnedRevenue } from "../lib/cmic";

export default function CmicPullWipEarned({ projects, forecastData, onApplied }) {
  const [busy, setBusy] = useState(false);
  const [updates, setUpdates] = useState(null);
  const [include, setInclude] = useState({});
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [monthKey, setMonthKey] = useState("");

  async function handleClick() {
    setError("");
    setBusy(true);
    try {
      // Inject current actuals so the diff can show what (if anything) is
      // already stored for this month.
      const candidates = projects
        .filter((p) => p.projectNumber && p.status !== "Complete")
        .map((p) => ({
          ...p,
          actuals: forecastData?.[p.id]?.actuals ?? {},
        }));
      const result = await fetchWipEarnedRevenue(candidates);
      setUpdates(result);
      setMonthKey(result[0]?.monthKey || "");
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
        const newActuals = { ...(existingForecast?.actuals || {}) };
        newActuals[u.monthKey] = Number(u.earned) || 0;

        if (existingForecast?.id) {
          const { error: upErr } = await supabase
            .from("forecast")
            // Clear the redistributed cache so the app rebuilds it from the
            // new actuals on next render.
            .update({ actuals: newActuals, redistributed_spread: {} })
            .eq("id", existingForecast.id);
          if (upErr) throw upErr;
        } else {
          const { error: insErr } = await supabase.from("forecast").insert({
            project_id: u.projectId,
            contract_value: 0,
            spread_rule: "even",
            actuals: newActuals,
            redistributed_spread: {},
          });
          if (insErr) throw insErr;
        }
      }
      setUpdates(null);
      onApplied?.({ updated: toApply.length, source: "wip-earned", month: monthKey });
      alert(
        `WIP earned revenue applied.\n\n` +
        `${toApply.length} project${toApply.length === 1 ? "" : "s"} updated for ${monthKey}.`
      );
    } catch (err) {
      setError(err.message || "Failed to apply changes.");
    } finally {
      setApplying(false);
    }
  }

  const changedCount = updates?.filter((u) => u.changed && !u.error).length || 0;
  const includedCount = Object.values(include).filter(Boolean).length;

  return (
    <>
      <button
        onClick={handleClick}
        disabled={busy}
        className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-2.5 font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
        title="Pull current-period posted WIP earned revenue"
      >
        {busy ? <Loader2 size={18} className="animate-spin" /> : <TrendingUp size={18} />}
        {busy ? "Checking WIP…" : "Pull WIP Earned Revenue"}
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
                <h2 className="text-lg font-bold text-slate-900">WIP Earned Revenue</h2>
                <p className="text-xs text-slate-500">
                  Posted WIP for {monthKey} · {changedCount} project{changedCount === 1 ? "" : "s"} to set
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
                        <span className="text-xs text-red-700">Error: {String(u.error).slice(0, 60)}</span>
                      ) : u.changed ? (
                        <>
                          {u.currentActual != null && (
                            <span className="line-through text-xs text-slate-400">
                              ${Number(u.currentActual || 0).toLocaleString()}
                            </span>
                          )}
                          <span className="text-xs">→</span>
                          <span className="font-mono text-sm font-bold text-emerald-700">
                            ${Number(u.earned || 0).toLocaleString()}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">{u.note || "Unchanged"}</span>
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
                Will set earned revenue for <strong>{includedCount}</strong> project{includedCount === 1 ? "" : "s"} ({monthKey})
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
                  Apply earned revenue
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
