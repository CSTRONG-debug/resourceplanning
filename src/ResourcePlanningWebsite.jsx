import React, { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, CalendarDays, Users, BriefcaseBusiness, X, ZoomIn, Settings, Search, FolderKanban, ClipboardCheck } from "lucide-react";

const PROJECTS_KEY = "ggc_resource_planning_projects";
const ASSIGNMENTS_KEY = "ggc_resource_planning_assignments";
const RESOURCES_KEY = "ggc_resource_planning_resources";
const CREWS_KEY = "ggc_resource_planning_crews";
const CERTIFICATIONS_KEY = "ggc_resource_planning_certifications";

const PROJECTS_LEGACY_KEYS = ["ggc_resource_planning_projects_v5", "ggc_resource_planning_projects_v4", "ggc_resource_planning_projects_v3", "ggc_resource_planning_projects_v2", "ggc_resource_planning_projects"];
const ASSIGNMENTS_LEGACY_KEYS = ["ggc_resource_planning_assignments_v2", "ggc_resource_planning_assignments_v1", "ggc_resource_planning_assignments"];
const RESOURCES_LEGACY_KEYS = ["ggc_resource_planning_resources_v1", "ggc_resource_planning_superintendents_v1", "ggc_resource_planning_resources"];
const CREWS_LEGACY_KEYS = ["ggc_resource_planning_crews_v1", "ggc_resource_planning_crews"];
const CERTIFICATIONS_LEGACY_KEYS = ["ggc_resource_planning_certifications_v1", "ggc_resource_planning_certifications"]; 

const divisions = ["Hardscape", "Commercial", "Industrial", "Tilt"];
const statuses = ["Pending Award", "Scheduled", "Active", "On Hold", "Complete"];
const resourceTypes = ["Project Manager", "Superintendent", "Field Coordinator", "Field Engineer", "Safety"];

const divisionStyles = {
  Hardscape: "bg-emerald-700",
  Commercial: "bg-blue-700",
  Industrial: "bg-orange-600",
  Tilt: "bg-purple-700",
};

const pendingDivisionStyles = {
  Hardscape: "bg-emerald-300",
  Commercial: "bg-blue-300",
  Industrial: "bg-orange-300",
  Tilt: "bg-purple-300",
};

const startingCertifications = ["OSHA 10", "OSHA 30", "First Aid / CPR", "Forklift", "Aerial Lift", "Rigging", "Confined Space"];

const startingResources = [
  { id: crypto.randomUUID(), name: "Mike Reynolds", resourceType: "Superintendent", phone: "", email: "", homeDivision: "Commercial", certifications: ["OSHA 30", "First Aid / CPR"], pto: [], status: "Active" },
  { id: crypto.randomUUID(), name: "Carlos Vega", resourceType: "Superintendent", phone: "", email: "", homeDivision: "Hardscape", certifications: ["OSHA 10"], pto: [], status: "Active" },
  { id: crypto.randomUUID(), name: "Brandon Lee", resourceType: "Superintendent", phone: "", email: "", homeDivision: "Tilt", certifications: ["OSHA 30", "Rigging"], pto: [], status: "Active" },
  { id: crypto.randomUUID(), name: "Sarah Mitchell", resourceType: "Project Manager", phone: "", email: "", homeDivision: "Commercial", certifications: [], pto: [], status: "Active" },
];

const startingCrews = [
  { id: crypto.randomUUID(), crewName: "Crew A", foremanName: "Jose Martinez", specialty: ["OSHA 10"] },
  { id: crypto.randomUUID(), crewName: "Crew B", foremanName: "Derrick Hill", specialty: ["Aerial Lift"] },
  { id: crypto.randomUUID(), crewName: "Crew C", foremanName: "Tony Harris", specialty: ["Rigging"] },
];

const startingProjects = [
  { id: crypto.randomUUID(), projectNumber: "P-1001", name: "Eastside Apartments", client: "Evergreen Development", address: "", division: "Commercial", specificRequirements: ["OSHA 30"], status: "Active" },
  { id: crypto.randomUUID(), projectNumber: "P-1002", name: "Northview School", client: "Northview County Schools", address: "", division: "Hardscape", specificRequirements: ["OSHA 10"], status: "Pending Award" },
  { id: crypto.randomUUID(), projectNumber: "P-1003", name: "Peachtree Retail", client: "Summit Retail Group", address: "", division: "Tilt", specificRequirements: ["Rigging"], status: "Scheduled" },
];

const startingAssignments = [];

const blankProject = {
  projectNumber: "",
  name: "",
  client: "",
  address: "",
  division: "Hardscape",
  specificRequirements: [],
  status: "Scheduled",
};

const blankAssignment = {
  projectId: "",
  projectManager: "",
  superintendent: "",
  fieldCoordinator: "",
  fieldEngineer: "",
  safety: "",
  crew1Id: "",
  crew2Id: "",
  crew3Id: "",
  crew4Id: "",
  mobilizations: [{ id: crypto.randomUUID(), start: "", durationWeeks: "", end: "" }],
};

const blankResource = {
  name: "",
  resourceType: "Superintendent",
  phone: "",
  email: "",
  homeDivision: "Hardscape",
  certifications: [],
  pto: [],
  status: "Active",
};

const blankCrew = {
  crewName: "",
  foremanName: "",
  specialty: [],
};

const zoomModes = ["Days", "Weeks", "Months", "Quarters", "Years"];

function toDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function addDays(date, days) { const result = new Date(date); result.setDate(result.getDate() + days); return result; }
function addMonths(date, months) { const result = new Date(date); result.setMonth(result.getMonth() + months); return result; }
function startOfWeek(date) { const result = new Date(date); const day = result.getDay(); result.setDate(result.getDate() - day); return result; }
function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function startOfQuarter(date) { const quarterMonth = Math.floor(date.getMonth() / 3) * 3; return new Date(date.getFullYear(), quarterMonth, 1); }
function startOfYear(date) { return new Date(date.getFullYear(), 0, 1); }
function daysBetween(start, end) { const startDate = start instanceof Date ? start : new Date(start); const endDate = end instanceof Date ? end : new Date(end); if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0; return Math.max(1, Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1); }
function formatDate(date) { if (!date) return "Not set"; const parsed = date instanceof Date ? date : new Date(date); if (Number.isNaN(parsed.getTime())) return "Not set"; return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
function formatTick(date, zoom) { if (zoom === "Days") return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }); if (zoom === "Weeks") return `Week of ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`; if (zoom === "Months") return date.toLocaleDateString(undefined, { month: "short", year: "numeric" }); if (zoom === "Quarters") return `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`; return String(date.getFullYear()); }

function loadStored(key, fallback) { try { const saved = localStorage.getItem(key); return saved ? JSON.parse(saved) : fallback; } catch { return fallback; } }
function loadStoredAny(keys, fallback) {
  for (const key of keys) {
    try {
      const saved = localStorage.getItem(key);
      if (saved) return JSON.parse(saved);
    } catch {
      // Keep checking older keys if one value is malformed.
    }
  }
  return fallback;
}
function toggleListValue(list, value) { return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]; }
function findProject(projects, projectId) { return projects.find((project) => project.id === projectId); }
function getCrewDisplayName(crew) {
  if (!crew) return "";
  return [crew.crewName, crew.foremanName].filter(Boolean).join(" - ");
}
function getAssignmentCrewIds(assignment) { return [assignment.crew1Id, assignment.crew2Id, assignment.crew3Id, assignment.crew4Id].filter(Boolean); }
function getAssignmentCrewDisplayNames(assignment, crews) {
  return getAssignmentCrewIds(assignment).map((id) => getCrewDisplayName(crews.find((crew) => crew.id === id))).filter(Boolean);
}
function getAssignmentPeopleLabel(assignment, crews = []) {
  return [assignment.superintendent, ...getAssignmentCrewDisplayNames(assignment, crews)].filter(Boolean).join(" • ");
}

