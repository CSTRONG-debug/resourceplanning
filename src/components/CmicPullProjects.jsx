// src/components/CmicPullProjects.jsx
//
// Renders the "Pull from CMiC" button. On click, fetches active jobs from
// CMiC via the proxy, computes a diff against existing local projects, and
// shows a preview modal listing what will be created/updated. Nothing is
// written to the database until the user confirms.

import React, { useState } from "react";
import { createPortal } from "react-dom";
import { Download, X, Plus, Edit3, Check, AlertCircle, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { fetchCmicJobs, diffCmicAgainstLocal } from "../lib/cmic";

export default function CmicPullProjects({ projects, onApplied }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null); // { toCreate, toUpdate, unchanged }
  const [applying, setApplying] = useState(false);
  const [includeUpdate, setIncludeUpdate] = useState({}); // existingId -> bool
  const [includeCreate, setIncludeCreate] = useState({}); // projectNumber -> bool

  async function handleClick() {
    setError("");
    setBusy(true);
    try {
      const { mapped } = await fetchCmicJobs({ status: "active" });
      const diff = diffCmicAgainstLocal(mapped, projects);
      setPreview(diff);
      // Default: include all creates and all updates.
      setIncludeCreate(Object.fromEntries(diff.toCreate.map((p) => [p.projectNumber, true])));
      setIncludeUpdate(Object.fromEntries(diff.toUpdate.map((u) => [u.existing.id, true])));
    } catch (err) {
      setError(err.message || "Failed to reach CMiC.");
    } finally {
      setBusy(false);
    }
  }

  async function handleApply() {
    if (!preview) return;
    setApplying(true);
    setError("");

    const creates = preview.toCreate.filter((p) => includeCreate[p.projectNumber]);
    const updates = preview.toUpdate.filter((u) => includeUpdate[u.existing.id]);

    try {
      // Inserts. Two-step write: first the projects table, then matching
      // rows in the `forecast` table for any project that has a CMiC
      // contract value. Contract values do NOT live on projects in this
      // app — they live in the separate `forecast` table keyed by project_id.
      if (creates.length) {
        const rows = creates.map((p) => ({
          project_number: p.projectNumber,
          name: p.name,
          client: p.client,
          division: p.division,
          status: p.status,
          project_type: p.projectType,
          // Default include_in_forecast TRUE for CMiC imports — these are
          // real revenue-tracked jobs and should land on the Forecast tab
          // automatically.
          include_in_forecast: true,
          source: "cmic", // mark provenance for the CMiC badge
        }));
        const { data: insertedProjects, error: insErr } = await supabase
          .from("projects")
          .insert(rows)
          .select(); // need IDs back so we can write matching forecast rows
        if (insErr) throw insErr;

        // Now write a forecast row for each newly-inserted project that has
        // a contract value. Match by project_number since that's stable
        // across both arrays. Contract value is already in thousands per
        // the toThousands() conversion in cmic.js mapper.
        const forecastRows = (insertedProjects || [])
          .map((dbProject) => {
            const incoming = creates.find(
              (c) => String(c.projectNumber) === String(dbProject.project_number)
            );
            if (!incoming || incoming.contractValue == null) return null;
            return {
              project_id: dbProject.id,
              contract_value: Number(incoming.contractValue) || 0,
              spread_rule: "even",
              actuals: {},
              redistributed_spread: {},
            };
          })
          .filter(Boolean);

        if (forecastRows.length) {
          const { error: fcErr } = await supabase.from("forecast").insert(forecastRows);
          if (fcErr) throw fcErr;
        }
      }

      // Updates — apply only the changed fields, not the whole row.
      // Skip contractValue here for the same reason as above.
      for (const u of updates) {
        const patch = {};
        for (const [k, v] of Object.entries(u.changes)) {
          if (k === "contractValue") continue; // forecast table, not projects
          patch[snake(k)] = v.to;
        }
        if (Object.keys(patch).length === 0) continue;
        const { error: upErr } = await supabase
          .from("projects")
          .update(patch)
          .eq("id", u.existing.id);
        if (upErr) throw upErr;
      }

      setPreview(null);
      onApplied?.({ created: creates.length, updated: updates.length });
    } catch (err) {
      setError(err.message || "Failed to apply changes.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
      <button
        onClick={handleClick}
        disabled={busy}
        className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-2.5 font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
        title="Pull active projects from CMiC"
      >
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
        {busy ? "Loading from CMiC…" : "Pull from CMiC"}
      </button>

      {error && !preview && (
        <div className="ml-3 inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {preview && (
        <PreviewModal
          preview={preview}
          includeCreate={includeCreate}
          setIncludeCreate={setIncludeCreate}
          includeUpdate={includeUpdate}
          setIncludeUpdate={setIncludeUpdate}
          applying={applying}
          error={error}
          onApply={handleApply}
          onCancel={() => { setPreview(null); setError(""); }}
        />
      )}
    </>
  );
}

// camelCase → snake_case for DB columns.
function snake(s) {
  return s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
}

// ── Preview modal ──────────────────────────────────────────────────────────

function PreviewModal({
  preview, includeCreate, setIncludeCreate, includeUpdate, setIncludeUpdate,
  applying, error, onApply, onCancel,
}) {
  const numCreate = Object.values(includeCreate).filter(Boolean).length;
  const numUpdate = Object.values(includeUpdate).filter(Boolean).length;

  // Lock body scroll while the modal is open so it can't drift off-screen
  // behind a scrolled page.
  React.useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Render via a portal directly under <body> so the modal can't be clipped
  // by any parent's `overflow: hidden`, transform, or stacking context.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4"
      onClick={onCancel}
    >
      <div
        className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">CMiC Sync Preview</h2>
            <p className="text-xs text-slate-500">
              Review changes before applying. Nothing is saved until you confirm.
            </p>
          </div>
          <button onClick={onCancel} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Creates */}
          <section className="mb-6">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-emerald-800">
              <Plus size={14} /> New projects ({preview.toCreate.length})
            </h3>
            {preview.toCreate.length === 0 ? (
              <p className="text-xs italic text-slate-400">No new projects to add.</p>
            ) : (
              <ul className="space-y-1">
                {preview.toCreate.map((p) => (
                  <li
                    key={p.projectNumber}
                    className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={!!includeCreate[p.projectNumber]}
                      onChange={(e) =>
                        setIncludeCreate((s) => ({ ...s, [p.projectNumber]: e.target.checked }))
                      }
                    />
                    <span className="font-mono text-xs text-slate-500">{p.projectNumber}</span>
                    <span className="flex-1 truncate font-semibold">{p.name}</span>
                    <span className="text-xs text-slate-500">{p.client || "—"}</span>
                    <span className="text-xs text-slate-500">{p.division || "—"}</span>
                    {p.contractValue != null && (
                      <span className="text-xs font-mono text-slate-700">
                        ${Number(p.contractValue).toLocaleString()}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Updates */}
          <section className="mb-6">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-amber-700">
              <Edit3 size={14} /> Updates ({preview.toUpdate.length})
            </h3>
            {preview.toUpdate.length === 0 ? (
              <p className="text-xs italic text-slate-400">No existing projects need updating.</p>
            ) : (
              <ul className="space-y-2">
                {preview.toUpdate.map((u) => (
                  <li key={u.existing.id} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    <div className="flex items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={!!includeUpdate[u.existing.id]}
                        onChange={(e) =>
                          setIncludeUpdate((s) => ({ ...s, [u.existing.id]: e.target.checked }))
                        }
                      />
                      <span className="font-mono text-xs text-slate-500">{u.incoming.projectNumber}</span>
                      <span className="flex-1 truncate font-semibold">{u.incoming.name}</span>
                    </div>
                    <ul className="mt-1.5 space-y-0.5 pl-7 text-xs text-slate-600">
                      {Object.entries(u.changes).map(([field, { from, to }]) => (
                        <li key={field}>
                          <span className="font-semibold">{field}:</span>{" "}
                          <span className="line-through text-slate-400">{String(from ?? "—")}</span>{" "}
                          → <span className="font-semibold text-emerald-700">{String(to ?? "—")}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Unchanged */}
          {preview.unchanged.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-500">
                <Check size={14} /> Unchanged ({preview.unchanged.length})
              </h3>
              <p className="text-xs text-slate-400">
                These projects already match CMiC and won't be modified.
              </p>
            </section>
          )}
        </div>

        {error && (
          <div className="shrink-0 border-t border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <footer className="flex shrink-0 items-center justify-between border-t border-slate-200 px-5 py-4">
          <div className="text-xs text-slate-500">
            Will create <strong>{numCreate}</strong> · Will update <strong>{numUpdate}</strong>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              disabled={applying}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={onApply}
              disabled={applying || (numCreate + numUpdate === 0)}
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
  );
}
