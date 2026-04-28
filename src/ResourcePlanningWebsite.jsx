import React, { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, CalendarDays, Users, BriefcaseBusiness, X, ZoomIn, Settings, Search } from "lucide-react";

const PROJECTS_KEY = "ggc_resource_planning_projects_v3";
const SUPERINTENDENTS_KEY = "ggc_resource_planning_superintendents_v1";
const CERTIFICATIONS_KEY = "ggc_resource_planning_certifications_v1";

const divisions = ["Hardscape", "Commercial", "Industrial", "Tilt"];
const statuses = ["Pending Award", "Scheduled", "Active", "On Hold", "Complete"];

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

const startingSuperintendents = [
  {
    id: crypto.randomUUID(),
    name: "Mike Reynolds",
    phone: "",
    email: "",
    homeDivision: "Commercial",
    certifications: ["OSHA 30", "First Aid / CPR"],
    pto: [],
    status: "Active",
  },
  {
    id: crypto.randomUUID(),
    name: "Carlos Vega",
    phone: "",
    email: "",
    homeDivision: "Hardscape",
    certifications: ["OSHA 10"],
    pto: [],
    status: "Active",
  },
  {
    id: crypto.randomUUID(),
    name: "Brandon Lee",
    phone: "",
    email: "",
    homeDivision: "Tilt",
    certifications: ["OSHA 30", "Rigging"],
    pto: [],
    status: "Active",
  },
];

const startingProjects = [
  {
    id: crypto.randomUUID(),
    name: "Eastside Apartments",
    client: "Evergreen Development",
    division: "Commercial",
    superintendent: "Mike Reynolds",
    crew1: "Crew A",
    crew2: "Crew B",
    crew3: "",
    crew4: "",
    start: "2026-04-20",
    end: "2026-05-22",
    status: "Active",
  },
  {
    id: crypto.randomUUID(),
    name: "Northview School",
    client: "Northview County Schools",
    division: "Hardscape",
    superintendent: "Carlos Vega",
    crew1: "Crew C",
    crew2: "",
    crew3: "",
    crew4: "",
    start: "2026-04-28",
    end: "2026-06-05",
    status: "Pending Award",
  },
  {
    id: crypto.randomUUID(),
    name: "Peachtree Retail",
    client: "Summit Retail Group",
    division: "Tilt",
    superintendent: "Mike Reynolds",
    crew1: "Crew D",
    crew2: "Crew E",
    crew3: "Crew F",
    crew4: "",
    start: "2026-05-12",
    end: "2026-06-18",
    status: "Scheduled",
  },
];

const blankProject = {
  name: "",
  client: "",
  division: "Hardscape",
  superintendent: "",
  crew1: "",
  crew2: "",
  crew3: "",
  crew4: "",
  start: "",
  end: "",
  status: "Scheduled",
};

const blankSuperintendent = {
  name: "",
  phone: "",
  email: "",
  homeDivision: "Hardscape",
  certifications: [],
  pto: [],
  status: "Active",
};

const zoomModes = ["Days", "Weeks", "Months", "Quarters", "Years"];

function toDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function startOfWeek(date) {
  const result = new Date(date);
  const day = result.getDay();
  result.setDate(result.getDate() - day);
  return result;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfQuarter(date) {
  const quarterMonth = Math.floor(date.getMonth() / 3) * 3;
  return new Date(date.getFullYear(), quarterMonth, 1);
}

function startOfYear(date) {
  return new Date(date.getFullYear(), 0, 1);
}

function daysBetween(start, end) {
  const startDate = start instanceof Date ? start : new Date(start);
  const endDate = end instanceof Date ? end : new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
  return Math.max(1, Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1);
}

function formatDate(date) {
  if (!date) return "Not set";
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return "Not set";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatTick(date, zoom) {
  if (zoom === "Days") return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (zoom === "Weeks") return `Week of ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  if (zoom === "Months") return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  if (zoom === "Quarters") return `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`;
  return String(date.getFullYear());
}

function buildTimeline(projects, zoom) {
  const starts = projects.map((p) => toDate(p.start)).filter(Boolean);
  const ends = projects.map((p) => toDate(p.end)).filter(Boolean);

  let min = starts.length ? new Date(Math.min(...starts)) : new Date();
  let max = ends.length ? new Date(Math.max(...ends)) : addDays(new Date(), 30);

  if (zoom === "Days") {
    min = addDays(min, -3);
    max = addDays(max, 3);
  }
  if (zoom === "Weeks") {
    min = startOfWeek(addDays(min, -7));
    max = addDays(max, 14);
  }
  if (zoom === "Months") {
    min = startOfMonth(addMonths(min, -1));
    max = addMonths(max, 1);
  }
  if (zoom === "Quarters") {
    min = startOfQuarter(addMonths(min, -3));
    max = addMonths(max, 3);
  }
  if (zoom === "Years") {
    min = startOfYear(min);
    max = addMonths(startOfYear(max), 12);
  }

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

function getProjectPeopleLabel(project) {
  return [project.superintendent, project.crew1, project.crew2, project.crew3, project.crew4].filter(Boolean).join(" • ");
}

function getProjectCrews(project) {
  return [project.crew1, project.crew2, project.crew3, project.crew4].filter(Boolean);
}

function loadStored(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

function toggleListValue(list, value) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{value}</p>
        </div>
        <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700">
          <Icon size={24} />
        </div>
      </div>
    </div>
  );
}

function MultiSelectFilter({ label, options, selected, setSelected }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="mb-2 text-sm font-semibold text-slate-700">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = selected.includes(option);
          return (
            <button
              key={option}
              onClick={() => setSelected((current) => toggleListValue(current, option))}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${active ? "bg-emerald-700 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"}`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SearchableSuperintendentSelect({ value, onChange, superintendents }) {
  const [query, setQuery] = useState(value || "");
  const [open, setOpen] = useState(false);

  useEffect(() => setQuery(value || ""), [value]);

  const filtered = superintendents.filter((sup) => sup.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="relative">
      <div className="flex items-center rounded-xl border border-slate-300 px-3 py-2 focus-within:border-emerald-600">
        <Search size={16} className="mr-2 text-slate-400" />
        <input
          className="w-full outline-none"
          value={query}
          placeholder="Search superintendent..."
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange(e.target.value);
            setOpen(true);
          }}
        />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {filtered.length ? filtered.map((sup) => (
            <button
              key={sup.id}
              type="button"
              onClick={() => {
                onChange(sup.name);
                setQuery(sup.name);
                setOpen(false);
              }}
              className="block w-full px-3 py-2 text-left hover:bg-emerald-50"
            >
              <p className="font-semibold text-slate-800">{sup.name}</p>
              <p className="text-xs text-slate-500">{sup.homeDivision}</p>
            </button>
          )) : <p className="px-3 py-2 text-sm text-slate-500">No matching superintendent</p>}
        </div>
      )}
    </div>
  );
}

function ProjectForm({ form, setForm, onSave, onCancel, editing, superintendents }) {
  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{editing ? "Edit Project" : "Add Project"}</h2>
            <p className="text-sm text-slate-500">Enter project, division, schedule, and resource details.</p>
          </div>
          <button onClick={onCancel} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
            <X size={20} />
          </button>
        </div>

        <div className="grid gap-4 p-5 md:grid-cols-2">
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
              {divisions.map((division) => <option key={division}>{division}</option>)}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Status</span>
            <select className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.status} onChange={(e) => updateField("status", e.target.value)}>
              {statuses.map((status) => <option key={status}>{status}</option>)}
            </select>
          </label>

          <label className="space-y-1 md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Superintendent</span>
            <SearchableSuperintendentSelect value={form.superintendent} onChange={(value) => updateField("superintendent", value)} superintendents={superintendents} />
          </label>

          {[1, 2, 3, 4].map((number) => (
            <label key={number} className="space-y-1">
              <span className="text-sm font-medium text-slate-700">Crew #{number}</span>
              <input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form[`crew${number}`]} onChange={(e) => updateField(`crew${number}`, e.target.value)} />
            </label>
          ))}

          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Start Date</span>
            <input type="date" className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.start} onChange={(e) => updateField("start", e.target.value)} />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">End Date</span>
            <input type="date" className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.end} onChange={(e) => updateField("end", e.target.value)} />
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