function buildGanttItems(projects, assignments) {
  return assignments.flatMap((assignment) => {
    const project = findProject(projects, assignment.projectId);
    if (!project) return [];
    return (assignment.mobilizations || []).filter((mob) => mob.start && mob.end).map((mob, index) => ({
      id: `${assignment.id}-${mob.id}`,
      assignmentId: assignment.id,
      mobilizationId: mob.id,
      mobilizationNumber: index + 1,
      project,
      assignment,
      start: mob.start,
      end: mob.end,
    }));
  });
}

function buildTimeline(items, zoom) {
  const starts = items.map((item) => toDate(item.start)).filter(Boolean);
  const ends = items.map((item) => toDate(item.end)).filter(Boolean);
  let min = starts.length ? new Date(Math.min(...starts)) : new Date();
  let max = ends.length ? new Date(Math.max(...ends)) : addDays(new Date(), 30);
  if (zoom === "Days") { min = addDays(min, -3); max = addDays(max, 3); }
  if (zoom === "Weeks") { min = startOfWeek(addDays(min, -7)); max = addDays(max, 14); }
  if (zoom === "Months") { min = startOfMonth(addMonths(min, -1)); max = addMonths(max, 1); }
  if (zoom === "Quarters") { min = startOfQuarter(addMonths(min, -3)); max = addMonths(max, 3); }
  if (zoom === "Years") { min = startOfYear(min); max = addMonths(startOfYear(max), 12); }
  const ticks = [];
  let cursor = new Date(min);
  while (cursor <= max && ticks.length < 120) {
    ticks.push(new Date(cursor));
    if (zoom === "Days") cursor = addDays(cursor, 1);
    else if (zoom === "Weeks") cursor = addDays(cursor, 7);
    else if (zoom === "Months") cursor = addMonths(cursor, 1);
    else if (zoom === "Quarters") cursor = addMonths(cursor, 3);
    else cursor = addMonths(cursor, 12);
  }
  return { minDate: min, maxDate: max, totalDays: daysBetween(min, max), ticks };
}

function StatCard({ icon: Icon, label, value }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-3xl font-bold text-slate-900">{value}</p></div><div className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><Icon size={24} /></div></div></div>;
}

function MultiSelectFilter({ label, options, selected, setSelected }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><p className="mb-2 text-sm font-semibold text-slate-700">{label}</p><div className="flex flex-wrap gap-2">{options.map((option) => { const active = selected.includes(option); return <button key={option} onClick={() => setSelected((current) => toggleListValue(current, option))} className={`rounded-full px-3 py-1 text-xs font-semibold ${active ? "bg-emerald-700 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"}`}>{option}</button>; })}</div></div>;
}

function SearchableResourceSelect({ value, onChange, resources, resourceType, placeholder }) {
  const [query, setQuery] = useState(value || "");
  const [open, setOpen] = useState(false);
  useEffect(() => setQuery(value || ""), [value]);
  const filtered = resources.filter((resource) => (resourceType ? resource.resourceType === resourceType : true) && resource.name.toLowerCase().includes(query.toLowerCase()));
  return <div className="relative"><div className="flex items-center rounded-xl border border-slate-300 px-3 py-2 focus-within:border-emerald-600"><Search size={16} className="mr-2 text-slate-400" /><input className="w-full outline-none" value={query} placeholder={placeholder || "Search resource..."} onFocus={() => setOpen(true)} onChange={(e) => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); }} /></div>{open && <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">{filtered.length ? filtered.map((resource) => <button key={resource.id} type="button" onClick={() => { onChange(resource.name); setQuery(resource.name); setOpen(false); }} className="block w-full px-3 py-2 text-left hover:bg-emerald-50"><p className="font-semibold text-slate-800">{resource.name}</p><p className="text-xs text-slate-500">{resource.resourceType} • {resource.homeDivision}</p></button>) : <p className="px-3 py-2 text-sm text-slate-500">No matching resource</p>}</div>}</div>;
}

