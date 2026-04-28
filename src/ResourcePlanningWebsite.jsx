import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/Icons";
import { initialProjects, initialCrews, initialSuperintendents, weeks } from "@/data/sampleData";

const allowedStatuses = ["Planned", "Confirmed", "At Risk"];
const CELL_WIDTH = 116;
const ROW_LABEL_WIDTH = 300;

function getStatusClass(status) {
  if (status === "At Risk") return "bg-red-50 text-red-700 border-red-200";
  if (status === "Confirmed") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

function getBarClass(status) {
  if (status === "At Risk") return "bg-red-600 text-white ring-red-200";
  if (status === "Confirmed") return "bg-ggc-green text-white ring-emerald-200";
  return "bg-slate-800 text-white ring-slate-200";
}

function getProjectEndWeek(project) {
  return project.startWeek + project.durationWeeks - 1;
}

function projectTouchesWeek(project, weekIndex) {
  return weekIndex >= project.startWeek && weekIndex <= getProjectEndWeek(project);
}

function getCrewAssignments(projects, crewName) {
  return projects.filter((project) => project.crew === crewName);
}

function getSuperintendentAssignments(projects, superintendentName) {
  return projects.filter((project) => project.superintendent === superintendentName);
}

function hasAssignmentConflict(projects, assignments) {
  return weeks.some((_, weekIndex) => assignments.filter((project) => projectTouchesWeek(project, weekIndex)).length > 1);
}

function filterProjects(projectList, searchText, status) {
  const normalizedSearch = searchText.trim().toLowerCase();
  return projectList.filter((project) => {
    const searchable = `${project.id} ${project.name} ${project.location} ${project.pm} ${project.crew} ${project.superintendent}`.toLowerCase();
    const matchesQuery = searchable.includes(normalizedSearch);
    const matchesStatus = status === "All" || project.status === status;
    return matchesQuery && matchesStatus;
  });
}

function filterCrews(crewList, searchText) {
  const normalizedSearch = searchText.trim().toLowerCase();
  return crewList.filter((crew) => `${crew.name} ${crew.capacity} ${crew.type}`.toLowerCase().includes(normalizedSearch));
}

function filterSuperintendents(superintendentList, searchText) {
  const normalizedSearch = searchText.trim().toLowerCase();
  return superintendentList.filter((superintendent) => `${superintendent.name} ${superintendent.role}`.toLowerCase().includes(normalizedSearch));
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(value.trim());
      value = "";
    } else {
      value += char;
    }
  }

  values.push(value.trim());
  return values;
}

function parseProjectCsv(csvText) {
  const lines = csvText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase());
  return lines.slice(1).map((line, index) => {
    const row = parseCsvLine(line);
    const record = Object.fromEntries(headers.map((header, columnIndex) => [header, row[columnIndex] ?? ""]));

    return {
      id: record.id || `CSV-${index + 1}`,
      name: record.name || "Imported Project",
      pm: record.pm || "",
      location: record.location || "",
      startWeek: Number.parseInt(record.startweek || record.start_week || "0", 10),
      durationWeeks: Number.parseInt(record.durationweeks || record.duration_weeks || "1", 10),
      phase: record.phase || "",
      status: allowedStatuses.includes(record.status) ? record.status : "Planned",
      crew: record.crew || "Crew A",
      superintendent: record.superintendent || "Open",
    };
  });
}

