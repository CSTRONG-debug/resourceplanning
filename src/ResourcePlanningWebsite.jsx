import React, { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, CalendarDays, Users, BriefcaseBusiness, X, ZoomIn, Settings, Search, FolderKanban, ClipboardCheck } from "lucide-react";
import { supabase } from "./lib/supabase";

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
const resourceTypes = ["Project Manager", "General Superintendent", "Superintendent", "Field Coordinator", "Field Engineer", "Safety"];
const defaultDashboardResourceTypes = resourceTypes.filter((type) => type !== "Project Manager");

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

const divisionSvgColors = {
  Hardscape: "#047857",
  Commercial: "#1d4ed8",
  Industrial: "#ea580c",
  Tilt: "#7e22ce",
};

const pendingDivisionSvgColors = {
  Hardscape: "#6ee7b7",
  Commercial: "#93c5fd",
  Industrial: "#fdba74",
  Tilt: "#d8b4fe",
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

function getTimelineWindow(zoom) {
  const today = new Date();
  const start = startOfWeek(today);
  let end;

  if (zoom === "Days") end = addDays(start, 15);
  else if (zoom === "Weeks") end = addDays(start, 6 * 7);
  else if (zoom === "Months") end = addMonths(start, 6);
  else if (zoom === "Quarters") end = addMonths(start, 8 * 3);
  else end = addMonths(start, 4 * 12);

  return { start, end, today };
}

function buildTimeline(items, zoom) {
  const window = getTimelineWindow(zoom);
  const min = window.start;
  const max = window.end;
  const ticks = [];
  let cursor = new Date(min);

  while (cursor <= max && ticks.length < 160) {
    ticks.push(new Date(cursor));
    if (zoom === "Days") cursor = addDays(cursor, 1);
    else if (zoom === "Weeks") cursor = addDays(cursor, 7);
    else if (zoom === "Months") cursor = addMonths(cursor, 1);
    else if (zoom === "Quarters") cursor = addMonths(cursor, 3);
    else cursor = addMonths(cursor, 12);
  }

  return { minDate: min, maxDate: max, currentDate: window.today, totalDays: daysBetween(min, max), ticks };
}

function itemOverlapsTimeline(startValue, endValue, timeline) {
  const start = toDate(startValue);
  const end = toDate(endValue);
  if (!start || !end) return false;
  return rangesOverlap(start, addDays(end, 1), timeline.minDate, addDays(timeline.maxDate, 1));
}

function timelinePercent(dateValue, timeline) {
  const date = dateValue instanceof Date ? dateValue : toDate(dateValue);
  if (!date) return 0;
  const startMs = timeline.minDate.getTime();
  const endMs = timeline.maxDate.getTime();
  const dateMs = date.getTime();
  if (endMs === startMs) return 0;
  return ((dateMs - startMs) / (endMs - startMs)) * 100;
}

function timelineSpanPercent(startValue, endValue, timeline) {
  const start = toDate(startValue);
  const end = toDate(endValue);
  if (!start || !end) return { left: 0, width: 0 };
  const endExclusive = addDays(end, 1);
  const rawLeft = timelinePercent(start, timeline);
  const rawRight = timelinePercent(endExclusive, timeline);
  const left = Math.max(0, Math.min(100, rawLeft));
  const right = Math.max(0, Math.min(100, rawRight));
  return { left, width: Math.max(1, right - left) };
}

function StatCard({ icon: Icon, label, value }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-3xl font-bold text-slate-900">{value}</p></div><div className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><Icon size={24} /></div></div></div>;
}

function MultiSelectFilter({ label, options, selected, setSelected, labels = {} }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><p className="mb-2 text-sm font-semibold text-slate-700">{label}</p><div className="flex flex-wrap gap-2">{options.map((option) => { const active = selected.includes(option); return <button key={option} onClick={() => setSelected((current) => toggleListValue(current, option))} className={`rounded-full px-3 py-1 text-xs font-semibold ${active ? "bg-emerald-700 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"}`}>{labels[option] || option}</button>; })}</div></div>;
}

function SearchableMultiSelect({ label, options, selected, setSelected, getLabel }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const filtered = options.filter((option) => getLabel(option).toLowerCase().includes(query.toLowerCase()));

  return <div className="relative rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><p className="mb-2 text-sm font-semibold text-slate-700">{label}</p><div className="flex flex-wrap gap-2 mb-2">{selected.map((value) => { const option = options.find((item) => item.value === value); if (!option) return null; return <span key={value} className="inline-flex items-center gap-2 rounded-full bg-emerald-700 px-3 py-1 text-xs font-semibold text-white">{getLabel(option)}<button type="button" onClick={() => setSelected((current) => current.filter((item) => item !== value))}>×</button></span>; })}</div><div className="flex items-center rounded-xl border border-slate-300 bg-white px-3 py-2 focus-within:border-emerald-600"><Search size={16} className="mr-2 text-slate-400" /><input className="w-full bg-transparent outline-none" value={query} placeholder="Search and select..." onFocus={() => setOpen(true)} onChange={(e) => { setQuery(e.target.value); setOpen(true); }} /></div>{open && <div className="absolute left-3 right-3 z-50 mt-1 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">{filtered.length ? filtered.map((option) => { const active = selected.includes(option.value); return <button key={option.value} type="button" onClick={() => { setSelected((current) => toggleListValue(current, option.value)); setQuery(""); setOpen(true); }} className={`block w-full px-3 py-2 text-left hover:bg-emerald-50 ${active ? "bg-emerald-50" : ""}`}><p className="font-semibold text-slate-800">{getLabel(option)}</p>{option.subLabel && <p className="text-xs text-slate-500">{option.subLabel}</p>}</button>; }) : <p className="px-3 py-2 text-sm text-slate-500">No matching options</p>}<button type="button" onClick={() => setOpen(false)} className="block w-full border-t border-slate-200 px-3 py-2 text-center text-sm font-semibold text-slate-600 hover:bg-slate-50">Close</button></div>}</div>;
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
  const currentLeft = timelinePercent(timeline.currentDate, timeline);
  return <div className="ml-[260px] min-w-[900px] border-b border-slate-200 pb-2"><div className="relative h-10">{currentLeft >= 0 && currentLeft <= 100 && <div className="absolute top-0 z-20 h-10 border-l-4 border-dashed border-red-600" style={{ left: `${currentLeft}%` }}><span className="ml-1 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">Today</span></div>}{timeline.ticks.map((tick, index) => { const left = timelinePercent(tick, timeline); return <div key={`${tick.toISOString()}-${index}`} className="absolute top-0 h-10 border-l border-slate-200 pl-2 text-xs font-medium text-slate-500" style={{ left: `${left}%` }}>{formatTick(tick, zoom)}</div>; })}</div></div>;
}

function GanttSegmentBar({ item, timeline, label, conflict = false }) {
  const project = item.project;
  const colorClass = project.status === "Pending Award" ? pendingDivisionStyles[project.division] || "bg-slate-300" : divisionStyles[project.division] || "bg-slate-700";
  const { left, width } = timelineSpanPercent(item.start, item.end, timeline);
  const conflictStyle = conflict ? {
    border: "2px solid #dc2626",
    backgroundImage: "repeating-linear-gradient(135deg, transparent 0 8px, rgba(220,38,38,.95) 8px 10px)",
    backgroundSize: "14px 14px",
  } : {};
  return <div className={`absolute top-1 h-9 overflow-hidden rounded-xl ${colorClass} px-3 text-xs font-semibold leading-9 text-white shadow-sm`} style={{ left: `${left}%`, width: `${Math.max(2, width)}%`, ...conflictStyle }} title={conflict ? `${label || project.name} - conflict` : label || project.name}><span className={conflict ? "rounded bg-white/90 px-1.5 py-0.5 font-bold text-red-700" : ""}>{label}</span>{conflict && <span className="ml-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white">conflict</span>}</div>;
}

function PtoOverlayBar({ pto, timeline }) {
  const { left, width } = timelineSpanPercent(pto.start, pto.end, timeline);
  return <div className="absolute top-0 z-20 h-11 overflow-hidden rounded-xl border-2 border-black bg-white/70 px-3 text-xs font-bold leading-10 text-black shadow" style={{ left: `${left}%`, width: `${Math.max(2, width)}%`, backgroundImage: "repeating-linear-gradient(135deg, transparent 0 8px, rgba(0,0,0,.95) 8px 10px)", backgroundSize: "14px 14px" }} title={`PTO ${pto.ptoId || ""}: ${formatDate(pto.start)} - ${formatDate(pto.end)}`}>PTO {pto.ptoId || ""}</div>;
}

function ProjectGanttRow({ assignment, project, items, timeline, crews }) {
  const label = getAssignmentPeopleLabel(assignment, crews);
  return <div className="grid grid-cols-[240px_1fr] items-center gap-5"><button className="text-left"><div className="flex items-center gap-2"><span className={`h-3 w-3 rounded-full ${project.status === "Pending Award" ? pendingDivisionStyles[project.division] : divisionStyles[project.division] || "bg-slate-600"}`} /><p className="font-semibold text-slate-900 hover:text-emerald-700">{project.projectNumber ? `${project.projectNumber} - ` : ""}{project.name}</p></div><p className="mt-1 text-xs text-slate-500">{project.division} • {project.status} • {items.length} mobilization{items.length === 1 ? "" : "s"}</p></button><div className="relative h-11 rounded-xl bg-slate-100">{items.map((item) => <GanttSegmentBar key={item.id} item={item} timeline={timeline} label={label} />)}</div></div>;
}

function ResourceGanttRow({ resource, items, timeline, onResourceClick }) {
  const ptoItems = (resource.pto || []).filter((pto) => pto.start && pto.end);
  const sortedItems = [...items].sort((a, b) => new Date(a.start) - new Date(b.start));
  const conflictIds = new Set();

  sortedItems.forEach((item, index) => {
    const itemStart = toDate(item.start);
    const itemEnd = toDate(item.end);
    if (!itemStart || !itemEnd) return;
    const hasEarlierOverlap = sortedItems.slice(0, index).some((previous) => {
      const previousStart = toDate(previous.start);
      const previousEnd = toDate(previous.end);
      if (!previousStart || !previousEnd) return false;
      return rangesOverlap(itemStart, addDays(itemEnd, 1), previousStart, addDays(previousEnd, 1));
    });
    if (hasEarlierOverlap) conflictIds.add(item.id);
  });

  return <div className="grid grid-cols-[260px_1fr] items-center gap-5"><div className="text-left"><button onClick={() => onResourceClick?.(resource)} className="font-semibold text-slate-900 hover:text-emerald-700">{resource.name}</button><p className="mt-1 text-xs text-slate-500">{resource.resourceType} • {resource.homeDivision} • {items.length} assignment{items.length === 1 ? "" : "s"}{ptoItems.length ? ` • ${ptoItems.length} PTO` : ""}</p></div><div className="relative h-11 rounded-xl bg-slate-100">{sortedItems.map((item) => <GanttSegmentBar key={`${resource.name}-${item.id}`} item={item} timeline={timeline} label={item.project.name} conflict={conflictIds.has(item.id)} />)}{ptoItems.map((pto) => <PtoOverlayBar key={`${resource.id}-${pto.id || pto.ptoId}`} pto={pto} timeline={timeline} />)}</div></div>;
}

function CrewGanttRow({ crew, items, timeline }) {
  const sortedItems = [...items].sort((a, b) => new Date(a.start) - new Date(b.start));
  const lanes = [];

  sortedItems.forEach((item) => {
    const start = toDate(item.start);
    const end = toDate(item.end);
    let laneIndex = lanes.findIndex((lane) => !lane.some((placed) => rangesOverlap(start, addDays(end, 1), toDate(placed.start), addDays(toDate(placed.end), 1))));
    if (laneIndex === -1) {
      laneIndex = lanes.length;
      lanes.push([]);
    }
    lanes[laneIndex].push(item);
  });

  return <div className="grid grid-cols-[260px_1fr] items-start gap-5"><div className="text-left"><p className="font-semibold text-slate-900">{getCrewDisplayName(crew)}</p><p className="mt-1 text-xs text-slate-500">{(crew.specialty || []).join(", ") || "No specialty"} • {items.length} assignment{items.length === 1 ? "" : "s"}</p></div><div className="relative rounded-xl bg-slate-100" style={{ height: `${Math.max(48, lanes.length * 48)}px` }}>{lanes.map((lane, laneIndex) => lane.map((item) => { const span = timelineSpanPercent(item.start, item.end, timeline); const colorClass = item.project.status === "Pending Award" ? pendingDivisionStyles[item.project.division] : divisionStyles[item.project.division]; return <div key={`${crew.id}-${item.id}`} className={`absolute h-9 overflow-hidden rounded-xl px-3 text-xs font-semibold leading-9 text-white shadow-sm ${colorClass || "bg-slate-700"}`} style={{ left: `${span.left}%`, width: `${Math.max(2, span.width)}%`, top: `${laneIndex * 48 + 5}px` }}>{item.project.name}</div>; }))}</div></div>;
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

function ResourceDemandChart({ items, timeline, zoom, totalResources, onExportPdf, enlarged = false }) {
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
      if (item.project.status === "Pending Award") buckets[item.project.division].pending += 1;
      else if (item.project.status !== "Complete") buckets[item.project.division].current += 1;
    });

    const segments = [];
    divisions.forEach((division) => {
      if (buckets[division].current > 0) segments.push({ division, type: "Current", value: buckets[division].current, color: divisionSvgColors[division] });
      if (buckets[division].pending > 0) segments.push({ division, type: "Pending", value: buckets[division].pending, color: pendingDivisionSvgColors[division] });
    });

    const count = divisions.reduce((sum, division) => sum + buckets[division].current + buckets[division].pending, 0);
    return { label: formatTick(tick, zoom), segments, count };
  });

  const rawMaxValue = Math.max(totalResources, ...periods.map((period) => period.count), 1);
  const yAxisMax = Math.max(5, Math.ceil(rawMaxValue / 5) * 5);
  const width = Math.max(enlarged ? 1600 : 1160, periods.length * (enlarged ? 150 : 110));
  const height = enlarged ? 480 : 340;
  const margin = { top: 28, right: 24, bottom: 70, left: 58 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const y = (value) => margin.top + plotHeight - (value / yAxisMax) * plotHeight;
  const barWidth = Math.max(36, Math.min(90, plotWidth / Math.max(periods.length, 1) - 16));
  const yTicks = Array.from({ length: 6 }, (_, index) => Math.round((yAxisMax / 5) * index));

  return <section id="resource-demand-graph" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><div className="flex items-center gap-2"><button onClick={() => window.dispatchEvent(new CustomEvent("ggc-expand-demand"))} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50" title="Open enlarged view">↗</button><h2 className="text-xl font-bold">Resource Demand Graph</h2></div><p className="text-sm text-slate-500">Y-axis is project count. One active project/mobilization equals 1. The red dashed line represents total filtered resources.</p></div><button onClick={onExportPdf} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Export PDF</button></div><div className="overflow-x-auto"><svg width={width} height={height} className="rounded-xl border border-slate-200 bg-slate-50"><line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + plotHeight} stroke="#94a3b8" /><line x1={margin.left} y1={margin.top + plotHeight} x2={margin.left + plotWidth} y2={margin.top + plotHeight} stroke="#94a3b8" />{yTicks.map((tick) => <g key={tick}><line x1={margin.left} y1={y(tick)} x2={margin.left + plotWidth} y2={y(tick)} stroke="#e2e8f0" /><text x={margin.left - 12} y={y(tick) + 4} textAnchor="end" fontSize="12" fontWeight="600" fill="#64748b">{tick}</text></g>)}<line x1={margin.left} y1={y(totalResources)} x2={margin.left + plotWidth} y2={y(totalResources)} stroke="#dc2626" strokeWidth="4" strokeDasharray="8 6" /><rect x={margin.left + plotWidth - 124} y={y(totalResources) - 26} width="124" height="22" rx="5" fill="#dc2626" /><text x={margin.left + plotWidth - 62} y={y(totalResources) - 11} textAnchor="middle" fontSize="12" fontWeight="700" fill="white">Total Resources: {totalResources}</text>{periods.map((period, index) => {
      const x = margin.left + index * (plotWidth / Math.max(periods.length, 1)) + (plotWidth / Math.max(periods.length, 1) - barWidth) / 2;
      let stackedValue = 0;
      return <g key={`${period.label}-${index}`}>{period.segments.map((segment) => {
        const segmentHeight = (segment.value / yAxisMax) * plotHeight;
        const rectY = y(stackedValue + segment.value);
        stackedValue += segment.value;
        return <rect key={`${segment.division}-${segment.type}`} x={x} y={rectY} width={barWidth} height={segmentHeight} rx="5" fill={segment.color}><title>{segment.division} {segment.type}: {segment.value}</title></rect>;
      })}<text x={x + barWidth / 2} y={height - 36} textAnchor="middle" fontSize="10" fill="#475569">{period.label}</text></g>;
    })}</svg></div><div className="mt-4 flex flex-wrap gap-3 text-xs font-semibold">{divisions.map((division) => <div key={division} className="flex items-center gap-2"><span className={`h-3 w-6 rounded-full ${divisionStyles[division]}`} /><span>{division} Current</span><span className={`ml-2 h-3 w-6 rounded-full ${pendingDivisionStyles[division]}`} /><span>{division} Pending</span></div>)}</div></section>;
}