function SearchableProjectSelect({ value, onChange, projects }) {
  const current = findProject(projects, value);
  const [query, setQuery] = useState(current ? `${current.projectNumber} - ${current.name}` : "");
  const [open, setOpen] = useState(false);
  useEffect(() => { const selected = findProject(projects, value); setQuery(selected ? `${selected.projectNumber} - ${selected.name}` : ""); }, [value, projects]);
  const filtered = projects.filter((project) => `${project.projectNumber} ${project.name} ${project.client}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="relative"><div className="flex items-center rounded-xl border border-slate-300 px-3 py-2 focus-within:border-emerald-600"><Search size={16} className="mr-2 text-slate-400" /><input className="w-full outline-none" value={query} placeholder="Search project..." onFocus={() => setOpen(true)} onChange={(e) => { setQuery(e.target.value); onChange(""); setOpen(true); }} /></div>{open && <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">{filtered.length ? filtered.map((project) => <button key={project.id} type="button" onClick={() => { onChange(project.id); setQuery(`${project.projectNumber} - ${project.name}`); setOpen(false); }} className="block w-full px-3 py-2 text-left hover:bg-emerald-50"><p className="font-semibold text-slate-800">{project.projectNumber} - {project.name}</p><p className="text-xs text-slate-500">{project.client} • {project.division} • {project.status}</p></button>) : <p className="px-3 py-2 text-sm text-slate-500">No matching project</p>}</div>}</div>;
}

function SearchableCrewSelect({ value, onChange, crews }) {
  const current = crews.find((crew) => crew.id === value);
  const [query, setQuery] = useState(current ? getCrewDisplayName(current) : "");
  const [open, setOpen] = useState(false);
  useEffect(() => { const selected = crews.find((crew) => crew.id === value); setQuery(selected ? getCrewDisplayName(selected) : ""); }, [value, crews]);
  const filtered = crews.filter((crew) => `${crew.crewName} ${crew.foremanName} ${(crew.specialty || []).join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="relative"><div className="flex items-center rounded-xl border border-slate-300 px-3 py-2 focus-within:border-emerald-600"><Search size={16} className="mr-2 text-slate-400" /><input className="w-full outline-none" value={query} placeholder="Search crew..." onFocus={() => setOpen(true)} onChange={(e) => { setQuery(e.target.value); onChange(""); setOpen(true); }} /></div>{open && <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">{filtered.length ? filtered.map((crew) => <button key={crew.id} type="button" onClick={() => { onChange(crew.id); setQuery(getCrewDisplayName(crew)); setOpen(false); }} className="block w-full px-3 py-2 text-left hover:bg-emerald-50"><p className="font-semibold text-slate-800">{getCrewDisplayName(crew)}</p><p className="text-xs text-slate-500">{(crew.specialty || []).join(", ")}</p></button>) : <p className="px-3 py-2 text-sm text-slate-500">No matching crew</p>}</div>}</div>;
}

function CertificationPicker({ selected, onChange, certifications }) {
  return <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">{certifications.map((cert) => { const active = selected.includes(cert); return <button key={cert} type="button" onClick={() => onChange(toggleListValue(selected, cert))} className={`rounded-full px-3 py-1 text-xs font-semibold ${active ? "bg-emerald-700 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"}`}>{cert}</button>; })}</div>;
}

function ProjectForm({ form, setForm, onSave, onCancel, editing, certifications }) {
  function updateField(field, value) { setForm((current) => ({ ...current, [field]: value })); }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-xl"><div className="flex items-center justify-between border-b border-slate-200 p-5"><div><h2 className="text-xl font-bold text-slate-900">{editing ? "Edit Project" : "Add Project"}</h2><p className="text-sm text-slate-500">Project master information only. Assignments are made from the Dashboard.</p></div><button onClick={onCancel} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button></div><div className="grid gap-4 p-5 md:grid-cols-2"><label className="space-y-1"><span className="text-sm font-medium text-slate-700">Project Number</span><input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.projectNumber} onChange={(e) => updateField("projectNumber", e.target.value)} /></label><label className="space-y-1"><span className="text-sm font-medium text-slate-700">Project Name</span><input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.name} onChange={(e) => updateField("name", e.target.value)} /></label><label className="space-y-1"><span className="text-sm font-medium text-slate-700">Client</span><input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.client} onChange={(e) => updateField("client", e.target.value)} /></label><label className="space-y-1"><span className="text-sm font-medium text-slate-700">Division</span><select className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.division} onChange={(e) => updateField("division", e.target.value)}>{divisions.map((division) => <option key={division}>{division}</option>)}</select></label><label className="space-y-1 md:col-span-2"><span className="text-sm font-medium text-slate-700">Address</span><input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.address} onChange={(e) => updateField("address", e.target.value)} /></label><label className="space-y-1 md:col-span-2"><span className="text-sm font-medium text-slate-700">Specific Requirements / Certifications</span><CertificationPicker selected={form.specificRequirements || []} onChange={(value) => updateField("specificRequirements", value)} certifications={certifications} /></label><label className="space-y-1"><span className="text-sm font-medium text-slate-700">Status</span><select className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.status} onChange={(e) => updateField("status", e.target.value)}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label></div><div className="flex justify-end gap-3 border-t border-slate-200 p-5"><button onClick={onCancel} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50">Cancel</button><button onClick={onSave} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800">Save Project</button></div></div></div>;
}

function AssignmentForm({ form, setForm, onSave, onCancel, editing, resources, projects, crews }) {
  function updateField(field, value) { setForm((current) => ({ ...current, [field]: value })); }
  function calculateEndDateFromWeeks(startDate, durationWeeks) {
    if (!startDate || !durationWeeks) return "";
    const start = toDate(startDate);
    const weeks = Number(durationWeeks);
    if (!start || Number.isNaN(weeks) || weeks <= 0) return "";
    const end = addDays(start, Math.ceil(weeks * 7) - 1);
    return end.toISOString().slice(0, 10);
  }
  function updateMobilization(id, field, value) {
    setForm((current) => ({
      ...current,
      mobilizations: (current.mobilizations || []).map((mob) => {
        if (mob.id !== id) return mob;
        const updated = { ...mob, [field]: value };
        if (field === "start" || field === "durationWeeks") {
          const calculatedEnd = calculateEndDateFromWeeks(updated.start, updated.durationWeeks);
          if (calculatedEnd) updated.end = calculatedEnd;
        }
        return updated;
      })
    }));
  }
  function addMobilization() { setForm((current) => ({ ...current, mobilizations: [...(current.mobilizations || []), { id: crypto.randomUUID(), start: "", durationWeeks: "", end: "" }] })); }
  function removeMobilization(id) { setForm((current) => ({ ...current, mobilizations: (current.mobilizations || []).filter((mob) => mob.id !== id) })); }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white shadow-xl"><div className="flex items-center justify-between border-b border-slate-200 p-5"><div><h2 className="text-xl font-bold text-slate-900">{editing ? "Edit Assignment" : "Assign Project"}</h2><p className="text-sm text-slate-500">Select an existing project, assign resources, crews, and one or more mobilization date ranges.</p></div><button onClick={onCancel} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button></div><div className="grid gap-4 p-5 md:grid-cols-2"><label className="space-y-1 md:col-span-2"><span className="text-sm font-medium text-slate-700">Project</span><SearchableProjectSelect value={form.projectId} onChange={(value) => updateField("projectId", value)} projects={projects} /></label><label className="space-y-1"><span className="text-sm font-medium text-slate-700">Project Manager</span><SearchableResourceSelect value={form.projectManager} onChange={(value) => updateField("projectManager", value)} resources={resources} resourceType="Project Manager" placeholder="Search project manager..." /></label><label className="space-y-1"><span className="text-sm font-medium text-slate-700">Superintendent</span><SearchableResourceSelect value={form.superintendent} onChange={(value) => updateField("superintendent", value)} resources={resources} resourceType="Superintendent" placeholder="Search superintendent..." /></label><label className="space-y-1"><span className="text-sm font-medium text-slate-700">Field Coordinator</span><SearchableResourceSelect value={form.fieldCoordinator} onChange={(value) => updateField("fieldCoordinator", value)} resources={resources} resourceType="Field Coordinator" placeholder="Search field coordinator..." /></label><label className="space-y-1"><span className="text-sm font-medium text-slate-700">Field Engineer</span><SearchableResourceSelect value={form.fieldEngineer} onChange={(value) => updateField("fieldEngineer", value)} resources={resources} resourceType="Field Engineer" placeholder="Search field engineer..." /></label><label className="space-y-1"><span className="text-sm font-medium text-slate-700">Safety</span><SearchableResourceSelect value={form.safety} onChange={(value) => updateField("safety", value)} resources={resources} resourceType="Safety" placeholder="Search safety..." /></label><div />{[1, 2, 3, 4].map((number) => <label key={number} className="space-y-1"><span className="text-sm font-medium text-slate-700">Crew #{number}</span><SearchableCrewSelect value={form[`crew${number}Id`]} onChange={(value) => updateField(`crew${number}Id`, value)} crews={crews} /></label>) }<div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="font-bold text-slate-900">Mobilizations</h3><p className="text-sm text-slate-500">Use + to add additional start/end date ranges for remobilizations.</p></div><button onClick={addMobilization} type="button" className="flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white"><Plus size={16} /> Add Mobilization</button></div><div className="space-y-3">{(form.mobilizations || []).map((mob, index) => <div key={mob.id} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-[auto_1fr_1fr_1fr_auto]"><div className="flex items-center font-semibold text-slate-600">#{index + 1}</div><label className="space-y-1"><span className="text-xs font-medium text-slate-600">Start Date</span><input type="date" className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={mob.start} onChange={(e) => updateMobilization(mob.id, "start", e.target.value)} /></label><label className="space-y-1"><span className="text-xs font-medium text-slate-600">Duration / Weeks</span><input type="number" min="0" step="0.5" className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={mob.durationWeeks || ""} onChange={(e) => updateMobilization(mob.id, "durationWeeks", e.target.value)} placeholder="Weeks" /></label><label className="space-y-1"><span className="text-xs font-medium text-slate-600">End Date</span><input type="date" className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={mob.end} onChange={(e) => updateMobilization(mob.id, "end", e.target.value)} /></label><button type="button" onClick={() => removeMobilization(mob.id)} className="rounded-xl border border-red-200 px-3 py-2 font-medium text-red-700 hover:bg-red-50">Remove</button></div>)}</div></div></div><div className="flex justify-end gap-3 border-t border-slate-200 p-5"><button onClick={onCancel} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50">Cancel</button><button onClick={onSave} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800">Save Assignment</button></div></div></div>;
}

function ResourceForm({ form, setForm, certifications, onSave, onCancel, editing }) {
  const [ptoDraft, setPtoDraft] = useState({ ptoId: "", start: "", end: "" });
  function updateField(field, value) { setForm((current) => ({ ...current, [field]: value })); }
  function addPto() { if (!ptoDraft.ptoId || !ptoDraft.start || !ptoDraft.end) { alert("PTO ID, start date, and end date are required."); return; } setForm((current) => ({ ...current, pto: [...(current.pto || []), { ...ptoDraft, id: crypto.randomUUID() }] })); setPtoDraft({ ptoId: "", start: "", end: "" }); }
  function deletePto(id) { setForm((current) => ({ ...current, pto: (current.pto || []).filter((item) => item.id !== id) })); }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-xl"><div className="flex items-center justify-between border-b border-slate-200 p-5"><div><h2 className="text-xl font-bold text-slate-900">{editing ? "Edit Resource" : "Add Resource"}</h2><p className="text-sm text-slate-500">Create resource profile, role, certifications, and PTO records.</p></div><button onClick={onCancel} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button></div><div className="grid gap-4 p-5 md:grid-cols-2"><label className="space-y-1"><span className="text-sm font-medium text-slate-700">Name</span><input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.name} onChange={(e) => updateField("name", e.target.value)} /></label><label className="space-y-1"><span className="text-sm font-medium text-slate-700">Resource Type</span><select className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.resourceType} onChange={(e) => updateField("resourceType", e.target.value)}>{resourceTypes.map((type) => <option key={type}>{type}</option>)}</select></label><label className="space-y-1"><span className="text-sm font-medium text-slate-700">Home Division</span><select className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.homeDivision} onChange={(e) => updateField("homeDivision", e.target.value)}>{divisions.map((division) => <option key={division}>{division}</option>)}</select></label><label className="space-y-1"><span className="text-sm font-medium text-slate-700">Status</span><select className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.status} onChange={(e) => updateField("status", e.target.value)}><option>Active</option><option>Available</option><option>Inactive</option></select></label><label className="space-y-1"><span className="text-sm font-medium text-slate-700">Phone</span><input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.phone} onChange={(e) => updateField("phone", e.target.value)} /></label><label className="space-y-1"><span className="text-sm font-medium text-slate-700">Email</span><input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.email} onChange={(e) => updateField("email", e.target.value)} /></label></div><div className="border-t border-slate-200 p-5"><h3 className="font-bold text-slate-900">Certifications</h3><div className="mt-3"><CertificationPicker selected={form.certifications || []} onChange={(value) => updateField("certifications", value)} certifications={certifications} /></div></div><div className="border-t border-slate-200 p-5"><h3 className="font-bold text-slate-900">PTO</h3><div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]"><input placeholder="PTO ID" className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={ptoDraft.ptoId} onChange={(e) => setPtoDraft((current) => ({ ...current, ptoId: e.target.value }))} /><input type="date" className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={ptoDraft.start} onChange={(e) => setPtoDraft((current) => ({ ...current, start: e.target.value }))} /><input type="date" className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={ptoDraft.end} onChange={(e) => setPtoDraft((current) => ({ ...current, end: e.target.value }))} /><button onClick={addPto} className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white">Add PTO</button></div><div className="mt-4 overflow-hidden rounded-xl border border-slate-200"><table className="w-full text-left text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="p-3">PTO ID</th><th className="p-3">Start</th><th className="p-3">End</th><th className="p-3 text-right">Action</th></tr></thead><tbody>{(form.pto || []).map((pto) => <tr key={pto.id} className="border-t border-slate-200"><td className="p-3">{pto.ptoId}</td><td className="p-3">{formatDate(pto.start)}</td><td className="p-3">{formatDate(pto.end)}</td><td className="p-3 text-right"><button onClick={() => deletePto(pto.id)} className="text-red-700">Delete</button></td></tr>)}</tbody></table></div></div><div className="flex justify-end gap-3 border-t border-slate-200 p-5"><button onClick={onCancel} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50">Cancel</button><button onClick={onSave} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800">Save Resource</button></div></div></div>;
}

function CrewForm({ form, setForm, certifications, onSave, onCancel, editing }) {
  function updateField(field, value) { setForm((current) => ({ ...current, [field]: value })); }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-xl"><div className="flex items-center justify-between border-b border-slate-200 p-5"><div><h2 className="text-xl font-bold text-slate-900">{editing ? "Edit Crew" : "Add Crew"}</h2><p className="text-sm text-slate-500">Crew master information used by assignment dropdowns.</p></div><button onClick={onCancel} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button></div><div className="grid gap-4 p-5 md:grid-cols-2"><label className="space-y-1"><span className="text-sm font-medium text-slate-700">Crew Name</span><input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.crewName} onChange={(e) => updateField("crewName", e.target.value)} /></label><label className="space-y-1"><span className="text-sm font-medium text-slate-700">Foreman Name</span><input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.foremanName} onChange={(e) => updateField("foremanName", e.target.value)} /></label><label className="space-y-1 md:col-span-2"><span className="text-sm font-medium text-slate-700">Specialty</span><CertificationPicker selected={form.specialty || []} onChange={(value) => updateField("specialty", value)} certifications={certifications} /></label></div><div className="flex justify-end gap-3 border-t border-slate-200 p-5"><button onClick={onCancel} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50">Cancel</button><button onClick={onSave} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800">Save Crew</button></div></div></div>;
}

function GanttHeader({ timeline, zoom }) {
  return <div className="ml-[260px] min-w-[900px] border-b border-slate-200 pb-2"><div className="relative h-10">{timeline.ticks.map((tick, index) => { const left = ((daysBetween(timeline.minDate, tick) - 1) / timeline.totalDays) * 100; return <div key={`${tick.toISOString()}-${index}`} className="absolute top-0 h-10 border-l border-slate-200 pl-2 text-xs font-medium text-slate-500" style={{ left: `${left}%` }}>{formatTick(tick, zoom)}</div>; })}</div></div>;
}

function GanttSegmentBar({ item, timeline, label }) {
  const project = item.project;
  const start = toDate(item.start);
  const end = toDate(item.end);
  const offset = start ? daysBetween(timeline.minDate, start) - 1 : 0;
  const length = start && end ? daysBetween(start, end) : 1;
  const left = timeline.totalDays > 0 ? (offset / timeline.totalDays) * 100 : 0;
  const width = timeline.totalDays > 0 ? (length / timeline.totalDays) * 100 : 10;
  const colorClass = project.status === "Pending Award" ? pendingDivisionStyles[project.division] || "bg-slate-300" : divisionStyles[project.division] || "bg-slate-700";
  return <div className={`absolute top-1 h-9 overflow-hidden rounded-xl ${colorClass} px-3 text-xs font-semibold leading-9 text-white shadow-sm`} style={{ left: `${Math.max(0, left)}%`, width: `${Math.max(7, width)}%` }} title={label || project.name}>{label}</div>;
}

function ProjectGanttRow({ assignment, project, items, timeline, crews }) {
  const label = getAssignmentPeopleLabel(assignment, crews);
  return <div className="grid grid-cols-[240px_1fr] items-center gap-5"><button className="text-left"><div className="flex items-center gap-2"><span className={`h-3 w-3 rounded-full ${project.status === "Pending Award" ? pendingDivisionStyles[project.division] : divisionStyles[project.division] || "bg-slate-600"}`} /><p className="font-semibold text-slate-900 hover:text-emerald-700">{project.projectNumber ? `${project.projectNumber} - ` : ""}{project.name}</p></div><p className="mt-1 text-xs text-slate-500">{project.division} • {project.status} • {items.length} mobilization{items.length === 1 ? "" : "s"}</p></button><div className="relative h-11 rounded-xl bg-slate-100">{items.map((item) => <GanttSegmentBar key={item.id} item={item} timeline={timeline} label={label} />)}</div></div>;
}

function ResourceGanttRow({ resource, items, timeline }) {
  return <div className="grid grid-cols-[260px_1fr] items-center gap-5"><div className="text-left"><p className="font-semibold text-slate-900">{resource.name}</p><p className="mt-1 text-xs text-slate-500">{resource.resourceType} • {resource.homeDivision} • {items.length} assignment{items.length === 1 ? "" : "s"}</p></div><div className="relative h-11 rounded-xl bg-slate-100">{items.map((item) => <GanttSegmentBar key={`${resource.name}-${item.id}`} item={item} timeline={timeline} label={item.project.name} />)}</div></div>;
}

function getPeriodEnd(start, zoom) {
  if (zoom === "Days") return addDays(start, 1);
  if (zoom === "Weeks") return addDays(start, 7);
  if (zoom === "Months") return addMonths(start, 1);
  if (zoom === "Quarters") return addMonths(start, 3);
  return addMonths(start, 12);
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function countRequiredResources(assignment) {
  return [assignment.projectManager, assignment.superintendent, assignment.fieldCoordinator, assignment.fieldEngineer, assignment.safety, assignment.crew1Id, assignment.crew2Id, assignment.crew3Id, assignment.crew4Id].filter(Boolean).length;
}

function ResourceDemandChart({ items, timeline, zoom, totalResources }) {
  const periods = timeline.ticks.map((tick) => {
    const periodStart = tick;
    const periodEnd = getPeriodEnd(tick, zoom);
    const buckets = {};
    divisions.forEach((division) => {
      buckets[division] = { current: 0, pending: 0 };
    });

    items.forEach((item) => {
      const itemStart = toDate(item.start);
      const itemEnd = toDate(item.end);
      if (!itemStart || !itemEnd || !rangesOverlap(itemStart, addDays(itemEnd, 1), periodStart, periodEnd)) return;
      const count = 1;
      if (item.project.status === "Pending Award") buckets[item.project.division].pending += count;
      else if (item.project.status !== "Complete") buckets[item.project.division].current += count;
    });

    const required = divisions.reduce((sum, division) => sum + buckets[division].current + buckets[division].pending, 0);
    return { label: formatTick(tick, zoom), buckets, required };
  });

  const rawMaxValue = Math.max(totalResources, ...periods.map((period) => period.required), 1);
  const yAxisMax = Math.ceil(rawMaxValue / 5) * 5;
  const chartHeight = 240;
  const totalLineTopPx = chartHeight - (totalResources / yAxisMax) * chartHeight;
  const yTicks = Array.from({ length: 6 }, (_, index) => Math.round((yAxisMax / 5) * (5 - index)));

  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4"><h2 className="text-xl font-bold">Resource Demand Graph</h2><p className="text-sm text-slate-500">Y-axis is project count. One active project/mobilization equals 1. The red dashed line represents total filtered resources. Current work is shown by division color; Pending Award is stacked above in the lighter division shade.</p></div><div className="overflow-x-auto"><div className="relative min-w-[1160px] rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="grid grid-cols-[52px_1fr] gap-3"><div className="relative" style={{ height: `${chartHeight}px` }}>{yTicks.map((tick, index) => <div key={tick} className="absolute right-0 -translate-y-1/2 text-xs font-semibold text-slate-500" style={{ top: `${(index / 5) * 100}%` }}>{tick}</div>)}</div><div className="relative" style={{ height: `${chartHeight}px` }}><div className="pointer-events-none absolute left-0 right-0 z-30 border-t-4 border-dashed border-red-600" style={{ top: `${totalLineTopPx}px` }}><span className="absolute -top-7 right-0 rounded bg-red-600 px-2 py-1 text-xs font-bold text-white shadow">Total Resources: {totalResources}</span></div>{yTicks.map((tick, index) => <div key={`grid-${tick}`} className="absolute left-0 right-0 border-t border-slate-200" style={{ top: `${(index / 5) * 100}%` }} />)}<div className="relative z-10 flex h-full items-end gap-3 border-b border-l border-slate-300 pl-3 pr-3">{periods.map((period, index) => <div key={`${period.label}-${index}`} className="flex h-full min-w-20 flex-1 flex-col justify-end"><div className="flex w-full flex-col-reverse overflow-hidden rounded-t-lg border border-slate-200 bg-white" style={{ height: `${Math.min(chartHeight, (period.required / yAxisMax) * chartHeight)}px` }}>{divisions.map((division) => <React.Fragment key={division}><div className={divisionStyles[division]} style={{ height: `${(period.buckets[division].current / yAxisMax) * chartHeight}px` }} title={`${division} current: ${period.buckets[division].current}`} /> <div className={pendingDivisionStyles[division]} style={{ height: `${(period.buckets[division].pending / yAxisMax) * chartHeight}px` }} title={`${division} pending: ${period.buckets[division].pending}`} /></React.Fragment>)}</div><p className="mt-2 truncate text-center text-[10px] font-medium text-slate-500">{period.label}</p></div>)}</div></div></div><div className="mt-4 flex flex-wrap gap-3 text-xs font-semibold">{divisions.map((division) => <div key={division} className="flex items-center gap-2"><span className={`h-3 w-6 rounded-full ${divisionStyles[division]}`} /><span>{division} Current</span><span className={`ml-2 h-3 w-6 rounded-full ${pendingDivisionStyles[division]}`} /><span>{division} Pending</span></div>)}</div></div></div></section>;
}

export default function App() {
  const [projects, setProjects] = useState(() => loadStoredAny(PROJECTS_LEGACY_KEYS, startingProjects));
  const [assignments, setAssignments] = useState(() => loadStoredAny(ASSIGNMENTS_LEGACY_KEYS, startingAssignments));
  const [resources, setResources] = useState(() => loadStoredAny(RESOURCES_LEGACY_KEYS, startingResources));
  const [crews, setCrews] = useState(() => loadStoredAny(CREWS_LEGACY_KEYS, startingCrews));
  const [certifications, setCertifications] = useState(() => loadStoredAny(CERTIFICATIONS_LEGACY_KEYS, startingCertifications));
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showAssignmentForm, setShowAssignmentForm] = useState(false);
  const [showResourceForm, setShowResourceForm] = useState(false);
  const [showCrewForm, setShowCrewForm] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editingAssignmentId, setEditingAssignmentId] = useState(null);
  const [editingResourceId, setEditingResourceId] = useState(null);
  const [editingCrewId, setEditingCrewId] = useState(null);
  const [projectForm, setProjectForm] = useState(blankProject);
  const [assignmentForm, setAssignmentForm] = useState(blankAssignment);
  const [resourceForm, setResourceForm] = useState(blankResource);
  const [crewForm, setCrewForm] = useState(blankCrew);
  const [zoom, setZoom] = useState("Months");
  const [divisionFilter, setDivisionFilter] = useState([...divisions]);
  const [statusFilter, setStatusFilter] = useState([...statuses]);
  const [page, setPage] = useState("dashboard");
  const [showCertSettings, setShowCertSettings] = useState(false);
  const [newCertification, setNewCertification] = useState("");
  const [resourceTypeFilter, setResourceTypeFilter] = useState([...resourceTypes]);
  const [dashboardResourceTypeFilter, setDashboardResourceTypeFilter] = useState([...resourceTypes]);
  const [projectTabDivisionFilter, setProjectTabDivisionFilter] = useState([...divisions]);

  useEffect(() => localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects)), [projects]);
  useEffect(() => localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(assignments)), [assignments]);
  useEffect(() => localStorage.setItem(RESOURCES_KEY, JSON.stringify(resources)), [resources]);
  useEffect(() => localStorage.setItem(CREWS_KEY, JSON.stringify(crews)), [crews]);
  useEffect(() => localStorage.setItem(CERTIFICATIONS_KEY, JSON.stringify(certifications)), [certifications]);

  const ganttItems = buildGanttItems(projects, assignments);
  const assignmentMatchesDashboardResourceType = (assignment) => {
    const selectedResourceNames = resources
      .filter((resource) => dashboardResourceTypeFilter.includes(resource.resourceType))
      .map((resource) => resource.name);
    return [assignment.projectManager, assignment.superintendent, assignment.fieldCoordinator, assignment.fieldEngineer, assignment.safety]
      .filter(Boolean)
      .some((name) => selectedResourceNames.includes(name));
  };
  const visibleItems = ganttItems.filter((item) =>
    divisionFilter.includes(item.project.division) &&
    statusFilter.includes(item.project.status) &&
    assignmentMatchesDashboardResourceType(item.assignment)
  );
  const activeProjects = projects.filter((project) => project.status !== "Complete");
  const assignedCrewIds = [...new Set(assignments.flatMap((assignment) => getAssignmentCrewIds(assignment)).filter(Boolean))];
  const filteredResources = resources.filter((resource) => resourceTypeFilter.includes(resource.resourceType));
  const filteredProjectsForProjectTab = projects.filter((project) => projectTabDivisionFilter.includes(project.division));
  const timeline = useMemo(() => buildTimeline(visibleItems, zoom), [visibleItems, zoom]);
  const visibleAssignments = assignments.filter((assignment) => assignmentMatchesDashboardResourceType(assignment));
  const projectGanttRows = visibleAssignments.map((assignment) => {
    const project = findProject(projects, assignment.projectId);
    if (!project) return null;
    if (!divisionFilter.includes(project.division) || !statusFilter.includes(project.status)) return null;
    const items = visibleItems.filter((item) => item.assignmentId === assignment.id);
    if (!items.length) return null;
    return { assignment, project, items };
  }).filter(Boolean);
  const resourceGanttRows = resources.map((resource) => {
    const items = visibleItems.filter((item) => [item.assignment.projectManager, item.assignment.superintendent, item.assignment.fieldCoordinator, item.assignment.fieldEngineer, item.assignment.safety].includes(resource.name));
    if (!items.length) return null;
    return { resource, items };
  }).filter(Boolean);

  function openAddProjectForm() { setEditingProjectId(null); setProjectForm(blankProject); setShowProjectForm(true); }
  function openEditProjectForm(project) { setEditingProjectId(project.id); setProjectForm({ ...blankProject, ...project }); setShowProjectForm(true); }
  function saveProject() { if (!projectForm.name.trim()) { alert("Project name is required."); return; } if (editingProjectId) setProjects((current) => current.map((project) => (project.id === editingProjectId ? { ...projectForm, id: editingProjectId } : project))); else setProjects((current) => [{ ...projectForm, id: crypto.randomUUID() }, ...current]); setShowProjectForm(false); setEditingProjectId(null); setProjectForm(blankProject); }
  function deleteProject(id) { const project = projects.find((item) => item.id === id); if (!confirm(`Delete ${project?.name || "this project"}? This will also remove related assignments.`)) return; setProjects((current) => current.filter((project) => project.id !== id)); setAssignments((current) => current.filter((assignment) => assignment.projectId !== id)); }

  function openAddAssignmentForm() { setEditingAssignmentId(null); setAssignmentForm({ ...blankAssignment, mobilizations: [{ id: crypto.randomUUID(), start: "", durationWeeks: "", end: "" }] }); setShowAssignmentForm(true); }
  function openEditAssignmentForm(assignment) { setEditingAssignmentId(assignment.id); setAssignmentForm({ ...blankAssignment, ...assignment, mobilizations: assignment.mobilizations?.length ? assignment.mobilizations : [{ id: crypto.randomUUID(), start: "", durationWeeks: "", end: "" }] }); setShowAssignmentForm(true); }
  function saveAssignment() { if (!assignmentForm.projectId) { alert("Project is required."); return; } if (!(assignmentForm.mobilizations || []).some((mob) => mob.start && mob.end)) { alert("At least one mobilization with start and end date is required."); return; } if (editingAssignmentId) setAssignments((current) => current.map((assignment) => (assignment.id === editingAssignmentId ? { ...assignmentForm, id: editingAssignmentId } : assignment))); else setAssignments((current) => [{ ...assignmentForm, id: crypto.randomUUID() }, ...current]); setShowAssignmentForm(false); setEditingAssignmentId(null); setAssignmentForm(blankAssignment); }
  function deleteAssignment(id) { const assignment = assignments.find((item) => item.id === id); const project = assignment ? findProject(projects, assignment.projectId) : null; if (!confirm(`Delete assignment for ${project?.name || "this project"}?`)) return; setAssignments((current) => current.filter((assignment) => assignment.id !== id)); }

  function openAddResourceForm() { setEditingResourceId(null); setResourceForm(blankResource); setShowResourceForm(true); }
  function openEditResourceForm(resource) { setEditingResourceId(resource.id); setResourceForm({ ...blankResource, ...resource }); setShowResourceForm(true); }
  function saveResource() { if (!resourceForm.name.trim()) { alert("Resource name is required."); return; } if (editingResourceId) setResources((current) => current.map((resource) => (resource.id === editingResourceId ? { ...resourceForm, id: editingResourceId } : resource))); else setResources((current) => [{ ...resourceForm, id: crypto.randomUUID() }, ...current]); setShowResourceForm(false); setEditingResourceId(null); setResourceForm(blankResource); }
  function deleteResource(id) { const resource = resources.find((item) => item.id === id); if (!confirm(`Delete ${resource?.name || "this resource"}?`)) return; setResources((current) => current.filter((item) => item.id !== id)); }
  function openAddCrewForm() { setEditingCrewId(null); setCrewForm(blankCrew); setShowCrewForm(true); }
  function openEditCrewForm(crew) { setEditingCrewId(crew.id); setCrewForm({ ...blankCrew, ...crew }); setShowCrewForm(true); }
  function saveCrew() { if (!crewForm.crewName.trim()) { alert("Crew name is required."); return; } if (editingCrewId) setCrews((current) => current.map((crew) => (crew.id === editingCrewId ? { ...crewForm, id: editingCrewId } : crew))); else setCrews((current) => [{ ...crewForm, id: crypto.randomUUID() }, ...current]); setShowCrewForm(false); setEditingCrewId(null); setCrewForm(blankCrew); }
  function deleteCrew(id) { const crew = crews.find((item) => item.id === id); if (!confirm(`Delete ${crew?.crewName || "this crew"}?`)) return; setCrews((current) => current.filter((item) => item.id !== id)); }
  function addCertification() { const cert = newCertification.trim(); if (!cert) return; if (!certifications.includes(cert)) setCertifications((current) => [...current, cert]); setNewCertification(""); }
  function deleteCertification(cert) { setCertifications((current) => current.filter((item) => item !== cert)); setResources((current) => current.map((resource) => ({ ...resource, certifications: (resource.certifications || []).filter((item) => item !== cert) }))); setProjects((current) => current.map((project) => ({ ...project, specificRequirements: (project.specificRequirements || []).filter((item) => item !== cert) }))); }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <div className="h-1 w-24 rounded-full bg-emerald-700" />
            <h1 className="mt-3 text-3xl font-bold tracking-tight">GGC Resource Planning</h1>
            <p className="mt-1 text-slate-500">Project master list, resource assignments, and mobilization scheduling.</p>
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <button onClick={() => setPage("dashboard")} className={`rounded-xl px-4 py-3 font-semibold shadow-sm ${page === "dashboard" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>Dashboard</button>
            <button onClick={() => setPage("projects")} className={`rounded-xl px-4 py-3 font-semibold shadow-sm ${page === "projects" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>Projects</button>
            <button onClick={() => setPage("resources")} className={`rounded-xl px-4 py-3 font-semibold shadow-sm ${page === "resources" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>Resources</button>
            <button onClick={() => setPage("crews")} className={`rounded-xl px-4 py-3 font-semibold shadow-sm ${page === "crews" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>Crews</button>
            {page === "dashboard" && <button onClick={openAddAssignmentForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white shadow-sm hover:bg-emerald-800"><ClipboardCheck size={18} /> Assign</button>}
            {page === "projects" && <button onClick={openAddProjectForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white shadow-sm hover:bg-emerald-800"><Plus size={18} /> Add Project</button>}
            {page === "resources" && <button onClick={openAddResourceForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white shadow-sm hover:bg-emerald-800"><Plus size={18} /> Add Resource</button>}
            {page === "crews" && <button onClick={openAddCrewForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white shadow-sm hover:bg-emerald-800"><Plus size={18} /> Add Crew</button>}
          </div>
        </div>
      </header>

      {page === "crews" && (
        <section className="mx-auto max-w-7xl space-y-6 px-6 py-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-2xl font-bold">Crews</h2>
                <p className="text-sm text-slate-500">Master crew list used by assignment crew dropdowns.</p>
              </div>
              <button onClick={openAddCrewForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800"><Plus size={17} /> Add Crew</button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[850px] text-left text-sm">
                <thead className="bg-slate-100 text-slate-600">
                  <tr><th className="p-3">Crew Name</th><th className="p-3">Foreman Name</th><th className="p-3">Specialty</th><th className="p-3">Current Assignments</th><th className="p-3 text-right">Actions</th></tr>
                </thead>
                <tbody>
                  {crews.map((crew) => (
                    <tr key={crew.id} className="border-t border-slate-200 align-top">
                      <td className="p-3 font-medium">{crew.crewName}</td>
                      <td className="p-3">{crew.foremanName}</td>
                      <td className="p-3">{(crew.specialty || []).join(", ")}</td>
                      <td className="p-3">{assignments.filter((a) => getAssignmentCrewIds(a).includes(crew.id)).map((a) => findProject(projects, a.projectId)?.name).filter(Boolean).join(", ")}</td>
                      <td className="p-3 text-right"><button onClick={() => openEditCrewForm(crew)} className="mr-2 rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50">Edit</button><button onClick={() => deleteCrew(crew.id)} className="rounded-lg border border-red-200 px-3 py-1.5 font-medium text-red-700 hover:bg-red-50">Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      )}

      {page === "resources" && (
        <section className="mx-auto max-w-7xl space-y-6 px-6 py-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div><h2 className="text-2xl font-bold">Resources</h2><p className="text-sm text-slate-500">Master resource list used by the Dashboard assignment dropdowns.</p></div>
              <div className="flex flex-wrap gap-3"><button onClick={() => setShowCertSettings((current) => !current)} className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"><Settings size={17} /> Certification Settings</button><button onClick={openAddResourceForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800"><Plus size={17} /> Add Resource</button></div>
            </div>
            {showCertSettings && <div className="mb-5 rounded-2xl border border-emerald-100 bg-emerald-50 p-4"><h3 className="font-bold text-slate-900">Saved Certification Selections</h3><div className="mt-3 flex gap-2"><input value={newCertification} onChange={(e) => setNewCertification(e.target.value)} placeholder="Add certification" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none focus:border-emerald-600" /><button onClick={addCertification} className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white">Add</button></div><div className="mt-3 flex flex-wrap gap-2">{certifications.map((cert) => <span key={cert} className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">{cert}<button onClick={() => deleteCertification(cert)} className="text-red-600">×</button></span>)}</div></div>}
            <div className="mb-4"><MultiSelectFilter label="Resource Type Filter" options={resourceTypes} selected={resourceTypeFilter} setSelected={setResourceTypeFilter} /></div>
            <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[1150px] text-left text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="p-3">Name</th><th className="p-3">Resource Type</th><th className="p-3">Home Division</th><th className="p-3">Phone</th><th className="p-3">Email</th><th className="p-3">Certifications</th><th className="p-3">PTO</th><th className="p-3">Assigned Projects</th><th className="p-3 text-right">Actions</th></tr></thead><tbody>{filteredResources.map((resource) => <tr key={resource.id} className="border-t border-slate-200 align-top"><td className="p-3 font-medium">{resource.name}</td><td className="p-3">{resource.resourceType}</td><td className="p-3">{resource.homeDivision}</td><td className="p-3">{resource.phone}</td><td className="p-3">{resource.email}</td><td className="p-3">{(resource.certifications || []).join(", ")}</td><td className="p-3">{(resource.pto || []).map((pto) => `${pto.ptoId}: ${formatDate(pto.start)} - ${formatDate(pto.end)}`).join("; ")}</td><td className="p-3">{assignments.filter((a) => [a.projectManager, a.superintendent, a.fieldCoordinator, a.fieldEngineer, a.safety].includes(resource.name)).map((a) => findProject(projects, a.projectId)?.name).filter(Boolean).join(", ")}</td><td className="p-3 text-right"><button onClick={() => openEditResourceForm(resource)} className="mr-2 rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50">Edit</button><button onClick={() => deleteResource(resource.id)} className="rounded-lg border border-red-200 px-3 py-1.5 font-medium text-red-700 hover:bg-red-50">Delete</button></td></tr>)}</tbody></table></div>
          </section>
        </section>
      )}

      {page === "projects" && (
        <section className="mx-auto max-w-7xl space-y-6 px-6 py-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><div><h2 className="text-2xl font-bold">Projects</h2><p className="text-sm text-slate-500">Create and edit projects here only. Resource assignments happen on the Dashboard.</p></div><button onClick={openAddProjectForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800"><Plus size={17} /> Add Project</button></div>
            <div className="mb-4"><MultiSelectFilter label="Division Filter" options={divisions} selected={projectTabDivisionFilter} setSelected={setProjectTabDivisionFilter} /></div>
            <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="p-3">Project #</th><th className="p-3">Project Name</th><th className="p-3">Client</th><th className="p-3">Address</th><th className="p-3">Division</th><th className="p-3">Requirements</th><th className="p-3">Status</th><th className="p-3 text-right">Actions</th></tr></thead><tbody>{filteredProjectsForProjectTab.map((project) => <tr key={project.id} className="border-t border-slate-200 align-top"><td className="p-3 font-medium">{project.projectNumber}</td><td className="p-3 font-medium">{project.name}</td><td className="p-3">{project.client}</td><td className="p-3">{project.address}</td><td className="p-3">{project.division}</td><td className="p-3">{(project.specificRequirements || []).join(", ")}</td><td className="p-3">{project.status}</td><td className="p-3 text-right"><button onClick={() => openEditProjectForm(project)} className="mr-2 rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50">Edit</button><button onClick={() => deleteProject(project.id)} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 font-medium text-red-700 hover:bg-red-50"><Trash2 size={14} /> Delete</button></td></tr>)}</tbody></table></div>
          </section>
        </section>
      )}

      {page === "dashboard" && (
        <section className="mx-auto max-w-7xl space-y-6 px-6 py-6">
          <div className="grid gap-4 md:grid-cols-4"><StatCard icon={BriefcaseBusiness} label="Total Projects" value={projects.length} /><StatCard icon={ClipboardCheck} label="Assignments" value={assignments.length} /><StatCard icon={Users} label="Resources" value={resources.length} /><StatCard icon={FolderKanban} label="Crews" value={crews.length} /></div>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><div><h2 className="text-xl font-bold">Project Assignment Gantt View</h2><p className="text-sm text-slate-500">Each project assignment is one row. Multiple mobilizations appear on that same project row.</p></div><div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><ZoomIn size={16} className="text-slate-500" /><span className="text-sm font-medium text-slate-700">Zoom</span><select value={zoom} onChange={(e) => setZoom(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-emerald-600">{zoomModes.map((mode) => <option key={mode}>{mode}</option>)}</select></div></div><div className="mb-4 grid gap-3 lg:grid-cols-3"><MultiSelectFilter label="Division Filter" options={divisions} selected={divisionFilter} setSelected={setDivisionFilter} /><MultiSelectFilter label="Status Filter" options={statuses} selected={statusFilter} setSelected={setStatusFilter} /><MultiSelectFilter label="Resource Type Filter" options={resourceTypes} selected={dashboardResourceTypeFilter} setSelected={setDashboardResourceTypeFilter} /></div><div className="mb-4 flex flex-wrap gap-3 text-xs font-semibold">{divisions.map((division) => <div key={division} className="flex items-center gap-2"><span className={`h-3 w-8 rounded-full ${divisionStyles[division]}`} /><span className="text-slate-600">{division}</span></div>)}<div className="text-slate-400">Pending Award uses lighter shade</div></div><div className="overflow-x-auto rounded-xl border border-slate-200 p-4"><GanttHeader timeline={timeline} zoom={zoom} /><div className="mt-3 min-w-[1160px] space-y-3">{projectGanttRows.map((row) => <button key={row.assignment.id} onClick={() => openEditAssignmentForm(row.assignment)} className="block w-full text-left"><ProjectGanttRow assignment={row.assignment} project={row.project} items={row.items} timeline={timeline} crews={crews} /></button>)}</div></div></section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4"><h2 className="text-xl font-bold">Resource Gantt View</h2><p className="text-sm text-slate-500">Rows are resources. Bars show the assigned project name for each mobilization.</p></div><div className="overflow-x-auto rounded-xl border border-slate-200 p-4"><GanttHeader timeline={timeline} zoom={zoom} /><div className="mt-3 min-w-[1160px] space-y-3">{resourceGanttRows.map((row) => <ResourceGanttRow key={row.resource.id} resource={row.resource} items={row.items} timeline={timeline} />)}</div></div></section>
          <ResourceDemandChart items={visibleItems} timeline={timeline} zoom={zoom} totalResources={resources.filter((resource) => dashboardResourceTypeFilter.includes(resource.resourceType)).length} />
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-xl font-bold">Assignments</h2><p className="text-sm text-slate-500">Assign existing projects to resources and crews.</p></div><button onClick={openAddAssignmentForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800"><ClipboardCheck size={17} /> Assign</button></div><div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[1250px] text-left text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="p-3">Project</th><th className="p-3">PM</th><th className="p-3">Superintendent</th><th className="p-3">Field Coordinator</th><th className="p-3">Field Engineer</th><th className="p-3">Safety</th><th className="p-3">Crews</th><th className="p-3">Mobilizations</th><th className="p-3 text-right">Actions</th></tr></thead><tbody>{visibleAssignments.map((assignment) => { const project = findProject(projects, assignment.projectId); return <tr key={assignment.id} className="border-t border-slate-200 align-top"><td className="p-3 font-medium">{project ? `${project.projectNumber} - ${project.name}` : "Missing project"}</td><td className="p-3">{assignment.projectManager}</td><td className="p-3">{assignment.superintendent}</td><td className="p-3">{assignment.fieldCoordinator}</td><td className="p-3">{assignment.fieldEngineer}</td><td className="p-3">{assignment.safety}</td><td className="p-3">{getAssignmentCrewDisplayNames(assignment, crews).join(", ")}</td><td className="p-3">{(assignment.mobilizations || []).map((mob, index) => `#${index + 1}: ${formatDate(mob.start)} - ${formatDate(mob.end)}`).join("; ")}</td><td className="p-3 text-right"><button onClick={() => openEditAssignmentForm(assignment)} className="mr-2 rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50">Edit</button><button onClick={() => deleteAssignment(assignment.id)} className="rounded-lg border border-red-200 px-3 py-1.5 font-medium text-red-700 hover:bg-red-50">Delete</button></td></tr>; })}</tbody></table></div></section>
        </section>
      )}

      {showProjectForm && <ProjectForm form={projectForm} setForm={setProjectForm} onSave={saveProject} onCancel={() => setShowProjectForm(false)} editing={Boolean(editingProjectId)} certifications={certifications} />}
      {showAssignmentForm && <AssignmentForm form={assignmentForm} setForm={setAssignmentForm} onSave={saveAssignment} onCancel={() => setShowAssignmentForm(false)} editing={Boolean(editingAssignmentId)} resources={resources} projects={projects} crews={crews} />}
      {showResourceForm && <ResourceForm form={resourceForm} setForm={setResourceForm} certifications={certifications} onSave={saveResource} onCancel={() => setShowResourceForm(false)} editing={Boolean(editingResourceId)} />}
      {showCrewForm && <CrewForm form={crewForm} setForm={setCrewForm} certifications={certifications} onSave={saveCrew} onCancel={() => setShowCrewForm(false)} editing={Boolean(editingCrewId)} />}
    </main>
  );
}