function SuperintendentForm({ form, setForm, certifications, onSave, onCancel, editing }) {
  const [ptoDraft, setPtoDraft] = useState({ ptoId: "", start: "", end: "" });

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function addPto() {
    if (!ptoDraft.ptoId || !ptoDraft.start || !ptoDraft.end) {
      alert("PTO ID, start date, and end date are required.");
      return;
    }
    setForm((current) => ({ ...current, pto: [...(current.pto || []), { ...ptoDraft, id: crypto.randomUUID() }] }));
    setPtoDraft({ ptoId: "", start: "", end: "" });
  }

  function deletePto(id) {
    setForm((current) => ({ ...current, pto: (current.pto || []).filter((item) => item.id !== id) }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{editing ? "Edit Superintendent" : "Add Superintendent"}</h2>
            <p className="text-sm text-slate-500">Create superintendent profile, certifications, and PTO records.</p>
          </div>
          <button onClick={onCancel} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
            <X size={20} />
          </button>
        </div>

        <div className="grid gap-4 p-5 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Name</span>
            <input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.name} onChange={(e) => updateField("name", e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Home Division</span>
            <select className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.homeDivision} onChange={(e) => updateField("homeDivision", e.target.value)}>
              {divisions.map((division) => <option key={division}>{division}</option>)}
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
          <label className="space-y-1 md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Status</span>
            <select className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.status} onChange={(e) => updateField("status", e.target.value)}>
              <option>Active</option>
              <option>Available</option>
              <option>Inactive</option>
            </select>
          </label>
        </div>

        <div className="border-t border-slate-200 p-5">
          <h3 className="font-bold text-slate-900">Certifications</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {certifications.map((cert) => {
              const active = (form.certifications || []).includes(cert);
              return (
                <button key={cert} onClick={() => updateField("certifications", toggleListValue(form.certifications || [], cert))} className={`rounded-full px-3 py-1 text-xs font-semibold ${active ? "bg-emerald-700 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"}`}>
                  {cert}
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-t border-slate-200 p-5">
          <h3 className="font-bold text-slate-900">PTO</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
            <input placeholder="PTO ID" className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={ptoDraft.ptoId} onChange={(e) => setPtoDraft((current) => ({ ...current, ptoId: e.target.value }))} />
            <input type="date" className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={ptoDraft.start} onChange={(e) => setPtoDraft((current) => ({ ...current, start: e.target.value }))} />
            <input type="date" className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={ptoDraft.end} onChange={(e) => setPtoDraft((current) => ({ ...current, end: e.target.value }))} />
            <button onClick={addPto} className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white">Add PTO</button>
          </div>
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="p-3">PTO ID</th>
                  <th className="p-3">Start</th>
                  <th className="p-3">End</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
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
          <button onClick={onSave} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800">Save Superintendent</button>
        </div>
      </div>
    </div>
  );
}

function GanttHeader({ timeline, zoom }) {
  return (
    <div className="ml-[260px] min-w-[900px] border-b border-slate-200 pb-2">
      <div className="relative h-10">
        {timeline.ticks.map((tick, index) => {
          const left = ((daysBetween(timeline.minDate, tick) - 1) / timeline.totalDays) * 100;
          return (
            <div key={`${tick.toISOString()}-${index}`} className="absolute top-0 h-10 border-l border-slate-200 pl-2 text-xs font-medium text-slate-500" style={{ left: `${left}%` }}>
              {formatTick(tick, zoom)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GanttBar({ project, timeline }) {
  const start = toDate(project.start);
  const end = toDate(project.end);
  const offset = start ? daysBetween(timeline.minDate, start) - 1 : 0;
  const length = start && end ? daysBetween(start, end) : 1;
  const left = timeline.totalDays > 0 ? (offset / timeline.totalDays) * 100 : 0;
  const width = timeline.totalDays > 0 ? (length / timeline.totalDays) * 100 : 10;
  const colorClass = project.status === "Pending Award" ? pendingDivisionStyles[project.division] || "bg-slate-300" : divisionStyles[project.division] || "bg-slate-700";
  const label = getProjectPeopleLabel(project);

  return (
    <div className="relative h-11 rounded-xl bg-slate-100">
      <div className={`absolute top-1 h-9 overflow-hidden rounded-xl ${colorClass} px-3 text-xs font-semibold leading-9 text-white shadow-sm`} style={{ left: `${Math.max(0, left)}%`, width: `${Math.max(7, width)}%` }} title={label || project.name}>
        {label}
      </div>
    </div>
  );
}

export default function App() {
  const [projects, setProjects] = useState(() => loadStored(PROJECTS_KEY, startingProjects));
  const [superintendents, setSuperintendents] = useState(() => loadStored(SUPERINTENDENTS_KEY, startingSuperintendents));
  const [certifications, setCertifications] = useState(() => loadStored(CERTIFICATIONS_KEY, startingCertifications));
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showSuperintendentForm, setShowSuperintendentForm] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editingSuperintendentId, setEditingSuperintendentId] = useState(null);
  const [projectForm, setProjectForm] = useState(blankProject);
  const [superintendentForm, setSuperintendentForm] = useState(blankSuperintendent);
  const [zoom, setZoom] = useState("Months");
  const [divisionFilter, setDivisionFilter] = useState([...divisions]);
  const [statusFilter, setStatusFilter] = useState([...statuses]);
  const [page, setPage] = useState("dashboard");
  const [showCertSettings, setShowCertSettings] = useState(false);
  const [newCertification, setNewCertification] = useState("");

  useEffect(() => localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects)), [projects]);
  useEffect(() => localStorage.setItem(SUPERINTENDENTS_KEY, JSON.stringify(superintendents)), [superintendents]);
  useEffect(() => localStorage.setItem(CERTIFICATIONS_KEY, JSON.stringify(certifications)), [certifications]);

  const visibleProjects = projects.filter((project) => divisionFilter.includes(project.division) && statusFilter.includes(project.status));
  const activeProjects = projects.filter((project) => project.status !== "Complete");
  const crews = [...new Set(projects.flatMap((p) => getProjectCrews(p)).filter(Boolean))];
  const timeline = useMemo(() => buildTimeline(visibleProjects, zoom), [visibleProjects, zoom]);

  function openAddProjectForm() {
    setEditingProjectId(null);
    setProjectForm(blankProject);
    setShowProjectForm(true);
  }

  function openEditProjectForm(project) {
    setEditingProjectId(project.id);
    setProjectForm({ ...blankProject, ...project });
    setShowProjectForm(true);
  }

  function saveProject() {
    if (!projectForm.name.trim()) {
      alert("Project name is required.");
      return;
    }
    if (editingProjectId) setProjects((current) => current.map((project) => (project.id === editingProjectId ? { ...projectForm, id: editingProjectId } : project)));
    else setProjects((current) => [{ ...projectForm, id: crypto.randomUUID() }, ...current]);
    setShowProjectForm(false);
    setEditingProjectId(null);
    setProjectForm(blankProject);
  }

  function deleteProject(id) {
    const project = projects.find((item) => item.id === id);
    if (!confirm(`Delete ${project?.name || "this project"}?`)) return;
    setProjects((current) => current.filter((project) => project.id !== id));
  }

  function openAddSuperintendentForm() {
    setEditingSuperintendentId(null);
    setSuperintendentForm(blankSuperintendent);
    setShowSuperintendentForm(true);
  }

  function openEditSuperintendentForm(superintendent) {
    setEditingSuperintendentId(superintendent.id);
    setSuperintendentForm({ ...blankSuperintendent, ...superintendent });
    setShowSuperintendentForm(true);
  }

  function saveSuperintendent() {
    if (!superintendentForm.name.trim()) {
      alert("Superintendent name is required.");
      return;
    }
    if (editingSuperintendentId) setSuperintendents((current) => current.map((sup) => (sup.id === editingSuperintendentId ? { ...superintendentForm, id: editingSuperintendentId } : sup)));
    else setSuperintendents((current) => [{ ...superintendentForm, id: crypto.randomUUID() }, ...current]);
    setShowSuperintendentForm(false);
    setEditingSuperintendentId(null);
    setSuperintendentForm(blankSuperintendent);
  }

  function deleteSuperintendent(id) {
    const sup = superintendents.find((item) => item.id === id);
    if (!confirm(`Delete ${sup?.name || "this superintendent"}?`)) return;
    setSuperintendents((current) => current.filter((item) => item.id !== id));
  }

  function addCertification() {
    const cert = newCertification.trim();
    if (!cert) return;
    if (!certifications.includes(cert)) setCertifications((current) => [...current, cert]);
    setNewCertification("");
  }

  function deleteCertification(cert) {
    setCertifications((current) => current.filter((item) => item !== cert));
    setSuperintendents((current) => current.map((sup) => ({ ...sup, certifications: (sup.certifications || []).filter((item) => item !== cert) })));
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <div className="h-1 w-24 rounded-full bg-emerald-700" />
            <h1 className="mt-3 text-3xl font-bold tracking-tight">GGC Resource Planning</h1>
            <p className="mt-1 text-slate-500">Project, superintendent, crew, and division scheduling dashboard.</p>
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <button onClick={() => setPage("dashboard")} className={`rounded-xl px-4 py-3 font-semibold shadow-sm ${page === "dashboard" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>Dashboard</button>
            <button onClick={() => setPage("superintendents")} className={`rounded-xl px-4 py-3 font-semibold shadow-sm ${page === "superintendents" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>Superintendents</button>
            <button onClick={openAddProjectForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white shadow-sm hover:bg-emerald-800"><Plus size={18} /> Add Project</button>
          </div>
        </div>
      </header>

      {page === "superintendents" ? (
        <section className="mx-auto max-w-7xl space-y-6 px-6 py-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-2xl font-bold">Company Superintendents</h2>
                <p className="text-sm text-slate-500">Master list used by the project superintendent searchable dropdown.</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button onClick={() => setShowCertSettings((current) => !current)} className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"><Settings size={17} /> Certification Settings</button>
                <button onClick={openAddSuperintendentForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800"><Plus size={17} /> Add Superintendent</button>
              </div>
            </div>

            {showCertSettings && (
              <div className="mb-5 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                <h3 className="font-bold text-slate-900">Saved Certification Selections</h3>
                <div className="mt-3 flex gap-2">
                  <input value={newCertification} onChange={(e) => setNewCertification(e.target.value)} placeholder="Add certification" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none focus:border-emerald-600" />
                  <button onClick={addCertification} className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white">Add</button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {certifications.map((cert) => (
                    <span key={cert} className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">
                      {cert}
                      <button onClick={() => deleteCertification(cert)} className="text-red-600">×</button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[1050px] text-left text-sm">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th className="p-3">Name</th>
                    <th className="p-3">Home Division</th>
                    <th className="p-3">Phone</th>
                    <th className="p-3">Email</th>
                    <th className="p-3">Certifications</th>
                    <th className="p-3">PTO</th>
                    <th className="p-3">Current Projects</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {superintendents.map((sup) => (
                    <tr key={sup.id} className="border-t border-slate-200 align-top">
                      <td className="p-3 font-medium">{sup.name}</td>
                      <td className="p-3">{sup.homeDivision}</td>
                      <td className="p-3">{sup.phone}</td>
                      <td className="p-3">{sup.email}</td>
                      <td className="p-3">{(sup.certifications || []).join(", ")}</td>
                      <td className="p-3">{(sup.pto || []).map((pto) => `${pto.ptoId}: ${formatDate(pto.start)} - ${formatDate(pto.end)}`).join("; ")}</td>
                      <td className="p-3">{projects.filter((p) => p.superintendent === sup.name).map((p) => p.name).join(", ")}</td>
                      <td className="p-3 text-right">
                        <button onClick={() => openEditSuperintendentForm(sup)} className="mr-2 rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50">Edit</button>
                        <button onClick={() => deleteSuperintendent(sup.id)} className="rounded-lg border border-red-200 px-3 py-1.5 font-medium text-red-700 hover:bg-red-50">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      ) : (
        <section className="mx-auto max-w-7xl space-y-6 px-6 py-6">
          <div className="grid gap-4 md:grid-cols-4">
            <StatCard icon={BriefcaseBusiness} label="Total Projects" value={projects.length} />
            <StatCard icon={CalendarDays} label="Active/Scheduled" value={activeProjects.length} />
            <StatCard icon={Users} label="Superintendents" value={superintendents.length} />
            <StatCard icon={Users} label="Crews" value={crews.length} />
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-bold">Project Gantt View</h2>
                <p className="text-sm text-slate-500">Ribbon color is based on division. Pending Award shows as a lighter division shade.</p>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <ZoomIn size={16} className="text-slate-500" />
                <span className="text-sm font-medium text-slate-700">Zoom</span>
                <select value={zoom} onChange={(e) => setZoom(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-emerald-600">
                  {zoomModes.map((mode) => <option key={mode}>{mode}</option>)}
                </select>
              </div>
            </div>

            <div className="mb-4 grid gap-3 lg:grid-cols-2">
              <MultiSelectFilter label="Division Filter" options={divisions} selected={divisionFilter} setSelected={setDivisionFilter} />
              <MultiSelectFilter label="Status Filter" options={statuses} selected={statusFilter} setSelected={setStatusFilter} />
            </div>

            <div className="mb-4 flex flex-wrap gap-3 text-xs font-semibold">
              {divisions.map((division) => <div key={division} className="flex items-center gap-2"><span className={`h-3 w-8 rounded-full ${divisionStyles[division]}`} /><span className="text-slate-600">{division}</span></div>)}
              <div className="text-slate-400">Pending Award uses lighter shade</div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200 p-4">
              <GanttHeader timeline={timeline} zoom={zoom} />
              <div className="mt-3 min-w-[1160px] space-y-3">
                {visibleProjects.map((project) => (
                  <div key={project.id} className="grid grid-cols-[240px_1fr] items-center gap-5">
                    <button onClick={() => openEditProjectForm(project)} className="text-left">
                      <div className="flex items-center gap-2">
                        <span className={`h-3 w-3 rounded-full ${project.status === "Pending Award" ? pendingDivisionStyles[project.division] : divisionStyles[project.division] || "bg-slate-600"}`} />
                        <p className="font-semibold text-slate-900 hover:text-emerald-700">{project.name}</p>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{project.division} • {project.status} • {formatDate(project.start)} - {formatDate(project.end)}</p>
                    </button>
                    <GanttBar project={project} timeline={timeline} />
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-xl font-bold">Superintendent Schedule</h2>
              <div className="mt-4 space-y-3">
                {superintendents.map((sup) => (
                  <div key={sup.id} className="rounded-xl border border-slate-200 p-4">
                    <p className="font-semibold">{sup.name}</p>
                    <p className="mt-1 text-sm text-slate-500">{projects.filter((p) => p.superintendent === sup.name).map((p) => p.name).join(", ")}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-xl font-bold">Crew Schedule</h2>
              <div className="mt-4 space-y-3">
                {crews.map((name) => (
                  <div key={name} className="rounded-xl border border-slate-200 p-4">
                    <p className="font-semibold">{name}</p>
                    <p className="mt-1 text-sm text-slate-500">{projects.filter((p) => getProjectCrews(p).includes(name)).map((p) => p.name).join(", ")}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold">Project List</h2>
            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[1150px] text-left text-sm">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th className="p-3">Project</th>
                    <th className="p-3">Division</th>
                    <th className="p-3">Client</th>
                    <th className="p-3">Superintendent</th>
                    <th className="p-3">Crew #1</th>
                    <th className="p-3">Crew #2</th>
                    <th className="p-3">Crew #3</th>
                    <th className="p-3">Crew #4</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => (
                    <tr key={project.id} className="border-t border-slate-200">
                      <td className="p-3 font-medium">{project.name}</td>
                      <td className="p-3">{project.division}</td>
                      <td className="p-3">{project.client}</td>
                      <td className="p-3">{project.superintendent}</td>
                      <td className="p-3">{project.crew1}</td>
                      <td className="p-3">{project.crew2}</td>
                      <td className="p-3">{project.crew3}</td>
                      <td className="p-3">{project.crew4}</td>
                      <td className="p-3">{project.status}</td>
                      <td className="p-3 text-right">
                        <button onClick={() => openEditProjectForm(project)} className="mr-2 rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50">Edit</button>
                        <button onClick={() => deleteProject(project.id)} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 font-medium text-red-700 hover:bg-red-50"><Trash2 size={14} /> Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      )}

      {showProjectForm && <ProjectForm form={projectForm} setForm={setProjectForm} onSave={saveProject} onCancel={() => setShowProjectForm(false)} editing={Boolean(editingProjectId)} superintendents={superintendents} />}
      {showSuperintendentForm && <SuperintendentForm form={superintendentForm} setForm={setSuperintendentForm} certifications={certifications} onSave={saveSuperintendent} onCancel={() => setShowSuperintendentForm(false)} editing={Boolean(editingSuperintendentId)} />}
    </main>
  );
}