function downloadTextFile(filename, content, mimeType = "text/csv;charset=utf-8;") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const quote = String.fromCharCode(34);
  const comma = String.fromCharCode(44);
  const lineFeed = String.fromCharCode(10);
  const carriageReturn = String.fromCharCode(13);

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === quote && inQuotes && next === quote) {
      cell += quote;
      i += 1;
    } else if (char === quote) {
      inQuotes = !inQuotes;
    } else if (char === comma && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === lineFeed || char === carriageReturn) && !inQuotes) {
      if (char === carriageReturn && next === lineFeed) i += 1;
      row.push(cell);
      if (row.some((value) => String(value).trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => String(value).trim() !== "")) rows.push(row);
  return rows;
}

function csvToObjects(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = row[index] || "";
    });
    return item;
  });
}

function splitList(value) {
  return String(value || "").split(/[;,]/).map((item) => item.trim()).filter(Boolean);
}

function readCsvFile(event, onRows) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const rows = csvToObjects(String(reader.result || ""));
    onRows(rows);
    event.target.value = "";
  };
  reader.readAsText(file);
}

function mapProjectFromDb(p) {
  return {
    id: p.id,
    projectNumber: p.project_number || "",
    name: p.name || "",
    client: p.client || "",
    address: p.address || "",
    division: p.division || "Hardscape",
    specificRequirements: p.specific_requirements || [],
    status: p.status || "Scheduled",
  };
}