function validatePlanningData(projects, crews, superintendents) {
  const errors = [];
  const crewNames = new Set(crews.map((crew) => crew.name));
  const superintendentNames = new Set(superintendents.map((superintendent) => superintendent.name));

  projects.forEach((project) => {
    if (!project.id || !project.name) errors.push("Every project must have an id and name.");
    if (!allowedStatuses.includes(project.status)) errors.push(`${project.id} has an invalid status.`);
    if (!Number.isInteger(project.startWeek) || project.startWeek < 0) errors.push(`${project.id} startWeek must be a valid week index.`);
    if (!Number.isInteger(project.durationWeeks) || project.durationWeeks <= 0) errors.push(`${project.id} durationWeeks must be greater than zero.`);
    if (getProjectEndWeek(project) >= weeks.length) errors.push(`${project.id} extends beyond the visible timeline.`);
    if (!crewNames.has(project.crew)) errors.push(`${project.id} uses unknown crew ${project.crew}.`);
    if (!superintendentNames.has(project.superintendent)) errors.push(`${project.id} uses unknown superintendent ${project.superintendent}.`);
  });

  return errors;
}

function runSelfTests(projects, crews, superintendents) {
  const errors = [];

  if (filterProjects(projects, "duluth", "All").length !== 1) errors.push("Project search should find the Duluth job.");
  if (filterProjects(projects, "", "Planned").length !== 2) errors.push("Status filter should find two planned projects.");
  if (filterCrews(crews, "crew a").length !== 1) errors.push("Crew search should find Crew A.");
  if (filterSuperintendents(superintendents, "luis").length !== 1) errors.push("Superintendent search should find Luis M.");
  if (projectTouchesWeek(projects[0], 0) !== true || projectTouchesWeek(projects[0], 7) !== false) errors.push("Project Gantt week logic should match project start and duration.");

  return errors;
}

function GanttHeader({ label = "Name" }) {
  return (
    <div className="flex border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
      <div className="sticky left-0 z-20 shrink-0 border-r border-slate-200 bg-slate-50 p-3" style={{ width: ROW_LABEL_WIDTH }}>
        {label}
      </div>
      {weeks.map((week) => (
        <div key={week} className="shrink-0 border-r border-slate-200 p-3 text-center" style={{ width: CELL_WIDTH }}>
          {week}
        </div>
      ))}
    </div>
  );
}

function EmptyWeekCells() {
  return weeks.map((week, index) => (
    <div key={week} className={`shrink-0 border-r border-slate-200 ${index % 2 === 0 ? "bg-white" : "bg-slate-50/60"}`} style={{ width: CELL_WIDTH }} />
  ));
}

function ProjectBar({ project, compact = false }) {
  return (
    <div
      className={`absolute top-2 flex h-10 items-center overflow-hidden rounded-xl px-3 text-xs font-bold shadow-md ring-4 ${getBarClass(project.status)}`}
      style={{
        left: project.startWeek * CELL_WIDTH + 10,
        width: project.durationWeeks * CELL_WIDTH - 20,
      }}
      title={`${project.name} · ${project.phase}`}
    >
      <span className="truncate">{compact ? `${project.id} · ${project.phase}` : `${project.id} · ${project.name}`}</span>
    </div>
  );
}

function CrewGanttRow({ projects, crew }) {
  const assignments = getCrewAssignments(projects, crew.name);
  const conflict = hasAssignmentConflict(projects, assignments);

  return (
    <div className="flex min-h-[68px] border-b border-slate-200 bg-white text-sm">
      <div className="sticky left-0 z-10 flex shrink-0 items-center justify-between gap-3 border-r border-slate-200 bg-white p-3" style={{ width: ROW_LABEL_WIDTH }}>
        <div>
          <div className="font-bold text-slate-900">{crew.name}</div>
          <div className="text-xs text-slate-500">{crew.type} · {crew.capacity}</div>
        </div>
        {conflict && <span className="rounded-full bg-red-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-red-700">Conflict</span>}
      </div>
      <div className="relative flex min-h-[68px]">
        <EmptyWeekCells />
        {assignments.map((project) => <ProjectBar key={`${crew.id}-${project.id}`} project={project} compact />)}
      </div>
    </div>
  );
}

