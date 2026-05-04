import React, { useEffect, useMemo, useState, useRef } from "react";
import { Plus, Trash2, Users, BriefcaseBusiness, X, ZoomIn, Settings, FolderKanban, ClipboardCheck, Search, Sparkles } from "lucide-react";
import { supabase } from "./lib/supabase";
import ClaudeAssistant from "./components/ClaudeAssistant";
import CmicPullProjects from "./components/CmicPullProjects";
import CmicRefreshContracts from "./components/CmicRefreshContracts";

import {
  divisions, statuses, resourceTypes, defaultDashboardResourceTypes, zoomModes,
  blankProject, blankAssignment, blankResource, blankCrew, startingCertifications,
  divisionStyles, pendingDivisionStyles, divisionSvgColors, pendingDivisionSvgColors,
} from "./constants";

import {
  buildGanttItems, buildTimeline, itemOverlapsTimeline,
  findProject, getAssignmentCrewIds, getAssignmentCrewDisplayNames,
  getAssignmentPeopleLabel, getCrewDisplayName,
  formatDate, formatTick, csvEscape, downloadTextFile, readCsvFile, splitList,
  toggleListValue, toDate, addDays, rangesOverlap, timelinePercent,
  timelineSpanPercent, getPeriodEnd,
} from "./utils";

import {
  mapProjectFromDb, mapResourceFromDb, mapCrewFromDb,
  mapAssignmentFromDb, mapCertificationFromDb,
  projectToDb, resourceToDb, crewToDb, assignmentToDb, mobilizationToDb,
} from "./db/mappers";

// Override mappers locally to include includeInForecast until db/mappers.js is deployed
function mapProjectFromDbLocal(p) {
  return {
    id: p.id,
    projectNumber: p.project_number || "",
    name: p.name || "",
    client: p.client || "",
    address: p.address || "",
    division: p.division || "Hardscape",
    projectType: normalizeProjectTypes(p.project_type),
    owner: p.owner || "",
    architect: p.architect || "",
    engineer: p.engineer || "",
    specificRequirements: p.specific_requirements || [],
    status: p.status || "Scheduled",
    includeInForecast: p.include_in_forecast || false,
    source: p.source || null, // "cmic" if imported from CMiC, null otherwise
  };
}
function projectToDbLocal(project) {
  return {
    project_number: project.projectNumber,
    name: project.name,
    client: project.client,
    address: project.address,
    division: project.division,
    project_type: projectTypeLabel(project.projectType),
    owner: project.owner || "",
    architect: project.architect || "",
    engineer: project.engineer || "",
    specific_requirements: project.specificRequirements || [],
    status: project.status,
    include_in_forecast: project.includeInForecast || false,
    // Preserve provenance through edits — once "cmic", stays "cmic" until
    // explicitly set to null. This way the CMiC badge survives edits.
    source: project.source ?? null,
  };
}

// Local crew mappers include deactivated until db/mappers.js is updated.
function mapCrewFromDbLocal(c) {
  return {
    id: c.id,
    crewName: c.crew_name || "",
    foremanName: c.foreman_name || "",
    totalMembers: c.total_members || 0,
    specialty: c.specialty || [],
    deactivated: c.deactivated || false,
  };
}
function crewToDbLocal(crew) {
  return {
    crew_name: crew.crewName,
    foreman_name: crew.foremanName,
    total_members: crew.totalMembers || 0,
    specialty: crew.specialty || [],
    deactivated: crew.deactivated || false,
  };
}


// Resource certifications now support start and expiration dates while preserving older string-only records.
function normalizeResourceCertifications(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(Boolean).map((cert) => {
    if (typeof cert === "string") return { id: `legacy-${cert}`, name: cert, start: "", expiration: "" };
    return {
      id: cert.id || crypto.randomUUID(),
      name: cert.name || cert.certification || cert.label || "",
      start: cert.start || cert.startDate || cert.start_date || "",
      expiration: cert.expiration || cert.expirationDate || cert.expiration_date || cert.expires || "",
    };
  }).filter((cert) => cert.name);
}
function mapResourceFromDbLocal(r) {
  const mapped = mapResourceFromDb(r);
  return { ...mapped, certifications: normalizeResourceCertifications(mapped.certifications || r.certifications) };
}
function resourceToDbLocal(resource) {
  return { ...resourceToDb({ ...resource, certifications: normalizeResourceCertifications(resource.certifications) }), certifications: normalizeResourceCertifications(resource.certifications) };
}
function formatCertificationRecord(cert) {
  const c = typeof cert === "string" ? { name: cert } : cert || {};
  const dates = [c.start ? `Start: ${formatDate(c.start)}` : "", c.expiration ? `Expires: ${formatDate(c.expiration)}` : ""].filter(Boolean).join(" • ");
  return dates ? `${c.name} (${dates})` : c.name;
}
function parseResourceCertificationsCsv(value) {
  return splitList(value).map((item) => {
    const parts = item.split("|").map((part) => part.trim());
    if (parts.length >= 2) {
      return { id: crypto.randomUUID(), name: parts[0] || "", start: parts[1] || "", expiration: parts[2] || "" };
    }
    return { id: crypto.randomUUID(), name: item.trim(), start: "", expiration: "" };
  }).filter((cert) => cert.name);
}
function certificationCsvValue(cert) {
  const c = typeof cert === "string" ? { name: cert, start: "", expiration: "" } : cert || {};
  return [c.name || "", c.start || "", c.expiration || ""].join("|");
}
function getCertificationStatus(cert) {
  const exp = toDate(cert?.expiration);
  if (!exp) return "current";
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const warningDate = addDays(startOfToday, 30);
  if (exp < startOfToday) return "expired";
  if (exp <= warningDate) return "expiring";
  return "current";
}


// Division abbreviations used for explicit unassigned needs on mobilizations.
function getDivisionAbbreviation(division) {
  const text = String(division || "").toLowerCase();
  if (text.includes("hard")) return "HS";
  if (text.includes("concrete") || text.includes("masonry") || text === "cm") return "CM";
  if (text.includes("interior") || text === "in") return "IN";
  if (text.includes("tilt") || text === "tl") return "TL";
  return String(division || "").slice(0, 2).toUpperCase();
}
function normalizeUnassignedNeeds(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value && typeof value === "object") return Object.entries(value).filter(([, checked]) => !!checked).map(([division]) => division);
  return [];
}
function mapAssignmentFromDbLocal(assignment, mobilizations) {
  const mapped = mapAssignmentFromDb(assignment, mobilizations);
  const rawMobs = (mobilizations || []).filter((m) => m.assignment_id === assignment.id);
  const byId = new Map(rawMobs.map((m) => [m.id, m]));
  return {
    ...mapped,
    mobilizations: (mapped.mobilizations || []).map((mob) => {
      const raw = byId.get(mob.id) || rawMobs.find((m) => m.start_date === mob.start && m.end_date === mob.end) || {};
      return { ...mob, unassignedNeeds: normalizeUnassignedNeeds(raw.unassigned_needs || mob.unassignedNeeds) };
    }),
  };
}
function mobilizationToDbLocal(mobilization, assignmentId) {
  return {
    ...mobilizationToDb(mobilization, assignmentId),
    unassigned_needs: normalizeUnassignedNeeds(mobilization.unassignedNeeds),
  };
}

import { useSupabaseRealtime } from "./hooks/useSupabaseRealtime";

function normalizeProjectTypes(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  if (typeof value === "string") {
    return value
      .split(/[;,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function projectTypeLabel(value) {
  return normalizeProjectTypes(value).join(", ");
}


// ─── StatCard ────────────────────────────────────────────────────────────────

export function StatCard({ icon: Icon, label, value }) {
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

// ─── MultiSelectFilter ───────────────────────────────────────────────────────

export function MultiSelectFilter({ label, options, selected, setSelected, labels = {} }) {
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
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                active ? "bg-emerald-700 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
              }`}
            >
              {labels[option] || option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── SearchableMultiSelect ───────────────────────────────────────────────────

export function SearchableMultiSelect({ label, options, selected, setSelected, getLabel }) {
  const containerRef = useRef(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = options.filter((option) =>
    getLabel(option).toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div ref={containerRef} className="relative rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="mb-2 text-sm font-semibold text-slate-700">{label}</p>

      <div className="mb-2 flex flex-wrap gap-2">
        {selected.map((value) => {
          const option = options.find((item) => item.value === value);
          if (!option) return null;
          return (
            <span key={value} className="inline-flex items-center gap-2 rounded-full bg-emerald-700 px-3 py-1 text-xs font-semibold text-white">
              {getLabel(option)}
              <button type="button" onClick={() => setSelected((current) => current.filter((item) => item !== value))}>×</button>
            </span>
          );
        })}
      </div>

      <div className="flex items-center rounded-xl border border-slate-300 bg-white px-3 py-2 focus-within:border-emerald-600">
        <Search size={16} className="mr-2 text-slate-400" />
        <input
          className="w-full bg-transparent outline-none"
          value={query}
          placeholder="Search and select..."
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        />
      </div>

      {open && (
        <div className="absolute left-3 right-3 z-50 mt-1 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {filtered.length ? filtered.map((option) => {
            const active = selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setSelected((current) =>
                    current.includes(option.value)
                      ? current.filter((value) => value !== option.value)
                      : [...current, option.value]
                  );
                  setQuery("");
                  setOpen(true);
                }}
                className={`block w-full px-3 py-2 text-left hover:bg-emerald-50 ${active ? "bg-emerald-50" : ""}`}
              >
                <p className="font-semibold text-slate-800">{getLabel(option)}</p>
                {option.subLabel && <p className="text-xs text-slate-500">{option.subLabel}</p>}
              </button>
            );
          }) : <p className="px-3 py-2 text-sm text-slate-500">No matching options</p>}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="block w-full border-t border-slate-200 px-3 py-2 text-center text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

// ─── CertificationPicker ─────────────────────────────────────────────────────

export function CertificationPicker({ selected, onChange, certifications }) {
  return (
    <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
      {certifications.map((cert) => {
        const active = selected.includes(cert);
        return (
          <button
            key={cert}
            type="button"
            onClick={() => onChange(toggleListValue(selected, cert))}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              active ? "bg-emerald-700 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
            }`}
          >
            {cert}
          </button>
        );
      })}
    </div>
  );
}

// ─── useCloseDropdown ─────────────────────────────────────────────────────────

export function useCloseDropdown(setOpen, containerRef) {
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
    }
    function handleEsc(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [setOpen, containerRef]);
}

// ─── SearchableResourceSelect ─────────────────────────────────────────────────

export function SearchableResourceSelect({ value, onChange, resources, resourceType, placeholder }) {
  const containerRef = useRef(null);
  const [query, setQuery] = useState(value || "");
  const [open, setOpen] = useState(false);

  useCloseDropdown(setOpen, containerRef);
  useEffect(() => setQuery(value || ""), [value]);

  const filtered = resources.filter(
    (r) => (resourceType ? r.resourceType === resourceType : true) &&
      r.name.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center rounded-xl border border-slate-300 px-3 py-2 focus-within:border-emerald-600">
        <Search size={16} className="mr-2 text-slate-400" />
        <input
          className="w-full outline-none"
          value={query}
          placeholder={placeholder || "Search resource..."}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); }}
        />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {filtered.length ? filtered.map((r) => (
            <button key={r.id} type="button"
              onClick={() => { onChange(r.name); setQuery(r.name); setOpen(false); }}
              className="block w-full px-3 py-2 text-left hover:bg-emerald-50"
            >
              <p className="font-semibold text-slate-800">{r.name}</p>
              <p className="text-xs text-slate-500">{r.resourceType} • {r.homeDivision}</p>
            </button>
          )) : <p className="px-3 py-2 text-sm text-slate-500">No matching resource</p>}
        </div>
      )}
    </div>
  );
}

// ─── SearchableProjectSelect ──────────────────────────────────────────────────

export function SearchableProjectSelect({ value, onChange, projects }) {
  const containerRef = useRef(null);
  const current = findProject(projects, value);
  const [query, setQuery] = useState(current ? `${current.projectNumber} - ${current.name}` : "");
  const [open, setOpen] = useState(false);

  useCloseDropdown(setOpen, containerRef);

  useEffect(() => {
    const selected = findProject(projects, value);
    setQuery(selected ? `${selected.projectNumber} - ${selected.name}` : "");
  }, [value, projects]);

  const filtered = projects.filter((p) =>
    `${p.projectNumber} ${p.name} ${p.client}`.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center rounded-xl border border-slate-300 px-3 py-2 focus-within:border-emerald-600">
        <Search size={16} className="mr-2 text-slate-400" />
        <input
          className="w-full outline-none"
          value={query}
          placeholder="Search project..."
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {filtered.length ? filtered.map((p) => (
            <button key={p.id} type="button"
              onClick={() => { onChange(p.id); setQuery(`${p.projectNumber} - ${p.name}`); setOpen(false); }}
              className="block w-full px-3 py-2 text-left hover:bg-emerald-50"
            >
              <p className="font-semibold text-slate-800">{p.projectNumber} - {p.name}</p>
              <p className="text-xs text-slate-500">{p.client} • {p.division} • {p.status}</p>
            </button>
          )) : <p className="px-3 py-2 text-sm text-slate-500">No matching project</p>}
        </div>
      )}
    </div>
  );
}

// ─── SearchableCrewSelect ─────────────────────────────────────────────────────

export function SearchableCrewSelect({ value, onChange, crews }) {
  const containerRef = useRef(null);
  const current = crews.find((c) => c.id === value);
  const [query, setQuery] = useState(current ? getCrewDisplayName(current) : "");
  const [open, setOpen] = useState(false);

  useCloseDropdown(setOpen, containerRef);

  useEffect(() => {
    const selected = crews.find((c) => c.id === value);
    setQuery(selected ? getCrewDisplayName(selected) : "");
  }, [value, crews]);

  const filtered = crews.filter((c) =>
    `${c.crewName} ${c.foremanName} ${(c.specialty || []).join(" ")}`.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center rounded-xl border border-slate-300 px-3 py-2 focus-within:border-emerald-600">
        <Search size={16} className="mr-2 text-slate-400" />
        <input
          className="w-full outline-none"
          value={query}
          placeholder="Search crew..."
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {filtered.length ? filtered.map((c) => (
            <button key={c.id} type="button"
              onClick={() => { onChange(c.id); setQuery(getCrewDisplayName(c)); setOpen(false); }}
              className="block w-full px-3 py-2 text-left hover:bg-emerald-50"
            >
              <p className="font-semibold text-slate-800">{getCrewDisplayName(c)}</p>
              <p className="text-xs text-slate-500">{(c.specialty || []).join(", ")}</p>
            </button>
          )) : <p className="px-3 py-2 text-sm text-slate-500">No matching crew</p>}
        </div>
      )}
    </div>
  );
}


// ─── ProjectForm ──────────────────────────────────────────────────────────────