function mapResourceFromDb(r) {
  return {
    id: r.id,
    name: r.name || "",
    resourceType: r.resource_type || "Superintendent",
    homeDivision: r.home_division || "Hardscape",
    phone: r.phone || "",
    email: r.email || "",
    certifications: r.certifications || [],
    pto: r.pto || [],
    status: r.status || "Active",
  };
}

function mapCrewFromDb(c) {
  return {
    id: c.id,
    crewName: c.crew_name || "",
    foremanName: c.foreman_name || "",
    specialty: c.specialty || [],
  };
}

function mapAssignmentFromDb(a, mobilizations = []) {
  return {
    id: a.id,
    projectId: a.project_id || "",
    projectManager: a.project_manager || "",
    superintendent: a.superintendent || "",
    fieldCoordinator: a.field_coordinator || "",
    fieldEngineer: a.field_engineer || "",
    safety: a.safety || "",
    crew1Id: a.crew1_id || "",
    crew2Id: a.crew2_id || "",
    crew3Id: a.crew3_id || "",
    crew4Id: a.crew4_id || "",
    mobilizations: mobilizations
      .filter((m) => m.assignment_id === a.id)
      .map((m) => ({
        id: m.id,
        start: m.start_date || "",
        durationWeeks: m.duration_weeks || "",
        end: m.end_date || "",
      })),
  };
}

function projectToDb(project) {
  return {
    project_number: project.projectNumber,
    name: project.name,
    client: project.client,
    address: project.address,
    division: project.division,
    specific_requirements: project.specificRequirements || [],
    status: project.status,
  };
}

function resourceToDb(resource) {
  return {
    name: resource.name,
    resource_type: resource.resourceType,
    home_division: resource.homeDivision,
    phone: resource.phone,
    email: resource.email,
    certifications: resource.certifications || [],
    pto: resource.pto || [],
    status: resource.status || "Active",
  };
}

function crewToDb(crew) {
  return {
    crew_name: crew.crewName,
    foreman_name: crew.foremanName,
    specialty: crew.specialty || [],
  };
}

function assignmentToDb(assignment) {
  return {
    project_id: assignment.projectId,
    project_manager: assignment.projectManager,
    superintendent: assignment.superintendent,
    field_coordinator: assignment.fieldCoordinator,
    field_engineer: assignment.fieldEngineer,
    safety: assignment.safety,
    crew1_id: assignment.crew1Id || null,
    crew2_id: assignment.crew2Id || null,
    crew3_id: assignment.crew3Id || null,
    crew4_id: assignment.crew4Id || null,
  };
}

function mobilizationToDb(mob, assignmentId) {
  return {
    assignment_id: assignmentId,
    start_date: mob.start || null,
    duration_weeks: mob.durationWeeks === "" ? null : Number(mob.durationWeeks),
    end_date: mob.end || null,
  };
}