function SuperintendentGanttRow({ projects, superintendent }) {
  const assignments = getSuperintendentAssignments(projects, superintendent.name);
  const conflict = hasAssignmentConflict(projects, assignments);

  return (
    <div className="flex min-h-[68px] border-b border-slate-200 bg-white text-sm">
      <div className="sticky left-0 z-10 flex shrink-0 items-center justify-between gap-3 border-r border-slate-200 bg-white p-3" style={{ width: ROW_LABEL_WIDTH }}>
        <div>
          <div className="font-bold text-slate-900">{superintendent.name}</div>
          <div className="text-xs text-slate-500">{superintendent.role}</div>
        </div>
        {conflict && <span className="rounded-full bg-red-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-red-700">Conflict</span>}
      </div>
      <div className="relative flex min-h-[68px]">
        <EmptyWeekCells />
        {assignments.map((project) => <ProjectBar key={`${superintendent.id}-${project.id}`} project={project} compact />)}
      </div>
    </div>
  );
}

function ProjectGanttRow({ project }) {
  return (
    <div className="flex min-h-[82px] border-b border-slate-200 bg-white text-sm">
      <div className="sticky left-0 z-10 shrink-0 border-r border-slate-200 bg-white p-3" style={{ width: ROW_LABEL_WIDTH }}>
        <div className="font-bold text-slate-900">{project.name}</div>
        <div className="text-xs text-slate-500">{project.id} · {project.location}</div>
        <div className="mt-2 flex flex-wrap gap-1">
          <span className="rounded-full bg-ggc-soft px-2 py-0.5 text-[10px] font-bold text-ggc-green">{project.crew}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Superintendent: {project.superintendent}</span>
        </div>
      </div>
      <div className="relative flex min-h-[82px]">
        <EmptyWeekCells />
        <ProjectBar project={project} />
      </div>
    </div>
  );
}

function CsvUpload({ onImport }) {
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState("CSV columns: id,name,pm,location,startWeek,durationWeeks,phase,status,crew,superintendent");

  async function handleFile(file) {
    if (!file) return;
    const text = await file.text();
    const imported = parseProjectCsv(text);
    if (imported.length === 0) {
      setMessage("No project rows found. Check your CSV format.");
      return;
    }
    onImport(imported);
    setMessage(`Imported ${imported.length} project row${imported.length === 1 ? "" : "s"}.`);
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        handleFile(event.dataTransfer.files?.[0]);
      }}
      className={`rounded-2xl border-2 border-dashed p-5 transition ${dragging ? "border-ggc-green bg-ggc-soft" : "border-slate-300 bg-white"}`}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-ggc-soft p-3 text-ggc-green">
            <Icon name="upload" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900">Drag-and-drop project upload</h3>
            <p className="text-sm text-slate-500">{message}</p>
          </div>
        </div>
        <label className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-ggc-green px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-ggc-dark">
          Select CSV
          <input className="hidden" type="file" accept=".csv,text/csv" onChange={(event) => handleFile(event.target.files?.[0])} />
        </label>
      </div>
    </div>
  );
}

