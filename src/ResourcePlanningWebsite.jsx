import React, { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, CalendarDays, Users, BriefcaseBusiness, X } from "lucide-react";

const STORAGE_KEY = "ggc_resource_planning_projects";

const startingProjects = [
  {
    id: crypto.randomUUID(),
    name: "Eastside Apartments",
    client: "Evergreen Development",
    superintendent: "Mike Reynolds",
    crew: "Crew A",
    start: "2026-04-20",
    end: "2026-05-22",
    status: "Active",
  },
  {
    id: crypto.randomUUID(),
    name: "Northview School",
    client: "Northview County Schools",
    superintendent: "Carlos Vega",
    crew: "Crew B",
    start: "2026-04-28",
    end: "2026-06-05",
    status: "Active",
  },
  {
    id: crypto.randomUUID(),
    name: "Peachtree Retail",
    client: "Summit Retail Group",
    superintendent: "Mike Reynolds",
    crew: "Crew B",
    start: "2026-05-12",
    end: "2026-06-18",
    status: "Scheduled",
  },
];

const blankProject = {
  name: "",
  client: "",
  superintendent: "",
  crew: "",
  start: "",
  end: "",
  status: "Scheduled",
};

function daysBetween(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
  return Math.max(1, Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1);
}

function formatDate(date) {
  if (!date) return "Not set";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "Not set";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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

function ProjectForm({ form, setForm, onSave, onCancel, editing }) {
  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{editing ? "Edit Project" : "Add Project"}</h2>
            <p className="text-sm text-slate-500">Enter schedule and resource details.</p>
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
            <span className="text-sm font-medium text-slate-700">Superintendent</span>
            <input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.superintendent} onChange={(e) => updateField("superintendent", e.target.value)} />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Crew</span>
            <input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.crew} onChange={(e) => updateField("crew", e.target.value)} />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Start Date</span>
            <input type="date" className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.start} onChange={(e) => updateField("start", e.target.value)} />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">End Date</span>
            <input type="date" className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.end} onChange={(e) => updateField("end", e.target.value)} />
          </label>

          <label className="space-y-1 md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Status</span>
            <select className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.status} onChange={(e) => updateField("status", e.target.value)}>
              <option>Scheduled</option>
              <option>Active</option>
              <option>On Hold</option>
              <option>Complete</option>
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

function GanttBar({ project, minDate, totalDays }) {
  const offset = daysBetween(minDate, project.start) - 1;
  const length = daysBetween(project.start, project.end);
  const left = totalDays > 0 ? (offset / totalDays) * 100 : 0;
  const width = totalDays > 0 ? (length / totalDays) * 100 : 10;

  return (
    <div className="relative h-10 rounded-xl bg-slate-100">
      <div
        className="absolute top-1 h-8 rounded-xl bg-emerald-700 px-3 text-xs font-semibold leading-8 text-white shadow-sm"
        style={{ left: `${Math.max(0, left)}%`, width: `${Math.max(8, width)}%` }}
      >
        {project.name}
      </div>
    </div>
  );
}