export function ProjectForm({ form, setForm, onSave, onCancel, onDelete, editing, certifications, projectTypes }) {
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
          <div className="space-y-1">
            <SearchableMultiSelect
              label="Project Type"
              options={(projectTypes || []).map((t) => ({ value: t, label: t }))}
              selected={normalizeProjectTypes(form.projectType)}
              setSelected={(next) => setForm((current) => ({
                ...current,
                projectType: typeof next === "function" ? next(normalizeProjectTypes(current.projectType)) : next,
              }))}
              getLabel={(option) => option.label}
            />
          </div>
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Project Owner</span>
            <input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.owner || ""} onChange={(e) => updateField("owner", e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Architect</span>
            <input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.architect || ""} onChange={(e) => updateField("architect", e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Engineer</span>
            <input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.engineer || ""} onChange={(e) => updateField("engineer", e.target.value)} />
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
          <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 cursor-pointer hover:bg-slate-100">
            <input
              type="checkbox"
              className="h-4 w-4 rounded accent-emerald-600"
              checked={form.includeInForecast || false}
              onChange={(e) => updateField("includeInForecast", e.target.checked)}
            />
            <div>
              <p className="text-sm font-semibold text-slate-800">Include in Forecast</p>
              <p className="text-xs text-slate-500">Show this project in the Forecast tab revenue table.</p>
            </div>
          </label>
        </div>

        <div className="flex justify-between gap-3 border-t border-slate-200 p-5">
          <div>{editing && <button onClick={onDelete} className="rounded-xl border border-red-200 px-4 py-2 font-semibold text-red-700 hover:bg-red-50">Delete Project</button>}</div>
          <div className="flex gap-3">
            <button onClick={onCancel} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={onSave} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800">Save Project</button>
          </div>
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
    const weeks = parseFloat(durationWeeks);
    if (!start || isNaN(weeks) || weeks <= 0) return "";
    try {
      const end = addBusinessDaysInclusive(start, Math.round(weeks * 5));
      return end ? end.toISOString().slice(0, 10) : "";
    } catch (e) { return ""; }
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


  function toggleMobilizationUnassignedNeed(mobId, division) {
    setForm((c) => ({
      ...c,
      mobilizations: (c.mobilizations || []).map((mob) => {
        if (mob.id !== mobId) return mob;
        return { ...mob, unassignedNeeds: toggleListValue(normalizeUnassignedNeeds(mob.unassignedNeeds), division) };
      }),
    }));
  }

  function addMobilization() {
    setForm((c) => ({
      ...c,
      mobilizations: [...(c.mobilizations || []), {
        id: crypto.randomUUID(), start: "", durationWeeks: "", end: "",
        superintendent: "", fieldCoordinator: "", crewIds: [], crewMenCounts: {}, crewOnly: false, unassignedNeeds: [],
      }],
    }));
  }

  function removeMobilization(id) {
    setForm((c) => ({ ...c, mobilizations: (c.mobilizations || []).filter((m) => m.id !== id) }));
  }

  function addCrewToMob(mobId) {
    setForm((c) => ({
      ...c,
      mobilizations: (c.mobilizations || []).map((mob) =>
        mob.id === mobId ? { ...mob, crewIds: [...(mob.crewIds || []), ""] } : mob
      ),
    }));
  }

  function updateCrewInMob(mobId, crewIndex, crewId) {
    setForm((c) => ({
      ...c,
      mobilizations: (c.mobilizations || []).map((mob) => {
        if (mob.id !== mobId) return mob;
        const newCrewIds = [...(mob.crewIds || [])];
        newCrewIds[crewIndex] = crewId;
        return { ...mob, crewIds: newCrewIds };
      }),
    }));
  }

  function updateCrewMenCount(mobId, crewId, count) {
    setForm((c) => ({
      ...c,
      mobilizations: (c.mobilizations || []).map((mob) => {
        if (mob.id !== mobId) return mob;
        return { ...mob, crewMenCounts: { ...(mob.crewMenCounts || {}), [crewId]: Number(count) || 0 } };
      }),
    }));
  }

  function removeCrewFromMob(mobId, crewIndex) {
    setForm((c) => ({
      ...c,
      mobilizations: (c.mobilizations || []).map((mob) => {
        if (mob.id !== mobId) return mob;
        const newCrewIds = (mob.crewIds || []).filter((_, i) => i !== crewIndex);
        return { ...mob, crewIds: newCrewIds };
      }),
    }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{editing ? "Edit Assignment" : "Assign Project"}</h2>
            <p className="text-sm text-slate-500">Global roles apply across all mobilizations. Per-mobilization roles and crews are set inside each mobilization block.</p>
          </div>
          <button onClick={onCancel} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button>
        </div>

        <div className="grid gap-4 p-5 md:grid-cols-2">
          {/* Project */}
          <label className="space-y-1 md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Project</span>
            <SearchableProjectSelect value={form.projectId} onChange={(v) => updateField("projectId", v)} projects={projects} />
          </label>

          {/* Global roles — PM, Safety, Field Engineer */}
          <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-blue-50 p-4">
            <h3 className="mb-3 font-bold text-slate-900 text-sm">Global Roles <span className="font-normal text-slate-500">(apply to the entire project)</span></h3>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-700">Project Manager</span>
                <SearchableResourceSelect value={form.projectManager} onChange={(v) => updateField("projectManager", v)} resources={resources} resourceType="Project Manager" placeholder="Search PM..." />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-700">Field Engineer</span>
                <SearchableResourceSelect value={form.fieldEngineer} onChange={(v) => updateField("fieldEngineer", v)} resources={resources} resourceType="Field Engineer" placeholder="Search field engineer..." />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-700">Safety</span>
                <SearchableResourceSelect value={form.safety} onChange={(v) => updateField("safety", v)} resources={resources} resourceType="Safety" placeholder="Search safety..." />
              </label>
            </div>
          </div>

          {/* Mobilizations with per-mob roles and crews */}
          <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900">Mobilizations</h3>
                <p className="text-sm text-slate-500">Each mobilization has its own dates, superintendent, field coordinator, and crews.</p>
              </div>
              <button onClick={addMobilization} type="button" className="flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
                <Plus size={16} /> Add Mobilization
              </button>
            </div>
            <div className="space-y-4">
              {(form.mobilizations || []).map((mob, index) => (
                <div key={mob.id} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                  {/* Header row */}
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-700">Mobilization #{index + 1}</span>
                    {(form.mobilizations || []).length > 1 && (
                      <button type="button" onClick={() => removeMobilization(mob.id)} className="rounded-lg border border-red-200 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50">Remove</button>
                    )}
                  </div>

                  {/* Explicit unassigned needs by division */}
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-amber-800">Unassigned Need</p>
                    <div className="flex flex-wrap gap-3">
                      {divisions.map((division) => {
                        const active = normalizeUnassignedNeeds(mob.unassignedNeeds).includes(division);
                        return (
                          <label key={`${mob.id}-${division}-unassigned`} className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold ${active ? "border-amber-500 bg-white text-amber-900" : "border-amber-200 bg-amber-100/60 text-amber-700"}`}>
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-amber-600"
                              checked={active}
                              onChange={() => toggleMobilizationUnassignedNeed(mob.id, division)}
                            />
                            {getDivisionAbbreviation(division)}
                          </label>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-xs text-amber-700">Checked divisions create labeled Gantt placeholders like “HS - Unassigned”.</p>
                  </div>

                  {/* Dates row */}
                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="space-y-1">
                      <span className="text-xs font-medium text-slate-600">Start Date</span>
                      <input type="date" className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={mob.start} onChange={(e) => updateMobilization(mob.id, "start", e.target.value)} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-medium text-slate-600">Duration (Weeks)</span>
                      <input type="number" min="0" step="0.5" className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600"
                        value={mob.durationWeeks || ""}
                        onChange={(e) => updateMobilization(mob.id, "durationWeeks", e.target.value)}
                        placeholder="e.g. 4" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-medium text-slate-600">End Date</span>
                      <input type="date" className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={mob.end} onChange={(e) => updateMobilization(mob.id, "end", e.target.value)} />
                    </label>
                  </div>

                  {/* Per-mob roles — hidden if crew-only */}
                  {!mob.crewOnly && (
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-slate-600">Superintendent</span>
                        <SearchableResourceSelect value={mob.superintendent || ""} onChange={(v) => updateMobilization(mob.id, "superintendent", v)} resources={resources} resourceType="Superintendent" placeholder="Search superintendent..." />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-slate-600">Field Coordinator</span>
                        <SearchableResourceSelect value={mob.fieldCoordinator || ""} onChange={(v) => updateMobilization(mob.id, "fieldCoordinator", v)} resources={resources} resourceType="Field Coordinator" placeholder="Search field coordinator..." />
                      </label>
                    </div>
                  )}

                  {/* Crew-only toggle */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" className="h-4 w-4 accent-emerald-600 rounded"
                      checked={mob.crewOnly || false}
                      onChange={(e) => updateMobilization(mob.id, "crewOnly", e.target.checked)} />
                    <span className="text-xs font-semibold text-slate-700">Crew-only mobilization</span>
                    <span className="text-xs text-slate-400">(no superintendent — crew appears in Crew Gantt only)</span>
                  </label>

                  {/* Crews */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-600">Crews</span>
                      <button type="button" onClick={() => addCrewToMob(mob.id)} className="flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                        <Plus size={12} /> Add Crew
                      </button>
                    </div>
                    {(mob.crewIds || []).length === 0 && (
                      <p className="text-xs text-slate-400 italic">No crews assigned — click + Add Crew to assign one.</p>
                    )}
                    {(mob.crewIds || []).map((crewId, crewIdx) => (
                      <div key={`${mob.id}-crew-${crewIdx}`} className="flex items-center gap-2">
                        <div className="flex-1">
                          <SearchableCrewSelect value={crewId} onChange={(v) => updateCrewInMob(mob.id, crewIdx, v)} crews={crews} />
                        </div>
                        <label className="flex items-center gap-1 shrink-0">
                          <span className="text-xs text-slate-500">Men:</span>
                          <input type="number" min="0" step="1"
                            className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-sm text-right outline-none focus:border-emerald-600"
                            value={(mob.crewMenCounts || {})[crewId] || ""}
                            placeholder="0"
                            onChange={(e) => updateCrewMenCount(mob.id, crewId, e.target.value)} />
                        </label>
                        <button type="button" onClick={() => removeCrewFromMob(mob.id, crewIdx)} className="rounded-lg border border-red-200 px-2 py-1.5 text-xs text-red-700 hover:bg-red-50">✕</button>
                      </div>
                    ))}
                  </div>
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

export function ResourceForm({ form, setForm, certifications, onSave, onCancel, onDelete, onExportResume, resourceStats, editing }) {
  const [ptoDraft, setPtoDraft] = useState({ ptoId: "", start: "", end: "" });
  const [certDraft, setCertDraft] = useState({ name: "", start: "", expiration: "" });
  function updateField(field, value) { setForm((c) => ({ ...c, [field]: value })); }

  function addCertificationToResource() {
    if (!certDraft.name) { alert("Select a certification before adding it."); return; }
    setForm((c) => ({
      ...c,
      certifications: [...normalizeResourceCertifications(c.certifications), { ...certDraft, id: crypto.randomUUID() }],
    }));
    setCertDraft({ name: "", start: "", expiration: "" });
  }

  function deleteResourceCertification(id) {
    setForm((c) => ({ ...c, certifications: normalizeResourceCertifications(c.certifications).filter((cert) => cert.id !== id) }));
  }

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
          <div>
            <h3 className="font-bold text-slate-900">Certifications</h3>
            <p className="text-sm text-slate-500">Add certifications from the saved front-page list, then track start and expiration dates.</p>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-[1.2fr_1fr_1fr_auto]">
            <select className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={certDraft.name} onChange={(e) => setCertDraft((c) => ({ ...c, name: e.target.value }))}>
              <option value="">Select certification...</option>
              {certifications.map((cert) => <option key={cert} value={cert}>{cert}</option>)}
            </select>
            <input type="date" className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={certDraft.start} onChange={(e) => setCertDraft((c) => ({ ...c, start: e.target.value }))} />
            <input type="date" className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={certDraft.expiration} onChange={(e) => setCertDraft((c) => ({ ...c, expiration: e.target.value }))} />
            <button type="button" onClick={addCertificationToResource} className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white"><Plus size={16} /> Add</button>
          </div>
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr><th className="p-3">Certification</th><th className="p-3">Start Date</th><th className="p-3">Expiration Date</th><th className="p-3">Status</th><th className="p-3 text-right">Action</th></tr>
              </thead>
              <tbody>
                {normalizeResourceCertifications(form.certifications).map((cert) => {
                  const status = getCertificationStatus(cert);
                  return (
                    <tr key={cert.id} className="border-t border-slate-200">
                      <td className="p-3 font-semibold">{cert.name}</td>
                      <td className="p-3">{cert.start ? formatDate(cert.start) : <span className="text-slate-300">—</span>}</td>
                      <td className="p-3">{cert.expiration ? formatDate(cert.expiration) : <span className="text-slate-300">—</span>}</td>
                      <td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${status === "expired" ? "bg-red-100 text-red-700" : status === "expiring" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{status === "expired" ? "Past Due" : status === "expiring" ? "Expiring Soon" : "Current"}</span></td>
                      <td className="p-3 text-right"><button type="button" onClick={() => deleteResourceCertification(cert.id)} className="text-red-700">Delete</button></td>
                    </tr>
                  );
                })}
                {normalizeResourceCertifications(form.certifications).length === 0 && <tr><td colSpan={5} className="p-4 text-center text-slate-400">No certifications added.</td></tr>}
              </tbody>
            </table>
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

        {editing && resourceStats && (
          <div className="border-t border-slate-200 p-5">
            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="font-bold text-slate-900">Resource Experience Stats</h3>
                <p className="text-sm text-slate-500">Top five categories based on completed/current project assignments.</p>
              </div>
              <button type="button" onClick={onExportResume} className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-800 hover:bg-emerald-100">Export Resume</button>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              {[
                ["Owners", resourceStats.owners],
                ["Architects", resourceStats.architects],
                ["Engineers", resourceStats.engineers],
                ["Project Types", resourceStats.projectTypes],
              ].map(([title, rows]) => (
                <div key={title} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-2 text-sm font-bold text-slate-800">{title}</p>
                  <div className="space-y-1">
                    {rows.length ? rows.map((row) => (
                      <div key={`${title}-${row.name}`} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1 text-xs">
                        <span className="truncate font-semibold text-slate-700">{row.name}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-bold text-slate-600">{row.count}</span>
                      </div>
                    )) : <p className="text-xs text-slate-400">No history yet.</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-between gap-3 border-t border-slate-200 p-5">
          <div>{editing && <button onClick={onDelete} className="rounded-xl border border-red-200 px-4 py-2 font-semibold text-red-700 hover:bg-red-50">Delete Resource</button>}</div>
          <div className="flex gap-3">
            {editing && <button type="button" onClick={onExportResume} className="rounded-xl border border-emerald-300 px-4 py-2 font-semibold text-emerald-800 hover:bg-emerald-50">Export Resume</button>}
            <button onClick={onCancel} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={onSave} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800">Save Resource</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CrewForm ─────────────────────────────────────────────────────────────────

export function CrewForm({ form, setForm, certifications, onSave, onCancel, onDelete, editing }) {
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
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Total Crew Members</span>
            <input type="number" min="0" step="1" className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.totalMembers || ""} placeholder="0" onChange={(e) => updateField("totalMembers", Number(e.target.value) || 0)} />
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 cursor-pointer hover:bg-slate-100">
            <input
              type="checkbox"
              className="h-4 w-4 rounded accent-red-600"
              checked={form.deactivated || false}
              onChange={(e) => updateField("deactivated", e.target.checked)}
            />
            <div>
              <p className="text-sm font-semibold text-slate-800">Deactivate Crew</p>
              <p className="text-xs text-slate-500">Hides this crew from new assignments, Crew Gantt, and Crew Utilization.</p>
            </div>
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Specialty</span>
            <CertificationPicker selected={form.specialty || []} onChange={(v) => updateField("specialty", v)} certifications={certifications} />
          </label>
        </div>

        <div className="flex justify-between gap-3 border-t border-slate-200 p-5">
          <div>{editing && <button onClick={onDelete} className="rounded-xl border border-red-200 px-4 py-2 font-semibold text-red-700 hover:bg-red-50">Delete Crew</button>}</div>
          <div className="flex gap-3">
            <button onClick={onCancel} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={onSave} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800">Save Crew</button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ─── GanttHeader ──────────────────────────────────────────────────────────────

export function GanttHeader({ timeline, zoom }) {
  const currentLeft = timelinePercent(timeline.currentDate, timeline);
  return (
    <div className="grid grid-cols-[260px_1fr] border-b border-slate-200 pb-2" style={{ width: `${timeline.width + 260}px` }}>
      <div className="sticky left-0 z-30 h-10 bg-white" />
      <div className="relative h-10" style={{ width: `${timeline.width}px` }}>
        {currentLeft >= 0 && currentLeft <= 100 && (
          <div className="absolute top-0 z-20 h-10 border-l-4 border-dashed border-red-600" style={{ left: `${currentLeft}%` }}>
            <span className="ml-1 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">Today</span>
          </div>
        )}
        {timeline.ticks.map((tick, index) => {
          const left = timelinePercent(tick, timeline);
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

// ─── GanttSegmentBar ─────────────────────────────────────────────────────────

export function GanttSegmentBar({ item, timeline, label, conflict = false }) {
  const project = item.project;
  const isUnassigned = !!item.isUnassignedNeed;
  const barDivision = isUnassigned ? (item.unassignedDivision || project.division) : project.division;
  const colorClass = isUnassigned || project.status === "Pending Award"
    ? pendingDivisionStyles[barDivision] || "bg-slate-300"
    : divisionStyles[barDivision] || "bg-slate-700";
  const { left, width } = timelineSpanPercent(item.start, item.end, timeline);
  const patternStyle = isUnassigned ? {
    border: "2px solid #111827",
    backgroundImage: "repeating-linear-gradient(135deg, rgba(17,24,39,.35) 0 2px, transparent 2px 9px)",
    backgroundSize: "14px 14px",
  } : {};
  const conflictStyle = conflict ? {
    border: "2px solid #dc2626",
    backgroundImage: "repeating-linear-gradient(135deg, transparent 0 8px, rgba(220,38,38,.95) 8px 10px)",
    backgroundSize: "14px 14px",
  } : {};
  const tooltip = [
    project.projectNumber ? `${project.projectNumber} - ${project.name}` : project.name,
    `${isUnassigned ? (item.unassignedDivision || project.division) : project.division} • ${project.status}`,
    `${formatDate(item.start)} - ${formatDate(item.end)}`,
    label ? `Assignment: ${label}` : item.isUnassignedNeed ? `${item.unassignedAbbreviation} - Unassigned` : "Unassigned",
    conflict ? "Conflict detected" : "",
  ].filter(Boolean).join("\n");

  return (
    <div
      className={`absolute top-1 h-9 overflow-hidden rounded-xl ${colorClass} px-3 text-xs font-semibold leading-9 shadow-sm ${isUnassigned ? "text-slate-900" : "text-white"}`}
      style={{ left: `${left}%`, width: `${Math.max(2, width)}%`, ...patternStyle, ...conflictStyle }}
      title={tooltip}
    >
      <span className={conflict ? "rounded bg-white/90 px-1.5 py-0.5 font-bold text-red-700" : ""}>{label || "Unassigned"}</span>
      {isUnassigned && <span className="ml-2 rounded bg-white/80 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-900">unassigned</span>}
      {conflict && <span className="ml-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white">conflict</span>}
    </div>
  );
}

// ─── PtoOverlayBar ────────────────────────────────────────────────────────────

export function PtoOverlayBar({ pto, timeline }) {
  const start = toDate(pto.start);
  const end = toDate(pto.end);
  if (!start || !end || !rangesOverlap(start, addDays(end, 1), timeline.minDate, addDays(timeline.maxDate, 1))) return null;
  const { left, width } = timelineSpanPercent(start, end, timeline);
  return (
    <div
      className="absolute top-0 z-20 h-11 overflow-hidden rounded-xl border-2 border-black bg-white/70 px-3 text-xs font-bold leading-10 text-black shadow"
      style={{ left: `${left}%`, width: `${Math.max(0.15, width)}%`, backgroundImage: "repeating-linear-gradient(135deg, transparent 0 8px, rgba(0,0,0,.95) 8px 10px)", backgroundSize: "14px 14px" }}
      title={`PTO ${pto.ptoId || ""}: ${formatDate(pto.start)} - ${formatDate(pto.end)}`}
    >
      PTO {pto.ptoId || ""}
    </div>
  );
}

// ─── ProjectGanttRow ──────────────────────────────────────────────────────────

export function ProjectGanttRow({ assignment, project, items, timeline, crews }) {
  return (
    <div className="grid grid-cols-[260px_1fr] items-center gap-5">
      <button className="sticky left-0 z-20 bg-white pr-3 text-left">
        <div className="flex items-center gap-2">
          <span className={`h-3 w-3 rounded-full ${project.status === "Pending Award" ? pendingDivisionStyles[project.division] : divisionStyles[project.division] || "bg-slate-600"}`} />
          <p className="font-semibold text-slate-900 hover:text-emerald-700">
            {project.projectNumber ? `${project.projectNumber} - ` : ""}{project.name}
          </p>
        </div>
        <p className="mt-1 text-xs text-slate-500">{project.division} • {project.status} • {items.length} mobilization{items.length === 1 ? "" : "s"}</p>
      </button>
      <div className="relative h-11 rounded-xl bg-slate-100" style={{ width: `${timeline.width}px` }}>
        {items.map((item) => (
          <GanttSegmentBar key={item.id} item={item} timeline={timeline} label={item.isUnassignedNeed ? `${item.unassignedAbbreviation} - Unassigned` : getAssignmentPeopleLabel(item.assignment, crews)} />
        ))}
      </div>
    </div>
  );
}

// ─── ResourceGanttRow ─────────────────────────────────────────────────────────

export function ResourceGanttRow({ resource, items, timeline, onResourceClick }) {
  const ptoItems = (resource.pto || []).filter((pto) => pto.start && pto.end);
  const sortedItems = [...items].sort((a, b) => new Date(a.start) - new Date(b.start));
  const conflictIds = new Set();

  sortedItems.forEach((item, i) => {
    const itemStart = toDate(item.start);
    const itemEnd = toDate(item.end);
    const hasEarlierOverlap = sortedItems.slice(0, i).some((prev) => {
      const previousStart = toDate(prev.start);
      const previousEnd = toDate(prev.end);
      return rangesOverlap(itemStart, addDays(itemEnd, 1), previousStart, addDays(previousEnd, 1));
    });
    if (hasEarlierOverlap) conflictIds.add(item.id);
  });

  return (
    <div className="grid grid-cols-[260px_1fr] items-center gap-5">
      <div className="sticky left-0 z-20 bg-white pr-3 text-left">
        <button onClick={() => onResourceClick?.(resource)} className="font-semibold text-slate-900 hover:text-emerald-700">{resource.name}</button>
        <p className="mt-1 text-xs text-slate-500">
          {resource.resourceType} • {resource.homeDivision} • {items.length} assignment{items.length === 1 ? "" : "s"}
          {ptoItems.length ? ` • ${ptoItems.length} PTO` : ""}
        </p>
      </div>
      <div className="relative h-11 rounded-xl bg-slate-100" style={{ width: `${timeline.width}px` }}>
        {sortedItems.map((item) => (
          <GanttSegmentBar key={`${resource.name}-${item.id}`} item={item} timeline={timeline} label={item.project.name} conflict={conflictIds.has(item.id)} />
        ))}
        {ptoItems.map((pto) => (
          <PtoOverlayBar key={`${resource.id}-${pto.id || pto.ptoId}`} pto={pto} timeline={timeline} />
        ))}
      </div>
    </div>
  );
}

// ─── UnassignedNeedGanttRow ─────────────────────────────────────────────────

export function UnassignedNeedGanttRow({ resource, items, timeline }) {
  const sortedItems = [...items].sort((a, b) => new Date(a.start) - new Date(b.start));
  const lanes = [];

  sortedItems.forEach((item) => {
    const start = toDate(item.start);
    const end = toDate(item.end);
    let laneIndex = lanes.findIndex(
      (lane) => !lane.some((placed) => rangesOverlap(start, addDays(end, 1), toDate(placed.start), addDays(toDate(placed.end), 1)))
    );
    if (laneIndex === -1) { laneIndex = lanes.length; lanes.push([]); }
    lanes[laneIndex].push(item);
  });

  return (
    <div className="grid grid-cols-[260px_1fr] items-start gap-5">
      <div className="sticky left-0 z-20 bg-white pr-3 text-left">
        <p className="font-semibold text-amber-800">{resource.name}</p>
        <p className="mt-1 text-xs text-slate-500">{resource.homeDivision} • unassigned need</p>
        {resource.projectLabel && <p className="mt-0.5 text-xs font-medium text-slate-700">{resource.projectLabel}</p>}
      </div>
      <div className="relative rounded-xl bg-amber-50" style={{ width: `${timeline.width}px`, height: `${Math.max(48, lanes.length * 48)}px` }}>
        {lanes.map((lane, laneIndex) =>
          lane.map((item) => (
            <GanttSegmentBar
              key={`${resource.id}-${item.id}`}
              item={item}
              timeline={timeline}
              label={`${item.unassignedAbbreviation} - Unassigned`}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── CrewGanttRow ────────────────────────────────────────────────────────────

export function CrewGanttRow({ crew, items, timeline }) {
  const sortedItems = [...items].sort((a, b) => new Date(a.start) - new Date(b.start));
  const lanes = [];

  sortedItems.forEach((item) => {
    const start = toDate(item.start);
    const end = toDate(item.end);
    let laneIndex = lanes.findIndex(
      (lane) => !lane.some((placed) => rangesOverlap(start, addDays(end, 1), toDate(placed.start), addDays(toDate(placed.end), 1)))
    );
    if (laneIndex === -1) { laneIndex = lanes.length; lanes.push([]); }
    lanes[laneIndex].push(item);
  });

  return (
    <div className="grid grid-cols-[260px_1fr] items-start gap-5">
      <div className="sticky left-0 z-20 bg-white pr-3 text-left">
        <p className="font-semibold text-slate-900">{getCrewDisplayName(crew)}</p>
        <p className="mt-1 text-xs text-slate-500">
          {(crew.specialty || []).join(", ") || "No specialty"} • {items.length} assignment{items.length === 1 ? "" : "s"}
        </p>
      </div>
      <div className="relative rounded-xl bg-slate-100" style={{ width: `${timeline.width}px`, height: `${Math.max(48, lanes.length * 48)}px` }}>
        {lanes.map((lane, laneIndex) =>
          lane.map((item) => {
            const span = timelineSpanPercent(item.start, item.end, timeline);
            const colorClass = item.project.status === "Pending Award"
              ? pendingDivisionStyles[item.project.division]
              : divisionStyles[item.project.division];
            return (
              <div
                key={`${crew.id}-${item.id}`}
                className={`absolute h-9 overflow-hidden rounded-xl px-3 text-xs font-semibold leading-9 text-white shadow-sm ${colorClass || "bg-slate-700"}`}
                style={{ left: `${span.left}%`, width: `${Math.max(2, span.width)}%`, top: `${laneIndex * 48 + 5}px` }}
              >
                {item.project.name}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── ResourceDemandChart ──────────────────────────────────────────────────────

export function ResourceDemandChart({ items, timeline, zoom, totalResources, onExportPdf, onBarClick, onPeriodClick, enlarged = false }) {
  const periods = timeline.ticks.map((tick) => {
    const periodStart = tick;
    const periodEnd = getPeriodEnd(tick, zoom);

    // All items active in this period that pass the home-division filter (already applied upstream)
    const periodItems = items.filter((item) => {
      const itemStart = toDate(item.start);
      const itemEnd = toDate(item.end);
      return itemStart && itemEnd && rangesOverlap(itemStart, addDays(itemEnd, 1), periodStart, periodEnd);
    });

    // Bucket by PROJECT division so bar colors reflect the actual work being done.
    // The home-division filter is already applied on the items passed in — so only
    // assignments where the resource's home division matches show up, but the bar
    // color (and stack position) is still the project's division color.
    const buckets = {};
    divisions.forEach((d) => { buckets[d] = { current: 0, pending: 0 }; });

    periodItems.forEach((item) => {
      const projectDivision = item.project.division;
      if (!buckets[projectDivision]) return;
      if (item.project.status === "Pending Award") buckets[projectDivision].pending += 1;
      else if (item.project.status !== "Complete") buckets[projectDivision].current += 1;
    });

    const segments = [];
    divisions.forEach((d) => {
      if (buckets[d].current > 0) segments.push({
        division: d, type: "Current", value: buckets[d].current, color: divisionSvgColors[d],
        // Segment drilldown shows items whose project division matches AND resource division filter passes
        segmentItems: periodItems.filter((item) =>
          item.project.division === d &&
          item.project.status !== "Pending Award" &&
          item.project.status !== "Complete"
        ),
      });
      if (buckets[d].pending > 0) segments.push({
        division: d, type: "Pending", value: buckets[d].pending, color: pendingDivisionSvgColors[d],
        segmentItems: periodItems.filter((item) =>
          item.project.division === d &&
          item.project.status === "Pending Award"
        ),
      });
    });

    // Tight timeline scoped to just this period for drilldown Gantts
    const periodTimeline = {
      minDate: periodStart,
      maxDate: periodEnd,
      currentDate: new Date(),
      totalDays: Math.max(1, Math.ceil((periodEnd - periodStart) / (1000 * 60 * 60 * 24))),
      ticks: [periodStart],
      width: 1160,
    };

    const count = divisions.reduce((sum, d) => sum + buckets[d].current + buckets[d].pending, 0);
    return { label: formatTick(tick, zoom), tick, periodStart, periodEnd, segments, count, periodItems, periodTimeline };
  });

  const rawMaxValue = Math.max(totalResources, ...periods.map((p) => p.count), 1);
  const yAxisMax = Math.max(5, Math.ceil(rawMaxValue / 5) * 5);
  const width = Math.max(enlarged ? 1600 : 1160, timeline.width || 1160);
  const height = enlarged ? 480 : 340;
  const margin = { top: 28, right: 24, bottom: 70, left: 58 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const y = (value) => margin.top + plotHeight - (value / yAxisMax) * plotHeight;
  const barWidth = Math.max(36, Math.min(90, plotWidth / Math.max(periods.length, 1) - 16));
  const yTicks = Array.from({ length: 6 }, (_, i) => Math.round((yAxisMax / 5) * i));

  return (
    <section id="resource-demand-graph" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <button onClick={() => window.dispatchEvent(new CustomEvent("ggc-expand-demand"))} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50" title="Open enlarged view">↗</button>
            <h2 className="text-xl font-bold">Resource Demand Graph</h2>
          </div>
          <p className="text-sm text-slate-500">Y-axis is project count. The red dashed line represents total filtered resources.</p>
        </div>
        <button onClick={onExportPdf} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Export PDF</button>
      </div>

      <div className="overflow-x-auto">
        <svg width={width} height={height} className="rounded-xl border border-slate-200 bg-slate-50">
          <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + plotHeight} stroke="#94a3b8" />
          <line x1={margin.left} y1={margin.top + plotHeight} x2={margin.left + plotWidth} y2={margin.top + plotHeight} stroke="#94a3b8" />
          {yTicks.map((tick) => (
            <g key={tick}>
              <line x1={margin.left} y1={y(tick)} x2={margin.left + plotWidth} y2={y(tick)} stroke="#e2e8f0" />
              <text x={margin.left - 12} y={y(tick) + 4} textAnchor="end" fontSize="12" fontWeight="600" fill="#64748b">{tick}</text>
            </g>
          ))}
          <line x1={margin.left} y1={y(totalResources)} x2={margin.left + plotWidth} y2={y(totalResources)} stroke="#dc2626" strokeWidth="4" strokeDasharray="8 6" />
          <rect x={margin.left + plotWidth - 124} y={y(totalResources) - 26} width="124" height="22" rx="5" fill="#dc2626" />
          <text x={margin.left + plotWidth - 62} y={y(totalResources) - 11} textAnchor="middle" fontSize="12" fontWeight="700" fill="white">Total Resources: {totalResources}</text>
          {periods.map((period, index) => {
            const x = margin.left + index * (plotWidth / Math.max(periods.length, 1)) + (plotWidth / Math.max(periods.length, 1) - barWidth) / 2;
            let stackedValue = 0;
            return (
              <g key={`${period.label}-${index}`}>
                {period.segments.map((segment) => {
                  const segmentHeight = (segment.value / yAxisMax) * plotHeight;
                  const rectY = y(stackedValue + segment.value);
                  stackedValue += segment.value;
                  return (
                    <rect key={`${segment.division}-${segment.type}`} x={x} y={rectY} width={barWidth} height={segmentHeight} rx="5" fill={segment.color}
                      onClick={() => onBarClick?.({ period, segment })}
                      style={{ cursor: "pointer" }}>
                      <title>{segment.division} {segment.type}: {segment.value} — click for details</title>
                    </rect>
                  );
                })}
                <text
                  x={x + barWidth / 2} y={height - 36}
                  textAnchor="middle" fontSize="10"
                  fill="#1d4ed8"
                  style={{ cursor: "pointer", textDecoration: "underline" }}
                  onClick={() => onPeriodClick?.(period)}
                >{period.label}</text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-4 flex flex-wrap gap-3 text-xs font-semibold">
        {divisions.map((d) => (
          <div key={d} className="flex items-center gap-2">
            <span className={`h-3 w-6 rounded-full ${divisionStyles[d]}`} /><span>{d} Current</span>
            <span className={`ml-2 h-3 w-6 rounded-full ${pendingDivisionStyles[d]}`} /><span>{d} Pending</span>
          </div>
        ))}
      </div>
    </section>
  );
}


export default function App() {
  const [projects, setProjects] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [resources, setResources] = useState([]);
  const [crews, setCrews] = useState([]);
  const [certifications, setCertifications] = useState(startingCertifications);
  const [projectTypes, setProjectTypes] = useState(() => {
    try {
      const saved = localStorage.getItem("ggc_project_types");
      return saved ? JSON.parse(saved) : ["Multifamily", "Post-Tension", "Parking Deck"];
    } catch { return ["Multifamily", "Post-Tension", "Parking Deck"]; }
  });
  const [showProjectTypeSettings, setShowProjectTypeSettings] = useState(false);
  const [newProjectType, setNewProjectType] = useState("");

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
  const [demandZoom, setDemandZoom] = useState("Weeks");
  const [expandedView, setExpandedView] = useState(null);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [showClaude, setShowClaude] = useState(false);
  const [currentUser, setCurrentUser] = useState(() => sessionStorage.getItem("ggc_current_user") || "");
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [newUserForm, setNewUserForm] = useState({ username: "", password: "" });
  const [appUsers, setAppUsers] = useState([]);
  const [crewGanttFilter, setCrewGanttFilter] = useState([]);
  const [focusedResource, setFocusedResource] = useState(null);
  const [projectSort, setProjectSort] = useState({ key: "projectNumber", direction: "asc" });
  const [projectGanttSort, setProjectGanttSort] = useState("projectNumber");
  const [resourceSort, setResourceSort] = useState({ key: "name", direction: "asc" });
  const [crewSort, setCrewSort] = useState({ key: "crewName", direction: "asc" });
  const [demandDrilldown, setDemandDrilldown] = useState(null);
  const [demandPeriodDrilldown, setDemandPeriodDrilldown] = useState(null);
  const [showAssignments, setShowAssignments] = useState(false);
  const [showUnassignedNeedRows, setShowUnassignedNeedRows] = useState(false);
  const [certAlertModal, setCertAlertModal] = useState(null);

  // ── Forecast state ─────────────────────────────────────────────────────────
  const [forecastData, setForecastData] = useState({});
  const [globalLockThrough, setGlobalLockThrough] = useState(null);
  const [forecastYear, setForecastYear] = useState(new Date().getFullYear());
  const [forecastDivisionFilter, setForecastDivisionFilter] = useState([...divisions]);
  const [showForecastSettings, setShowForecastSettings] = useState(false);
  const [forecastSettingsId, setForecastSettingsId] = useState(null);
  const [forecastSort, setForecastSort] = useState({ key: "projectNumber", direction: "asc" });
  const [forecastSearch, setForecastSearch] = useState("");
  const [forecastKey, setForecastKey] = useState(0); // increment to force table re-render

  // ── Per-tab search state ───────────────────────────────────────────────────
  const [projectSearch, setProjectSearch] = useState("");
  const [resourceSearch, setResourceSearch] = useState("");
  const [crewSearch, setCrewSearch] = useState("");
  const [dashboardProjectSearch, setDashboardProjectSearch] = useState("");
  const [dashboardResourceSearch, setDashboardResourceSearch] = useState("");
  const [dashboardCrewSearch, setDashboardCrewSearch] = useState("");

  // Crew utilization date range — defaults to the current Sunday-Saturday week
  const [utilizationStart, setUtilizationStart] = useState(() => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
    return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  });
  const [utilizationEnd, setUtilizationEnd] = useState(() => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  });
  const [utilizationSearch, setUtilizationSearch] = useState("");
  const [selectedUtilizationCrew, setSelectedUtilizationCrew] = useState(null);
  const [utilizationSort, setUtilizationSort] = useState({ key: "crew", direction: "asc" });
  const [selectedProjectManagerUtilization, setSelectedProjectManagerUtilization] = useState(null);
  const [projectManagerUtilizationZoom, setProjectManagerUtilizationZoom] = useState("Months");
  const [crewDeactivationOverrides, setCrewDeactivationOverrides] = useState({});

  // ── Initial Supabase load ──────────────────────────────────────────────────
  const loadSupabaseData = React.useCallback(async () => {
    if (!supabase) { console.warn("Supabase not connected. Check Vercel environment variables."); return; }

    const [projectsRes, resourcesRes, crewsRes, assignmentsRes, mobilizationsRes, certsRes, forecastRes, settingsRes] = await Promise.all([
      supabase.from("projects").select("*").order("created_at", { ascending: false }),
      supabase.from("resources").select("*").order("created_at", { ascending: false }),
      supabase.from("crews").select("*").order("created_at", { ascending: false }),
      supabase.from("assignments").select("*").order("created_at", { ascending: false }),
      supabase.from("mobilizations").select("*"),
      supabase.from("certifications").select("*").order("name", { ascending: true }),
      supabase.from("forecast").select("*"),
      supabase.from("forecast_settings").select("*").limit(1),
    ]);

    if (projectsRes.error) console.error("Projects load error:", projectsRes.error);
    if (resourcesRes.error) console.error("Resources load error:", resourcesRes.error);
    if (crewsRes.error) console.error("Crews load error:", crewsRes.error);
    if (assignmentsRes.error) console.error("Assignments load error:", assignmentsRes.error);
    if (mobilizationsRes.error) console.error("Mobilizations load error:", mobilizationsRes.error);
    if (certsRes.error) console.error("Certifications load error:", certsRes.error);

    setProjects((projectsRes.data || []).map(mapProjectFromDbLocal));
    setResources((resourcesRes.data || []).map(mapResourceFromDbLocal));
    const mappedCrews = (crewsRes.data || []).map(mapCrewFromDbLocal);
    setCrews(mappedCrews);
    setCrewGanttFilter((current) => current.length ? current : mappedCrews.map((c) => c.id));
    setAssignments((assignmentsRes.data || []).map((a) => mapAssignmentFromDbLocal(a, mobilizationsRes.data || [])));
    if (certsRes.data?.length) setCertifications(certsRes.data.map(mapCertificationFromDb));

    // Load forecast rows into a map keyed by project_id
    if (forecastRes.data && !forecastRes.error) {
      const fMap = {};
      forecastRes.data.forEach((row) => {
        fMap[row.project_id] = {
          id: row.id,
          contractValue: row.contract_value || 0,
          spreadRule: row.spread_rule || "even",
          actuals: row.actuals || {},
          redistributedSpread: row.redistributed_spread || {},
          perProjectLockThrough: row.per_project_lock_through || null,
        };
      });
      setForecastData(fMap);
    }
    if (settingsRes.data?.length && !settingsRes.error) {
      const s = settingsRes.data[0];
      setForecastSettingsId(s.id);
      setGlobalLockThrough(s.global_lock_through || null);
    }
  }, []);

  useEffect(() => {
    loadSupabaseData();
  }, [loadSupabaseData]);

  // ── Realtime subscriptions (#5) ────────────────────────────────────────────
  useSupabaseRealtime({ setProjects, setResources, setCrews, setAssignments, setCertifications });

  // ── Load app users after login ─────────────────────────────────────────────
  useEffect(() => { if (currentUser) { loadAppUsers(); loadProjectTypes(); } }, [currentUser]);

  useEffect(() => {
    localStorage.setItem("ggc_project_types", JSON.stringify(projectTypes));
  }, [projectTypes]);

  useEffect(() => {
    function handleExpandDemand() { setExpandedView("demand"); }
    window.addEventListener("ggc-expand-demand", handleExpandDemand);
    return () => window.removeEventListener("ggc-expand-demand", handleExpandDemand);
  }, []);

  // Keep the bottom Assignments table collapsed whenever the Dashboard is opened.
  useEffect(() => {
    if (page === "dashboard") setShowAssignments(false);
  }, [page]);

  function formatLocalIsoDate(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function setUtilizationWeekFromDate(baseDate) {
    const base = baseDate ? new Date(baseDate) : new Date();
    const day = base.getDay(); // Sunday = 0
    const start = new Date(base.getFullYear(), base.getMonth(), base.getDate() - day);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    setUtilizationStart(formatLocalIsoDate(start));
    setUtilizationEnd(formatLocalIsoDate(end));
  }

  function shiftUtilizationWeek(direction) {
    const base = toDate(utilizationStart) || new Date();
    const nextBase = new Date(base.getFullYear(), base.getMonth(), base.getDate() + direction * 7);
    setUtilizationWeekFromDate(nextBase);
  }

  function isCrewDeactivated(crew) {
    return Object.prototype.hasOwnProperty.call(crewDeactivationOverrides, crew.id)
      ? crewDeactivationOverrides[crew.id]
      : !!crew.deactivated;
  }

  function isProjectManagerActiveStatus(status) {
    const normalized = String(status || "").toLowerCase().replace(/[-_]+/g, " ").trim();
    return ["scheduled", "schedule", "active", "on hold"].includes(normalized);
  }

  function isProjectManagerPendingStatus(status) {
    return String(status || "").toLowerCase().replace(/[-_]+/g, " ").trim() === "pending award";
  }

  function getProjectStartFromItems(items) {
    const dates = (items || []).map((item) => toDate(item.start)).filter(Boolean);
    return dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
  }

  function getProjectEndFromItems(items) {
    const dates = (items || []).map((item) => toDate(item.end)).filter(Boolean);
    return dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
  }

  // ── Derived data ───────────────────────────────────────────────────────────
  const ganttItems = buildGanttItems(projects, assignments);

  const assignmentMatchesDashboardResourceType = (assignment) => {
    const names = [assignment.projectManager, assignment.superintendent, assignment.fieldCoordinator, assignment.fieldEngineer, assignment.safety].filter(Boolean);
    // Crew-only mobilization — no named resources, always show
    if (!names.length) return true;
    const selectedNames = resources.filter((r) => dashboardResourceTypeFilter.includes(r.resourceType)).map((r) => r.name);
    return names.some((name) => selectedNames.includes(name));
  };

  const visibleItems = ganttItems.filter((item) =>
    divisionFilter.includes(item.project.division) &&
    statusFilter.includes(item.project.status) &&
    assignmentMatchesDashboardResourceType(item.assignment)
  );

  const visibleAssignments = assignments.filter((a) => assignmentMatchesDashboardResourceType(a));
  const activeProjects = projects.filter((p) => p.status !== "Complete");
  const timeline = useMemo(() => buildTimeline(visibleItems, zoom), [visibleItems, zoom]);
  const timelineVisibleItems = visibleItems.filter((item) => itemOverlapsTimeline(item.start, item.end, timeline));
  function getUnassignedNeedsForItem(item) {
    const direct = normalizeUnassignedNeeds(item.assignment?.unassignedNeeds || item.assignment?._unassignedNeeds);
    if (direct.length) return direct;
    const sourceAssignment = assignments.find((a) => a.id === item.assignment?.id || a.projectId === item.project?.id);
    const sourceMob = (sourceAssignment?.mobilizations || []).find((mob) =>
      mob.id === item.mobilizationId ||
      (String(mob.start || "") === String(item.start || "") && String(mob.end || "") === String(item.end || ""))
    );
    return normalizeUnassignedNeeds(sourceMob?.unassignedNeeds);
  }
  const unassignedNeedItems = timelineVisibleItems.flatMap((item) =>
    getUnassignedNeedsForItem(item).map((division) => {
      const abbr = getDivisionAbbreviation(division);
      return {
        ...item,
        id: `${item.id}-unassigned-${abbr}`,
        isUnassignedNeed: true,
        unassignedDivision: division,
        unassignedAbbreviation: abbr,
        assignment: { ...item.assignment, superintendent: `${abbr} - Unassigned` },
      };
    })
  );
  // Demand chart uses its own independent timeline scoped to demandZoom
  const demandTimeline = useMemo(() => buildTimeline(visibleItems, demandZoom), [visibleItems, demandZoom]);
  const demandFilteredItems = visibleItems.filter((item) => itemOverlapsTimeline(item.start, item.end, demandTimeline)).map((item) => {
    const assignedNames = [item.assignment.superintendent, item.assignment.projectManager, item.assignment.fieldCoordinator, item.assignment.fieldEngineer, item.assignment.safety].filter(Boolean);
    const assignedResource = resources.find((r) => assignedNames.includes(r.name) && demandHomeDivisionFilter.includes(r.homeDivision));
    const anyAssignedResource = assignedResource || resources.find((r) => assignedNames.includes(r.name));
    const resourceHomeDivision = anyAssignedResource?.homeDivision || item.project.division;
    return demandHomeDivisionFilter.includes(resourceHomeDivision)
      ? { ...item, assignment: { ...item.assignment, _resourceHomeDivision: resourceHomeDivision } }
      : null;
  }).filter(Boolean);

  const activeCrews = crews.filter((c) => !isCrewDeactivated(c));

  function toggleSort(setter, key) {
    setter((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
  }
  function compareValues(a, b, direction) {
    const left = String(a ?? "").toLowerCase();
    const right = String(b ?? "").toLowerCase();
    const nL = Number(left); const nR = Number(right);
    const bothNum = !Number.isNaN(nL) && !Number.isNaN(nR) && left !== "" && right !== "";
    const result = bothNum ? nL - nR : left.localeCompare(right, undefined, { numeric: true });
    return direction === "asc" ? result : -result;
  }

  const filteredResources = resources.filter((r) => {
    if (!resourceTypeFilter.includes(r.resourceType)) return false;
    if (!resourceSearch) return true;
    const q = resourceSearch.toLowerCase();
    return r.name.toLowerCase().includes(q) || r.resourceType.toLowerCase().includes(q) || (r.homeDivision || "").toLowerCase().includes(q) || (r.email || "").toLowerCase().includes(q);
  });
  const sortedResources = [...filteredResources].sort((a, b) => compareValues(a[resourceSort.key], b[resourceSort.key], resourceSort.direction));
  const certificationAlertRows = resources.flatMap((resource) =>
    normalizeResourceCertifications(resource.certifications).map((cert) => ({ resource, cert, status: getCertificationStatus(cert) }))
  );
  const expiringCertificationRows = certificationAlertRows.filter((row) => row.status === "expiring").sort((a, b) => new Date(a.cert.expiration) - new Date(b.cert.expiration));
  const expiredCertificationRows = certificationAlertRows.filter((row) => row.status === "expired").sort((a, b) => new Date(a.cert.expiration) - new Date(b.cert.expiration));
  const sortedCrews = [...crews].filter((c) => {
    if (!crewSearch) return true;
    const q = crewSearch.toLowerCase();
    const statusLabel = isCrewDeactivated(c) ? "deactivated inactive" : "active";
    return c.crewName.toLowerCase().includes(q) || (c.foremanName || "").toLowerCase().includes(q) || statusLabel.includes(q);
  }).sort((a, b) => compareValues(a[crewSort.key], b[crewSort.key], crewSort.direction));
  const filteredProjectsForTab = projects.filter((p) => {
    if (!projectTabDivisionFilter.includes(p.division)) return false;
    if (!projectSearch) return true;
    const q = projectSearch.toLowerCase();
    return (p.projectNumber || "").toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || (p.client || "").toLowerCase().includes(q) || projectTypeLabel(p.projectType).toLowerCase().includes(q) || (p.owner || "").toLowerCase().includes(q) || (p.architect || "").toLowerCase().includes(q) || (p.engineer || "").toLowerCase().includes(q);
  });
  const sortedProjectsForTab = [...filteredProjectsForTab].sort((a, b) => compareValues(a[projectSort.key], b[projectSort.key], projectSort.direction));

  function getProjectGanttStart(row) {
    const dates = (row.items || []).map((item) => toDate(item.start)).filter(Boolean);
    if (!dates.length) return new Date(8640000000000000);
    return new Date(Math.min(...dates.map((d) => d.getTime())));
  }

  function getProjectGanttEnd(row) {
    const dates = (row.items || []).map((item) => toDate(item.end)).filter(Boolean);
    if (!dates.length) return new Date(-8640000000000000);
    return new Date(Math.max(...dates.map((d) => d.getTime())));
  }

  function projectGanttSortValue(row) {
    if (projectGanttSort === "startDate") return getProjectGanttStart(row).getTime();
    if (projectGanttSort === "endDate") return getProjectGanttEnd(row).getTime();
    if (projectGanttSort === "unassigned") return (row.items || []).some((item) => item.isUnassignedNeed) ? 0 : 1;
    return `${row.project.projectNumber || ""} ${row.project.name || ""}`.toLowerCase();
  }

  const projectGanttRows = projects
    .filter((p) => {
      if (!divisionFilter.includes(p.division) || !statusFilter.includes(p.status)) return false;
      if (dashboardProjectSearch) {
        const q = dashboardProjectSearch.toLowerCase();
        if (!(p.projectNumber || "").toLowerCase().includes(q) && !p.name.toLowerCase().includes(q)) return false;
      }
      return true;
    })
    .map((project) => {
      const projectAssignments = visibleAssignments.filter((a) => a.projectId === project.id);
      const items = [...timelineVisibleItems, ...unassignedNeedItems].filter((item) => item.project.id === project.id);
      if (!items.length) return null;
      return { project, assignments: projectAssignments, assignment: projectAssignments[0] || {}, items };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const aPending = a.project.status === "Pending Award" ? 1 : 0;
      const bPending = b.project.status === "Pending Award" ? 1 : 0;
      if (aPending !== bPending) return aPending - bPending;

      const aValue = projectGanttSortValue(a);
      const bValue = projectGanttSortValue(b);
      if (typeof aValue === "number" && typeof bValue === "number") {
        const result = aValue - bValue;
        return result !== 0 ? result : compareValues(a.project.projectNumber, b.project.projectNumber, "asc");
      }
      const result = String(aValue).localeCompare(String(bValue), undefined, { numeric: true });
      return result !== 0 ? result : compareValues(a.project.name, b.project.name, "asc");
    });

  const resourceGanttRows = resources.map((resource) => {
    if (!dashboardResourceTypeFilter.includes(resource.resourceType)) return null;
    if (dashboardResourceSearch) {
      const q = dashboardResourceSearch.toLowerCase();
      if (!resource.name.toLowerCase().includes(q)) return null;
    }
    const items = timelineVisibleItems.filter((item) =>
      [item.assignment.projectManager, item.assignment.superintendent, item.assignment.fieldCoordinator, item.assignment.fieldEngineer, item.assignment.safety].includes(resource.name)
    );
    if (!items.length) return null;
    return { resource, items, isUnassignedNeedRow: false };
  }).filter(Boolean);

  const unassignedNeedResourceRows = showUnassignedNeedRows
    ? Object.values(unassignedNeedItems.reduce((groups, item) => {
        const abbr = item.unassignedAbbreviation || getDivisionAbbreviation(item.unassignedDivision);
        const key = `${abbr}-${item.project?.id || "missing-project"}`;
        const searchText = `${abbr} unassigned ${item.unassignedDivision} ${item.project?.projectNumber || ""} ${item.project?.name || ""}`.toLowerCase();
        if (dashboardResourceSearch && !searchText.includes(dashboardResourceSearch.toLowerCase())) return groups;
        if (!groups[key]) {
          groups[key] = {
            isUnassignedNeedRow: true,
            resource: {
              id: `unassigned-${key}`,
              name: `${abbr} - Unassigned`,
              resourceType: "Unassigned Need",
              homeDivision: item.unassignedDivision,
              projectLabel: `${item.project?.projectNumber ? item.project.projectNumber + " - " : ""}${item.project?.name || ""}`,
            },
            items: [],
            sortDivision: item.unassignedDivision || "",
            sortProject: `${item.project?.projectNumber || ""} ${item.project?.name || ""}`,
          };
        }
        groups[key].items.push(item);
        return groups;
      }, {})).sort((a, b) => {
        const divCompare = String(a.sortDivision || "").localeCompare(String(b.sortDivision || ""));
        if (divCompare !== 0) return divCompare;
        return String(a.sortProject || "").localeCompare(String(b.sortProject || ""), undefined, { numeric: true });
      })
    : [];

  const resourceGanttRowsWithUnassigned = [...resourceGanttRows, ...unassignedNeedResourceRows];

  const crewGanttRows = activeCrews
    .filter((c) => {
      if (dashboardCrewSearch) {
        const q = dashboardCrewSearch.toLowerCase();
        return c.crewName.toLowerCase().includes(q) || (c.foremanName || "").toLowerCase().includes(q);
      }
      return true;
    })
    .map((crew) => {
      // Check ALL gantt items (not just timelineVisibleItems) filtered to timeline window
      // so crew-only mobs (which have no named resources) are always included
      const items = ganttItems.filter((item) =>
        getAssignmentCrewIds(item.assignment).includes(crew.id) &&
        itemOverlapsTimeline(item.start, item.end, timeline) &&
        divisionFilter.includes(item.project.division) &&
        statusFilter.includes(item.project.status)
      );
      if (!items.length) return null;
      return { crew, items };
    }).filter(Boolean);

  const projectManagerUtilizationRows = Object.values(assignments.reduce((groups, assignment) => {
    const pmName = (assignment.projectManager || "").trim();
    if (!pmName) return groups;
    const project = findProject(projects, assignment.projectId);
    if (!project) return groups;
    if (!isProjectManagerActiveStatus(project.status) && !isProjectManagerPendingStatus(project.status)) return groups;
    if (!groups[pmName]) {
      groups[pmName] = {
        projectManager: pmName,
        activeProjectIds: new Set(),
        pendingProjectIds: new Set(),
        projectIds: new Set(),
      };
    }
    groups[pmName].projectIds.add(project.id);
    if (isProjectManagerPendingStatus(project.status)) groups[pmName].pendingProjectIds.add(project.id);
    else groups[pmName].activeProjectIds.add(project.id);
    return groups;
  }, {})).map((row) => ({
    projectManager: row.projectManager,
    activeCount: row.activeProjectIds.size,
    pendingCount: row.pendingProjectIds.size,
    totalCount: row.projectIds.size,
  })).sort((a, b) => {
    if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
    return compareValues(a.projectManager, b.projectManager, "asc");
  });

  const focusedResourceItems = focusedResource
    ? timelineVisibleItems.filter((item) =>
        [item.assignment.projectManager, item.assignment.superintendent, item.assignment.fieldCoordinator, item.assignment.fieldEngineer, item.assignment.safety].includes(focusedResource.name)
      )
    : [];

  function getResourceHistoricalItems(resource) {
    if (!resource?.name) return [];
    const today = new Date();
    const fiveYearsAgo = new Date(today.getFullYear() - 5, today.getMonth(), today.getDate());
    const byProject = new Map();

    ganttItems.forEach((item) => {
      const names = [item.assignment.projectManager, item.assignment.superintendent, item.assignment.fieldCoordinator, item.assignment.fieldEngineer, item.assignment.safety].filter(Boolean);
      if (!names.includes(resource.name)) return;
      const start = toDate(item.start);
      const end = toDate(item.end);
      if (!start || !end) return;
      if (start > today) return; // no future projects
      if (end < fiveYearsAgo) return;

      const existing = byProject.get(item.project.id);
      if (!existing) {
        byProject.set(item.project.id, { ...item, firstStart: start, lastEnd: end });
      } else {
        byProject.set(item.project.id, {
          ...existing,
          firstStart: start < existing.firstStart ? start : existing.firstStart,
          lastEnd: end > existing.lastEnd ? end : existing.lastEnd,
        });
      }
    });

    return Array.from(byProject.values()).sort((a, b) => b.lastEnd - a.lastEnd);
  }

  function topCountsFromItems(items, getValue) {
    const counts = new Map();
    items.forEach((item) => {
      const value = String(getValue(item.project) || "").trim();
      if (!value) return;
      counts.set(value, (counts.get(value) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 5);
  }

  function getResourceStats(resource) {
    const items = getResourceHistoricalItems(resource);
    return {
      owners: topCountsFromItems(items, (p) => p.owner),
      architects: topCountsFromItems(items, (p) => p.architect),
      engineers: topCountsFromItems(items, (p) => p.engineer),
      projectTypes: topCountsFromItems(items, (p) => projectTypeLabel(p.projectType)),
      items,
    };
  }

  function exportResourceResume(resource) {
    if (!resource?.name) return;
    const stats = getResourceStats(resource);
    const currentCerts = normalizeResourceCertifications(resource.certifications).filter((cert) => getCertificationStatus(cert) !== "expired");
    const fmt = (value) => value ? formatDate(value) : "";
    const escapeHtml = (value) => String(value || "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch] || ch));
    const statList = (title, rows) => `<div class="stat"><h3>${title}</h3>${rows.length ? `<ol>${rows.map((r) => `<li><span>${escapeHtml(r.name)}</span><strong>${r.count}</strong></li>`).join("")}</ol>` : `<p class="muted">No history</p>`}</div>`;
    const projectRows = stats.items.map((item) => `<tr>
      <td><strong>${escapeHtml(item.project.projectNumber ? `${item.project.projectNumber} - ${item.project.name}` : item.project.name)}</strong><br><span>${escapeHtml(item.project.status)}</span></td>
      <td>${escapeHtml(projectTypeLabel(item.project.projectType))}</td>
      <td>${escapeHtml(item.project.owner || "")}</td>
      <td>${escapeHtml(item.project.architect || "")}</td>
      <td>${escapeHtml(item.project.engineer || "")}</td>
      <td>${fmt(item.firstStart)} - ${fmt(item.lastEnd)}</td>
    </tr>`).join("");
    const certRows = currentCerts.map((cert) => `<tr><td>${escapeHtml(cert.name)}</td><td>${fmt(cert.start)}</td><td>${fmt(cert.expiration)}</td></tr>`).join("");
    const html = `<!doctype html><html><head><title>${escapeHtml(resource.name)} Resume</title><style>
      @page{size:letter;margin:.45in} body{font-family:Arial,sans-serif;color:#0f172a;font-size:11px} h1{font-size:24px;margin:0} h2{font-size:14px;margin:18px 0 6px;border-bottom:2px solid #047857;padding-bottom:4px} h3{font-size:12px;margin:0 0 6px;color:#065f46}.header{display:flex;justify-content:space-between;gap:18px;border-bottom:4px solid #047857;padding-bottom:12px}.muted{color:#64748b}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.stat{border:1px solid #e2e8f0;border-radius:10px;padding:10px;background:#f8fafc}.stat ol{margin:0;padding-left:18px}.stat li{margin:4px 0}.stat li strong{float:right} table{width:100%;border-collapse:collapse} th{background:#f1f5f9;text-align:left;padding:6px;border-bottom:2px solid #cbd5e1}td{padding:6px;border-bottom:1px solid #e2e8f0;vertical-align:top}span{color:#64748b}.small{font-size:10px;color:#64748b}
    </style></head><body>
      <div class="header"><div><h1>${escapeHtml(resource.name)}</h1><p class="muted">${escapeHtml(resource.resourceType)} • ${escapeHtml(resource.homeDivision)}</p></div><div class="small">${escapeHtml(resource.phone)}<br>${escapeHtml(resource.email)}<br>Generated ${new Date().toLocaleDateString()}</div></div>
      <h2>Top Experience Stats</h2><div class="grid">${statList("Owners", stats.owners)}${statList("Architects", stats.architects)}${statList("Engineers", stats.engineers)}${statList("Project Types", stats.projectTypes)}</div>
      <h2>Current Certifications</h2><table><thead><tr><th>Certification</th><th>Start Date</th><th>Expiration Date</th></tr></thead><tbody>${certRows || `<tr><td colspan="3" class="muted">No current certifications listed.</td></tr>`}</tbody></table>
      <h2>Project Experience — Past 5 Years</h2><p class="small">Completed and current projects only; future projects are excluded.</p><table><thead><tr><th>Project</th><th>Type</th><th>Owner</th><th>Architect</th><th>Engineer</th><th>Dates</th></tr></thead><tbody>${projectRows || `<tr><td colspan="6" class="muted">No qualifying project history found.</td></tr>`}</tbody></table>
      <script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script>
    </body></html>`;
    const w = window.open("", "_blank", "width=950,height=1100");
    if (!w) { alert("Please allow pop-ups to export the resume."); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  // ── CRUD: Projects ─────────────────────────────────────────────────────────
  function openAddProjectForm() { setEditingProjectId(null); setProjectForm(blankProject); setShowProjectForm(true); }
  function openEditProjectForm(project) { setEditingProjectId(project.id); setProjectForm({ ...blankProject, ...project }); setShowProjectForm(true); }

  async function saveProject() {
    if (!projectForm.name.trim()) { alert("Project name is required."); return; }
    if (!supabase) { alert("Supabase is not connected. Check Vercel environment variables."); return; }
    const payload = projectToDbLocal(projectForm);
    if (editingProjectId) {
      const { data, error } = await supabase.from("projects").update(payload).eq("id", editingProjectId).select().single();
      if (error) { console.error(error); alert("Could not update project."); return; }
      setProjects((current) => current.map((p) => (p.id === editingProjectId ? mapProjectFromDbLocal(data) : p)));
    } else {
      const { data, error } = await supabase.from("projects").insert(payload).select().single();
      if (error) { console.error(error); alert("Could not save project."); return; }
      setProjects((current) => [mapProjectFromDbLocal(data), ...current]);
    }
    setShowProjectForm(false); setEditingProjectId(null); setProjectForm(blankProject);
  }

  async function deleteProject(id) {
    const project = projects.find((p) => p.id === id);
    if (!confirm(`Delete ${project?.name || "this project"}? This will also remove related assignments.`)) return;
    if (!supabase) { alert("Supabase is not connected."); return; }
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) { console.error(error); alert("Could not delete project."); return; }
    setProjects((current) => current.filter((p) => p.id !== id));
    setAssignments((current) => current.filter((a) => a.projectId !== id));
    setShowProjectForm(false); setEditingProjectId(null); setProjectForm(blankProject);
  }

  // ── CRUD: Assignments ──────────────────────────────────────────────────────
  function openAddAssignmentForm() {
    setEditingAssignmentId(null);
    setAssignmentForm({
      ...blankAssignment,
      mobilizations: [{ id: crypto.randomUUID(), start: "", durationWeeks: "", end: "", superintendent: "", fieldCoordinator: "", crewIds: [], crewMenCounts: {}, crewOnly: false, unassignedNeeds: [] }],
    });
    setShowAssignmentForm(true);
  }

  function openEditAssignmentForm(assignment) {
    setEditingAssignmentId(assignment.id);
    const mobs = (assignment.mobilizations?.length ? assignment.mobilizations : [
      { id: crypto.randomUUID(), start: "", durationWeeks: "", end: "", superintendent: "", fieldCoordinator: "", crewIds: [], crewMenCounts: {}, crewOnly: false, unassignedNeeds: [] }
    ]).map((mob, i) => {
      const isFirst = i === 0;
      return {
        id: mob.id || crypto.randomUUID(),
        start: mob.start || "",
        durationWeeks: mob.durationWeeks || "",
        end: mob.end || "",
        superintendent: mob.superintendent || (isFirst ? assignment.superintendent || "" : ""),
        fieldCoordinator: mob.fieldCoordinator || (isFirst ? assignment.fieldCoordinator || "" : ""),
        crewIds: mob.crewIds?.length
          ? mob.crewIds
          : (isFirst ? [assignment.crew1Id, assignment.crew2Id, assignment.crew3Id, assignment.crew4Id].filter(Boolean) : []),
        crewMenCounts: mob.crewMenCounts || {},
        crewOnly: mob.crewOnly || false,
        unassignedNeeds: normalizeUnassignedNeeds(mob.unassignedNeeds),
      };
    });
    setAssignmentForm({
      projectId: assignment.projectId || "",
      projectManager: assignment.projectManager || "",
      fieldEngineer: assignment.fieldEngineer || "",
      safety: assignment.safety || "",
      mobilizations: mobs,
    });
    setShowAssignmentForm(true);
  }

  async function saveAssignment() {
    if (!assignmentForm.projectId) { alert("Project is required."); return; }
    if (!(assignmentForm.mobilizations || []).some((m) => m.start && m.end)) { alert("At least one mobilization with start and end date is required."); return; }
    if (!supabase) { alert("Supabase is not connected. Check Vercel environment variables."); return; }
    const assignmentPayload = assignmentToDb(assignmentForm);
    let savedAssignment;
    if (editingAssignmentId) {
      const { data, error } = await supabase.from("assignments").update(assignmentPayload).eq("id", editingAssignmentId).select().single();
      if (error) { console.error(error); alert("Could not update assignment."); return; }
      savedAssignment = data;
      const del = await supabase.from("mobilizations").delete().eq("assignment_id", editingAssignmentId);
      if (del.error) { console.error(del.error); alert("Could not update mobilizations."); return; }
    } else {
      const { data, error } = await supabase.from("assignments").insert(assignmentPayload).select().single();
      if (error) { console.error(error); alert("Could not save assignment."); return; }
      savedAssignment = data;
    }
    const validMobs = (assignmentForm.mobilizations || []).filter((m) => m.start && m.end).map((m) => mobilizationToDbLocal(m, savedAssignment.id));
    let savedMobs = [];
    if (validMobs.length) {
      const { data, error } = await supabase.from("mobilizations").insert(validMobs).select();
      if (error) { console.error(error); alert("Could not save mobilizations."); return; }
      savedMobs = data || [];
    }
    let mapped = mapAssignmentFromDbLocal(savedAssignment, savedMobs);
    // Preserve mobilization-level unassigned selections immediately so the Gantt updates without a refresh.
    const formMobs = (assignmentForm.mobilizations || []).filter((m) => m.start && m.end);
    mapped = {
      ...mapped,
      mobilizations: (mapped.mobilizations || []).map((mob, index) => {
        const formMob = formMobs[index] || formMobs.find((m) => String(m.start || "") === String(mob.start || "") && String(m.end || "") === String(mob.end || ""));
        return formMob ? { ...mob, unassignedNeeds: normalizeUnassignedNeeds(formMob.unassignedNeeds) } : mob;
      }),
    };
    if (editingAssignmentId) setAssignments((current) => current.map((a) => (a.id === editingAssignmentId ? mapped : a)));
    else setAssignments((current) => [mapped, ...current]);
    setShowAssignmentForm(false); setEditingAssignmentId(null);
    setAssignmentForm({ ...blankAssignment, mobilizations: [{ id: crypto.randomUUID(), start: "", durationWeeks: "", end: "", superintendent: "", fieldCoordinator: "", crewIds: [], crewMenCounts: {}, crewOnly: false, unassignedNeeds: [] }] });
  }

  async function deleteAssignment(id) {
    const assignment = assignments.find((a) => a.id === id);
    const project = assignment ? findProject(projects, assignment.projectId) : null;
    if (!confirm(`Delete assignment for ${project?.name || "this project"}?`)) return;
    if (!supabase) { alert("Supabase is not connected."); return; }
    const { error } = await supabase.from("assignments").delete().eq("id", id);
    if (error) { console.error(error); alert("Could not delete assignment."); return; }
    setAssignments((current) => current.filter((a) => a.id !== id));
  }

  // ── CRUD: Resources ────────────────────────────────────────────────────────
  function openAddResourceForm() { setEditingResourceId(null); setResourceForm(blankResource); setShowResourceForm(true); }
  function openEditResourceForm(resource) { setEditingResourceId(resource.id); setResourceForm({ ...blankResource, ...resource }); setShowResourceForm(true); }

  async function saveResource() {
    if (!resourceForm.name.trim()) { alert("Resource name is required."); return; }
    if (!supabase) { alert("Supabase is not connected."); return; }
    const payload = resourceToDbLocal(resourceForm);
    if (editingResourceId) {
      const { data, error } = await supabase.from("resources").update(payload).eq("id", editingResourceId).select().single();
      if (error) { console.error(error); alert("Could not update resource."); return; }
      setResources((current) => current.map((r) => (r.id === editingResourceId ? mapResourceFromDbLocal(data) : r)));
    } else {
      const { data, error } = await supabase.from("resources").insert(payload).select().single();
      if (error) { console.error(error); alert("Could not save resource."); return; }
      setResources((current) => [mapResourceFromDbLocal(data), ...current]);
    }
    setShowResourceForm(false); setEditingResourceId(null); setResourceForm(blankResource);
  }

  async function deleteResource(id) {
    const resource = resources.find((r) => r.id === id);
    if (!confirm(`Delete ${resource?.name || "this resource"}?`)) return;
    if (!supabase) { alert("Supabase is not connected."); return; }
    const { error } = await supabase.from("resources").delete().eq("id", id);
    if (error) { console.error(error); alert("Could not delete resource."); return; }
    setResources((current) => current.filter((r) => r.id !== id));
    setShowResourceForm(false); setEditingResourceId(null); setResourceForm(blankResource);
  }

  // ── CRUD: Crews ────────────────────────────────────────────────────────────
  function openAddCrewForm() { setEditingCrewId(null); setCrewForm(blankCrew); setShowCrewForm(true); }
  function openEditCrewForm(crew) { setEditingCrewId(crew.id); setCrewForm({ ...blankCrew, ...crew, deactivated: isCrewDeactivated(crew) }); setShowCrewForm(true); }

  async function saveCrew() {
    if (!crewForm.crewName.trim()) { alert("Crew name is required."); return; }
    if (editingCrewId) {
      setCrewDeactivationOverrides((current) => ({ ...current, [editingCrewId]: !!crewForm.deactivated }));
      setCrews((current) => current.map((c) => (c.id === editingCrewId ? { ...c, ...crewForm, id: editingCrewId, deactivated: !!crewForm.deactivated } : c)));
    }
    if (!supabase) { alert("Supabase is not connected."); return; }
    const payload = crewToDbLocal(crewForm);
    if (editingCrewId) {
      const { data, error } = await supabase.from("crews").update(payload).eq("id", editingCrewId).select().single();
      if (error) { console.error(error); alert("Could not update crew."); return; }
      const mappedCrew = { ...mapCrewFromDbLocal(data), deactivated: !!crewForm.deactivated };
      setCrewDeactivationOverrides((current) => ({ ...current, [editingCrewId]: !!crewForm.deactivated }));
      setCrews((current) => current.map((c) => (c.id === editingCrewId ? mappedCrew : c)));
      setTimeout(() => {
        setCrewDeactivationOverrides((current) => ({ ...current, [editingCrewId]: !!crewForm.deactivated }));
        setCrews((current) => current.map((c) => (c.id === editingCrewId ? { ...c, deactivated: !!crewForm.deactivated } : c)));
      }, 500);
    } else {
      const { data, error } = await supabase.from("crews").insert(payload).select().single();
      if (error) { console.error(error); alert("Could not save crew."); return; }
      setCrews((current) => [mapCrewFromDbLocal(data), ...current]);
    }
    setShowCrewForm(false); setEditingCrewId(null); setCrewForm(blankCrew);
  }

  async function deleteCrew(id) {
    const crew = crews.find((c) => c.id === id);
    if (!confirm(`Delete ${crew?.crewName || "this crew"}?`)) return;
    if (!supabase) { alert("Supabase is not connected."); return; }
    const { error } = await supabase.from("crews").delete().eq("id", id);
    if (error) { console.error(error); alert("Could not delete crew."); return; }
    setCrews((current) => current.filter((c) => c.id !== id));
    setShowCrewForm(false); setEditingCrewId(null); setCrewForm(blankCrew);
  }

  // ── CRUD: Certifications (now Supabase, not localStorage) ──────────────────
  async function addCertification() {
    const cert = newCertification.trim();
    if (!cert) return;
    if (certifications.includes(cert)) { setNewCertification(""); return; }
    if (!supabase) { alert("Supabase is not connected."); return; }
    const { error } = await supabase.from("certifications").insert({ name: cert });
    if (error) { console.error(error); alert("Could not add certification."); return; }
    setCertifications((current) => [...current, cert]);
    setNewCertification("");
  }

  async function deleteCertification(cert) {
    if (!supabase) { alert("Supabase is not connected."); return; }
    const { error } = await supabase.from("certifications").delete().eq("name", cert);
    if (error) { console.error(error); alert("Could not delete certification."); return; }
    setCertifications((current) => current.filter((c) => c !== cert));
    setResources((current) => current.map((r) => ({ ...r, certifications: normalizeResourceCertifications(r.certifications).filter((c) => c.name !== cert) })));
    setProjects((current) => current.map((p) => ({ ...p, specificRequirements: (p.specificRequirements || []).filter((c) => c !== cert) })));
  }

  async function addProjectType() {
    const type = newProjectType.trim();
    if (!type) return;
    if (projectTypes.includes(type)) { setNewProjectType(""); return; }
    if (supabase) {
      const { error } = await supabase.from("project_types").insert({ name: type });
      if (error) { console.error(error); alert("Could not add project type. Run the project_types SQL block first."); return; }
    }
    setProjectTypes((current) => current.includes(type) ? current : [...current, type]);
    setNewProjectType("");
  }

  async function deleteProjectType(type) {
    if (!confirm(`Delete project type ${type}? Existing projects will keep their saved value.`)) return;
    if (supabase) {
      const { error } = await supabase.from("project_types").delete().eq("name", type);
      if (error) { console.error(error); alert("Could not delete project type."); return; }
    }
    setProjectTypes((current) => current.filter((item) => item !== type));
  }

  // ── Forecast helpers ───────────────────────────────────────────────────────

  // Returns the months (YYYY-MM strings) a project's mobilizations overlap
  function getProjectMonths(projectId) {
    const projectAssignments = assignments.filter((a) => a.projectId === projectId);
    const months = new Set();
    projectAssignments.forEach((a) => {
      (a.mobilizations || []).forEach((mob) => {
        if (!mob.start || !mob.end) return;
        const start = toDate(mob.start);
        const end = toDate(mob.end);
        if (!start || !end) return;
        let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
        const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
        while (cursor <= endMonth) {
          months.add(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
          cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
        }
      });
    });
    return [...months].sort();
  }

  // Get the number of onsite days a project has in a given month
  // across all its mobilization date ranges
  function getProjectDaysInMonth(projectId, monthKey) {
    const [year, month] = monthKey.split("-").map(Number);
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0); // last day of month
    let days = 0;
    const projectAssignments = assignments.filter((a) => a.projectId === projectId);
    projectAssignments.forEach((a) => {
      (a.mobilizations || []).forEach((mob) => {
        if (!mob.start || !mob.end) return;
        const mobStart = toDate(mob.start);
        const mobEnd = toDate(mob.end);
        if (!mobStart || !mobEnd) return;
        const overlapStart = mobStart > monthStart ? mobStart : monthStart;
        const overlapEnd = mobEnd < monthEnd ? mobEnd : monthEnd;
        if (overlapStart <= overlapEnd) {
          days += Math.ceil((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)) + 1;
        }
      });
    });
    return days;
  }

  // Spread rules: distribute contractValue across active months weighted by actual onsite days
  function spreadRevenue(contractValue, activeMonths, rule, projectId = null) {
    const n = activeMonths.length;
    if (n === 0 || !contractValue) return {};
    const result = {};

    // Get day-weights per month if projectId is provided for accurate weighting
    const dayWeights = projectId
      ? activeMonths.map((m) => Math.max(1, getProjectDaysInMonth(projectId, m)))
      : activeMonths.map(() => 1);
    const totalDays = dayWeights.reduce((s, d) => s + d, 0);

    if (rule === "even") {
      // Weighted by actual onsite days — a 1-day month gets proportionally less than a 25-day month
      activeMonths.forEach((m, i) => { result[m] = (dayWeights[i] / totalDays) * contractValue; });
    } else if (rule === "front") {
      // Front-loaded: combine day-weight with decreasing index weight
      const indexWeights = activeMonths.map((_, i) => 1 / (i + 1));
      const combined = activeMonths.map((_, i) => dayWeights[i] * indexWeights[i]);
      const total = combined.reduce((s, w) => s + w, 0);
      activeMonths.forEach((m, i) => { result[m] = (combined[i] / total) * contractValue; });
    } else if (rule === "back") {
      // Back-loaded: combine day-weight with increasing index weight
      const indexWeights = activeMonths.map((_, i) => 1 / (n - i));
      const combined = activeMonths.map((_, i) => dayWeights[i] * indexWeights[i]);
      const total = combined.reduce((s, w) => s + w, 0);
      activeMonths.forEach((m, i) => { result[m] = (combined[i] / total) * contractValue; });
    } else if (rule === "scurve") {
      // S-curve: bell-shaped weights peaked in middle, multiplied by day-weight
      const mid = (n - 1) / 2;
      const sigma = Math.max(1, n / 4);
      const bellWeights = activeMonths.map((_, i) => Math.exp(-Math.pow(i - mid, 2) / (2 * sigma * sigma)));
      const combined = activeMonths.map((_, i) => dayWeights[i] * bellWeights[i]);
      const total = combined.reduce((s, w) => s + w, 0);
      activeMonths.forEach((m, i) => { result[m] = (combined[i] / total) * contractValue; });
    }
    return result;
  }

  // Recalculate redistributed spread for a single project based on current actuals + rule
  function recalculateProject(projectId, row) {
    const allMonths = getProjectMonths(projectId);
    const actuals = row.actuals || {};
    const totalActuals = Object.values(actuals).reduce((s, v) => s + v, 0);
    const remaining = (row.contractValue || 0) - totalActuals;
    const remainingMonths = allMonths.filter((m) => actuals[m] === undefined && !isMonthLocked(m));
    if (remainingMonths.length > 0 && remaining >= 0) {
      return spreadRevenue(remaining, remainingMonths, row.spreadRule, projectId);
    }
    return {};
  }

  // Recalculate all visible forecast projects and save
  async function recalculateAll() {
    const forecastProjects = projects.filter((p) => forecastDivisionFilter.includes(p.division) && p.includeInForecast && p.status !== "Complete");
    for (const p of forecastProjects) {
      const row = getForecastRow(p.id);
      const redistributed = recalculateProject(p.id, row);
      await saveForecastRow(p.id, { redistributedSpread: redistributed });
    }
    // Force uncontrolled inputs to re-mount with fresh values
    setForecastKey((k) => k + 1);
  }

  // Get forecast row for a project (with defaults)
  function getForecastRow(projectId) {
    return forecastData[projectId] || { contractValue: 0, spreadRule: "even", actuals: {}, redistributedSpread: {} };
  }

  // Check if a month is locked (global lock only)
  function isMonthLocked(monthKey) {
    return !!(globalLockThrough && monthKey <= globalLockThrough);
  }

  // Get the value to display for a month — actual if exists, redistributed spread, else original spread
  function getMonthValue(projectId, monthKey, spread) {
    const row = getForecastRow(projectId);
    if (row.actuals[monthKey] !== undefined) return { value: row.actuals[monthKey], isActual: true };
    // Use redistributed spread if available (actuals have been entered)
    if (row.redistributedSpread && row.redistributedSpread[monthKey] !== undefined) {
      return { value: row.redistributedSpread[monthKey], isActual: false, isRedistributed: true };
    }
    return { value: spread[monthKey] || 0, isActual: false };
  }

  // Save/upsert a forecast row for a project
  async function saveForecastRow(projectId, patch) {
    if (!supabase) { alert("Supabase not connected."); return; }
    const existing = forecastData[projectId];
    const newRow = { ...getForecastRow(projectId), ...patch };
    const dbPayload = {
      contract_value: newRow.contractValue,
      spread_rule: newRow.spreadRule,
      actuals: newRow.actuals,
      redistributed_spread: newRow.redistributedSpread || {},
      updated_at: new Date().toISOString(),
    };
    if (existing?.id) {
      const { error } = await supabase.from("forecast").update(dbPayload).eq("id", existing.id);
      if (error) { console.error(error); alert("Could not save forecast."); return; }
    } else {
      const { data, error } = await supabase.from("forecast").insert({ project_id: projectId, ...dbPayload }).select().single();
      if (error) { console.error(error); alert("Could not save forecast."); return; }
      newRow.id = data.id;
    }
    setForecastData((prev) => ({ ...prev, [projectId]: newRow }));
  }

  // Save actual revenue for a specific month — recalculates remaining spread if actual differs
  async function saveActual(projectId, monthKey, value) {
    const row = getForecastRow(projectId);
    const newActuals = { ...row.actuals };

    if (value === "" || value === null || isNaN(Number(value))) {
      delete newActuals[monthKey];
    } else {
      newActuals[monthKey] = Number(value);
    }

    const allMonths = getProjectMonths(projectId);
    const totalActuals = Object.values(newActuals).reduce((s, v) => s + v, 0);
    const remaining = (row.contractValue || 0) - totalActuals;
    const remainingMonths = allMonths.filter((m) => newActuals[m] === undefined && !isMonthLocked(m));

    if (remainingMonths.length > 0 && remaining >= 0) {
      const redistributed = spreadRevenue(remaining, remainingMonths, row.spreadRule, projectId);
      await saveForecastRow(projectId, { actuals: newActuals, redistributedSpread: redistributed });
    } else {
      await saveForecastRow(projectId, { actuals: newActuals, redistributedSpread: {} });
    }
    setForecastKey((k) => k + 1);
  }

  // When spread rule changes, immediately recalculate remaining months
  async function saveSpreadRule(projectId, newRule) {
    const row = getForecastRow(projectId);
    const allMonths = getProjectMonths(projectId);
    const actuals = row.actuals || {};
    const totalActuals = Object.values(actuals).reduce((s, v) => s + v, 0);
    const remaining = (row.contractValue || 0) - totalActuals;
    const remainingMonths = allMonths.filter((m) => actuals[m] === undefined && !isMonthLocked(m));
    const redistributed = remainingMonths.length > 0 && remaining >= 0
      ? spreadRevenue(remaining, remainingMonths, newRule, projectId)
      : {};
    await saveForecastRow(projectId, { spreadRule: newRule, redistributedSpread: redistributed });
    setForecastKey((k) => k + 1);
  }

  // Save global lock setting
  async function saveGlobalLock(monthKey) {
    if (!supabase) { alert("Supabase not connected."); return; }
    const val = monthKey || null;
    if (forecastSettingsId) {
      await supabase.from("forecast_settings").update({ global_lock_through: val, updated_at: new Date().toISOString() }).eq("id", forecastSettingsId);
    } else {
      const { data } = await supabase.from("forecast_settings").insert({ global_lock_through: val }).select().single();
      if (data) setForecastSettingsId(data.id);
    }
    setGlobalLockThrough(val);
  }

  // CSV export for forecast
  function exportForecastCsv() {
    const months = Array.from({ length: 12 }, (_, i) => `${forecastYear}-${String(i + 1).padStart(2, "0")}`);
    const headers = ["Project #", "Project Name", "Division", "Status", "Contract Value", "Spread Rule", "Per-Project Lock", ...months.map((m) => m), "Year Total", "Thereafter"];
    const forecastProjects = projects.filter((p) => forecastDivisionFilter.includes(p.division) && p.status !== "Complete");
    const rows = forecastProjects.map((p) => {
      const row = getForecastRow(p.id);
      const allMonths = getProjectMonths(p.id);
      const spread = spreadRevenue(row.contractValue, allMonths, row.spreadRule);
      const yearValues = months.map((m) => getMonthValue(p.id, m, spread).value);
      const yearTotal = yearValues.reduce((s, v) => s + v, 0);
      const thereafter = allMonths.filter((m) => m > `${forecastYear}-12`).reduce((s, m) => s + (spread[m] || 0), 0);
      return [p.projectNumber, p.name, p.division, p.status, row.contractValue, row.spreadRule, row.perProjectLockThrough || "", ...yearValues.map((v) => v.toFixed(2)), yearTotal.toFixed(2), thereafter.toFixed(2)];
    });
    const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
    downloadTextFile(`ggc-forecast-${forecastYear}.csv`, csv);
  }

  // PDF export for forecast
  function exportForecastPdf() {
    const months = Array.from({ length: 12 }, (_, i) => ({
      key: `${forecastYear}-${String(i + 1).padStart(2, "0")}`,
      label: new Date(forecastYear, i, 1).toLocaleString("default", { month: "short" }),
    }));
    const forecastProjects = projects
      .filter((p) => forecastDivisionFilter.includes(p.division) && p.includeInForecast && p.status !== "Complete")
      .sort((a, b) => compareValues(a[forecastSort.key], b[forecastSort.key], forecastSort.direction));
    const fmt = (v) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v || 0);

    const rows = forecastProjects.map((p, idx) => {
      const row = getForecastRow(p.id);
      const allMonths = getProjectMonths(p.id);
      const spread = spreadRevenue(row.contractValue, allMonths, row.spreadRule);
      const monthValues = months.map((m) => getMonthValue(p.id, m.key, spread));
      const yearTotal = monthValues.reduce((s, mv) => s + mv.value, 0);
      const thereafter = allMonths.filter((m) => m > `${forecastYear}-12`).reduce((s, m) => s + (spread[m] || 0), 0);
      const bg = idx % 2 === 0 ? "#f8fafc" : "#ffffff";
      const cells = monthValues.map((mv) => `<td style="padding:4px 6px;text-align:right;color:${mv.isActual ? "#065f46" : "#334155"};font-weight:${mv.isActual ? "600" : "400"}">${mv.value > 0 ? fmt(mv.value) : ""}</td>`).join("");
      return `<tr style="background:${bg}"><td style="padding:4px 6px;font-weight:600">${p.projectNumber ? p.projectNumber + " - " : ""}${p.name}</td><td style="padding:4px 6px">${p.division}</td><td style="padding:4px 6px;text-align:right">${fmt(row.contractValue)}</td>${cells}<td style="padding:4px 6px;text-align:right;color:#64748b">${fmt(thereafter)}</td><td style="padding:4px 6px;text-align:right;font-weight:700">${fmt(yearTotal)}</td></tr>`;
    });

    const monthTotals = months.map((m, i) => {
      return forecastProjects.reduce((s, p) => {
        const row = getForecastRow(p.id);
        const allMonths = getProjectMonths(p.id);
        const spread = spreadRevenue(row.contractValue, allMonths, row.spreadRule);
        return s + getMonthValue(p.id, m.key, spread).value;
      }, 0);
    });
    const yearGrandTotal = monthTotals.reduce((s, v) => s + v, 0);
    const thereafterTotal = forecastProjects.reduce((s, p) => {
      const row = getForecastRow(p.id);
      const allMonths = getProjectMonths(p.id);
      const spread = spreadRevenue(row.contractValue, allMonths, row.spreadRule);
      return s + allMonths.filter((m) => m > `${forecastYear}-12`).reduce((ms, m) => ms + (spread[m] || 0), 0);
    }, 0);
    const cumulative = monthTotals.map((_, i) => monthTotals.slice(0, i + 1).reduce((s, v) => s + v, 0));

    const headerCells = months.map((m) => `<th style="padding:4px 6px;text-align:right;background:#f1f5f9">${m.label}</th>`).join("");
    const totalCells = monthTotals.map((v) => `<td style="padding:4px 6px;text-align:right;font-weight:700">${fmt(v)}</td>`).join("");
    const cumCells = cumulative.map((v) => `<td style="padding:4px 6px;text-align:right;color:#065f46">${fmt(v)}</td>`).join("");

    const html = `<!doctype html><html><head><title>GGC Forecast ${forecastYear}</title><style>@page{size:landscape;margin:.3in}body{font-family:Arial,sans-serif;font-size:10px;color:#0f172a}table{border-collapse:collapse;width:100%}th{background:#f1f5f9;padding:4px 6px;text-align:left;border-bottom:2px solid #cbd5e1}td{border-bottom:1px solid #e2e8f0}h1{font-size:14px;margin-bottom:8px}</style></head><body><h1>GGC Revenue Forecast — ${forecastYear}</h1><table><thead><tr><th>Project</th><th>Division</th><th style="text-align:right">Contract Value</th>${headerCells}<th style="text-align:right;background:#e2e8f0">Thereafter</th><th style="text-align:right;background:#e2e8f0">Year Total</th></tr></thead><tbody>${rows.join("")}<tr style="background:#f1f5f9;font-weight:700"><td colspan="3" style="padding:4px 6px">Monthly Total</td>${totalCells}<td style="padding:4px 6px;text-align:right">${fmt(thereafterTotal)}</td><td style="padding:4px 6px;text-align:right">${fmt(yearGrandTotal)}</td></tr><tr style="background:#ecfdf5;color:#065f46"><td colspan="3" style="padding:4px 6px;font-weight:700">Cumulative YTD</td>${cumCells}<td></td><td style="padding:4px 6px;text-align:right;font-weight:700">${fmt(yearGrandTotal)}</td></tr></tbody></table><script>window.onload=function(){setTimeout(function(){window.print()},350)}<\/script></body></html>`;
    const w = window.open("", "_blank", "width=1400,height=900");
    if (!w) { alert("Please allow pop-ups to export PDF."); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  // CSV import for forecast
  function importForecastCsv(event) {
    readCsvFile(event, async (rows) => {
      for (const row of rows) {
        const projectNum = row.projectnumber || row.project || "";
        const project = projects.find((p) => p.projectNumber === projectNum || p.name === (row.projectname || row.name || ""));
        if (!project) continue;
        const contractValue = parseFloat(row.contractvalue || row.contract || 0) || 0;
        const spreadRule = ["even", "front", "back", "scurve"].includes(row.spreadrule) ? row.spreadrule : undefined;
        const patch = { contractValue };
        if (spreadRule) patch.spreadRule = spreadRule;
        await saveForecastRow(project.id, patch);
      }
    });
  }

  // ── Auth ───────────────────────────────────────────────────────────────────
  async function handleLogin(event) {
    event.preventDefault();
    if (!supabase) { alert("Supabase is not connected."); return; }
    const { data, error } = await supabase.rpc("authenticate_app_user", { input_username: loginForm.username, input_password: loginForm.password });
    if (error) { console.error(error); alert("Login setup is missing. Run the user SQL block in Supabase."); return; }
    if (!data) { alert("Invalid username or password."); return; }
    sessionStorage.setItem("ggc_current_user", loginForm.username);
    setCurrentUser(loginForm.username);
    setLoginForm({ username: "", password: "" });
    await loadAppUsers();
  }

  async function loadAppUsers() {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("list_app_users");
    if (error) { console.error("Could not load app users:", error); return; }
    setAppUsers(data || []);
  }

  async function loadProjectTypes() {
    if (!supabase) return;
    const { data, error } = await supabase.from("project_types").select("name").order("name", { ascending: true });
    if (error) { console.warn("Project type settings table is not set up yet:", error); return; }
    if (data?.length) setProjectTypes(data.map((row) => row.name));
  }

  async function addAppUser() {
    if (!newUserForm.username.trim() || !newUserForm.password.trim()) { alert("Username and password are required."); return; }
    if (!supabase) { alert("Supabase is not connected."); return; }
    const { error } = await supabase.rpc("create_app_user", { input_username: newUserForm.username, input_password: newUserForm.password });
    if (error) { console.error(error); alert("Could not create user."); return; }
    setNewUserForm({ username: "", password: "" });
    await loadAppUsers();
  }

  async function deleteAppUser(username) {
    if (username === currentUser) { alert("You cannot delete the user currently signed in."); return; }
    if (!confirm(`Delete login user ${username}?`)) return;
    if (!supabase) { alert("Supabase is not connected."); return; }
    const { error } = await supabase.rpc("delete_app_user", { input_username: username });
    if (error) { console.error(error); alert("Could not delete user."); return; }
    await loadAppUsers();
  }

  function logout() { sessionStorage.removeItem("ggc_current_user"); setCurrentUser(""); }

  function parseYesNo(value) {
    const text = String(value ?? "").trim().toLowerCase();
    return ["yes", "y", "true", "1", "active", "checked", "include", "included"].includes(text);
  }

  function formatYesNo(value) {
    return value ? "Yes" : "No";
  }

  // ── Exports ────────────────────────────────────────────────────────────────
  function exportDashboardExcel() {
    const rows = [
      ["Project #", "Project Name", "Division", "Status", "Mobilization #", "Start", "End", "Project Manager", "Superintendent", "Field Coordinator", "Field Engineer", "Safety", "Crews"],
      ...timelineVisibleItems.map((item) => [item.project.projectNumber, item.project.name, item.project.division, item.project.status, item.mobilizationNumber, item.start, item.end, item.assignment.projectManager, item.assignment.superintendent, item.assignment.fieldCoordinator, item.assignment.fieldEngineer, item.assignment.safety, getAssignmentCrewDisplayNames(item.assignment, crews).join("; ")]),
    ];
    downloadTextFile("ggc-resource-planning-dashboard.csv", rows.map((r) => r.map(csvEscape).join(",")).join("\n"));
  }

  function exportProjectsExcel() {
    const rows = [
      ["Project Number", "Project Name", "Client", "Address", "Division", "Project Type", "Owner", "Architect", "Engineer", "Specific Requirements", "Status", "Include in Forecast"],
      ...projects.map((p) => [
        p.projectNumber,
        p.name,
        p.client,
        p.address,
        p.division,
        projectTypeLabel(p.projectType),
        p.owner || "",
        p.architect || "",
        p.engineer || "",
        (p.specificRequirements || []).join("; "),
        p.status,
        formatYesNo(p.includeInForecast),
      ]),
    ];
    downloadTextFile("ggc-projects.csv", rows.map((r) => r.map(csvEscape).join(",")).join("\n"));
  }

  function exportResourcesExcel() {
    const rows = [["Name", "Resource Type", "Home Division", "Status", "Phone", "Email", "Certifications (name|start|expiration)", "PTO (id|start|end)"], ...resources.map((r) => [r.name, r.resourceType, r.homeDivision, r.status || "Active", r.phone, r.email, normalizeResourceCertifications(r.certifications).map(certificationCsvValue).join("; "), (r.pto || []).map((p) => `${p.ptoId}|${p.start}|${p.end}`).join("; ")])];
    downloadTextFile("ggc-resources.csv", rows.map((r) => r.map(csvEscape).join(",")).join("\n"));
  }

  function exportCrewsExcel() {
    const rows = [["Crew Name", "Foreman Name", "Total Members", "Status", "Deactivated", "Specialty"], ...crews.map((c) => [c.crewName, c.foremanName, c.totalMembers || 0, isCrewDeactivated(c) ? "Deactivated" : "Active", isCrewDeactivated(c) ? "TRUE" : "FALSE", (c.specialty || []).join("; ")])];
    downloadTextFile("ggc-crews.csv", rows.map((r) => r.map(csvEscape).join(",")).join("\n"));
  }

  function exportSectionPdf(sectionId, title) {
    const section = document.getElementById(sectionId);
    if (!section) { alert(`Could not find section "${title}" to export.`); return; }
    const printWindow = window.open("", "_blank", "width=1400,height=900");
    if (!printWindow) { alert("Please allow pop-ups to export PDF."); return; }

    // Clone and strip interactive elements
    const cloned = section.cloneNode(true);
    cloned.querySelectorAll("button, input, select, label").forEach((el) => el.remove());
    cloned.querySelectorAll("[class*='overflow-x-auto']").forEach((el) => { el.style.overflow = "visible"; el.style.width = "auto"; });
    cloned.querySelectorAll("svg").forEach((el) => { el.style.maxWidth = "none"; });

    const css = `
      @page { size: landscape; margin: 0.3in; }
      body { font-family: Arial, sans-serif; font-size: 10px; color: #0f172a; margin: 0; background: white; }
      h1 { font-size: 13px; margin: 0 0 8px 0; }
      * { box-sizing: border-box; }
      [class*="rounded"] { border-radius: 8px; }
      [class*="bg-white"] { background: white !important; }
      [class*="bg-slate-50"] { background: #f8fafc !important; }
      [class*="bg-slate-100"] { background: #f1f5f9 !important; }
      [class*="bg-slate-200"] { background: #e2e8f0 !important; }
      [class*="bg-emerald-700"] { background: #047857 !important; }
      [class*="bg-emerald-300"] { background: #6ee7b7 !important; }
      [class*="bg-blue-700"] { background: #1d4ed8 !important; }
      [class*="bg-blue-300"] { background: #93c5fd !important; }
      [class*="bg-orange-600"] { background: #ea580c !important; }
      [class*="bg-orange-300"] { background: #fdba74 !important; }
      [class*="bg-purple-700"] { background: #7e22ce !important; }
      [class*="bg-purple-300"] { background: #d8b4fe !important; }
      [class*="bg-amber-50"] { background: #fffbeb !important; }
      [class*="bg-red-600"] { background: #dc2626 !important; }
      [class*="text-white"] { color: white !important; }
      [class*="text-slate-900"] { color: #0f172a !important; }
      [class*="text-slate-500"] { color: #64748b !important; }
      [class*="border"] { border: 1px solid #e2e8f0; }
      [class*="shadow"] { box-shadow: none !important; }
      [class*="sticky"] { position: static !important; }
      button, input, select, label { display: none !important; }
      .overflow-x-auto { overflow: visible !important; }
    `;

    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html><head><title>${title || "GGC Export"}</title><style>${css}</style></head><body><h1>${title || "GGC Export"}</h1><div style="padding:0">${cloned.outerHTML}</div><script>window.onload=function(){setTimeout(function(){window.print()},500)}<\/script></body></html>`);
    printWindow.document.close();
  }

  // ── CSV Imports ────────────────────────────────────────────────────────────
  function importProjectsCsv(event) {
    readCsvFile(event, async (rows) => {
      if (!supabase) { alert("Supabase is not connected."); return; }
      const imported = rows.map((row) => ({
        project_number: row.projectnumber || row.project || "",
        name: row.projectname || row.name || "",
        client: row.client || "",
        address: row.address || "",
        division: divisions.includes(row.division) ? row.division : "Hardscape",
        project_type: splitList(row.projecttype || row.projecttypes || row.type || "").join("; "),
        owner: row.owner || row.projectowner || "",
        architect: row.architect || "",
        engineer: row.engineer || "",
        specific_requirements: splitList(row.specificrequirements || row.requirements || row.certifications),
        status: statuses.includes(row.status) ? row.status : "Scheduled",
        include_in_forecast: parseYesNo(row.includeinforecast || row.forecast || row.activeforecast || row.includeforecast || row.inforecast),
      })).filter((p) => p.project_number || p.name);
      if (!imported.length) { alert("No valid projects found in CSV."); return; }
      const { data, error } = await supabase.from("projects").insert(imported).select();
      if (error) { console.error(error); alert("Could not import projects."); return; }
      setProjects((current) => [...(data || []).map(mapProjectFromDbLocal), ...current]);
    });
  }

  function importResourcesCsv(event) {
    readCsvFile(event, async (rows) => {
      if (!supabase) { alert("Supabase is not connected."); return; }
      const imported = rows.map((row) => ({ name: row.name || "", resource_type: resourceTypes.includes(row.resourcetype) ? row.resourcetype : "Superintendent", home_division: divisions.includes(row.homedivision || row.division) ? (row.homedivision || row.division) : "Hardscape", phone: row.phone || "", email: row.email || "", certifications: parseResourceCertificationsCsv(row.certifications || row.certificationsnamestartexpiration || row.certificationsname_start_expiration), pto: splitList(row.pto || row.ptoidstartend || row.ptoid_start_end).map((item) => { const [ptoId, start, end] = item.split("|"); return { id: crypto.randomUUID(), ptoId: ptoId || "", start: start || "", end: end || "" }; }).filter((p) => p.ptoId || p.start || p.end), status: row.status || "Active" })).filter((r) => r.name);
      if (!imported.length) { alert("No valid resources found in CSV."); return; }
      const { data, error } = await supabase.from("resources").insert(imported).select();
      if (error) { console.error(error); alert("Could not import resources."); return; }
      setResources((current) => [...(data || []).map(mapResourceFromDbLocal), ...current]);
    });
  }

  function importCrewsCsv(event) {
    readCsvFile(event, async (rows) => {
      if (!supabase) { alert("Supabase is not connected."); return; }
      const imported = rows.map((row) => ({
        crew_name: row.crewname || row.crew || "",
        foreman_name: row.foremanname || row.foreman || "",
        total_members: Number(row.totalmembers || row.total || row.members || 0) || 0,
        specialty: splitList(row.specialty || row.certifications),
        deactivated: ["true", "yes", "1", "deactivated", "inactive"].includes(String(row.deactivated || row.status || "").toLowerCase()),
      })).filter((c) => c.crew_name);
      if (!imported.length) { alert("No valid crews found in CSV."); return; }
      const { data, error } = await supabase.from("crews").insert(imported).select();
      if (error) { console.error(error); alert("Could not import crews."); return; }
      setCrews((current) => [...(data || []).map(mapCrewFromDbLocal), ...current]);
    });
  }

  function importAssignmentsCsv(event) {
    readCsvFile(event, async (rows) => {
      if (!supabase) { alert("Supabase is not connected."); return; }
      const findProjectId = (row) => { const value = row.projectnumber || row.project || row.projectname || ""; const match = projects.find((p) => p.projectNumber === value || p.name === value); return match?.id || ""; };
      const findCrewId = (value) => { const text = String(value || "").trim(); const match = crews.find((c) => c.id === text || c.crewName === text || getCrewDisplayName(c) === text); return match?.id || null; };
      const imported = rows.map((row) => ({ projectId: findProjectId(row), projectManager: row.projectmanager || row.pm || "", superintendent: row.superintendent || "", fieldCoordinator: row.fieldcoordinator || "", fieldEngineer: row.fieldengineer || "", safety: row.safety || "", crew1Id: findCrewId(row.crew1 || row.crew1name), crew2Id: findCrewId(row.crew2 || row.crew2name), crew3Id: findCrewId(row.crew3 || row.crew3name), crew4Id: findCrewId(row.crew4 || row.crew4name), mobilizations: [{ id: crypto.randomUUID(), start: row.start || row.startdate || "", durationWeeks: row.durationweeks || "", end: row.end || row.enddate || "" }] })).filter((a) => a.projectId);
      if (!imported.length) { alert("No valid assignments found."); return; }
      const savedAssignments = [];
      for (const assignment of imported) {
        const { data, error } = await supabase.from("assignments").insert(assignmentToDb(assignment)).select().single();
        if (error) { console.error(error); continue; }
        const validMobs = (assignment.mobilizations || []).filter((m) => m.start && m.end).map((m) => mobilizationToDbLocal(m, data.id));
        let savedMobs = [];
        if (validMobs.length) { const mobRes = await supabase.from("mobilizations").insert(validMobs).select(); savedMobs = mobRes.data || []; }
        savedAssignments.push(mapAssignmentFromDbLocal(data, savedMobs));
      }
      if (savedAssignments.length) setAssignments((current) => [...savedAssignments, ...current]);
    });
  }

  // ── Login Screen ───────────────────────────────────────────────────────────
  if (!currentUser) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="w-full max-w-md">
          <form onSubmit={handleLogin} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="h-1 w-24 rounded-full bg-emerald-700" />
            <h1 className="mt-4 text-2xl font-bold text-slate-900">GGC Resource Planning</h1>
            <p className="mt-1 text-sm text-slate-500">Sign in to access the scheduling system.</p>
            <label className="mt-6 block space-y-1">
              <span className="text-sm font-semibold text-slate-700">Username</span>
              <input value={loginForm.username} onChange={(e) => setLoginForm((c) => ({ ...c, username: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" />
            </label>
            <label className="mt-4 block space-y-1">
              <span className="text-sm font-semibold text-slate-700">Password</span>
              <input type="password" value={loginForm.password} onChange={(e) => setLoginForm((c) => ({ ...c, password: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" />
            </label>
            <div className="mt-6 flex gap-2">
              <button type="submit" className="flex-1 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white hover:bg-emerald-800">Log In</button>
              <button
                type="button"
                onClick={() => setShowClaude(true)}
                title="Connect Claude (optional)"
                className="flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 font-semibold text-emerald-800 hover:bg-emerald-100"
              >
                <Sparkles size={16} /> Claude
              </button>
            </div>
            <p className="mt-3 text-center text-xs text-slate-400">
              Claude is optional. Requires your own paid Anthropic API key.
            </p>
          </form>
        </div>
        <ClaudeAssistant open={showClaude} onClose={() => setShowClaude(false)} appData={null} />
      </main>
    );
  }

  // ── Main App ───────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-4">
          <div className="flex min-w-0 items-center gap-4">
            <img src="/logo.png" alt="Greater Georgia Concrete logo" className="h-14 w-auto shrink-0 object-contain" onError={(e) => { e.currentTarget.style.display = "none"; }} />
            <div className="min-w-0">
              <div className="h-1 w-24 rounded-full bg-emerald-700" />
              <h1 className="mt-2 truncate text-2xl font-bold tracking-tight">GGC Resource Planning</h1>
              <p className="mt-1 truncate text-sm text-slate-500">Project master list, resource assignments, and mobilization scheduling.</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button
              onClick={() => setShowClaude(true)}
              title="Ask Claude"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            >
              <Sparkles size={18} />
            </button>
            <div className="flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
              <span className="max-w-[180px] truncate">{currentUser}</span>
              <button onClick={() => setShowUserSettings(true)} className="rounded-lg p-1 hover:bg-slate-200" title="User settings"><Settings size={16} /></button>
              <button onClick={logout} className="rounded-lg px-2 py-1 text-xs text-red-700 hover:bg-red-50">Logout</button>
            </div>
          </div>
        </div>
        <div className="border-t border-slate-100 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-3">
            <nav className="flex min-w-0 flex-1 flex-nowrap gap-2 overflow-x-auto">
              {["dashboard", "projects", "resources", "crews", "forecast"].map((p) => (
                <button key={p} onClick={() => setPage(p)} className={`shrink-0 rounded-xl px-4 py-2.5 font-semibold shadow-sm capitalize ${page === p ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>{p}</button>
              ))}
            </nav>
            <div className="flex shrink-0 items-center gap-2">
              {page === "dashboard" && <button onClick={openAddAssignmentForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 font-semibold text-white shadow-sm hover:bg-emerald-800"><ClipboardCheck size={18} /> Assign</button>}
              {page === "projects" && (
                <>
                  <CmicPullProjects projects={projects} onApplied={() => loadSupabaseData()} />
                  <button onClick={openAddProjectForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 font-semibold text-white shadow-sm hover:bg-emerald-800"><Plus size={18} /> Add Project</button>
                </>
              )}
              {page === "resources" && <button onClick={openAddResourceForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 font-semibold text-white shadow-sm hover:bg-emerald-800"><Plus size={18} /> Add Resource</button>}
              {page === "crews" && <button onClick={openAddCrewForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 font-semibold text-white shadow-sm hover:bg-emerald-800"><Plus size={18} /> Add Crew</button>}
            </div>
          </div>
        </div>
      </header>

      {/* ── Crews Page ── */}
      {page === "crews" && (
        <section className="mx-auto max-w-7xl space-y-6 px-6 py-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div><h2 className="text-2xl font-bold">Crews</h2><p className="text-sm text-slate-500">Master crew list used by assignment crew dropdowns.</p></div>
              <div className="flex flex-wrap gap-3 items-center">
                <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2">
                  <Search size={15} className="text-slate-400" />
                  <input className="outline-none text-sm w-44" placeholder="Search crews…" value={crewSearch} onChange={(e) => setCrewSearch(e.target.value)} />
                </div>
                <button onClick={exportCrewsExcel} className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">Export Excel</button>
                <label className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">Import CSV<input type="file" accept=".csv" onChange={importCrewsCsv} className="hidden" /></label>
                <button onClick={openAddCrewForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800"><Plus size={17} /> Add Crew</button>
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[850px] text-left text-sm">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th onClick={() => toggleSort(setCrewSort, "crewName")} className="cursor-pointer p-3 hover:bg-slate-200">Crew Name</th>
                    <th onClick={() => toggleSort(setCrewSort, "foremanName")} className="cursor-pointer p-3 hover:bg-slate-200">Foreman Name</th>
                    <th className="p-3 text-center">Total Members</th>
                    <th className="p-3 text-center">Status</th>
                    <th className="p-3">Specialty</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCrews.map((crew) => (
                    <tr key={crew.id} onClick={() => openEditCrewForm(crew)} className="cursor-pointer border-t border-slate-200 align-top hover:bg-emerald-50">
                      <td className="p-3 font-medium">{crew.crewName}</td>
                      <td className="p-3">{crew.foremanName}</td>
                      <td className="p-3 text-center font-semibold">{crew.totalMembers || <span className="text-slate-300">—</span>}</td>
                      <td className="p-3 text-center">
                        <span className={`rounded-full px-2 py-1 text-xs font-bold ${isCrewDeactivated(crew) ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                          {isCrewDeactivated(crew) ? "Deactivated" : "Active"}
                        </span>
                      </td>
                      <td className="p-3">{(crew.specialty || []).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      )}

      {/* ── Resources Page ── */}
      {page === "resources" && (
        <section className="mx-auto max-w-7xl space-y-6 px-6 py-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div><h2 className="text-2xl font-bold">Resources</h2><p className="text-sm text-slate-500">Master resource list used by Dashboard assignment dropdowns.</p></div>
              <div className="flex flex-wrap gap-3">
                <button onClick={exportResourcesExcel} className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">Export Excel</button>
                <label className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">Import CSV<input type="file" accept=".csv" onChange={importResourcesCsv} className="hidden" /></label>
                <button onClick={() => setShowCertSettings((c) => !c)} className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"><Settings size={17} /> Certification Settings</button>
                <button onClick={openAddResourceForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800"><Plus size={17} /> Add Resource</button>
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
                      {cert}<button onClick={() => deleteCertification(cert)} className="text-red-600">×</button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="mb-5 grid gap-4 md:grid-cols-2">
              <button type="button" onClick={() => setCertAlertModal("expiring")} className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-left shadow-sm hover:bg-amber-100">
                <p className="text-sm font-semibold text-amber-800">Certifications Expiring Within 30 Days</p>
                <p className="mt-1 text-3xl font-bold text-amber-900">{expiringCertificationRows.length}</p>
                <p className="mt-1 text-xs text-amber-700">Click to review upcoming expirations.</p>
              </button>
              <button type="button" onClick={() => setCertAlertModal("expired")} className="rounded-2xl border border-red-200 bg-red-50 p-5 text-left shadow-sm hover:bg-red-100">
                <p className="text-sm font-semibold text-red-800">Past Due Certifications</p>
                <p className="mt-1 text-3xl font-bold text-red-900">{expiredCertificationRows.length}</p>
                <p className="mt-1 text-xs text-red-700">Click to review expired certifications.</p>
              </button>
            </div>
            <div className="mb-4 flex flex-wrap gap-3 items-center">
              <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 flex-1 min-w-[200px] max-w-sm">
                <Search size={15} className="text-slate-400 shrink-0" />
                <input className="outline-none text-sm w-full" placeholder="Search resources…" value={resourceSearch} onChange={(e) => setResourceSearch(e.target.value)} />
              </div>
              <MultiSelectFilter label="Resource Type Filter" options={resourceTypes} selected={resourceTypeFilter} setSelected={setResourceTypeFilter} />
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[1150px] text-left text-sm">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th onClick={() => toggleSort(setResourceSort, "name")} className="cursor-pointer p-3 hover:bg-slate-200">Name</th>
                    <th onClick={() => toggleSort(setResourceSort, "resourceType")} className="cursor-pointer p-3 hover:bg-slate-200">Resource Type</th>
                    <th onClick={() => toggleSort(setResourceSort, "homeDivision")} className="cursor-pointer p-3 hover:bg-slate-200">Home Division</th>
                    <th className="p-3">Phone</th><th className="p-3">Email</th>
                    <th className="p-3">Certifications</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedResources.map((resource) => (
                    <tr key={resource.id} onClick={() => openEditResourceForm(resource)} className="cursor-pointer border-t border-slate-200 align-top hover:bg-emerald-50">
                      <td className="p-3 font-medium">{resource.name}</td>
                      <td className="p-3">{resource.resourceType}</td>
                      <td className="p-3">{resource.homeDivision}</td>
                      <td className="p-3">{resource.phone}</td>
                      <td className="p-3">{resource.email}</td>
                      <td className="p-3">{normalizeResourceCertifications(resource.certifications).map(formatCertificationRecord).join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      )}

      {/* ── Projects Page ── */}
      {page === "projects" && (
        <section className="mx-auto max-w-7xl space-y-6 px-6 py-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div><h2 className="text-2xl font-bold">Projects</h2><p className="text-sm text-slate-500">Create and edit projects here only. Resource assignments happen on the Dashboard.</p></div>
              <div className="flex flex-wrap gap-3">
                <button onClick={exportProjectsExcel} className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">Export Excel</button>
                <label className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">Import CSV<input type="file" accept=".csv" onChange={importProjectsCsv} className="hidden" /></label>
                <button onClick={() => setShowProjectTypeSettings((c) => !c)} className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"><Settings size={17} /> Project Type Settings</button>
                <button onClick={openAddProjectForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800"><Plus size={17} /> Add Project</button>
              </div>
            </div>
            {showProjectTypeSettings && (
              <div className="mb-5 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                <h3 className="font-bold text-slate-900">Project Type Settings</h3>
                <div className="mt-3 flex gap-2">
                  <input value={newProjectType} onChange={(e) => setNewProjectType(e.target.value)} placeholder="Add project type" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none focus:border-emerald-600" />
                  <button onClick={addProjectType} className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white">Add</button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {projectTypes.map((type) => (
                    <span key={type} className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">
                      {type}<button onClick={() => deleteProjectType(type)} className="text-red-600">×</button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="mb-4 flex flex-wrap gap-3 items-center">
              <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 flex-1 min-w-[200px] max-w-sm">
                <Search size={15} className="text-slate-400 shrink-0" />
                <input className="outline-none text-sm w-full" placeholder="Search projects…" value={projectSearch} onChange={(e) => setProjectSearch(e.target.value)} />
              </div>
              <MultiSelectFilter label="Division Filter" options={divisions} selected={projectTabDivisionFilter} setSelected={setProjectTabDivisionFilter} />
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[1150px] text-left text-sm">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th onClick={() => toggleSort(setProjectSort, "projectNumber")} className="cursor-pointer p-3 hover:bg-slate-200">Project #</th>
                    <th onClick={() => toggleSort(setProjectSort, "name")} className="cursor-pointer p-3 hover:bg-slate-200">Project Name</th>
                    <th onClick={() => toggleSort(setProjectSort, "client")} className="cursor-pointer p-3 hover:bg-slate-200">Client</th>
                    <th className="p-3">Address</th>
                    <th onClick={() => toggleSort(setProjectSort, "division")} className="cursor-pointer p-3 hover:bg-slate-200">Division</th>
                    <th onClick={() => toggleSort(setProjectSort, "projectType")} className="cursor-pointer p-3 hover:bg-slate-200">Project Type</th>
                    <th className="p-3">Requirements</th>
                    <th onClick={() => toggleSort(setProjectSort, "status")} className="cursor-pointer p-3 hover:bg-slate-200">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedProjectsForTab.map((project) => (
                    <tr key={project.id} onClick={() => openEditProjectForm(project)} className="cursor-pointer border-t border-slate-200 align-top hover:bg-emerald-50">
                      <td className="p-3 font-medium">{project.projectNumber}</td>
                      <td className="p-3 font-medium">
                        <span className="inline-flex items-center gap-2">
                          {project.name}
                          {project.source === "cmic" && (
                            <span
                              title="Imported from CMiC"
                              className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700"
                            >
                              CMiC
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="p-3">{project.client}</td>
                      <td className="p-3">{project.address}</td>
                      <td className="p-3">{project.division}</td>
                      <td className="p-3">{projectTypeLabel(project.projectType) || <span className="text-slate-300">—</span>}</td>
                      <td className="p-3">{(project.specificRequirements || []).join(", ")}</td>
                      <td className="p-3">{project.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      )}

      {/* ── Dashboard Page ── */}
      {page === "dashboard" && (
        <section className="mx-auto max-w-7xl space-y-6 px-6 py-6">
          <div className="grid gap-4 md:grid-cols-4">
            <StatCard icon={BriefcaseBusiness} label="Total Projects" value={projects.length} />
            <StatCard icon={ClipboardCheck} label="Assignments" value={assignments.length} />
            <StatCard icon={Users} label="Resources" value={resources.length} />
            <StatCard icon={FolderKanban} label="Crews" value={crews.length} />
          </div>

          {/* Project Assignment Gantt */}
          <section id="project-assignment-gantt" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setExpandedView("project")} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50" title="Open enlarged view">↗</button>
                  <h2 className="text-xl font-bold">Project Assignment Gantt View</h2>
                </div>
                <p className="text-sm text-slate-500">Each project assignment is one row. Multiple mobilizations appear on that same project row.</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2">
                  <Search size={15} className="text-slate-400" />
                  <input className="outline-none text-sm w-40" placeholder="Search projects…" value={dashboardProjectSearch} onChange={(e) => setDashboardProjectSearch(e.target.value)} />
                </div>
                <button onClick={exportDashboardExcel} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Export Excel</button>
                <button onClick={() => exportSectionPdf("project-assignment-gantt", "Project Assignment Gantt View")} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Export PDF</button>
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <ZoomIn size={16} className="text-slate-500" />
                  <span className="text-sm font-medium text-slate-700">Zoom</span>
                  <select value={zoom} onChange={(e) => setZoom(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-emerald-600">
                    {zoomModes.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="mb-4 grid gap-3 lg:grid-cols-3">
              <MultiSelectFilter label="Project Division Filter" options={divisions} selected={divisionFilter} setSelected={setDivisionFilter} />
              <MultiSelectFilter label="Status Filter" options={statuses} selected={statusFilter} setSelected={setStatusFilter} />
              <label className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Sort Project Gantt By</span>
                <select
                  value={projectGanttSort}
                  onChange={(e) => setProjectGanttSort(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-emerald-600"
                >
                  <option value="projectNumber">Project Number</option>
                  <option value="startDate">Start Date</option>
                  <option value="endDate">Project End</option>
                  <option value="unassigned">Unassigned Needs First</option>
                </select>
                <p className="mt-1 text-xs text-slate-500">Pending Awards always stay at the bottom.</p>
              </label>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200 p-4">
              <GanttHeader timeline={timeline} zoom={zoom} />
              <div className="mt-3 space-y-3" style={{ minWidth: `${timeline.width + 280}px` }}>
                {projectGanttRows.map((row) => (
                  <button key={row.project.id} onClick={() => openEditAssignmentForm(row.assignment)} className="block w-full text-left">
                    <ProjectGanttRow assignment={row.assignment} project={row.project} items={row.items} timeline={timeline} crews={crews} />
                  </button>
                ))}
              </div>
            </div>
          </section>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <MultiSelectFilter label="Resource Type Filter" options={resourceTypes} selected={dashboardResourceTypeFilter} setSelected={setDashboardResourceTypeFilter} />
          </div>

          {/* Resource Gantt */}
          <section id="resource-gantt" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setExpandedView("resource")} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50" title="Open enlarged view">↗</button>
                  <h2 className="text-xl font-bold">Resource Gantt View</h2>
                </div>
                <p className="text-sm text-slate-500">Rows are resources. Bars show the assigned project name for each mobilization.</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2">
                  <Search size={15} className="text-slate-400" />
                  <input className="outline-none text-sm w-40" placeholder="Search resources…" value={dashboardResourceSearch} onChange={(e) => setDashboardResourceSearch(e.target.value)} />
                </div>
                <label className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                  <input type="checkbox" className="h-4 w-4 accent-amber-600" checked={showUnassignedNeedRows} onChange={(e) => setShowUnassignedNeedRows(e.target.checked)} />
                  Show unassigned needs
                </label>
                <button onClick={() => exportSectionPdf("resource-gantt", "Resource Gantt View")} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Export PDF</button>
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200 p-4">
              <GanttHeader timeline={timeline} zoom={zoom} />
              <div className="mt-3 space-y-3" style={{ minWidth: `${timeline.width + 280}px` }}>
                {resourceGanttRowsWithUnassigned.map((row) => (
                  row.isUnassignedNeedRow
                    ? <UnassignedNeedGanttRow key={row.resource.id} resource={row.resource} items={row.items} timeline={timeline} />
                    : <ResourceGanttRow key={row.resource.id} resource={row.resource} items={row.items} timeline={timeline} onResourceClick={setFocusedResource} />
                ))}
              </div>
            </div>
          </section>

          {/* Demand Chart */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap gap-4 items-start">
              <div className="flex-1 min-w-[200px]">
                <MultiSelectFilter label="Resource Demand Home Division Filter" options={divisions} selected={demandHomeDivisionFilter} setSelected={setDemandHomeDivisionFilter} />
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="mb-2 text-sm font-semibold text-slate-700">Demand Chart Zoom</p>
                <div className="flex flex-wrap gap-2">
                  {zoomModes.map((mode) => (
                    <button key={mode} onClick={() => setDemandZoom(mode)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${demandZoom === mode ? "bg-emerald-700 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"}`}>
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <ResourceDemandChart
            items={demandFilteredItems}
            timeline={demandTimeline}
            zoom={demandZoom}
            totalResources={resources.filter((r) => dashboardResourceTypeFilter.includes(r.resourceType) && demandHomeDivisionFilter.includes(r.homeDivision)).length}
            onExportPdf={() => exportSectionPdf("resource-demand-graph", "Resource Demand Graph")}
            onBarClick={setDemandDrilldown}
            onPeriodClick={setDemandPeriodDrilldown}
          />

          {/* Crew Gantt */}
          <section id="crew-gantt" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setExpandedView("crew")} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50" title="Open enlarged view">↗</button>
                  <h2 className="text-xl font-bold">Crew Gantt View</h2>
                </div>
                <p className="text-sm text-slate-500">Rows are crews. Overlapping projects stack below each other within the same crew row.</p>
              </div>
              <button onClick={() => exportSectionPdf("crew-gantt", "Crew Gantt View")} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Export PDF</button>
            </div>
            <div className="mb-4 flex flex-wrap gap-3 items-start">
              <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2">
                <Search size={15} className="text-slate-400" />
                <input className="outline-none text-sm w-40" placeholder="Search crews…" value={dashboardCrewSearch} onChange={(e) => setDashboardCrewSearch(e.target.value)} />
              </div>

            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200 p-4">
              <GanttHeader timeline={timeline} zoom={zoom} />
              <div className="mt-3 space-y-3" style={{ minWidth: `${timeline.width + 280}px` }}>
                {crewGanttRows.map((row) => <CrewGanttRow key={row.crew.id} crew={row.crew} items={row.items} timeline={timeline} />)}
              </div>
            </div>
          </section>

          {/* Crew Utilization Chart */}
          {(() => {
            const utilStart = toDate(utilizationStart);
            const utilEnd = toDate(utilizationEnd);
            const utilizationDateRangeValid = Boolean(utilStart && utilEnd && utilStart <= utilEnd);

            const allUtilizationRows = activeCrews.map((crew) => {
              const activeMobs = ganttItems.filter((item) => {
                if (!utilizationDateRangeValid) return false;
                if (!getAssignmentCrewIds(item.assignment).includes(crew.id)) return false;
                const s = toDate(item.start);
                const e = toDate(item.end);
                if (!s || !e) return false;
                return rangesOverlap(s, addDays(e, 1), utilStart, addDays(utilEnd, 1));
              });

              const menMobilized = activeMobs.reduce((sum, item) => {
                const count = (item.assignment._crewMenCounts || item.assignment.crewMenCounts || {})[crew.id];
                return sum + (count !== undefined ? count : (crew.totalMembers || 0));
              }, 0);

              const totalMen = crew.totalMembers || 0;
              const delta = totalMen - menMobilized;
              const projects = [...new Set(activeMobs.map((item) => item.project.name))];

              return { crew, totalMen, menMobilized, delta, projects };
            }).filter((r) => r.crew.totalMembers > 0 || r.menMobilized > 0);

            // Apply search filter, then sort
            const searchedUtilizationRows = utilizationSearch
              ? allUtilizationRows.filter((r) => {
                  const q = utilizationSearch.toLowerCase();
                  return (
                    r.crew.crewName.toLowerCase().includes(q) ||
                    (r.crew.foremanName || "").toLowerCase().includes(q) ||
                    r.projects.some((p) => p.toLowerCase().includes(q))
                  );
                })
              : allUtilizationRows;

            const utilizationRows = [...searchedUtilizationRows].sort((a, b) => {
              const dir = utilizationSort.direction === "asc" ? 1 : -1;
              if (utilizationSort.key === "crew") return compareValues(getCrewDisplayName(a.crew), getCrewDisplayName(b.crew), utilizationSort.direction);
              if (utilizationSort.key === "totalMen") return (a.totalMen - b.totalMen) * dir;
              if (utilizationSort.key === "menMobilized") return (a.menMobilized - b.menMobilized) * dir;
              if (utilizationSort.key === "delta") return (a.delta - b.delta) * dir;
              if (utilizationSort.key === "utilization") {
                const aPct = a.totalMen > 0 ? a.menMobilized / a.totalMen : 0;
                const bPct = b.totalMen > 0 ? b.menMobilized / b.totalMen : 0;
                return (aPct - bPct) * dir;
              }
              if (utilizationSort.key === "projects") return compareValues(a.projects.join(", "), b.projects.join(", "), utilizationSort.direction);
              return 0;
            });

            function UtilizationSortTh({ label, sortKey, className = "" }) {
              const active = utilizationSort.key === sortKey;
              return (
                <th
                  onClick={() => setUtilizationSort((current) => ({ key: sortKey, direction: current.key === sortKey && current.direction === "asc" ? "desc" : "asc" }))}
                  className={`cursor-pointer select-none p-3 hover:bg-slate-200 ${className}`}
                >
                  {label} {active ? (utilizationSort.direction === "asc" ? "↑" : "↓") : ""}
                </th>
              );
            }

            const grandTotalMen = utilizationRows.reduce((s, r) => s + r.totalMen, 0);
            const grandMobilized = utilizationRows.reduce((s, r) => s + r.menMobilized, 0);
            const grandDelta = grandTotalMen - grandMobilized;

            function exportUtilizationPdf() {
              const section = document.getElementById("crew-utilization");
              if (!section) return;
              const cloned = section.cloneNode(true);
              // Remove interactive controls (inputs, buttons, search bar)
              cloned.querySelectorAll("input, button, .no-print").forEach((el) => el.remove());
              // Convert progress bar divs to width-styled spans for print
              const css = `
                @page { size: portrait; margin: 0.4in; }
                body { font-family: Arial, sans-serif; font-size: 11px; color: #0f172a; }
                h2 { font-size: 14px; margin: 0 0 4px 0; }
                p { margin: 0 0 8px 0; color: #64748b; font-size: 10px; }
                table { border-collapse: collapse; width: 100%; }
                th { background: #f1f5f9; padding: 6px 8px; text-align: left; border-bottom: 2px solid #cbd5e1; font-size: 10px; }
                td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 10px; }
                .bar-wrap { background: #e2e8f0; border-radius: 4px; height: 8px; width: 120px; display: inline-block; vertical-align: middle; }
                .bar-fill { height: 8px; border-radius: 4px; display: inline-block; }
                .badge-over { background: #fee2e2; color: #b91c1c; padding: 2px 6px; border-radius: 9999px; font-weight: 700; }
                .badge-bench { background: #fef3c7; color: #92400e; padding: 2px 6px; border-radius: 9999px; font-weight: 700; }
                .badge-ok { background: #d1fae5; color: #065f46; padding: 2px 6px; border-radius: 9999px; font-weight: 700; }
                .totals { background: #f1f5f9; font-weight: 700; }
              `;
              const title = `Crew Utilization — ${utilizationStart} to ${utilizationEnd}`;
              const w = window.open("", "_blank", "width=900,height=1100");
              if (!w) { alert("Please allow pop-ups to export PDF."); return; }
              w.document.open();
              w.document.write(`<!doctype html><html><head><title>${title}</title><style>${css}</style></head><body><h2>${title}</h2>${cloned.outerHTML}<script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script></body></html>`);
              w.document.close();
            }

            return (
              <section id="crew-utilization" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <div>
                    <h2 className="text-xl font-bold">Crew Utilization</h2>
                    <p className="text-sm text-slate-500">Men deployed vs. available capacity across the selected date range.</p>
                  </div>
                  <div className="ml-auto flex flex-wrap items-center gap-3">
                    {/* Search */}
                    <div className="no-print flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2">
                      <Search size={15} className="text-slate-400" />
                      <input className="outline-none text-sm w-40" placeholder="Search crew or project…"
                        value={utilizationSearch} onChange={(e) => setUtilizationSearch(e.target.value)} />
                    </div>
                    {/* Week controls */}
                    <div className="no-print flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-2 py-2">
                      <button type="button" onClick={() => shiftUtilizationWeek(-1)} className="rounded-lg px-2 py-1 text-sm font-bold text-slate-700 hover:bg-slate-100" title="Previous week">←</button>
                      <button type="button" onClick={() => setUtilizationWeekFromDate(new Date())} className="rounded-lg bg-emerald-700 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-800">Week</button>
                      <button type="button" onClick={() => shiftUtilizationWeek(1)} className="rounded-lg px-2 py-1 text-sm font-bold text-slate-700 hover:bg-slate-100" title="Next week">→</button>
                    </div>
                    {/* Date range */}
                    <label className="no-print flex items-center gap-2 text-sm font-medium text-slate-700">
                      From
                      <input type="date" className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600 text-sm"
                        value={utilizationStart} onChange={(e) => setUtilizationStart(e.target.value)} />
                    </label>
                    <label className="no-print flex items-center gap-2 text-sm font-medium text-slate-700">
                      To
                      <input type="date" className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600 text-sm"
                        value={utilizationEnd} onChange={(e) => setUtilizationEnd(e.target.value)} />
                    </label>
                    {/* PDF export */}
                    <button onClick={exportUtilizationPdf} className="no-print rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                      Export PDF
                    </button>
                  </div>
                </div>

                {/* Date range label shown in PDF */}
                <p className="mb-3 text-xs text-slate-400">{utilizationStart} → {utilizationEnd}{utilizationSearch ? ` · Filtered: "${utilizationSearch}"` : ""}</p>
                {!utilizationDateRangeValid && (
                  <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                    Crew Utilization is visible, but the selected date range is invalid. Choose a valid From and To date to calculate utilization.
                  </div>
                )}

                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-100 text-slate-600 border-b border-slate-200">
                      <tr>
                        <UtilizationSortTh label="Crew" sortKey="crew" />
                        <UtilizationSortTh label="Total Members" sortKey="totalMen" className="text-center" />
                        <UtilizationSortTh label="Men Mobilized" sortKey="menMobilized" className="text-center" />
                        <UtilizationSortTh label="Delta" sortKey="delta" className="text-center" />
                        <UtilizationSortTh label="Utilization" sortKey="utilization" />
                        <UtilizationSortTh label="Active Projects" sortKey="projects" />
                      </tr>
                    </thead>
                    <tbody>
                      {utilizationRows.map((row, idx) => {
                        const utilPct = row.totalMen > 0 ? Math.min(100, Math.round((row.menMobilized / row.totalMen) * 100)) : 0;
                        const isOver = row.delta < 0;
                        const isBench = row.delta > 0;
                        const rowBg = idx % 2 === 0 ? "bg-white" : "bg-slate-50";
                        return (
                          <tr key={row.crew.id} className={`border-t border-slate-100 ${rowBg}`}>
                            <td className="p-3">
                              <button type="button" onClick={() => setSelectedUtilizationCrew(row.crew)} className="font-semibold text-slate-900 hover:text-emerald-700 hover:underline">{getCrewDisplayName(row.crew)}</button>
                              <p className="text-xs text-slate-400">{(row.crew.specialty || []).join(", ")}</p>
                            </td>
                            <td className="p-3 text-center font-semibold text-slate-700">{row.totalMen || <span className="text-slate-300">—</span>}</td>
                            <td className="p-3 text-center font-semibold text-slate-900">{row.menMobilized}</td>
                            <td className="p-3 text-center">
                              <span className={`rounded-full px-3 py-1 text-xs font-bold ${isOver ? "bg-red-100 text-red-700 badge-over" : isBench ? "bg-amber-100 text-amber-700 badge-bench" : "bg-emerald-100 text-emerald-700 badge-ok"}`}>
                                {isOver ? `+${Math.abs(row.delta)} over` : isBench ? `${row.delta} on bench` : "Fully utilized"}
                              </span>
                            </td>
                            <td className="p-3 min-w-[160px]">
                              {row.totalMen > 0 ? (
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-3 rounded-full bg-slate-200 overflow-hidden bar-wrap">
                                    <div className={`h-full rounded-full bar-fill ${isOver ? "bg-red-500" : utilPct >= 80 ? "bg-emerald-500" : "bg-amber-400"}`}
                                      style={{ width: `${Math.min(100, utilPct)}%`, background: isOver ? "#ef4444" : utilPct >= 80 ? "#10b981" : "#f59e0b" }} />
                                  </div>
                                  <span className="text-xs font-semibold text-slate-600 w-9 text-right">{utilPct}%</span>
                                </div>
                              ) : <span className="text-xs text-slate-300">No capacity set</span>}
                            </td>
                            <td className="p-3 text-xs text-slate-500">{row.projects.join(", ") || "—"}</td>
                          </tr>
                        );
                      })}
                      {utilizationRows.length === 0 && (
                        <tr><td colSpan={6} className="p-6 text-center text-slate-400">
                          {utilizationSearch ? `No results matching "${utilizationSearch}".` : "No crews with capacity set. Add total members in the Crews tab."}
                        </td></tr>
                      )}
                      {/* Totals row */}
                      <tr className="border-t-2 border-slate-300 bg-slate-100 font-semibold totals">
                        <td className="p-3">Total ({utilizationRows.length} crew{utilizationRows.length === 1 ? "" : "s"})</td>
                        <td className="p-3 text-center">{grandTotalMen}</td>
                        <td className="p-3 text-center">{grandMobilized}</td>
                        <td className="p-3 text-center">
                          <span className={`rounded-full px-3 py-1 text-xs font-bold ${grandDelta < 0 ? "bg-red-100 text-red-700" : grandDelta > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                            {grandDelta < 0 ? `+${Math.abs(grandDelta)} over` : grandDelta > 0 ? `${grandDelta} on bench` : "Fully utilized"}
                          </span>
                        </td>
                        <td className="p-3" colSpan={2}>
                          {grandTotalMen > 0 && (
                            <div className="flex items-center gap-2 max-w-xs">
                              <div className="flex-1 h-3 rounded-full bg-slate-200 overflow-hidden">
                                <div className={`h-full rounded-full ${grandDelta < 0 ? "bg-red-500" : "bg-emerald-500"}`}
                                  style={{ width: `${Math.min(100, Math.round((grandMobilized / grandTotalMen) * 100))}%` }} />
                              </div>
                              <span className="text-xs font-semibold text-slate-600 w-9">{Math.round((grandMobilized / grandTotalMen) * 100)}%</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })()}

          {/* Project Manager Utilization */}
          <section id="project-manager-utilization" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-bold">Project Manager Utilization</h2>
                <p className="text-sm text-slate-500">Current workload by project manager. Active includes Scheduled, Active, and On-Hold projects.</p>
              </div>
              <div className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">Click a PM row to view project duration Gantt</div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th className="p-3">Project Manager</th>
                    <th className="p-3 text-center">Current Active Projects</th>
                    <th className="p-3 text-center">Pending Awards</th>
                    <th className="p-3 text-center">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {projectManagerUtilizationRows.map((row) => (
                    <tr key={row.projectManager} onClick={() => setSelectedProjectManagerUtilization(row.projectManager)} className="cursor-pointer border-t border-slate-200 hover:bg-emerald-50">
                      <td className="p-3 font-semibold text-slate-900 hover:text-emerald-700">{row.projectManager}</td>
                      <td className="p-3 text-center font-semibold text-slate-700">{row.activeCount}</td>
                      <td className="p-3 text-center font-semibold text-amber-700">{row.pendingCount}</td>
                      <td className="p-3 text-center font-bold text-slate-900">{row.totalCount}</td>
                    </tr>
                  ))}
                  {projectManagerUtilizationRows.length === 0 && (
                    <tr><td colSpan={4} className="p-6 text-center text-slate-400">No project manager assignments found for active or pending projects.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div><h2 className="text-xl font-bold">Assignments</h2><p className="text-sm text-slate-500">Assign existing projects to resources and crews.</p></div>
              <div className="flex flex-wrap gap-3">
                <button onClick={() => setShowAssignments((c) => !c)} className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">{showAssignments ? "Collapse" : "Expand"}</button>
                <label className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">Import CSV<input type="file" accept=".csv" onChange={importAssignmentsCsv} className="hidden" /></label>
                <button onClick={openAddAssignmentForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800"><ClipboardCheck size={17} /> Assign</button>
              </div>
            </div>
            {showAssignments && (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[1250px] text-left text-sm">
                  <thead className="bg-slate-100 text-slate-600">
                    <tr><th className="p-3">Project</th><th className="p-3">PM</th><th className="p-3">Superintendent</th><th className="p-3">Field Coordinator</th><th className="p-3">Field Engineer</th><th className="p-3">Safety</th><th className="p-3">Crews</th><th className="p-3">Mobilizations</th><th className="p-3 text-right">Actions</th></tr>
                  </thead>
                  <tbody>
                    {visibleAssignments.map((assignment) => {
                      const project = findProject(projects, assignment.projectId);
                      return (
                        <tr key={assignment.id} className="border-t border-slate-200 align-top">
                          <td className="p-3 font-medium">{project ? `${project.projectNumber} - ${project.name}` : "Missing project"}</td>
                          <td className="p-3">{assignment.projectManager}</td>
                          <td className="p-3">{assignment.superintendent}</td>
                          <td className="p-3">{assignment.fieldCoordinator}</td>
                          <td className="p-3">{assignment.fieldEngineer}</td>
                          <td className="p-3">{assignment.safety}</td>
                          <td className="p-3">{getAssignmentCrewDisplayNames(assignment, crews).join(", ")}</td>
                          <td className="p-3">{(assignment.mobilizations || []).map((m, i) => `#${i + 1}: ${formatDate(m.start)} - ${formatDate(m.end)}`).join("; ")}</td>
                          <td className="p-3 text-right">
                            <button onClick={() => openEditAssignmentForm(assignment)} className="mr-2 rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50">Edit</button>
                            <button onClick={() => deleteAssignment(assignment.id)} className="rounded-lg border border-red-200 px-3 py-1.5 font-medium text-red-700 hover:bg-red-50">Delete</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </section>
      )}

      {/* ── Modals ── */}

      {/* Focused Resource */}
      {focusedResource && (
        <div className="fixed inset-0 z-[90] bg-slate-950/70 p-4">
          <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white p-5">
              <div>
                <h2 className="text-2xl font-bold">{focusedResource.name} Conflict / PTO Breakout</h2>
                <p className="text-sm text-slate-500">Each assignment is shown on a separate line. PTO is shown on its own row.</p>
              </div>
              <button onClick={() => setFocusedResource(null)} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold hover:bg-slate-50">Close</button>
            </div>
            <div className="flex-1 overflow-auto p-5">
              <GanttHeader timeline={timeline} zoom={zoom} />
              <div className="mt-3 space-y-3" style={{ minWidth: `${timeline.width + 280}px` }}>
                {focusedResourceItems.map((item) => (
                  <div key={`focused-${item.id}`} className="grid grid-cols-[260px_1fr] items-center gap-5">
                    <div className="text-left">
                      <p className="font-semibold text-slate-900">{item.project.projectNumber ? `${item.project.projectNumber} - ` : ""}{item.project.name}</p>
                      <p className="mt-1 text-xs text-slate-500">{item.project.division} • {formatDate(item.start)} - {formatDate(item.end)}</p>
                    </div>
                    <div className="relative h-11 rounded-xl bg-slate-100" style={{ width: `${timeline.width}px` }}>
                      <GanttSegmentBar item={item} timeline={timeline} label={item.project.name} />
                    </div>
                  </div>
                ))}
                {/* PTO rows */}
                {(focusedResource.pto || []).filter((p) => p.start && p.end).map((pto) => (
                  <div key={`focused-pto-${pto.id || pto.ptoId}`} className="grid grid-cols-[260px_1fr] items-center gap-5">
                    <div className="text-left">
                      <p className="font-semibold text-slate-900">PTO — {pto.ptoId || "Unspecified"}</p>
                      <p className="mt-1 text-xs text-slate-500">{formatDate(pto.start)} – {formatDate(pto.end)}</p>
                    </div>
                    <div className="relative h-11 rounded-xl bg-slate-100" style={{ width: `${timeline.width}px` }}>
                      <PtoOverlayBar pto={pto} timeline={timeline} />
                    </div>
                  </div>
                ))}
                {focusedResourceItems.length === 0 && (focusedResource.pto || []).filter((p) => p.start && p.end).length === 0 && (
                  <p className="text-sm text-slate-400">No assignments or PTO in the current timeline window.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Crew Utilization Drilldown */}
      {selectedUtilizationCrew && (() => {
        const utilStart = toDate(utilizationStart);
        const utilEnd = toDate(utilizationEnd);
        const validRange = Boolean(utilStart && utilEnd && utilStart <= utilEnd);
        const items = validRange ? ganttItems.filter((item) => {
          if (!getAssignmentCrewIds(item.assignment).includes(selectedUtilizationCrew.id)) return false;
          const s = toDate(item.start);
          const e = toDate(item.end);
          if (!s || !e) return false;
          return rangesOverlap(s, addDays(e, 1), utilStart, addDays(utilEnd, 1));
        }) : [];
        const getCrewMenForItem = (item) => {
          const crewMenCount = (item.assignment._crewMenCounts || item.assignment.crewMenCounts || {})[selectedUtilizationCrew.id];
          return crewMenCount !== undefined && crewMenCount !== null && crewMenCount !== ""
            ? Number(crewMenCount) || 0
            : (selectedUtilizationCrew.totalMembers || 0);
        };
        const totalAssignedMen = items.reduce((sum, item) => sum + getCrewMenForItem(item), 0);
        const crewCapacity = selectedUtilizationCrew.totalMembers || 0;
        const utilizationDelta = crewCapacity - totalAssignedMen;
        const utilizationPct = crewCapacity > 0 ? Math.round((totalAssignedMen / crewCapacity) * 100) : 0;
        const popupTimeline = {
          minDate: utilStart || new Date(),
          maxDate: utilEnd || new Date(),
          currentDate: new Date(),
          totalDays: validRange ? Math.max(1, Math.ceil((addDays(utilEnd, 1) - utilStart) / (1000 * 60 * 60 * 24))) : 1,
          ticks: validRange ? [utilStart, utilEnd] : [new Date()],
          width: 1160,
        };
        return (
          <div className="fixed inset-0 z-[88] bg-slate-950/70 p-4">
            <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white p-5">
                <div>
                  <h2 className="text-2xl font-bold">{getCrewDisplayName(selectedUtilizationCrew)} — Utilization Assignments</h2>
                  <p className="text-sm text-slate-500">{utilizationStart} to {utilizationEnd} · {items.length} active assignment{items.length === 1 ? "" : "s"}</p>
                  {validRange && (
                    <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">Crew Capacity: {crewCapacity}</span>
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">Assigned Men: {totalAssignedMen}</span>
                      <span className={`rounded-full px-3 py-1 ${utilizationDelta < 0 ? "bg-red-100 text-red-700" : utilizationDelta > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-800"}`}>
                        {utilizationDelta < 0 ? `+${Math.abs(utilizationDelta)} over` : utilizationDelta > 0 ? `${utilizationDelta} on bench` : "Fully utilized"}
                      </span>
                      <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-800">Utilization: {utilizationPct}%</span>
                    </div>
                  )}
                </div>
                <button onClick={() => setSelectedUtilizationCrew(null)} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold hover:bg-slate-50">Close</button>
              </div>
              <div className="flex-1 overflow-auto p-5">
                {!validRange && <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-800">Choose a valid Crew Utilization date range first.</div>}
                {validRange && (
                  <>
                    <GanttHeader timeline={popupTimeline} zoom="Weeks" />
                    <div className="mt-3 space-y-3" style={{ minWidth: `${popupTimeline.width + 280}px` }}>
                      {items.length === 0 && <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">No assignments found for this crew during the selected period.</div>}
                      {items.map((item) => {
                        const rowMen = getCrewMenForItem(item);
                        return (
                          <div key={`util-drilldown-${item.id}`} className="grid grid-cols-[320px_1fr] items-center gap-5">
                            <div className="text-left">
                              <div className="flex items-start justify-between gap-3">
                                <p className="font-semibold text-slate-900">{item.project.projectNumber ? `${item.project.projectNumber} - ` : ""}{item.project.name}</p>
                                <span className="shrink-0 rounded-full bg-slate-900 px-2.5 py-1 text-xs font-bold text-white">{rowMen} men</span>
                              </div>
                              <p className="mt-1 text-xs text-slate-500">{item.project.division} • {item.project.status} • {formatDate(item.start)} – {formatDate(item.end)}</p>
                              <p className="mt-0.5 text-xs text-slate-400">Counts toward selected period total.</p>
                            </div>
                            <div className="relative h-11 rounded-xl bg-slate-100" style={{ width: `${popupTimeline.width}px` }}>
                              <GanttSegmentBar item={item} timeline={popupTimeline} label={`${item.project.name} · ${rowMen} men`} />
                            </div>
                          </div>
                        );
                      })}
                      {items.length > 0 && (
                        <div className="grid grid-cols-[320px_1fr] items-center gap-5 border-t border-slate-200 pt-3">
                          <div className="text-left">
                            <p className="font-bold text-slate-900">Selected Period Total</p>
                            <p className="text-xs text-slate-500">{utilizationStart} – {utilizationEnd}</p>
                          </div>
                          <div className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-800">
                            {totalAssignedMen} assigned men / {crewCapacity} crew capacity · {utilizationDelta < 0 ? `+${Math.abs(utilizationDelta)} over` : utilizationDelta > 0 ? `${utilizationDelta} on bench` : "fully utilized"}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Project Manager Utilization Drilldown */}
      {selectedProjectManagerUtilization && (() => {
        const pmAssignments = assignments.filter((assignment) => assignment.projectManager === selectedProjectManagerUtilization);
        const pmProjectIds = new Set(pmAssignments.map((assignment) => assignment.projectId));
        const pmItems = ganttItems.filter((item) =>
          pmProjectIds.has(item.project.id) &&
          (isProjectManagerActiveStatus(item.project.status) || isProjectManagerPendingStatus(item.project.status))
        );
        const pmTimeline = buildTimeline(pmItems, projectManagerUtilizationZoom);
        const pmRows = Object.values(pmItems.reduce((groups, item) => {
          const id = item.project.id;
          if (!groups[id]) groups[id] = { project: item.project, items: [] };
          groups[id].items.push(item);
          return groups;
        }, {})).sort((a, b) => {
          const aPending = isProjectManagerPendingStatus(a.project.status) ? 1 : 0;
          const bPending = isProjectManagerPendingStatus(b.project.status) ? 1 : 0;
          if (aPending !== bPending) return aPending - bPending;
          const aStart = getProjectStartFromItems(a.items);
          const bStart = getProjectStartFromItems(b.items);
          if (aStart && bStart && aStart.getTime() !== bStart.getTime()) return aStart - bStart;
          return compareValues(a.project.projectNumber || a.project.name, b.project.projectNumber || b.project.name, "asc");
        });
        const activeCount = pmRows.filter((row) => isProjectManagerActiveStatus(row.project.status)).length;
        const pendingCount = pmRows.filter((row) => isProjectManagerPendingStatus(row.project.status)).length;
        return (
          <div className="fixed inset-0 z-[89] bg-slate-950/70 p-4">
            <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="sticky top-0 z-30 flex flex-col gap-4 border-b border-slate-200 bg-white p-5 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-2xl font-bold">{selectedProjectManagerUtilization} — Project Manager Utilization</h2>
                  <p className="text-sm text-slate-500">{activeCount} current active · {pendingCount} pending award · {pmRows.length} total project{pmRows.length === 1 ? "" : "s"}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <ZoomIn size={16} className="text-slate-500" />
                    <span className="text-sm font-medium text-slate-700">Time Scale</span>
                    <select value={projectManagerUtilizationZoom} onChange={(e) => setProjectManagerUtilizationZoom(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-emerald-600">
                      {zoomModes.map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                  <button onClick={() => setSelectedProjectManagerUtilization(null)} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold hover:bg-slate-50">Close</button>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-5">
                {pmRows.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">No active or pending project durations found for this project manager.</div>
                ) : (
                  <>
                    <GanttHeader timeline={pmTimeline} zoom={projectManagerUtilizationZoom} />
                    <div className="mt-3 space-y-3" style={{ minWidth: `${pmTimeline.width + 280}px` }}>
                      {pmRows.map((row) => {
                        const start = getProjectStartFromItems(row.items);
                        const end = getProjectEndFromItems(row.items);
                        return (
                          <div key={`pm-util-${row.project.id}`} className="grid grid-cols-[300px_1fr] items-center gap-5">
                            <div className="text-left">
                              <div className="flex items-center gap-2">
                                <span className={`h-3 w-3 rounded-full ${row.project.status === "Pending Award" ? pendingDivisionStyles[row.project.division] : divisionStyles[row.project.division] || "bg-slate-600"}`} />
                                <p className="font-semibold text-slate-900">{row.project.projectNumber ? `${row.project.projectNumber} - ` : ""}{row.project.name}</p>
                              </div>
                              <p className="mt-1 text-xs text-slate-500">{row.project.division} • {row.project.status} • {start ? formatDate(start) : "No start"} – {end ? formatDate(end) : "No end"}</p>
                            </div>
                            <div className="relative h-11 rounded-xl bg-slate-100" style={{ width: `${pmTimeline.width}px` }}>
                              {row.items.map((item) => (
                                <GanttSegmentBar key={`pm-util-${row.project.id}-${item.id}`} item={item} timeline={pmTimeline} label={row.project.name} />
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Segment Drilldown — specific division+type for one period */}
      {demandDrilldown && (() => {
        const { period, segment } = demandDrilldown;
        const { label, periodTimeline } = period;
        const items = segment.segmentItems || [];
        return (
          <div className="fixed inset-0 z-[87] bg-slate-950/70 p-4">
            <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white p-5">
                <div>
                  <h2 className="text-2xl font-bold">{segment.division} Projects ({segment.type}) — {label}</h2>
                  <p className="text-sm text-slate-500">{items.length} {segment.division} {segment.type.toLowerCase()} project{items.length === 1 ? "" : "s"} with filtered resources active during this period</p>
                </div>
                <button onClick={() => setDemandDrilldown(null)} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold hover:bg-slate-50">Close</button>
              </div>
              <div className="flex-1 overflow-auto p-5">
                <GanttHeader timeline={periodTimeline} zoom={demandZoom} />
                <div className="mt-3 space-y-3" style={{ minWidth: `${periodTimeline.width + 280}px` }}>
                  {items.length === 0 && <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">No assignments found for this segment.</div>}
                  {items.map((item) => (
                    <div key={`seg-drilldown-${item.id}`} className="grid grid-cols-[260px_1fr] items-center gap-5">
                      <div className="text-left">
                        <p className="font-semibold text-slate-900">{item.project.projectNumber ? `${item.project.projectNumber} - ` : ""}{item.project.name}</p>
                        <p className="mt-1 text-xs text-slate-500">{item.project.division} • {item.project.status} • {formatDate(item.start)} – {formatDate(item.end)}</p>
                        <p className="mt-0.5 text-xs text-slate-400">{getAssignmentPeopleLabel(item.assignment, crews) || "Unassigned"}</p>
                      </div>
                      <div className="relative h-11 rounded-xl bg-slate-100" style={{ width: `${periodTimeline.width}px` }}>
                        <GanttSegmentBar item={item} timeline={periodTimeline} label={getAssignmentPeopleLabel(item.assignment, crews) || item.project.name} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Period-wide Gantt Drilldown — all assignments active in that period */}
      {demandPeriodDrilldown && (() => {
        const { label, periodItems, periodTimeline } = demandPeriodDrilldown;
        return (
          <div className="fixed inset-0 z-[85] bg-slate-950/70 p-4">
            <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white p-5">
                <div>
                  <h2 className="text-2xl font-bold">All Assignments — {label}</h2>
                  <p className="text-sm text-slate-500">{periodItems.length} assignment{periodItems.length === 1 ? "" : "s"} active during this period across all divisions</p>
                </div>
                <button onClick={() => setDemandPeriodDrilldown(null)} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold hover:bg-slate-50">Close</button>
              </div>
              <div className="flex-1 overflow-auto p-5">
                <GanttHeader timeline={periodTimeline} zoom={demandZoom} />
                <div className="mt-3 space-y-3" style={{ minWidth: `${periodTimeline.width + 280}px` }}>
                  {periodItems.length === 0 && <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">No assignments active in this period.</div>}
                  {periodItems.map((item) => (
                    <div key={`period-drilldown-${item.id}`} className="grid grid-cols-[260px_1fr] items-center gap-5">
                      <div className="text-left">
                        <p className="font-semibold text-slate-900">{item.project.projectNumber ? `${item.project.projectNumber} - ` : ""}{item.project.name}</p>
                        <p className="mt-1 text-xs text-slate-500">{item.project.division} • {item.project.status} • {formatDate(item.start)} – {formatDate(item.end)}</p>
                        <p className="mt-0.5 text-xs text-slate-400">{getAssignmentPeopleLabel(item.assignment, crews) || "Unassigned"}</p>
                      </div>
                      <div className="relative h-11 rounded-xl bg-slate-100" style={{ width: `${periodTimeline.width}px` }}>
                        <GanttSegmentBar item={item} timeline={periodTimeline} label={getAssignmentPeopleLabel(item.assignment, crews) || item.project.name} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Expanded View */}
      {expandedView && (
        <div className="fixed inset-0 z-[60] bg-slate-950/70 p-4">
          <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white p-5">
              <h2 className="text-2xl font-bold">
                {expandedView === "project" ? "Project Assignment Gantt View" : expandedView === "resource" ? "Resource Gantt View" : expandedView === "crew" ? "Crew Gantt View" : "Resource Demand Graph"}
              </h2>
              <button onClick={() => setExpandedView(null)} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold hover:bg-slate-50">Close</button>
            </div>
            <div className="flex-1 overflow-auto p-5">
              {expandedView === "project" && (
                <div>
                  <GanttHeader timeline={timeline} zoom={zoom} />
                  <div className="mt-3 space-y-3" style={{ minWidth: `${timeline.width + 280}px` }}>
                    {projectGanttRows.map((row) => <ProjectGanttRow key={row.project.id} assignment={row.assignment} project={row.project} items={row.items} timeline={timeline} crews={crews} />)}
                  </div>
                </div>
              )}
              {expandedView === "resource" && (
                <div>
                  <GanttHeader timeline={timeline} zoom={zoom} />
                  <div className="mt-3 space-y-3" style={{ minWidth: `${timeline.width + 280}px` }}>
                    {resourceGanttRowsWithUnassigned.map((row) => row.isUnassignedNeedRow ? <UnassignedNeedGanttRow key={row.resource.id} resource={row.resource} items={row.items} timeline={timeline} /> : <ResourceGanttRow key={row.resource.id} resource={row.resource} items={row.items} timeline={timeline} onResourceClick={setFocusedResource} />)}
                  </div>
                </div>
              )}
              {expandedView === "crew" && (
                <div>
                  <GanttHeader timeline={timeline} zoom={zoom} />
                  <div className="mt-3 space-y-3" style={{ minWidth: `${timeline.width + 280}px` }}>
                    {crewGanttRows.map((row) => <CrewGanttRow key={row.crew.id} crew={row.crew} items={row.items} timeline={timeline} />)}
                  </div>
                </div>
              )}
              {expandedView === "demand" && (
                <ResourceDemandChart
                  enlarged
                  items={demandFilteredItems}
                  timeline={demandTimeline}
                  zoom={demandZoom}
                  totalResources={resources.filter((r) => dashboardResourceTypeFilter.includes(r.resourceType) && demandHomeDivisionFilter.includes(r.homeDivision)).length}
                  onExportPdf={() => exportSectionPdf("resource-demand-graph", "Resource Demand Graph")}
                  onBarClick={setDemandDrilldown}
                  onPeriodClick={setDemandPeriodDrilldown}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* User Settings */}
      {showUserSettings && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div><h2 className="text-xl font-bold">User Settings</h2><p className="text-sm text-slate-500">Add users who can log in to this system.</p></div>
              <button onClick={() => setShowUserSettings(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <input placeholder="Username" value={newUserForm.username} onChange={(e) => setNewUserForm((c) => ({ ...c, username: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" />
              <input placeholder="Password" type="password" value={newUserForm.password} onChange={(e) => setNewUserForm((c) => ({ ...c, password: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" />
              <button onClick={addAppUser} className="rounded-xl bg-emerald-700 px-4 py-2 font-bold text-white hover:bg-emerald-800">Add User</button>
            </div>
            <div className="mt-5 rounded-xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100 text-slate-600"><tr><th className="p-3">Username</th><th className="p-3">Created</th><th className="p-3 text-right">Action</th></tr></thead>
                <tbody>
                  {appUsers.map((user) => (
                    <tr key={user.username} className="border-t border-slate-200">
                      <td className="p-3 font-semibold">{user.username}</td>
                      <td className="p-3">{user.created_at ? formatDate(user.created_at) : ""}</td>
                      <td className="p-3 text-right"><button onClick={() => deleteAppUser(user.username)} className="rounded-lg border border-red-200 px-3 py-1.5 font-semibold text-red-700 hover:bg-red-50">Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Forecast Page ── */}
      {page === "forecast" && (() => {
        const months = Array.from({ length: 12 }, (_, i) => ({
          key: `${forecastYear}-${String(i + 1).padStart(2, "0")}`,
          label: new Date(forecastYear, i, 1).toLocaleString("default", { month: "short" }),
        }));

        const forecastProjects = projects
          .filter((p) => {
            if (!forecastDivisionFilter.includes(p.division)) return false;
            if (p.status === "Complete") return false;
            // Pending Award only shows if explicitly opted in
            if (p.status === "Pending Award" && !p.includeInForecast) return false;
            if (!p.includeInForecast) return false;
            if (forecastSearch) {
              const q = forecastSearch.toLowerCase();
              return (p.projectNumber || "").toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || (p.client || "").toLowerCase().includes(q);
            }
            return true;
          })
          .sort((a, b) => {
            if (forecastSort.key === "yearTotal") {
              const aRow = getForecastRow(a.id); const bRow = getForecastRow(b.id);
              const aMonths = getProjectMonths(a.id); const bMonths = getProjectMonths(b.id);
              const aSpread = spreadRevenue(aRow.contractValue, aMonths, aRow.spreadRule);
              const bSpread = spreadRevenue(bRow.contractValue, bMonths, bRow.spreadRule);
              const aTotal = months.reduce((s, m) => s + getMonthValue(a.id, m.key, aSpread).value, 0);
              const bTotal = months.reduce((s, m) => s + getMonthValue(b.id, m.key, bSpread).value, 0);
              return forecastSort.direction === "asc" ? aTotal - bTotal : bTotal - aTotal;
            }
            if (forecastSort.key === "contractValue") {
              const aV = getForecastRow(a.id).contractValue; const bV = getForecastRow(b.id).contractValue;
              return forecastSort.direction === "asc" ? aV - bV : bV - aV;
            }
            return compareValues(a[forecastSort.key], b[forecastSort.key], forecastSort.direction);
          });

        const projectRows = forecastProjects.map((p) => {
          const row = getForecastRow(p.id);
          const allMonths = getProjectMonths(p.id);
          const spread = spreadRevenue(row.contractValue, allMonths, row.spreadRule, p.id);
          const monthValues = months.map((m) => ({ ...getMonthValue(p.id, m.key, spread), key: m.key, locked: isMonthLocked(m.key) }));
          const yearTotal = monthValues.reduce((s, mv) => s + mv.value, 0);
          const thereafter = allMonths.filter((m) => m > `${forecastYear}-12`).reduce((s, m) => s + (spread[m] || 0), 0);
          return { project: p, row, spread, monthValues, yearTotal, thereafter };
        });

        const monthTotals = months.map((_, i) => projectRows.reduce((s, r) => s + r.monthValues[i].value, 0));
        const yearGrandTotal = monthTotals.reduce((s, v) => s + v, 0);
        const thereafterTotal = projectRows.reduce((s, r) => s + r.thereafter, 0);
        const cumulativeTotals = monthTotals.map((_, i) => monthTotals.slice(0, i + 1).reduce((s, v) => s + v, 0));

        const fmt = (v) => v == null ? "" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);

        function SortTh({ label, sortKey, className = "" }) {
          const active = forecastSort.key === sortKey;
          return (
            <th onClick={() => setForecastSort((s) => ({ key: sortKey, direction: s.key === sortKey && s.direction === "asc" ? "desc" : "asc" }))}
              className={`cursor-pointer p-3 hover:bg-slate-200 select-none ${className}`}>
              {label} {active ? (forecastSort.direction === "asc" ? "↑" : "↓") : ""}
            </th>
          );
        }

        return (
          <section className="mx-auto max-w-[1700px] space-y-4 px-4 py-6">
            {/* Header controls */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                <button onClick={() => setForecastYear((y) => y - 1)} className="rounded-lg px-2 py-1 text-slate-600 hover:bg-slate-100 font-bold">←</button>
                <span className="text-lg font-bold text-slate-900 w-16 text-center">{forecastYear}</span>
                <button onClick={() => setForecastYear((y) => y + 1)} className="rounded-lg px-2 py-1 text-slate-600 hover:bg-slate-100 font-bold">→</button>
              </div>
              {/* Search */}
              <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 shadow-sm">
                <Search size={15} className="text-slate-400" />
                <input className="outline-none text-sm w-44" placeholder="Search projects…" value={forecastSearch} onChange={(e) => setForecastSearch(e.target.value)} />
              </div>
              {/* Division filter */}
              <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                {divisions.map((d) => {
                  const active = forecastDivisionFilter.includes(d);
                  return <button key={d} onClick={() => setForecastDivisionFilter((prev) => toggleListValue(prev, d))} className={`rounded-full px-3 py-1 text-xs font-semibold ${active ? "bg-emerald-700 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"}`}>{d}</button>;
                })}
              </div>
              <button onClick={exportForecastCsv} className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 shadow-sm">Export CSV</button>
              <button onClick={exportForecastPdf} className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 shadow-sm">Export PDF</button>
              <CmicRefreshContracts projects={projects} forecastData={forecastData} onApplied={() => loadSupabaseData()} />
              <button onClick={recalculateAll} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800 shadow-sm">↻ Recalculate</button>
              <label className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 shadow-sm cursor-pointer">
                Import CSV<input type="file" accept=".csv" onChange={importForecastCsv} className="hidden" />
              </label>
              <button onClick={() => setShowForecastSettings(true)} className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 shadow-sm">
                <Settings size={16} /> Settings {globalLockThrough ? `· 🔒 ${globalLockThrough}` : ""}
              </button>
            </div>

            <p className="text-xs text-slate-500">Only projects with <strong>Include in Forecast</strong> checked appear here. Edit a project to opt it in. Pending Award projects must also be opted in explicitly.</p>

            {/* Main forecast table */}
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-left text-sm border-collapse" style={{ minWidth: "1500px" }}>
                <thead>
                  <tr className="bg-slate-100 text-slate-600 border-b-2 border-slate-300">
                    <SortTh label="Project" sortKey="projectNumber" className="sticky left-0 z-10 bg-slate-100 min-w-[200px]" />
                    <SortTh label="Division" sortKey="division" className="min-w-[90px]" />
                    <SortTh label="Contract Value" sortKey="contractValue" className="min-w-[130px]" />
                    <th className="p-3 min-w-[100px] bg-slate-200 text-right">Prior Year</th>
                    <th className="p-3 min-w-[110px]">Spread Rule</th>
                    {months.map((m) => (
                      <th key={m.key} className={`p-3 text-right min-w-[88px] ${globalLockThrough && m.key <= globalLockThrough ? "bg-amber-50" : ""}`}>
                        {m.label}{globalLockThrough && m.key <= globalLockThrough ? " 🔒" : ""}
                      </th>
                    ))}
                    <th className="p-3 text-right min-w-[100px] bg-slate-200">Thereafter</th>
                    <SortTh label="Year Total" sortKey="yearTotal" className="text-right min-w-[100px] bg-slate-200" />
                  </tr>
                </thead>
                <tbody key={forecastKey}>
                    {projectRows.map(({ project: p, row, monthValues, yearTotal, thereafter }, rowIdx) => {
                      const isEven = rowIdx % 2 === 0;
                      const rowBg = isEven ? "bg-white" : "bg-slate-50";
                      // Prior year total = sum of all actuals from previous year months
                      const prevYear = forecastYear - 1;
                      const prevYearMonths = Array.from({ length: 12 }, (_, i) => `${prevYear}-${String(i + 1).padStart(2, "0")}`);
                      const allMonths = getProjectMonths(p.id);
                      const spread = spreadRevenue(row.contractValue, allMonths, row.spreadRule, p.id);
                      const priorYearTotal = prevYearMonths.reduce((s, m) => {
                        const mv = getMonthValue(p.id, m, spread);
                        return s + mv.value;
                      }, 0);
                      return (
                        <tr key={p.id} className={`border-t border-slate-100 ${rowBg} hover:bg-emerald-50 group`}>
                          <td className={`sticky left-0 z-10 p-3 group-hover:bg-emerald-50 ${rowBg}`}>
                            <p className="font-semibold text-slate-900">{p.projectNumber ? `${p.projectNumber} - ` : ""}{p.name}</p>
                            <p className="text-xs text-slate-400">{p.status}</p>
                          </td>
                          <td className="p-3">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold text-white ${divisionStyles[p.division] || "bg-slate-500"}`}>{p.division}</span>
                          </td>
                          <td className="p-3">
                            <input type="number" className="w-full rounded-lg border border-slate-200 bg-transparent px-2 py-1 text-right text-sm outline-none focus:border-emerald-500 focus:bg-white" defaultValue={row.contractValue || ""} placeholder="0"
                              onBlur={(e) => saveForecastRow(p.id, { contractValue: parseFloat(e.target.value) || 0 })} />
                          </td>
                          {/* Prior Year column */}
                          <td className="p-3 text-right text-sm bg-slate-100 text-slate-600 font-medium">{priorYearTotal > 0 ? fmt(priorYearTotal) : <span className="text-slate-300">—</span>}</td>
                          <td className="p-3">
                            <select className="w-full rounded-lg border border-slate-200 bg-transparent px-2 py-1 text-sm outline-none focus:border-emerald-500 focus:bg-white" value={row.spreadRule} onChange={(e) => saveSpreadRule(p.id, e.target.value)}>
                              <option value="even">Even</option>
                              <option value="front">Front-Loaded</option>
                              <option value="back">Back-Loaded</option>
                              <option value="scurve">S-Curve</option>
                            </select>
                          </td>
                          {monthValues.map((mv) => (
                            <td key={mv.key} className={`p-1 text-right ${mv.locked ? "bg-amber-50" : ""}`}>
                              {mv.locked ? (
                                <div className={`w-full rounded-lg px-2 py-1 text-right text-xs ${mv.isActual ? "bg-emerald-50 font-semibold text-emerald-800 border border-emerald-200" : "bg-amber-50 text-slate-500 border border-amber-200"}`}>
                                  {mv.value > 0 ? fmt(mv.value) : <span className="text-slate-300">—</span>}
                                </div>
                              ) : (
                                <div className="relative group/cell">
                                  <input type="number"
                                    className={`w-full rounded-lg border px-2 py-1 text-right text-xs outline-none focus:bg-white ${mv.isActual ? "border-emerald-300 bg-emerald-50 font-semibold text-emerald-800 focus:border-emerald-500" : mv.isRedistributed ? "border-blue-200 bg-blue-50 text-blue-700 focus:border-blue-400" : "border-transparent bg-transparent text-slate-700 hover:border-slate-200 focus:border-emerald-500"}`}
                                    defaultValue={mv.isActual || mv.isRedistributed ? mv.value.toFixed(0) : (mv.value > 0 ? mv.value.toFixed(0) : "")}
                                    placeholder={mv.value > 0 && !mv.isActual ? mv.value.toFixed(0) : ""}
                                    onBlur={(e) => saveActual(p.id, mv.key, e.target.value)} />
                                  {mv.isActual && (
                                    <button
                                      type="button"
                                      title="Clear actual — revert to system calculation"
                                      onClick={() => saveActual(p.id, mv.key, "")}
                                      className="absolute -right-1.5 -top-1.5 z-10 hidden h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white shadow hover:bg-red-600 group-hover/cell:flex"
                                    >×</button>
                                  )}
                                </div>
                              )}
                            </td>
                          ))}
                          <td className="p-3 text-right text-xs text-slate-500 bg-slate-50">{thereafter > 0 ? fmt(thereafter) : ""}</td>
                          <td className="p-3 text-right text-sm font-semibold text-slate-800 bg-slate-50">{fmt(yearTotal)}</td>
                        </tr>
                      );
                    })}

                  {projectRows.length === 0 && (
                    <tr><td colSpan={20} className="p-8 text-center text-slate-400">No projects match. Make sure projects have <strong>Include in Forecast</strong> checked in their edit form.</td></tr>
                  )}

                  {/* Monthly totals */}
                  <tr className="border-t-2 border-slate-300 bg-slate-100 font-semibold text-slate-800">
                    <td className="sticky left-0 z-10 bg-slate-100 p-3">Monthly Total</td>
                    <td className="p-3" /><td className="p-3" /><td className="p-3 bg-slate-200" /><td className="p-3" />
                    {monthTotals.map((total, i) => (
                      <td key={months[i].key} className={`p-3 text-right ${globalLockThrough && months[i].key <= globalLockThrough ? "bg-amber-100" : ""}`}>{fmt(total)}</td>
                    ))}
                    <td className="p-3 text-right bg-slate-200">{fmt(thereafterTotal)}</td>
                    <td className="p-3 text-right bg-slate-200">{fmt(yearGrandTotal)}</td>
                  </tr>

                  {/* Cumulative YTD */}
                  <tr className="border-t border-slate-200 bg-emerald-50 text-emerald-900">
                    <td className="sticky left-0 z-10 bg-emerald-50 p-3 font-semibold">Cumulative YTD</td>
                    <td className="p-3" /><td className="p-3" /><td className="p-3 bg-emerald-100" /><td className="p-3" />
                    {cumulativeTotals.map((total, i) => (
                      <td key={months[i].key} className="p-3 text-right font-medium">{fmt(total)}</td>
                    ))}
                    <td className="p-3 bg-emerald-100" />
                    <td className="p-3 text-right font-bold bg-emerald-100">{fmt(yearGrandTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-5 rounded bg-emerald-100 border border-emerald-300" /> Actual entered (hover to see × clear button)</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-5 rounded bg-blue-100 border border-blue-300" /> Redistributed (remaining after actuals)</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-5 rounded bg-amber-50 border border-amber-200" /> Locked (read-only)</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-5 rounded bg-white border border-slate-200" /> Forecast (spread)</span>
              <span className="text-slate-400">· Changing spread rule or clicking ↻ Recalculate redistributes remaining value instantly.</span>
            </div>
          </section>
        );
      })()}

      {/* Certification Alert Modal */}
      {certAlertModal && (() => {
        const rows = certAlertModal === "expired" ? expiredCertificationRows : expiringCertificationRows;
        const title = certAlertModal === "expired" ? "Past Due Certifications" : "Certifications Expiring Within 30 Days";
        return (
          <div className="fixed inset-0 z-[88] flex items-center justify-center bg-slate-950/60 p-4">
            <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 p-5">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
                  <p className="text-sm text-slate-500">{rows.length} certification{rows.length === 1 ? "" : "s"} found.</p>
                </div>
                <button onClick={() => setCertAlertModal(null)} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold hover:bg-slate-50">Close</button>
              </div>
              <div className="overflow-auto p-5">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-100 text-slate-600">
                    <tr><th className="p-3">Resource</th><th className="p-3">Resource Type</th><th className="p-3">Certification</th><th className="p-3">Start</th><th className="p-3">Expiration</th><th className="p-3">Status</th></tr>
                  </thead>
                  <tbody>
                    {rows.map(({ resource, cert, status }) => (
                      <tr key={`${resource.id}-${cert.id}`} className="border-t border-slate-200">
                        <td className="p-3 font-semibold text-slate-900">{resource.name}</td>
                        <td className="p-3">{resource.resourceType}</td>
                        <td className="p-3">{cert.name}</td>
                        <td className="p-3">{cert.start ? formatDate(cert.start) : <span className="text-slate-300">—</span>}</td>
                        <td className="p-3 font-semibold">{cert.expiration ? formatDate(cert.expiration) : <span className="text-slate-300">—</span>}</td>
                        <td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${status === "expired" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{status === "expired" ? "Past Due" : "Expiring Soon"}</span></td>
                      </tr>
                    ))}
                    {rows.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-400">No certifications in this category.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Forms */}
      {showProjectForm && <ProjectForm form={projectForm} setForm={setProjectForm} onSave={saveProject} onCancel={() => setShowProjectForm(false)} onDelete={() => deleteProject(editingProjectId)} editing={Boolean(editingProjectId)} certifications={certifications} projectTypes={projectTypes} />}
      {showAssignmentForm && <AssignmentForm form={assignmentForm} setForm={setAssignmentForm} onSave={saveAssignment} onCancel={() => setShowAssignmentForm(false)} editing={Boolean(editingAssignmentId)} resources={resources} projects={projects} crews={activeCrews} />}
      {showResourceForm && <ResourceForm form={resourceForm} setForm={setResourceForm} certifications={certifications} onSave={saveResource} onCancel={() => setShowResourceForm(false)} onDelete={() => deleteResource(editingResourceId)} onExportResume={() => exportResourceResume(resourceForm)} resourceStats={editingResourceId ? getResourceStats(resourceForm) : null} editing={Boolean(editingResourceId)} />}
      {showCrewForm && <CrewForm form={crewForm} setForm={setCrewForm} certifications={certifications} onSave={saveCrew} onCancel={() => setShowCrewForm(false)} onDelete={() => deleteCrew(editingCrewId)} editing={Boolean(editingCrewId)} />}

      {/* ── Forecast Settings Modal ── */}
      {showForecastSettings && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <div><h2 className="text-xl font-bold">Forecast Settings</h2><p className="text-sm text-slate-500">Global lock freezes all projects up to that month.</p></div>
              <button onClick={() => setShowForecastSettings(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button>
            </div>
            <label className="block space-y-1">
              <span className="text-sm font-semibold text-slate-700">Global Lock-Through Month</span>
              <p className="text-xs text-slate-500">All months up to and including this month will be locked for all projects. Enter as YYYY-MM (e.g. 2025-06) or clear to unlock.</p>
              <div className="mt-2 flex gap-2">
                <input
                  type="month"
                  className="flex-1 rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600"
                  value={globalLockThrough || ""}
                  onChange={(e) => setGlobalLockThrough(e.target.value || null)}
                />
                <button onClick={() => saveGlobalLock(globalLockThrough)} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800">Save</button>
                <button onClick={() => saveGlobalLock(null)} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">Clear</button>
              </div>
            </label>
            {globalLockThrough && <p className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">🔒 All months through <strong>{globalLockThrough}</strong> are globally locked.</p>}
          </div>
        </div>
      )}

      {/* ── Claude Assistant ── */}
      <ClaudeAssistant
        open={showClaude}
        onClose={() => setShowClaude(false)}
        appData={{ projects, resources, crews, assignments, certifications }}
      />
    </main>
  );
}