export default function App() {
  const [projects, setProjects] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [resources, setResources] = useState([]);
  const [crews, setCrews] = useState([]);
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
  const [dashboardResourceTypeFilter, setDashboardResourceTypeFilter] = useState([...defaultDashboardResourceTypes]);
  const [projectTabDivisionFilter, setProjectTabDivisionFilter] = useState([...divisions]);
  const [demandHomeDivisionFilter, setDemandHomeDivisionFilter] = useState([...divisions]);
  const [expandedView, setExpandedView] = useState(null);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [currentUser, setCurrentUser] = useState(() => sessionStorage.getItem("ggc_current_user") || "");
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [newUserForm, setNewUserForm] = useState({ username: "", password: "" });
  const [appUsers, setAppUsers] = useState([]);
  const [crewGanttFilter, setCrewGanttFilter] = useState([]);
  const [focusedResource, setFocusedResource] = useState(null);
  const [projectSort, setProjectSort] = useState({ key: "projectNumber", direction: "asc" });
  const [resourceSort, setResourceSort] = useState({ key: "name", direction: "asc" });
  const [crewSort, setCrewSort] = useState({ key: "crewName", direction: "asc" });

  useEffect(() => {
    if (currentUser) loadAppUsers();
  }, [currentUser]);

  useEffect(() => {
    function handleExpandDemand() { setExpandedView("demand"); }
    window.addEventListener("ggc-expand-demand", handleExpandDemand);
    return () => window.removeEventListener("ggc-expand-demand", handleExpandDemand);
  }, []);

  useEffect(() => {
    async function loadSupabaseData() {
      if (!supabase) {
        console.warn("SUPABASE TEST: missing URL or anon key");
        return;
      }

      const [projectsRes, resourcesRes, crewsRes, assignmentsRes, mobilizationsRes] = await Promise.all([
        supabase.from("projects").select("*").order("created_at", { ascending: false }),
        supabase.from("resources").select("*").order("created_at", { ascending: false }),
        supabase.from("crews").select("*").order("created_at", { ascending: false }),
        supabase.from("assignments").select("*").order("created_at", { ascending: false }),
        supabase.from("mobilizations").select("*"),
      ]);

      console.log("SUPABASE TEST:", projectsRes.data, projectsRes.error);

      if (projectsRes.error) console.error("Projects load error:", projectsRes.error);
      if (resourcesRes.error) console.error("Resources load error:", resourcesRes.error);
      if (crewsRes.error) console.error("Crews load error:", crewsRes.error);
      if (assignmentsRes.error) console.error("Assignments load error:", assignmentsRes.error);
      if (mobilizationsRes.error) console.error("Mobilizations load error:", mobilizationsRes.error);

      setProjects((projectsRes.data || []).map(mapProjectFromDb));
      setResources((resourcesRes.data || []).map(mapResourceFromDb));
      const mappedCrews = (crewsRes.data || []).map(mapCrewFromDb);
      setCrews(mappedCrews);
      setCrewGanttFilter((current) => current.length ? current : mappedCrews.map((crew) => crew.id));
      setAssignments((assignmentsRes.data || []).map((assignment) => mapAssignmentFromDb(assignment, mobilizationsRes.data || [])));
    }

    loadSupabaseData();
  }, []);

  
  
  
  
  useEffect(() => localStorage.setItem(CERTIFICATIONS_KEY, JSON.stringify(certifications)), [certifications]);

  const ganttItems = buildGanttItems(projects, assignments);
  const assignmentMatchesDashboardResourceType = (assignment) => {
    const assignedResourceNames = [assignment.projectManager, assignment.superintendent, assignment.fieldCoordinator, assignment.fieldEngineer, assignment.safety].filter(Boolean);

    // Allow pending-award / unstaffed assignments to remain visible and saveable.
    // These still need to appear on the Project Assignment Gantt and Resource Demand Graph.
    if (!assignedResourceNames.length) return true;

    const selectedResourceNames = resources
      .filter((resource) => dashboardResourceTypeFilter.includes(resource.resourceType))
      .map((resource) => resource.name);

    return assignedResourceNames.some((name) => selectedResourceNames.includes(name));
  };
  const visibleItems = ganttItems.filter((item) =>
    divisionFilter.includes(item.project.division) &&
    statusFilter.includes(item.project.status) &&
    assignmentMatchesDashboardResourceType(item.assignment)
  );
  const activeProjects = projects.filter((project) => project.status !== "Complete");
  const assignedCrewIds = [...new Set(assignments.flatMap((assignment) => getAssignmentCrewIds(assignment)).filter(Boolean))];
  function toggleSort(setter, key) {
    setter((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
  }

  function compareValues(a, b, direction) {
    const left = String(a ?? "").toLowerCase();
    const right = String(b ?? "").toLowerCase();
    const numberLeft = Number(left);
    const numberRight = Number(right);
    const bothNumbers = !Number.isNaN(numberLeft) && !Number.isNaN(numberRight) && left !== "" && right !== "";
    const result = bothNumbers ? numberLeft - numberRight : left.localeCompare(right, undefined, { numeric: true });
    return direction === "asc" ? result : -result;
  }

  const filteredResources = resources.filter((resource) => resourceTypeFilter.includes(resource.resourceType));
  const sortedResources = [...filteredResources].sort((a, b) => compareValues(a[resourceSort.key], b[resourceSort.key], resourceSort.direction));
  const sortedCrews = [...crews].sort((a, b) => compareValues(a[crewSort.key], b[crewSort.key], crewSort.direction));
  const filteredProjectsForProjectTab = projects.filter((project) => projectTabDivisionFilter.includes(project.division));
  const sortedProjectsForProjectTab = [...filteredProjectsForProjectTab].sort((a, b) => compareValues(a[projectSort.key], b[projectSort.key], projectSort.direction));
  const timeline = useMemo(() => buildTimeline(visibleItems, zoom), [visibleItems, zoom]);
  const timelineVisibleItems = visibleItems.filter((item) => itemOverlapsTimeline(item.start, item.end, timeline));
  const visibleAssignments = assignments.filter((assignment) => assignmentMatchesDashboardResourceType(assignment));
  const projectGanttRows = visibleAssignments.map((assignment) => {
    const project = findProject(projects, assignment.projectId);
    if (!project) return null;
    if (!divisionFilter.includes(project.division) || !statusFilter.includes(project.status)) return null;
    const items = timelineVisibleItems.filter((item) => item.assignmentId === assignment.id);
    if (!items.length) return null;
    return { assignment, project, items };
  }).filter(Boolean);
  const resourceGanttRows = resources.map((resource) => {
    if (!dashboardResourceTypeFilter.includes(resource.resourceType)) return null;
    const items = timelineVisibleItems.filter((item) => [item.assignment.projectManager, item.assignment.superintendent, item.assignment.fieldCoordinator, item.assignment.fieldEngineer, item.assignment.safety].includes(resource.name));
    if (!items.length) return null;
    return { resource, items };
  }).filter(Boolean);

  const crewGanttRows = crews
    .filter((crew) => crewGanttFilter.includes(crew.id))
    .map((crew) => {
      const items = timelineVisibleItems.filter((item) => getAssignmentCrewIds(item.assignment).includes(crew.id));
      if (!items.length) return null;
      return { crew, items };
    })
    .filter(Boolean);

  const focusedResourceItems = focusedResource
    ? timelineVisibleItems.filter((item) => [item.assignment.projectManager, item.assignment.superintendent, item.assignment.fieldCoordinator, item.assignment.fieldEngineer, item.assignment.safety].includes(focusedResource.name))
    : [];

  function openAddProjectForm() { setEditingProjectId(null); setProjectForm(blankProject); setShowProjectForm(true); }
  function openEditProjectForm(project) { setEditingProjectId(project.id); setProjectForm({ ...blankProject, ...project }); setShowProjectForm(true); }
  async function saveProject() {
    if (!projectForm.name.trim()) {
      alert("Project name is required.");
      return;
    }

    if (!supabase) {
      alert("Supabase is not connected. Check Vercel environment variables.");
      return;
    }

    const payload = {
      project_number: projectForm.projectNumber,
      name: projectForm.name,
      client: projectForm.client,
      address: projectForm.address,
      division: projectForm.division,
      specific_requirements: projectForm.specificRequirements || [],
      status: projectForm.status,
    };

    if (editingProjectId) {
      const { data, error } = await supabase
        .from("projects")
        .update(payload)
        .eq("id", editingProjectId)
        .select()
        .single();

      if (error) {
        console.error(error);
        alert("Could not update project.");
        return;
      }

      setProjects((current) => current.map((project) => (project.id === editingProjectId ? mapProjectFromDb(data) : project)));
    } else {
      const { data, error } = await supabase
        .from("projects")
        .insert(payload)
        .select()
        .single();

      if (error) {
        console.error(error);
        alert("Could not save project.");
        return;
      }

      setProjects((current) => [mapProjectFromDb(data), ...current]);
    }

    setShowProjectForm(false);
    setEditingProjectId(null);
    setProjectForm(blankProject);
  }
  async function deleteProject(id) {
    const project = projects.find((item) => item.id === id);
    if (!confirm(`Delete ${project?.name || "this project"}? This will also remove related assignments.`)) return;

    if (!supabase) {
      alert("Supabase is not connected. Check Vercel environment variables.");
      return;
    }

    const { error } = await supabase.from("projects").delete().eq("id", id);

    if (error) {
      console.error(error);
      alert("Could not delete project.");
      return;
    }

    setProjects((current) => current.filter((project) => project.id !== id));
    setAssignments((current) => current.filter((assignment) => assignment.projectId !== id));
  }

  function openAddAssignmentForm() { setEditingAssignmentId(null); setAssignmentForm({ ...blankAssignment, mobilizations: [{ id: crypto.randomUUID(), start: "", durationWeeks: "", end: "" }] }); setShowAssignmentForm(true); }
  function openEditAssignmentForm(assignment) { setEditingAssignmentId(assignment.id); setAssignmentForm({ ...blankAssignment, ...assignment, mobilizations: assignment.mobilizations?.length ? assignment.mobilizations : [{ id: crypto.randomUUID(), start: "", durationWeeks: "", end: "" }] }); setShowAssignmentForm(true); }
  async function saveAssignment() {
    if (!assignmentForm.projectId) { alert("Project is required."); return; }
    if (!(assignmentForm.mobilizations || []).some((mob) => mob.start && mob.end)) { alert("At least one mobilization with start and end date is required."); return; }
    if (!supabase) { alert("Supabase is not connected. Check Vercel environment variables."); return; }

    const assignmentPayload = assignmentToDb(assignmentForm);
    let savedAssignment;

    if (editingAssignmentId) {
      const { data, error } = await supabase.from("assignments").update(assignmentPayload).eq("id", editingAssignmentId).select().single();
      if (error) { console.error(error); alert("Could not update assignment."); return; }
      savedAssignment = data;
      const deleteExisting = await supabase.from("mobilizations").delete().eq("assignment_id", editingAssignmentId);
      if (deleteExisting.error) { console.error(deleteExisting.error); alert("Could not update mobilizations."); return; }
    } else {
      const { data, error } = await supabase.from("assignments").insert(assignmentPayload).select().single();
      if (error) { console.error(error); alert("Could not save assignment."); return; }
      savedAssignment = data;
    }

    const validMobilizations = (assignmentForm.mobilizations || []).filter((mob) => mob.start && mob.end).map((mob) => mobilizationToDb(mob, savedAssignment.id));
    let savedMobilizations = [];

    if (validMobilizations.length) {
      const { data, error } = await supabase.from("mobilizations").insert(validMobilizations).select();
      if (error) { console.error(error); alert("Could not save mobilizations."); return; }
      savedMobilizations = data || [];
    }

    const mappedAssignment = mapAssignmentFromDb(savedAssignment, savedMobilizations);
    if (editingAssignmentId) setAssignments((current) => current.map((assignment) => (assignment.id === editingAssignmentId ? mappedAssignment : assignment)));
    else setAssignments((current) => [mappedAssignment, ...current]);

    setShowAssignmentForm(false);
    setEditingAssignmentId(null);
    setAssignmentForm(blankAssignment);
  }
  async function deleteAssignment(id) {
    const assignment = assignments.find((item) => item.id === id);
    const project = assignment ? findProject(projects, assignment.projectId) : null;
    if (!confirm(`Delete assignment for ${project?.name || "this project"}?`)) return;
    if (!supabase) { alert("Supabase is not connected. Check Vercel environment variables."); return; }
    const { error } = await supabase.from("assignments").delete().eq("id", id);
    if (error) { console.error(error); alert("Could not delete assignment."); return; }
    setAssignments((current) => current.filter((assignment) => assignment.id !== id));
  }

  function openAddResourceForm() { setEditingResourceId(null); setResourceForm(blankResource); setShowResourceForm(true); }
  function openEditResourceForm(resource) { setEditingResourceId(resource.id); setResourceForm({ ...blankResource, ...resource }); setShowResourceForm(true); }
  async function saveResource() {
    if (!resourceForm.name.trim()) { alert("Resource name is required."); return; }
    if (!supabase) { alert("Supabase is not connected. Check Vercel environment variables."); return; }
    const payload = resourceToDb(resourceForm);

    if (editingResourceId) {
      const { data, error } = await supabase.from("resources").update(payload).eq("id", editingResourceId).select().single();
      if (error) { console.error(error); alert("Could not update resource."); return; }
      setResources((current) => current.map((resource) => (resource.id === editingResourceId ? mapResourceFromDb(data) : resource)));
    } else {
      const { data, error } = await supabase.from("resources").insert(payload).select().single();
      if (error) { console.error(error); alert("Could not save resource."); return; }
      setResources((current) => [mapResourceFromDb(data), ...current]);
    }

    setShowResourceForm(false);
    setEditingResourceId(null);
    setResourceForm(blankResource);
  }
  async function deleteResource(id) {
    const resource = resources.find((item) => item.id === id);
    if (!confirm(`Delete ${resource?.name || "this resource"}?`)) return;
    if (!supabase) { alert("Supabase is not connected. Check Vercel environment variables."); return; }
    const { error } = await supabase.from("resources").delete().eq("id", id);
    if (error) { console.error(error); alert("Could not delete resource."); return; }
    setResources((current) => current.filter((item) => item.id !== id));
  }
  function openAddCrewForm() { setEditingCrewId(null); setCrewForm(blankCrew); setShowCrewForm(true); }
  function openEditCrewForm(crew) { setEditingCrewId(crew.id); setCrewForm({ ...blankCrew, ...crew }); setShowCrewForm(true); }
  async function saveCrew() {
    if (!crewForm.crewName.trim()) { alert("Crew name is required."); return; }
    if (!supabase) { alert("Supabase is not connected. Check Vercel environment variables."); return; }
    const payload = crewToDb(crewForm);

    if (editingCrewId) {
      const { data, error } = await supabase.from("crews").update(payload).eq("id", editingCrewId).select().single();
      if (error) { console.error(error); alert("Could not update crew."); return; }
      setCrews((current) => current.map((crew) => (crew.id === editingCrewId ? mapCrewFromDb(data) : crew)));
    } else {
      const { data, error } = await supabase.from("crews").insert(payload).select().single();
      if (error) { console.error(error); alert("Could not save crew."); return; }
      setCrews((current) => [mapCrewFromDb(data), ...current]);
    }

    setShowCrewForm(false);
    setEditingCrewId(null);
    setCrewForm(blankCrew);
  }
  async function deleteCrew(id) {
    const crew = crews.find((item) => item.id === id);
    if (!confirm(`Delete ${crew?.crewName || "this crew"}?`)) return;
    if (!supabase) { alert("Supabase is not connected. Check Vercel environment variables."); return; }
    const { error } = await supabase.from("crews").delete().eq("id", id);
    if (error) { console.error(error); alert("Could not delete crew."); return; }
    setCrews((current) => current.filter((item) => item.id !== id));
  }
  function addCertification() { const cert = newCertification.trim(); if (!cert) return; if (!certifications.includes(cert)) setCertifications((current) => [...current, cert]); setNewCertification(""); }
  function deleteCertification(cert) { setCertifications((current) => current.filter((item) => item !== cert)); setResources((current) => current.map((resource) => ({ ...resource, certifications: (resource.certifications || []).filter((item) => item !== cert) }))); setProjects((current) => current.map((project) => ({ ...project, specificRequirements: (project.specificRequirements || []).filter((item) => item !== cert) }))); }

  function exportDashboardExcel() {
    const rows = [
      ["Project #", "Project Name", "Division", "Status", "Mobilization #", "Start", "End", "Project Manager", "Superintendent", "Field Coordinator", "Field Engineer", "Safety", "Crews"],
      ...timelineVisibleItems.map((item) => [
        item.project.projectNumber,
        item.project.name,
        item.project.division,
        item.project.status,
        item.mobilizationNumber,
        item.start,
        item.end,
        item.assignment.projectManager,
        item.assignment.superintendent,
        item.assignment.fieldCoordinator,
        item.assignment.fieldEngineer,
        item.assignment.safety,
        getAssignmentCrewDisplayNames(item.assignment, crews).join("; "),
      ])
    ];
    const lineBreak = String.fromCharCode(10);
    const csvContent = rows.map((row) => row.map(csvEscape).join(",")).join(lineBreak);
    downloadTextFile("ggc-resource-planning-dashboard.csv", csvContent);
  }

  function exportSectionPdf(sectionId, title) {
    const section = document.getElementById(sectionId);
    if (!section) return;

    const clonedSection = section.cloneNode(true);
    clonedSection.querySelectorAll("button, input, select").forEach((element) => element.remove());
    clonedSection.querySelectorAll(".overflow-x-auto").forEach((element) => {
      element.style.overflow = "visible";
    });

    const printWindow = window.open("", "_blank", "width=1400,height=900");
    if (!printWindow) {
      alert("Please allow pop-ups to export PDF.");
      return;
    }

    const printHtml = `<!doctype html>
<html>
<head>
<title>${title || "GGC Export"}</title>
<style>
@page { size: landscape; margin: 0.35in; }
body { font-family: Arial, sans-serif; background: white; color: #0f172a; margin: 0; }
.export-wrap { padding: 16px; }
.overflow-x-auto { overflow: visible !important; }
svg { max-width: none; height: auto; }
button { display: none !important; }
.rounded-2xl { border-radius: 16px; }
.rounded-xl { border-radius: 12px; }
.border { border: 1px solid #e2e8f0; }
.bg-white { background: white; }
.bg-slate-50 { background: #f8fafc; }
.bg-slate-100 { background: #f1f5f9; }
.bg-emerald-700 { background: #047857; }
.bg-emerald-300 { background: #6ee7b7; }
.bg-blue-700 { background: #1d4ed8; }
.bg-blue-300 { background: #93c5fd; }
.bg-orange-600 { background: #ea580c; }
.bg-orange-300 { background: #fdba74; }
.bg-purple-700 { background: #7e22ce; }
.bg-purple-300 { background: #d8b4fe; }
.text-white { color: white; }
.text-slate-900 { color: #0f172a; }
.text-slate-500 { color: #64748b; }
.shadow-sm { box-shadow: none; }
</style>
</head>
<body>
<div class="export-wrap">${clonedSection.outerHTML}</div>
<script>
window.onload = function () { setTimeout(function () { window.print(); }, 350); };
<\/script>
</body>
</html>`;

    printWindow.document.open();
    printWindow.document.write(printHtml);
    printWindow.document.close();
  }

  function exportProjectsExcel() {
    const rows = [["Project Number", "Project Name", "Client", "Address", "Division", "Specific Requirements", "Status"], ...projects.map((project) => [project.projectNumber, project.name, project.client, project.address, project.division, (project.specificRequirements || []).join("; "), project.status])];
    const lineBreak = String.fromCharCode(10);
    downloadTextFile("ggc-projects.csv", rows.map((row) => row.map(csvEscape).join(",")).join(lineBreak));
  }

  function exportResourcesExcel() {
    const rows = [["Name", "Resource Type", "Home Division", "Phone", "Email", "Certifications", "PTO"], ...resources.map((resource) => [resource.name, resource.resourceType, resource.homeDivision, resource.phone, resource.email, (resource.certifications || []).join("; "), (resource.pto || []).map((pto) => `${pto.ptoId}|${pto.start}|${pto.end}`).join("; ")])];
    const lineBreak = String.fromCharCode(10);
    downloadTextFile("ggc-resources.csv", rows.map((row) => row.map(csvEscape).join(",")).join(lineBreak));
  }

  function exportCrewsExcel() {
    const rows = [["Crew Name", "Foreman Name", "Specialty"], ...crews.map((crew) => [crew.crewName, crew.foremanName, (crew.specialty || []).join("; ")])];
    const lineBreak = String.fromCharCode(10);
    downloadTextFile("ggc-crews.csv", rows.map((row) => row.map(csvEscape).join(",")).join(lineBreak));
  }

  function importProjectsCsv(event) {
    readCsvFile(event, async (rows) => {
      if (!supabase) {
        alert("Supabase is not connected. Check Vercel environment variables.");
        return;
      }

      const imported = rows.map((row) => ({
        project_number: row.projectnumber || row.project || "",
        name: row.projectname || row.name || "",
        client: row.client || "",
        address: row.address || "",
        division: divisions.includes(row.division) ? row.division : "Hardscape",
        specific_requirements: splitList(row.specificrequirements || row.requirements || row.certifications),
        status: statuses.includes(row.status) ? row.status : "Scheduled",
      })).filter((project) => project.project_number || project.name);

      if (!imported.length) {
        alert("No valid projects found in CSV.");
        return;
      }

      const { data, error } = await supabase
        .from("projects")
        .insert(imported)
        .select();

      if (error) {
        console.error(error);
        alert("Could not import projects.");
        return;
      }

      setProjects((current) => [...(data || []).map(mapProjectFromDb), ...current]);
    });
  }

  function importResourcesCsv(event) {
    readCsvFile(event, async (rows) => {
      if (!supabase) { alert("Supabase is not connected. Check Vercel environment variables."); return; }
      const imported = rows.map((row) => ({
        name: row.name || "",
        resource_type: resourceTypes.includes(row.resourcetype) ? row.resourcetype : "Superintendent",
        home_division: divisions.includes(row.homedivision || row.division) ? (row.homedivision || row.division) : "Hardscape",
        phone: row.phone || "",
        email: row.email || "",
        certifications: splitList(row.certifications),
        pto: splitList(row.pto).map((item) => {
          const [ptoId, start, end] = item.split("|");
          return { id: crypto.randomUUID(), ptoId: ptoId || "", start: start || "", end: end || "" };
        }).filter((pto) => pto.ptoId || pto.start || pto.end),
        status: row.status || "Active",
      })).filter((resource) => resource.name);
      if (!imported.length) { alert("No valid resources found in CSV."); return; }
      const { data, error } = await supabase.from("resources").insert(imported).select();
      if (error) { console.error(error); alert("Could not import resources."); return; }
      setResources((current) => [...(data || []).map(mapResourceFromDb), ...current]);
    });
  }

  function importCrewsCsv(event) {
    readCsvFile(event, async (rows) => {
      if (!supabase) { alert("Supabase is not connected. Check Vercel environment variables."); return; }
      const imported = rows.map((row) => ({
        crew_name: row.crewname || row.crew || "",
        foreman_name: row.foremanname || row.foreman || "",
        specialty: splitList(row.specialty || row.certifications),
      })).filter((crew) => crew.crew_name);
      if (!imported.length) { alert("No valid crews found in CSV."); return; }
      const { data, error } = await supabase.from("crews").insert(imported).select();
      if (error) { console.error(error); alert("Could not import crews."); return; }
      setCrews((current) => [...(data || []).map(mapCrewFromDb), ...current]);
    });
  }

  function importAssignmentsCsv(event) {
    readCsvFile(event, async (rows) => {
      if (!supabase) { alert("Supabase is not connected. Check Vercel environment variables."); return; }
      const findProjectId = (row) => {
        const value = row.projectnumber || row.project || row.projectname || "";
        const match = projects.find((project) => project.projectNumber === value || project.name === value || `${project.projectNumber} - ${project.name}` === value);
        return match?.id || "";
      };
      const findCrewId = (value) => {
        const text = String(value || "").trim();
        const match = crews.find((crew) => crew.id === text || crew.crewName === text || getCrewDisplayName(crew) === text);
        return match?.id || null;
      };

      const imported = rows.map((row) => ({
        projectId: findProjectId(row),
        projectManager: row.projectmanager || row.pm || "",
        superintendent: row.superintendent || "",
        fieldCoordinator: row.fieldcoordinator || "",
        fieldEngineer: row.fieldengineer || "",
        safety: row.safety || "",
        crew1Id: findCrewId(row.crew1 || row.crew1name),
        crew2Id: findCrewId(row.crew2 || row.crew2name),
        crew3Id: findCrewId(row.crew3 || row.crew3name),
        crew4Id: findCrewId(row.crew4 || row.crew4name),
        mobilizations: [{ id: crypto.randomUUID(), start: row.start || row.startdate || "", durationWeeks: row.durationweeks || "", end: row.end || row.enddate || "" }],
      })).filter((assignment) => assignment.projectId);

      if (!imported.length) { alert("No valid assignments found. Make sure project numbers/names match existing projects."); return; }

      const savedAssignments = [];
      for (const assignment of imported) {
        const { data, error } = await supabase.from("assignments").insert(assignmentToDb(assignment)).select().single();
        if (error) { console.error(error); continue; }
        const validMobilizations = (assignment.mobilizations || []).filter((mob) => mob.start && mob.end).map((mob) => mobilizationToDb(mob, data.id));
        let savedMobilizations = [];
        if (validMobilizations.length) {
          const mobResult = await supabase.from("mobilizations").insert(validMobilizations).select();
          if (mobResult.error) console.error(mobResult.error);
          savedMobilizations = mobResult.data || [];
        }
        savedAssignments.push(mapAssignmentFromDb(data, savedMobilizations));
      }

      if (savedAssignments.length) setAssignments((current) => [...savedAssignments, ...current]);
    });
  }

  async function loadAppUsers() {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("list_app_users");
    if (error) {
      console.error("Could not load app users:", error);
      return;
    }
    setAppUsers(data || []);
  }

  async function handleLogin(event) {
    event.preventDefault();
    if (!supabase) { alert("Supabase is not connected."); return; }
    const { data, error } = await supabase.rpc("authenticate_app_user", {
      input_username: loginForm.username,
      input_password: loginForm.password,
    });

    if (error) {
      console.error(error);
      alert("Login setup is missing. Run the user SQL block in Supabase.");
      return;
    }

    if (!data) {
      alert("Invalid username or password.");
      return;
    }

    sessionStorage.setItem("ggc_current_user", loginForm.username);
    setCurrentUser(loginForm.username);
    setLoginForm({ username: "", password: "" });
    await loadAppUsers();
  }

  async function addAppUser() {
    if (!newUserForm.username.trim() || !newUserForm.password.trim()) {
      alert("Username and password are required.");
      return;
    }
    if (!supabase) { alert("Supabase is not connected."); return; }
    const { error } = await supabase.rpc("create_app_user", {
      input_username: newUserForm.username,
      input_password: newUserForm.password,
    });
    if (error) {
      console.error(error);
      alert("Could not create user.");
      return;
    }
    setNewUserForm({ username: "", password: "" });
    await loadAppUsers();
  }

  async function deleteAppUser(username) {
    if (username === currentUser) {
      alert("You cannot delete the user currently signed in.");
      return;
    }
    if (!confirm(`Delete login user ${username}?`)) return;
    if (!supabase) { alert("Supabase is not connected."); return; }
    const { error } = await supabase.rpc("delete_app_user", { input_username: username });
    if (error) {
      console.error(error);
      alert("Could not delete user. Make sure the delete_app_user SQL function exists.");
      return;
    }
    await loadAppUsers();
  }

  function logout() {
    sessionStorage.removeItem("ggc_current_user");
    setCurrentUser("");
  }

  if (!currentUser) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6"><form onSubmit={handleLogin} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"><div className="h-1 w-24 rounded-full bg-emerald-700" /><h1 className="mt-4 text-2xl font-bold text-slate-900">GGC Resource Planning</h1><p className="mt-1 text-sm text-slate-500">Sign in to access the scheduling system.</p><label className="mt-6 block space-y-1"><span className="text-sm font-semibold text-slate-700">Username</span><input value={loginForm.username} onChange={(e) => setLoginForm((current) => ({ ...current, username: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" /></label><label className="mt-4 block space-y-1"><span className="text-sm font-semibold text-slate-700">Password</span><input type="password" value={loginForm.password} onChange={(e) => setLoginForm((current) => ({ ...current, password: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" /></label><button type="submit" className="mt-6 w-full rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white hover:bg-emerald-800">Log In</button></form></main>;
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-4">
            <img src="/logo.png" alt="Greater Georgia Concrete logo" className="h-16 w-auto object-contain" onError={(event) => { event.currentTarget.style.display = "none"; }} />
            <div>
              <div className="h-1 w-24 rounded-full bg-emerald-700" />
              <h1 className="mt-3 text-3xl font-bold tracking-tight">GGC Resource Planning</h1>
              <p className="mt-1 text-slate-500">Project master list, resource assignments, and mobilization scheduling.</p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-3"><div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700"><span>{currentUser}</span><button onClick={() => setShowUserSettings(true)} className="rounded-lg p-1 hover:bg-slate-200" title="User settings"><Settings size={16} /></button><button onClick={logout} className="rounded-lg px-2 py-1 text-xs text-red-700 hover:bg-red-50">Logout</button></div>
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
              <div className="flex flex-wrap gap-3"><button onClick={exportCrewsExcel} className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">Export Excel</button><label className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">Import CSV<input type="file" accept=".csv" onChange={importCrewsCsv} className="hidden" /></label><button onClick={openAddCrewForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800"><Plus size={17} /> Add Crew</button></div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[850px] text-left text-sm">
                <thead className="bg-slate-100 text-slate-600">
                  <tr><th onClick={() => toggleSort(setCrewSort, "crewName")} className="cursor-pointer p-3 hover:bg-slate-200">Crew Name</th><th onClick={() => toggleSort(setCrewSort, "foremanName")} className="cursor-pointer p-3 hover:bg-slate-200">Foreman Name</th><th className="p-3">Specialty</th><th className="p-3">Current Assignments</th><th className="p-3 text-right">Actions</th></tr>
                </thead>
                <tbody>
                  {sortedCrews.map((crew) => (
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
              <div className="flex flex-wrap gap-3"><button onClick={exportResourcesExcel} className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">Export Excel</button><label className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">Import CSV<input type="file" accept=".csv" onChange={importResourcesCsv} className="hidden" /></label><button onClick={() => setShowCertSettings((current) => !current)} className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"><Settings size={17} /> Certification Settings</button><button onClick={openAddResourceForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800"><Plus size={17} /> Add Resource</button></div>
            </div>
            {showCertSettings && <div className="mb-5 rounded-2xl border border-emerald-100 bg-emerald-50 p-4"><h3 className="font-bold text-slate-900">Saved Certification Selections</h3><div className="mt-3 flex gap-2"><input value={newCertification} onChange={(e) => setNewCertification(e.target.value)} placeholder="Add certification" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none focus:border-emerald-600" /><button onClick={addCertification} className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white">Add</button></div><div className="mt-3 flex flex-wrap gap-2">{certifications.map((cert) => <span key={cert} className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">{cert}<button onClick={() => deleteCertification(cert)} className="text-red-600">×</button></span>)}</div></div>}
            <div className="mb-4"><MultiSelectFilter label="Resource Type Filter" options={resourceTypes} selected={resourceTypeFilter} setSelected={setResourceTypeFilter} /></div>
            <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[1150px] text-left text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th onClick={() => toggleSort(setResourceSort, "name")} className="cursor-pointer p-3 hover:bg-slate-200">Name</th><th onClick={() => toggleSort(setResourceSort, "resourceType")} className="cursor-pointer p-3 hover:bg-slate-200">Resource Type</th><th onClick={() => toggleSort(setResourceSort, "homeDivision")} className="cursor-pointer p-3 hover:bg-slate-200">Home Division</th><th className="p-3">Phone</th><th className="p-3">Email</th><th className="p-3">Certifications</th><th className="p-3">PTO</th><th className="p-3">Assigned Projects</th><th className="p-3 text-right">Actions</th></tr></thead><tbody>{sortedResources.map((resource) => <tr key={resource.id} className="border-t border-slate-200 align-top"><td className="p-3 font-medium">{resource.name}</td><td className="p-3">{resource.resourceType}</td><td className="p-3">{resource.homeDivision}</td><td className="p-3">{resource.phone}</td><td className="p-3">{resource.email}</td><td className="p-3">{(resource.certifications || []).join(", ")}</td><td className="p-3">{(resource.pto || []).map((pto) => `${pto.ptoId}: ${formatDate(pto.start)} - ${formatDate(pto.end)}`).join("; ")}</td><td className="p-3">{assignments.filter((a) => [a.projectManager, a.superintendent, a.fieldCoordinator, a.fieldEngineer, a.safety].includes(resource.name)).map((a) => findProject(projects, a.projectId)?.name).filter(Boolean).join(", ")}</td><td className="p-3 text-right"><button onClick={() => openEditResourceForm(resource)} className="mr-2 rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50">Edit</button><button onClick={() => deleteResource(resource.id)} className="rounded-lg border border-red-200 px-3 py-1.5 font-medium text-red-700 hover:bg-red-50">Delete</button></td></tr>)}</tbody></table></div>
          </section>
        </section>
      )}

      {page === "projects" && (
        <section className="mx-auto max-w-7xl space-y-6 px-6 py-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><div><h2 className="text-2xl font-bold">Projects</h2><p className="text-sm text-slate-500">Create and edit projects here only. Resource assignments happen on the Dashboard.</p></div><div className="flex flex-wrap gap-3"><button onClick={exportProjectsExcel} className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">Export Excel</button><label className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">Import CSV<input type="file" accept=".csv" onChange={importProjectsCsv} className="hidden" /></label><button onClick={openAddProjectForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800"><Plus size={17} /> Add Project</button></div></div>
            <div className="mb-4"><MultiSelectFilter label="Division Filter" options={divisions} selected={projectTabDivisionFilter} setSelected={setProjectTabDivisionFilter} /></div>
            <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th onClick={() => toggleSort(setProjectSort, "projectNumber")} className="cursor-pointer p-3 hover:bg-slate-200">Project #</th><th onClick={() => toggleSort(setProjectSort, "name")} className="cursor-pointer p-3 hover:bg-slate-200">Project Name</th><th onClick={() => toggleSort(setProjectSort, "client")} className="cursor-pointer p-3 hover:bg-slate-200">Client</th><th className="p-3">Address</th><th onClick={() => toggleSort(setProjectSort, "division")} className="cursor-pointer p-3 hover:bg-slate-200">Division</th><th className="p-3">Requirements</th><th onClick={() => toggleSort(setProjectSort, "status")} className="cursor-pointer p-3 hover:bg-slate-200">Status</th><th className="p-3 text-right">Actions</th></tr></thead><tbody>{sortedProjectsForProjectTab.map((project) => <tr key={project.id} className="border-t border-slate-200 align-top"><td className="p-3 font-medium">{project.projectNumber}</td><td className="p-3 font-medium">{project.name}</td><td className="p-3">{project.client}</td><td className="p-3">{project.address}</td><td className="p-3">{project.division}</td><td className="p-3">{(project.specificRequirements || []).join(", ")}</td><td className="p-3">{project.status}</td><td className="p-3 text-right"><button onClick={() => openEditProjectForm(project)} className="mr-2 rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50">Edit</button><button onClick={() => deleteProject(project.id)} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 font-medium text-red-700 hover:bg-red-50"><Trash2 size={14} /> Delete</button></td></tr>)}</tbody></table></div>
          </section>
        </section>
      )}

      {page === "dashboard" && (
        <section className="mx-auto max-w-7xl space-y-6 px-6 py-6">
          <div className="grid gap-4 md:grid-cols-4"><StatCard icon={BriefcaseBusiness} label="Total Projects" value={projects.length} /><StatCard icon={ClipboardCheck} label="Assignments" value={assignments.length} /><StatCard icon={Users} label="Resources" value={resources.length} /><StatCard icon={FolderKanban} label="Crews" value={crews.length} /></div>
          <section id="project-assignment-gantt" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><div><div className="flex items-center gap-2"><button onClick={() => setExpandedView("project")} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50" title="Open enlarged view">↗</button><h2 className="text-xl font-bold">Project Assignment Gantt View</h2></div><p className="text-sm text-slate-500">Each project assignment is one row. Multiple mobilizations appear on that same project row.</p></div><div className="flex flex-wrap items-center gap-3"><button onClick={exportDashboardExcel} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Export Excel</button><button onClick={() => exportSectionPdf("project-assignment-gantt", "Project Assignment Gantt View")} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Export PDF</button><div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><ZoomIn size={16} className="text-slate-500" /><span className="text-sm font-medium text-slate-700">Zoom</span><select value={zoom} onChange={(e) => setZoom(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-emerald-600">{zoomModes.map((mode) => <option key={mode}>{mode}</option>)}</select></div></div></div><div className="mb-4 grid gap-3 lg:grid-cols-3"><MultiSelectFilter label="Project Division Filter" options={divisions} selected={divisionFilter} setSelected={setDivisionFilter} /><MultiSelectFilter label="Status Filter" options={statuses} selected={statusFilter} setSelected={setStatusFilter} /><MultiSelectFilter label="Resource Type Filter" options={resourceTypes} selected={dashboardResourceTypeFilter} setSelected={setDashboardResourceTypeFilter} /></div><div className="mb-4 flex flex-wrap gap-3 text-xs font-semibold">{divisions.map((division) => <div key={division} className="flex items-center gap-2"><span className={`h-3 w-8 rounded-full ${divisionStyles[division]}`} /><span className="text-slate-600">{division}</span></div>)}<div className="text-slate-400">Pending Award uses lighter shade</div></div><div className="overflow-x-auto rounded-xl border border-slate-200 p-4"><GanttHeader timeline={timeline} zoom={zoom} /><div className="mt-3 min-w-[1160px] space-y-3">{projectGanttRows.map((row) => <button key={row.assignment.id} onClick={() => openEditAssignmentForm(row.assignment)} className="block w-full text-left"><ProjectGanttRow assignment={row.assignment} project={row.project} items={row.items} timeline={timeline} crews={crews} /></button>)}</div></div></section>
          <section id="resource-gantt" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><div className="flex items-center gap-2"><button onClick={() => setExpandedView("resource")} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50" title="Open enlarged view">↗</button><h2 className="text-xl font-bold">Resource Gantt View</h2></div><p className="text-sm text-slate-500">Rows are resources. Bars show the assigned project name for each mobilization.</p></div><button onClick={() => exportSectionPdf("resource-gantt", "Resource Gantt View")} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Export PDF</button></div><div className="overflow-x-auto rounded-xl border border-slate-200 p-4"><GanttHeader timeline={timeline} zoom={zoom} /><div className="mt-3 min-w-[1160px] space-y-3">{resourceGanttRows.map((row) => <ResourceGanttRow key={row.resource.id} resource={row.resource} items={row.items} timeline={timeline} onResourceClick={setFocusedResource} />)}</div></div></section>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><MultiSelectFilter label="Resource Demand Home Division Filter" options={divisions} selected={demandHomeDivisionFilter} setSelected={setDemandHomeDivisionFilter} /></div><ResourceDemandChart items={timelineVisibleItems} timeline={timeline} zoom={zoom} totalResources={resources.filter((resource) => dashboardResourceTypeFilter.includes(resource.resourceType) && demandHomeDivisionFilter.includes(resource.homeDivision)).length} onExportPdf={() => exportSectionPdf("resource-demand-graph", "Resource Demand Graph")} />
          <section id="crew-gantt" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><div className="flex items-center gap-2"><button onClick={() => setExpandedView("crew")} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50" title="Open enlarged view">↗</button><h2 className="text-xl font-bold">Crew Gantt View</h2></div><p className="text-sm text-slate-500">Rows are crews. Overlapping projects stack below each other within the same crew row.</p></div><button onClick={() => exportSectionPdf("crew-gantt", "Crew Gantt View")} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Export PDF</button></div><div className="mb-4"><SearchableMultiSelect label="Crew Name Filter" options={crews.map((crew) => ({ value: crew.id, label: getCrewDisplayName(crew), subLabel: (crew.specialty || []).join(", ") }))} selected={crewGanttFilter} setSelected={setCrewGanttFilter} getLabel={(option) => option.label} /></div><div className="overflow-x-auto rounded-xl border border-slate-200 p-4"><GanttHeader timeline={timeline} zoom={zoom} /><div className="mt-3 min-w-[1160px] space-y-3">{crewGanttRows.map((row) => <CrewGanttRow key={row.crew.id} crew={row.crew} items={row.items} timeline={timeline} />)}</div></div></section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-xl font-bold">Assignments</h2><p className="text-sm text-slate-500">Assign existing projects to resources and crews.</p></div><div className="flex flex-wrap gap-3"><label className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">Import CSV<input type="file" accept=".csv" onChange={importAssignmentsCsv} className="hidden" /></label><button onClick={openAddAssignmentForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800"><ClipboardCheck size={17} /> Assign</button></div></div><div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[1250px] text-left text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="p-3">Project</th><th className="p-3">PM</th><th className="p-3">Superintendent</th><th className="p-3">Field Coordinator</th><th className="p-3">Field Engineer</th><th className="p-3">Safety</th><th className="p-3">Crews</th><th className="p-3">Mobilizations</th><th className="p-3 text-right">Actions</th></tr></thead><tbody>{visibleAssignments.map((assignment) => { const project = findProject(projects, assignment.projectId); return <tr key={assignment.id} className="border-t border-slate-200 align-top"><td className="p-3 font-medium">{project ? `${project.projectNumber} - ${project.name}` : "Missing project"}</td><td className="p-3">{assignment.projectManager}</td><td className="p-3">{assignment.superintendent}</td><td className="p-3">{assignment.fieldCoordinator}</td><td className="p-3">{assignment.fieldEngineer}</td><td className="p-3">{assignment.safety}</td><td className="p-3">{getAssignmentCrewDisplayNames(assignment, crews).join(", ")}</td><td className="p-3">{(assignment.mobilizations || []).map((mob, index) => `#${index + 1}: ${formatDate(mob.start)} - ${formatDate(mob.end)}`).join("; ")}</td><td className="p-3 text-right"><button onClick={() => openEditAssignmentForm(assignment)} className="mr-2 rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50">Edit</button><button onClick={() => deleteAssignment(assignment.id)} className="rounded-lg border border-red-200 px-3 py-1.5 font-medium text-red-700 hover:bg-red-50">Delete</button></td></tr>; })}</tbody></table></div></section>
        </section>
      )}

      {focusedResource && <div className="fixed inset-0 z-[75] bg-slate-950/70 p-4"><div className="h-full overflow-auto rounded-2xl bg-white p-5 shadow-2xl"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-2xl font-bold">{focusedResource.name} Conflict Breakout</h2><p className="text-sm text-slate-500">Each assignment is shown on a separate line so overlapping work is easy to review.</p></div><button onClick={() => setFocusedResource(null)} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold hover:bg-slate-50">Close</button></div><GanttHeader timeline={timeline} zoom={zoom} /><div className="mt-3 min-w-[1500px] space-y-3">{focusedResourceItems.map((item) => <div key={`focused-${item.id}`} className="grid grid-cols-[260px_1fr] items-center gap-5"><div className="text-left"><p className="font-semibold text-slate-900">{item.project.projectNumber ? `${item.project.projectNumber} - ` : ""}{item.project.name}</p><p className="mt-1 text-xs text-slate-500">{item.project.division} • {formatDate(item.start)} - {formatDate(item.end)}</p></div><div className="relative h-11 rounded-xl bg-slate-100"><GanttSegmentBar item={item} timeline={timeline} label={item.project.name} /></div></div>)}</div></div></div>}

      {showUserSettings && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4"><div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-xl font-bold">User Settings</h2><p className="text-sm text-slate-500">Add users who can log in to this system.</p></div><button onClick={() => setShowUserSettings(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button></div><div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]"><input placeholder="Username" value={newUserForm.username} onChange={(e) => setNewUserForm((current) => ({ ...current, username: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" /><input placeholder="Password" type="password" value={newUserForm.password} onChange={(e) => setNewUserForm((current) => ({ ...current, password: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" /><button onClick={addAppUser} className="rounded-xl bg-emerald-700 px-4 py-2 font-bold text-white hover:bg-emerald-800">Add User</button></div><div className="mt-5 rounded-xl border border-slate-200"><table className="w-full text-left text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="p-3">Username</th><th className="p-3">Created</th><th className="p-3 text-right">Action</th></tr></thead><tbody>{appUsers.map((user) => <tr key={user.username} className="border-t border-slate-200"><td className="p-3 font-semibold">{user.username}</td><td className="p-3">{user.created_at ? formatDate(user.created_at) : ""}</td><td className="p-3 text-right"><button onClick={() => deleteAppUser(user.username)} className="rounded-lg border border-red-200 px-3 py-1.5 font-semibold text-red-700 hover:bg-red-50">Delete</button></td></tr>)}</tbody></table></div></div></div>}

      {expandedView && <div className="fixed inset-0 z-[60] bg-slate-950/70 p-4"><div className="h-full overflow-auto rounded-2xl bg-white p-5 shadow-2xl"><div className="mb-4 flex items-center justify-between"><h2 className="text-2xl font-bold">{expandedView === "project" ? "Project Assignment Gantt View" : expandedView === "resource" ? "Resource Gantt View" : "Resource Demand Graph"}</h2><button onClick={() => setExpandedView(null)} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold hover:bg-slate-50">Close</button></div>{expandedView === "project" && <div id="expanded-project-gantt"><GanttHeader timeline={timeline} zoom={zoom} /><div className="mt-3 min-w-[1500px] space-y-3">{projectGanttRows.map((row) => <ProjectGanttRow key={row.assignment.id} assignment={row.assignment} project={row.project} items={row.items} timeline={timeline} crews={crews} />)}</div></div>}{expandedView === "resource" && <div id="expanded-resource-gantt"><GanttHeader timeline={timeline} zoom={zoom} /><div className="mt-3 min-w-[1500px] space-y-3">{resourceGanttRows.map((row) => <ResourceGanttRow key={row.resource.id} resource={row.resource} items={row.items} timeline={timeline} onResourceClick={setFocusedResource} />)}</div></div>}{expandedView === "demand" && <ResourceDemandChart enlarged items={timelineVisibleItems} timeline={timeline} zoom={zoom} totalResources={resources.filter((resource) => dashboardResourceTypeFilter.includes(resource.resourceType) && demandHomeDivisionFilter.includes(resource.homeDivision)).length} onExportPdf={() => exportSectionPdf("resource-demand-graph", "Resource Demand Graph")} />}</div></div>}

      {showProjectForm && <ProjectForm form={projectForm} setForm={setProjectForm} onSave={saveProject} onCancel={() => setShowProjectForm(false)} editing={Boolean(editingProjectId)} certifications={certifications} />}
      {showAssignmentForm && <AssignmentForm form={assignmentForm} setForm={setAssignmentForm} onSave={saveAssignment} onCancel={() => setShowAssignmentForm(false)} editing={Boolean(editingAssignmentId)} resources={resources} projects={projects} crews={crews} />}
      {showResourceForm && <ResourceForm form={resourceForm} setForm={setResourceForm} certifications={certifications} onSave={saveResource} onCancel={() => setShowResourceForm(false)} editing={Boolean(editingResourceId)} />}
      {showCrewForm && <CrewForm form={crewForm} setForm={setCrewForm} certifications={certifications} onSave={saveCrew} onCancel={() => setShowCrewForm(false)} editing={Boolean(editingCrewId)} />}
    </main>
  );
}
