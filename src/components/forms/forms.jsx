import React, { useState } from "react";
import { X, Plus } from "lucide-react";
import { divisions, statuses, resourceTypes } from "../../constants";
import { toDate, addBusinessDaysInclusive, formatDate } from "../../utils";
import {
  CertificationPicker,
  SearchableProjectSelect,
  SearchableResourceSelect,
  SearchableCrewSelect,
} from "../ui/UI";

// ─── ProjectForm ──────────────────────────────────────────────────────────────

export function ProjectForm({ form, setForm, onSave, onCancel, editing, certifications }) {
  function updateField(field, value) { setForm((c) => ({ ...c, [field]: value })); }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{editing ? "Edit Project" : "Add Project"}</h2>
            <p className="text-sm text-slate-500">Project master information only. Assignments are made from the Dashboard.</p>
          </div>
          <button onClick={onCancel} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button>
        </div>

        <div className="grid gap-4 p-5 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Project Number</span>
            <input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.projectNumber} onChange={(e) => updateField("projectNumber", e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Project Name</span>
            <input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.name} onChange={(e) => updateField("name", e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Client</span>
            <input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.client} onChange={(e) => updateField("client", e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Division</span>
            <select className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.division} onChange={(e) => updateField("division", e.target.value)}>
              {divisions.map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Address</span>
            <input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.address} onChange={(e) => updateField("address", e.target.value)} />
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Specific Requirements / Certifications</span>
            <CertificationPicker selected={form.specificRequirements || []} onChange={(v) => updateField("specificRequirements", v)} certifications={certifications} />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Status</span>
            <select className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.status} onChange={(e) => updateField("status", e.target.value)}>
              {statuses.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 p-5">
          <button onClick={onCancel} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button onClick={onSave} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800">Save Project</button>
        </div>
      </div>
    </div>
  );
}

// ─── AssignmentForm ───────────────────────────────────────────────────────────

export function AssignmentForm({ form, setForm, onSave, onCancel, editing, resources, projects, crews }) {
  function updateField(field, value) { setForm((c) => ({ ...c, [field]: value })); }

  function calculateEndDateFromWeeks(startDate, durationWeeks) {
    if (!startDate || durationWeeks === "" || durationWeeks === null || durationWeeks === undefined) return "";
    const start = toDate(startDate);
    const weeks = Number(durationWeeks);
    if (!start || Number.isNaN(weeks) || weeks <= 0) return "";
    const end = addBusinessDaysInclusive(start, weeks * 5);
    return end ? end.toISOString().slice(0, 10) : "";
  }

  function updateMobilization(id, field, value) {
    setForm((c) => ({
      ...c,
      mobilizations: (c.mobilizations || []).map((mob) => {
        if (mob.id !== id) return mob;
        const updated = { ...mob, [field]: value };
        if (field === "start" || field === "durationWeeks") {
          const calculatedEnd = calculateEndDateFromWeeks(updated.start, updated.durationWeeks);
          if (calculatedEnd) updated.end = calculatedEnd;
        }
        return updated;
      }),
    }));
  }

  function addMobilization() {
    setForm((c) => ({
      ...c,
      mobilizations: [...(c.mobilizations || []), { id: crypto.randomUUID(), start: "", durationWeeks: "", end: "" }],
    }));
  }

  function removeMobilization(id) {
    setForm((c) => ({ ...c, mobilizations: (c.mobilizations || []).filter((m) => m.id !== id) }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{editing ? "Edit Assignment" : "Assign Project"}</h2>
            <p className="text-sm text-slate-500">Select a project, assign resources, crews, and mobilization dates.</p>
          </div>
          <button onClick={onCancel} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button>
        </div>

        <div className="grid gap-4 p-5 md:grid-cols-2">
          <label className="space-y-1 md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Project</span>
            <SearchableProjectSelect value={form.projectId} onChange={(v) => updateField("projectId", v)} projects={projects} />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Project Manager</span>
            <SearchableResourceSelect value={form.projectManager} onChange={(v) => updateField("projectManager", v)} resources={resources} resourceType="Project Manager" placeholder="Search project manager..." />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Superintendent</span>
            <SearchableResourceSelect value={form.superintendent} onChange={(v) => updateField("superintendent", v)} resources={resources} resourceType="Superintendent" placeholder="Search superintendent..." />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Field Coordinator</span>
            <SearchableResourceSelect value={form.fieldCoordinator} onChange={(v) => updateField("fieldCoordinator", v)} resources={resources} resourceType="Field Coordinator" placeholder="Search field coordinator..." />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Field Engineer</span>
            <SearchableResourceSelect value={form.fieldEngineer} onChange={(v) => updateField("fieldEngineer", v)} resources={resources} resourceType="Field Engineer" placeholder="Search field engineer..." />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Safety</span>
            <SearchableResourceSelect value={form.safety} onChange={(v) => updateField("safety", v)} resources={resources} resourceType="Safety" placeholder="Search safety..." />
          </label>
          <div />
          {[1, 2, 3, 4].map((n) => (
            <label key={n} className="space-y-1">
              <span className="text-sm font-medium text-slate-700">Crew #{n}</span>
              <SearchableCrewSelect value={form[`crew${n}Id`]} onChange={(v) => updateField(`crew${n}Id`, v)} crews={crews} />
            </label>
          ))}

          <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900">Mobilizations</h3>
                <p className="text-sm text-slate-500">Use + to add additional start/end date ranges for remobilizations.</p>
              </div>
              <button onClick={addMobilization} type="button" className="flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
                <Plus size={16} /> Add Mobilization
              </button>
            </div>
            <div className="space-y-3">
              {(form.mobilizations || []).map((mob, index) => (
                <div key={mob.id} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-[auto_1fr_1fr_1fr_auto]">
                  <div className="flex items-center font-semibold text-slate-600">#{index + 1}</div>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-600">Start Date</span>
                    <input type="date" className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={mob.start} onChange={(e) => updateMobilization(mob.id, "start", e.target.value)} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-600">Duration / Weeks</span>
                    <input type="number" min="0" step="0.5" className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={mob.durationWeeks || ""} onChange={(e) => updateMobilization(mob.id, "durationWeeks", e.target.value)} placeholder="Weeks" />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-600">End Date</span>
                    <input type="date" className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={mob.end} onChange={(e) => updateMobilization(mob.id, "end", e.target.value)} />
                  </label>
                  <button type="button" onClick={() => removeMobilization(mob.id)} className="rounded-xl border border-red-200 px-3 py-2 font-medium text-red-700 hover:bg-red-50">Remove</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 p-5">
          <button onClick={onCancel} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button onClick={onSave} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800">Save Assignment</button>
        </div>
      </div>
    </div>
  );
}

// ─── ResourceForm ─────────────────────────────────────────────────────────────

export function ResourceForm({ form, setForm, certifications, onSave, onCancel, editing }) {
  const [ptoDraft, setPtoDraft] = useState({ ptoId: "", start: "", end: "" });
  function updateField(field, value) { setForm((c) => ({ ...c, [field]: value })); }

  function addPto() {
    if (!ptoDraft.ptoId || !ptoDraft.start || !ptoDraft.end) { alert("PTO ID, start date, and end date are required."); return; }
    setForm((c) => ({ ...c, pto: [...(c.pto || []), { ...ptoDraft, id: crypto.randomUUID() }] }));
    setPtoDraft({ ptoId: "", start: "", end: "" });
  }

  function deletePto(id) {
    setForm((c) => ({ ...c, pto: (c.pto || []).filter((item) => item.id !== id) }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{editing ? "Edit Resource" : "Add Resource"}</h2>
            <p className="text-sm text-slate-500">Create resource profile, role, certifications, and PTO records.</p>
          </div>
          <button onClick={onCancel} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button>
        </div>

        <div className="grid gap-4 p-5 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Name</span>
            <input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.name} onChange={(e) => updateField("name", e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Resource Type</span>
            <select className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.resourceType} onChange={(e) => updateField("resourceType", e.target.value)}>
              {resourceTypes.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Home Division</span>
            <select className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.homeDivision} onChange={(e) => updateField("homeDivision", e.target.value)}>
              {divisions.map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Status</span>
            <select className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.status} onChange={(e) => updateField("status", e.target.value)}>
              <option>Active</option><option>Available</option><option>Inactive</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Phone</span>
            <input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.phone} onChange={(e) => updateField("phone", e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Email</span>
            <input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.email} onChange={(e) => updateField("email", e.target.value)} />
          </label>
        </div>

        <div className="border-t border-slate-200 p-5">
          <h3 className="font-bold text-slate-900">Certifications</h3>
          <div className="mt-3">
            <CertificationPicker selected={form.certifications || []} onChange={(v) => updateField("certifications", v)} certifications={certifications} />
          </div>
        </div>

        <div className="border-t border-slate-200 p-5">
          <h3 className="font-bold text-slate-900">PTO</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
            <input placeholder="PTO ID" className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={ptoDraft.ptoId} onChange={(e) => setPtoDraft((c) => ({ ...c, ptoId: e.target.value }))} />
            <input type="date" className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={ptoDraft.start} onChange={(e) => setPtoDraft((c) => ({ ...c, start: e.target.value }))} />
            <input type="date" className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={ptoDraft.end} onChange={(e) => setPtoDraft((c) => ({ ...c, end: e.target.value }))} />
            <button onClick={addPto} className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white">Add PTO</button>
          </div>
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr><th className="p-3">PTO ID</th><th className="p-3">Start</th><th className="p-3">End</th><th className="p-3 text-right">Action</th></tr>
              </thead>
              <tbody>
                {(form.pto || []).map((pto) => (
                  <tr key={pto.id} className="border-t border-slate-200">
                    <td className="p-3">{pto.ptoId}</td>
                    <td className="p-3">{formatDate(pto.start)}</td>
                    <td className="p-3">{formatDate(pto.end)}</td>
                    <td className="p-3 text-right"><button onClick={() => deletePto(pto.id)} className="text-red-700">Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 p-5">
          <button onClick={onCancel} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button onClick={onSave} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800">Save Resource</button>
        </div>
      </div>
    </div>
  );
}

// ─── CrewForm ─────────────────────────────────────────────────────────────────

export function CrewForm({ form, setForm, certifications, onSave, onCancel, editing }) {
  function updateField(field, value) { setForm((c) => ({ ...c, [field]: value })); }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{editing ? "Edit Crew" : "Add Crew"}</h2>
            <p className="text-sm text-slate-500">Crew master information used by assignment dropdowns.</p>
          </div>
          <button onClick={onCancel} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button>
        </div>

        <div className="grid gap-4 p-5 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Crew Name</span>
            <input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.crewName} onChange={(e) => updateField("crewName", e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Foreman Name</span>
            <input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.foremanName} onChange={(e) => updateField("foremanName", e.target.value)} />
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Specialty</span>
            <CertificationPicker selected={form.specialty || []} onChange={(v) => updateField("specialty", v)} certifications={certifications} />
          </label>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 p-5">
          <button onClick={onCancel} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button onClick={onSave} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800">Save Crew</button>
        </div>
      </div>
    </div>
  );
}