export default function ResourcePlanningWebsite() {
  const [projects, setProjects] = useState(initialProjects);
  const [projectQuery, setProjectQuery] = useState("");
  const [crewQuery, setCrewQuery] = useState("");
  const [superintendentQuery, setSuperintendentQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const filteredProjects = useMemo(() => filterProjects(projects, projectQuery, statusFilter), [projects, projectQuery, statusFilter]);
  const filteredCrews = useMemo(() => filterCrews(initialCrews, crewQuery), [crewQuery]);
  const filteredSuperintendents = useMemo(() => filterSuperintendents(initialSuperintendents, superintendentQuery), [superintendentQuery]);

  const crewConflicts = initialCrews.filter((crew) => hasAssignmentConflict(projects, getCrewAssignments(projects, crew.name)));
  const superintendentConflicts = initialSuperintendents.filter((superintendent) => hasAssignmentConflict(projects, getSuperintendentAssignments(projects, superintendent.name)));
  const atRiskProjects = projects.filter((project) => project.status === "At Risk").length;
  const totalAssignments = projects.length * 2;
  const appErrors = [...validatePlanningData(projects, initialCrews, initialSuperintendents), ...runSelfTests(initialProjects, initialCrews, initialSuperintendents)];

  if (appErrors.length > 0) {
    return (
      <div className="min-h-screen bg-slate-50 p-6 text-slate-900">
        <div className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-bold text-red-700">Resource Planner data check failed</h1>
          <p className="mt-2 text-sm text-slate-600">Fix the following issues before loading the planning dashboard:</p>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-slate-700">
            {appErrors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ggc-green text-white shadow-sm">
                <Icon name="building" size={26} className="h-7 w-7" />
              </div>
              <div>
                <div className="h-1 w-28 rounded-full bg-ggc-green" />
                <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">GGC Resource Planner</h1>
                <p className="text-sm font-medium text-slate-500">Crew, superintendent, and project Gantt planning board.</p>
              </div>
            </div>
            <Button className="rounded-xl bg-ggc-green hover:bg-ggc-dark">
              <Icon name="plus" className="mr-2 h-4 w-4" size={16} /> Add Assignment
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="grid gap-4 md:grid-cols-4">
          <Card><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-sm font-bold uppercase tracking-wide text-slate-500">Projects</p><Icon name="calendar" className="h-5 w-5 text-ggc-green" /></div><p className="mt-2 text-3xl font-black">{projects.length}</p></CardContent></Card>
          <Card><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-sm font-bold uppercase tracking-wide text-slate-500">Crews</p><Icon name="users" className="h-5 w-5 text-ggc-green" /></div><p className="mt-2 text-3xl font-black">{initialCrews.length}</p></CardContent></Card>
          <Card><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-sm font-bold uppercase tracking-wide text-slate-500">Superintendents</p><Icon name="chart" className="h-5 w-5 text-ggc-green" /></div><p className="mt-2 text-3xl font-black">{initialSuperintendents.length}</p></CardContent></Card>
          <Card className="border-red-100"><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-sm font-bold uppercase tracking-wide text-slate-500">Conflicts / At Risk</p><Icon name="alert" className="h-5 w-5 text-red-600" /></div><p className="mt-2 text-3xl font-black">{crewConflicts.length + superintendentConflicts.length + atRiskProjects}</p></CardContent></Card>
        </motion.section>

        <section className="mt-6">
          <CsvUpload onImport={setProjects} />
        </section>

        <section className="mt-6">
          <Card>
            <CardContent className="p-5">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-xl font-black">Superintendents Gantt</h2>
                  <div className="mt-2 h-0.5 w-32 rounded-full bg-ggc-line" />
                  <p className="mt-2 text-sm text-slate-500">Superintendents listed down the left, with assigned projects gantted across the timeline.</p>
                </div>
                <div className="relative">
                  <Icon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" size={16} />
                  <input value={superintendentQuery} onChange={(event) => setSuperintendentQuery(event.target.value)} placeholder="Search superintendents..." aria-label="Search superintendents" className="h-10 rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-ggc-green" />
                </div>
              </div>
              <div className="gantt-scroll overflow-x-auto rounded-2xl border border-slate-200">
                <div style={{ minWidth: ROW_LABEL_WIDTH + weeks.length * CELL_WIDTH }}>
                  <GanttHeader label="Superintendent" />
                  {filteredSuperintendents.map((superintendent) => <SuperintendentGanttRow key={superintendent.id} projects={projects} superintendent={superintendent} />)}
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="mt-6">
          <Card>
            <CardContent className="p-5">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-xl font-black">Crews Gantt</h2>
                  <div className="mt-2 h-0.5 w-32 rounded-full bg-ggc-line" />
                  <p className="mt-2 text-sm text-slate-500">Crews listed down the left, with assigned projects gantted across the timeline.</p>
                </div>
                <div className="relative">
                  <Icon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" size={16} />
                  <input value={crewQuery} onChange={(event) => setCrewQuery(event.target.value)} placeholder="Search crews..." aria-label="Search crews" className="h-10 rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-ggc-green" />
                </div>
              </div>
              <div className="gantt-scroll overflow-x-auto rounded-2xl border border-slate-200">
                <div style={{ minWidth: ROW_LABEL_WIDTH + weeks.length * CELL_WIDTH }}>
                  <GanttHeader label="Crew" />
                  {filteredCrews.map((crew) => <CrewGanttRow key={crew.id} projects={projects} crew={crew} />)}
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="mt-6">
          <Card>
            <CardContent className="p-5">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-xl font-black">Projects Gantt</h2>
                  <div className="mt-2 h-0.5 w-32 rounded-full bg-ggc-line" />
                  <p className="mt-2 text-sm text-slate-500">Projects listed down the left, with job duration, crew, and superintendent shown in each row.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="relative">
                    <Icon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" size={16} />
                    <input value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} placeholder="Search projects..." aria-label="Search projects" className="h-10 rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-ggc-green" />
                  </div>
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter project status" className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-ggc-green">
                    <option>All</option>
                    <option>Planned</option>
                    <option>Confirmed</option>
                    <option>At Risk</option>
                  </select>
                </div>
              </div>
              <div className="gantt-scroll overflow-x-auto rounded-2xl border border-slate-200">
                <div style={{ minWidth: ROW_LABEL_WIDTH + weeks.length * CELL_WIDTH }}>
                  <GanttHeader label="Project" />
                  {filteredProjects.map((project) => <ProjectGanttRow key={project.id} project={project} />)}
                  {filteredProjects.length === 0 && <div className="bg-white p-8 text-center text-sm text-slate-500">No projects match the current filters.</div>}
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <CardContent className="p-5">
              <h2 className="text-xl font-black">Conflict Watch</h2>
              <div className="mt-2 h-0.5 w-32 rounded-full bg-ggc-line" />
              <p className="mb-4 mt-2 text-sm text-slate-500">Crews or superintendents assigned to more than one project during the same week.</p>
              <div className="space-y-3">
                {superintendentConflicts.map((superintendent) => (
                  <div key={superintendent.id} className="rounded-2xl border border-red-100 bg-red-50 p-3">
                    <div className="font-bold text-red-800">Superintendent: {superintendent.name}</div>
                    <div className="text-xs text-red-700">Assigned to: {getSuperintendentAssignments(projects, superintendent.name).map((project) => project.id).join(", ")}</div>
                  </div>
                ))}
                {crewConflicts.map((crew) => (
                  <div key={crew.id} className="rounded-2xl border border-red-100 bg-red-50 p-3">
                    <div className="font-bold text-red-800">Crew: {crew.name}</div>
                    <div className="text-xs text-red-700">Assigned to: {getCrewAssignments(projects, crew.name).map((project) => project.id).join(", ")}</div>
                  </div>
                ))}
                {superintendentConflicts.length + crewConflicts.length === 0 && <p className="text-sm text-slate-500">No overlapping crew or superintendent conflicts.</p>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <h2 className="text-xl font-black">Project Assignment Detail</h2>
              <div className="mt-2 h-0.5 w-32 rounded-full bg-ggc-line" />
              <p className="mb-4 mt-2 text-sm text-slate-500">Quick list of jobs with assigned crew and superintendent.</p>
              <div className="space-y-3">
                {projects.map((project) => (
                  <div key={project.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-bold">{project.id} · {project.name}</div>
                        <div className="text-xs text-slate-500">{project.phase} · PM: {project.pm}</div>
                      </div>
                      <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-bold ${getStatusClass(project.status)}`}>{project.status}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <span className="rounded-full bg-ggc-soft px-2 py-1 text-xs font-bold text-ggc-green">Crew: {project.crew}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">Superintendent: {project.superintendent}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