export default function App() {
  const [projects, setProjects] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : startingProjects;
  });
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(blankProject);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  }, [projects]);

  const activeProjects = projects.filter((project) => project.status !== "Complete");
  const superintendents = [...new Set(projects.map((p) => p.superintendent).filter(Boolean))];
  const crews = [...new Set(projects.map((p) => p.crew).filter(Boolean))];

  const timeline = useMemo(() => {
    const starts = projects.map((p) => new Date(p.start)).filter((d) => !Number.isNaN(d.getTime()));
    const ends = projects.map((p) => new Date(p.end)).filter((d) => !Number.isNaN(d.getTime()));
    const min = starts.length ? new Date(Math.min(...starts)) : new Date();
    const max = ends.length ? new Date(Math.max(...ends)) : new Date();
    return { minDate: min.toISOString().slice(0, 10), totalDays: daysBetween(min, max) };
  }, [projects]);

  function openAddForm() {
    setEditingId(null);
    setForm(blankProject);
    setShowForm(true);
  }

  function openEditForm(project) {
    setEditingId(project.id);
    setForm(project);
    setShowForm(true);
  }

  function saveProject() {
    if (!form.name.trim()) {
      alert("Project name is required.");
      return;
    }

    if (editingId) {
      setProjects((current) => current.map((project) => (project.id === editingId ? { ...form, id: editingId } : project)));
    } else {
      setProjects((current) => [{ ...form, id: crypto.randomUUID() }, ...current]);
    }

    setShowForm(false);
    setEditingId(null);
    setForm(blankProject);
  }

  function deleteProject(id) {
    const project = projects.find((item) => item.id === id);
    const confirmed = confirm(`Delete ${project?.name || "this project"}?`);
    if (!confirmed) return;
    setProjects((current) => current.filter((project) => project.id !== id));
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <div className="h-1 w-24 rounded-full bg-emerald-700" />
            <h1 className="mt-3 text-3xl font-bold tracking-tight">GGC Resource Planning</h1>
            <p className="mt-1 text-slate-500">Project, superintendent, and crew scheduling dashboard.</p>
          </div>
          <button onClick={openAddForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white shadow-sm hover:bg-emerald-800">
            <Plus size={18} /> Add Project
          </button>
        </div>
      </header>

      <section className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard icon={BriefcaseBusiness} label="Total Projects" value={projects.length} />
          <StatCard icon={CalendarDays} label="Active/Scheduled" value={activeProjects.length} />
          <StatCard icon={Users} label="Superintendents" value={superintendents.length} />
          <StatCard icon={Users} label="Crews" value={crews.length} />
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold">Project Gantt View</h2>
              <p className="text-sm text-slate-500">Visual schedule based on start and end dates.</p>
            </div>
            <p className="text-sm text-slate-500">{formatDate(timeline.minDate)}</p>
          </div>

          <div className="space-y-3">
            {projects.map((project) => (
              <div key={project.id} className="grid gap-3 md:grid-cols-[220px_1fr] md:items-center">
                <button onClick={() => openEditForm(project)} className="text-left">
                  <p className="font-semibold text-slate-900 hover:text-emerald-700">{project.name}</p>
                  <p className="text-xs text-slate-500">{formatDate(project.start)} - {formatDate(project.end)}</p>
                </button>
                <GanttBar project={project} minDate={timeline.minDate} totalDays={timeline.totalDays} />
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold">Superintendent Schedule</h2>
            <div className="mt-4 space-y-3">
              {superintendents.map((name) => (
                <div key={name} className="rounded-xl border border-slate-200 p-4">
                  <p className="font-semibold">{name}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {projects.filter((p) => p.superintendent === name).map((p) => p.name).join(", ")}
                  </p>
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
                  <p className="mt-1 text-sm text-slate-500">
                    {projects.filter((p) => p.crew === name).map((p) => p.name).join(", ")}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Project List</h2>
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="p-3">Project</th>
                  <th className="p-3">Client</th>
                  <th className="p-3">Superintendent</th>
                  <th className="p-3">Crew</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id} className="border-t border-slate-200">
                    <td className="p-3 font-medium">{project.name}</td>
                    <td className="p-3">{project.client}</td>
                    <td className="p-3">{project.superintendent}</td>
                    <td className="p-3">{project.crew}</td>
                    <td className="p-3">{project.status}</td>
                    <td className="p-3 text-right">
                      <button onClick={() => openEditForm(project)} className="mr-2 rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50">Edit</button>
                      <button onClick={() => deleteProject(project.id)} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 font-medium text-red-700 hover:bg-red-50">
                        <Trash2 size={14} /> Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      {showForm && (
        <ProjectForm
          form={form}
          setForm={setForm}
          onSave={saveProject}
          onCancel={() => setShowForm(false)}
          editing={Boolean(editingId)}
        />
      )}
    </main>
  );
}

