import React, { useEffect, useMemo, useState, useRef } from "react";
import { Plus, Trash2, Users, BriefcaseBusiness, X, ZoomIn, Settings, FolderKanban, ClipboardCheck, Search, Sparkles, AlertTriangle, BadgeCheck, Calendar } from "lucide-react";
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
  buildGanttItems,
  buildTimeline as _legacyBuildTimeline,
  itemOverlapsTimeline,
  findProject, getAssignmentCrewIds, getAssignmentCrewDisplayNames,
  getAssignmentPeopleLabel, getCrewDisplayName,
  formatDate,
  formatTick as _legacyFormatTick,
  csvEscape, downloadTextFile, readCsvFile, splitList,
  toggleListValue, toDate, addDays, rangesOverlap,
  timelinePercent as _legacyTimelinePercent,
  timelineSpanPercent as _legacyTimelineSpanPercent,
  getPeriodEnd as _legacyGetPeriodEnd,
} from "./utils";

import {
  mapProjectFromDb, mapResourceFromDb, mapCrewFromDb,
  mapAssignmentFromDb, mapCertificationFromDb,
  projectToDb, resourceToDb, crewToDb, assignmentToDb, mobilizationToDb,
} from "./db/mappers";

// Override mappers locally to include includeInForecast until db/mappers.js is deployed
// ─── Working-day helpers (weekends excluded) ─────────────────────────────────
// Tasks are scheduled on business days only (Mon–Fri). These mirror addDays
// from utils but skip Saturdays/Sundays.
function isWeekendDay(d) { const day = d.getDay(); return day === 0 || day === 6; }
function nextWorkday(d) { const r = new Date(d); while (isWeekendDay(r)) r.setDate(r.getDate() + 1); return r; }
function prevWorkday(d) { const r = new Date(d); while (isWeekendDay(r)) r.setDate(r.getDate() - 1); return r; }
// Add N business days to a date (negative N steps backward). N=0 snaps the date
// to the nearest workday in the step direction's neutral sense (returns as-is if
// already a workday).
function addWorkDays(date, n) {
  const r = new Date(date);
  if (n === 0) return isWeekendDay(r) ? nextWorkday(r) : r;
  const step = n > 0 ? 1 : -1;
  let remaining = Math.abs(n);
  while (remaining > 0) {
    r.setDate(r.getDate() + step);
    if (!isWeekendDay(r)) remaining--;
  }
  return r;
}
// Business-day span end: start + (durationDays-1) working days, start snapped
// onto a workday first.
function workdayEnd(start, durationDays) {
  const s = nextWorkday(new Date(start));
  return addWorkDays(s, Math.max(0, (Number(durationDays) || 1) - 1));
}
// Inclusive count of working days between two dates (weekends excluded).
function workdayCountBetween(start, end) {
  const s = toDate(start), e = toDate(end);
  if (!s || !e || e < s) return null;
  let count = 0;
  const r = new Date(s);
  while (r <= e) { if (!isWeekendDay(r)) count++; r.setDate(r.getDate() + 1); }
  return count;
}

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
    crewType: c.crew_type || [],
    deactivated: c.deactivated || false,
  };
}
function crewToDbLocal(crew) {
  return {
    crew_name: crew.crewName,
    foreman_name: crew.foremanName,
    total_members: crew.totalMembers || 0,
    specialty: crew.specialty || [],
    crew_type: crew.crewType || [],
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


// ─── Gantt label abbreviation helpers ───────────────────────────────────────
//
// Bar labels were getting clipped/overlapping. We now abbreviate so more
// labels fit, render them overflow-visible (never truncated by bar width or a
// neighboring bar), and expose the FULL un-abbreviated text on hover.
//
//   - People (PM / superintendent / etc.): "First L." (full first name +
//     last-name initial). Single-word names pass through unchanged.
//   - Crews: FIRST NAME ONLY of the crew name (e.g. "Cruz Elite" -> "Cruz").
//   - Each crew also shows men / % allocation, where % = men on this
//     assignment ÷ that crew's total members. Format: "Cruz (4/40%)".

function abbreviatePersonName(name) {
  const full = String(name || "").trim();
  if (!full) return "";
  const parts = full.split(/\s+/);
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  return `${parts.slice(0, -1).join(" ")} ${last.charAt(0).toUpperCase()}.`;
}

function firstNameOnly(name) {
  const full = String(name || "").trim();
  if (!full) return "";
  return full.split(/\s+/)[0];
}

// Pull the per-mobilization men count for a crew from whichever field the
// synthetic assignment carries (_crewMenCounts is set by buildGanttItems;
// crewMenCounts is the raw mob field).
function getMenForCrewOnItem(assignment, crewId) {
  const counts = assignment?._crewMenCounts || assignment?.crewMenCounts || {};
  const v = counts[crewId];
  return v === undefined || v === null || v === "" ? null : Number(v) || 0;
}

// Build one crew chunk like "Cruz (4/40%)". men = men on this assignment,
// % = men ÷ crew.totalMembers (0 total -> omit %). Falls back to crew total
// if no per-mob men count is recorded.
function buildCrewChunk(crew, assignment, { abbreviate = true } = {}) {
  if (!crew) return "";
  const name = abbreviate ? firstNameOnly(crew.crewName) : getCrewDisplayName(crew);
  const total = Number(crew.totalMembers) || 0;
  const recorded = getMenForCrewOnItem(assignment, crew.id);
  const men = recorded != null ? recorded : total;
  if (!men && !total) return name;
  const pct = total > 0 ? Math.round((men / total) * 100) : null;
  return pct != null ? `${name} (${men}/${pct}%)` : `${name} (${men})`;
}

// The abbreviated label shown ON the bar: "Armando C. • Cruz (4/40%)".
function buildGanttBarLabel(assignment, crews = []) {
  if (!assignment) return "";
  const person = abbreviatePersonName(assignment.superintendent);
  const crewChunks = getAssignmentCrewIds(assignment)
    .map((id) => crews.find((c) => c.id === id))
    .filter(Boolean)
    .map((crew) => buildCrewChunk(crew, assignment, { abbreviate: true }));
  return [person, ...crewChunks].filter(Boolean).join(" • ");
}

// The FULL label shown on hover: "Armando Camacho • Cruz Elite (4 men / 40%)".
function buildGanttBarFullLabel(assignment, crews = []) {
  if (!assignment) return "";
  const person = String(assignment.superintendent || "").trim();
  const crewChunks = getAssignmentCrewIds(assignment)
    .map((id) => crews.find((c) => c.id === id))
    .filter(Boolean)
    .map((crew) => {
      const total = Number(crew.totalMembers) || 0;
      const recorded = getMenForCrewOnItem(assignment, crew.id);
      const men = recorded != null ? recorded : total;
      const pct = total > 0 ? Math.round((men / total) * 100) : null;
      const display = getCrewDisplayName(crew);
      if (!men && !total) return display;
      return pct != null ? `${display} (${men} men / ${pct}%)` : `${display} (${men} men)`;
    });
  return [person, ...crewChunks].filter(Boolean).join(" • ");
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
  const enrichedMobs = (mapped.mobilizations || []).map((mob) => {
    const raw = byId.get(mob.id) || rawMobs.find((m) => m.start_date === mob.start && m.end_date === mob.end) || {};
    return {
      ...mob,
      unassignedNeeds: normalizeUnassignedNeeds(raw.unassigned_needs || mob.unassignedNeeds),
      // Pull crew_only flag back from DB so the toggle's state survives
      // page reload and crew-only items can be identified by the
      // ganttItems augmentation.
      crewOnly: raw.crew_only != null ? !!raw.crew_only : !!mob.crewOnly,
      // Which project tasks this mobilization covers (for the "which task"
      // display on the assignment + the task-schedule details row).
      taskIds: Array.isArray(raw.task_ids) ? raw.task_ids : (Array.isArray(mob.taskIds) ? mob.taskIds : []),
    };
  });
  // Sort by start date so the earliest mobilization is always first. Mobs
  // without a start date sort to the bottom. This keeps the assignment form
  // and Gantt rendering in chronological order even after the user adds a
  // mobilization that predates the existing ones.
  enrichedMobs.sort((a, b) => {
    const aDate = toDate(a.start);
    const bDate = toDate(b.start);
    if (!aDate && !bDate) return 0;
    if (!aDate) return 1;
    if (!bDate) return -1;
    return aDate - bDate;
  });
  return { ...mapped, mobilizations: enrichedMobs };
}
function mobilizationToDbLocal(mobilization, assignmentId) {
  return {
    ...mobilizationToDb(mobilization, assignmentId),
    unassigned_needs: normalizeUnassignedNeeds(mobilization.unassignedNeeds),
    crew_only: !!mobilization.crewOnly,
    task_ids: Array.isArray(mobilization.taskIds) ? mobilization.taskIds.filter(Boolean) : [],
  };
}

import { useSupabaseRealtime } from "./hooks/useSupabaseRealtime";

// ─── Custom Gantt Timeline ──────────────────────────────────────────────────
//
// Replaces the legacy buildTimeline / timelineSpanPercent / timelinePercent /
// formatTick / getPeriodEnd helpers. The new model gives each zoom mode a
// FIXED VISIBLE WINDOW SIZE — the chart container is set to `viewportWidth`,
// while the scrollable inner timeline is `width` (which can be much larger).
// The user scrolls horizontally to see additional periods.
//
// Standard visible windows per zoom (the "see N units before scrolling" spec):
//   Days     → 15 days
//   Weeks    → 10 weeks
//   Months   →  6 months
//   Quarters →  6 quarters
//   Years    →  3 years
//
// Bar positioning: bars are placed in absolute pixels (left = pxPerDay × days
// from minDate, width = pxPerDay × bar_days). Single-day bars get exactly
// pxPerDay wide — no minimum-width floor, so a 1-day mob in Day view shows
// up as a single column wide rather than a 4-day-wide blob.

const ZOOM_VISIBLE_UNITS = {
  Days: 15,
  Weeks: 10,
  Months: 6,
  Quarters: 6,
  Years: 3,
};

// Fixed viewport pixel width for the scrollable Gantt area. 1500px is roughly
// what fits cleanly inside the new 1700px page layout.
const GANTT_VIEWPORT_PX = 1500;

function startOfWeek(date) {
  // Treat Sunday as start of week (matches existing utility conventions).
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function startOfQuarter(date) {
  const m = Math.floor(date.getMonth() / 3) * 3;
  return new Date(date.getFullYear(), m, 1);
}

function nextTickDate(date, zoom) {
  const d = new Date(date);
  if (zoom === "Days") d.setDate(d.getDate() + 1);
  else if (zoom === "Weeks") d.setDate(d.getDate() + 7);
  else if (zoom === "Months") d.setMonth(d.getMonth() + 1);
  else if (zoom === "Quarters") d.setMonth(d.getMonth() + 3);
  else if (zoom === "Years") d.setFullYear(d.getFullYear() + 1);
  return d;
}

// Snap any date to the start of its zoom-level period.
function snapToZoomStart(date, zoom) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (zoom === "Days") return d;
  if (zoom === "Weeks") return startOfWeek(d);
  if (zoom === "Months") return new Date(d.getFullYear(), d.getMonth(), 1);
  if (zoom === "Quarters") return startOfQuarter(d);
  if (zoom === "Years") return new Date(d.getFullYear(), 0, 1);
  return d;
}

// Build a timeline that:
//   - ALWAYS starts at the current period (this week / month / quarter /
//     year, depending on zoom). Items that started before this point are
//     not visible at the left edge but can be scrolled to via horizontal
//     scroll if maxDate has been pushed back far enough.
//   - extends to cover the latest item + a small buffer
//   - has at least the visible-window count of ticks
function buildTimeline(items, zoom) {
  const today = new Date();
  const todaySnapped = snapToZoomStart(today, zoom);
  const visibleUnits = ZOOM_VISIBLE_UNITS[zoom] || 15;

  // Find latest end across items so we know how far to extend the right
  // side of the chart. We don't track earliest start anymore — the chart
  // is anchored at TODAY no matter how old the data is.
  let latestEnd = todaySnapped;
  items.forEach((item) => {
    const e = toDate(item.end);
    if (e && e > latestEnd) latestEnd = e;
  });

  // Anchor minDate at the start of the current period (this week, this
  // month, this quarter, this year). Today's date snapped to the zoom
  // boundary IS the start of the current period — that's what the user
  // wanted as the left edge.
  const minDate = todaySnapped;

  // maxDate must extend at least visibleUnits past minDate, but also cover
  // the latest item + at least one extra unit of buffer past it.
  let maxDate = minDate;
  for (let i = 0; i < visibleUnits; i++) maxDate = nextTickDate(maxDate, zoom);
  // Keep extending until we cover the latest item + 1 buffer unit.
  let safetyCounter = 0;
  while (maxDate <= latestEnd && safetyCounter++ < 500) {
    maxDate = nextTickDate(maxDate, zoom);
  }
  // Add one extra unit of trailing buffer.
  maxDate = nextTickDate(maxDate, zoom);

  // Build tick array.
  const ticks = [];
  let cursor = new Date(minDate);
  let tickSafety = 0;
  while (cursor < maxDate && tickSafety++ < 2000) {
    ticks.push(new Date(cursor));
    cursor = nextTickDate(cursor, zoom);
  }
  if (!ticks.length) ticks.push(new Date(minDate));

  // Compute totalDays, pxPerDay, and total pixel width.
  const totalDays = Math.max(1, Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24)));

  // Scale pxPerDay so visibleUnits worth of days fit in the viewport.
  let visibleDays;
  if (zoom === "Days") visibleDays = visibleUnits;
  else if (zoom === "Weeks") visibleDays = visibleUnits * 7;
  else if (zoom === "Months") visibleDays = visibleUnits * 30.44; // avg month
  else if (zoom === "Quarters") visibleDays = visibleUnits * 91.31;
  else if (zoom === "Years") visibleDays = visibleUnits * 365.25;
  else visibleDays = visibleUnits;

  const pxPerDay = GANTT_VIEWPORT_PX / visibleDays;
  const width = Math.round(pxPerDay * totalDays);

  return {
    minDate, maxDate,
    currentDate: today,
    totalDays,
    ticks,
    width,                         // total scrollable inner width in pixels
    viewportWidth: GANTT_VIEWPORT_PX, // visible viewport size
    pxPerDay,
    zoom,
  };
}

// Pixel offset from minDate. Returns absolute pixels (not %), so bars and
// today-lines can be positioned with `left: ${px}px`. Tolerates legacy
// timeline objects that lack pxPerDay by falling back to width/totalDays.
function timelinePixelOffset(date, timeline) {
  const d = toDate(date);
  if (!d || !timeline) return 0;
  const pxPerDay = timeline.pxPerDay || (timeline.totalDays > 0 ? timeline.width / timeline.totalDays : 1);
  const days = (d - timeline.minDate) / (1000 * 60 * 60 * 24);
  return Math.round(days * pxPerDay);
}

// Returns { left, width } in PIXELS for placing a bar from start to end
// (inclusive — bar covers start day through end day).
function timelineSpanPixels(start, end, timeline) {
  const s = toDate(start);
  const e = toDate(end);
  if (!s || !e || !timeline) return { left: 0, width: 0 };
  const startOffset = timelinePixelOffset(s, timeline);
  // +1 day so a same-day mob (start = end) renders as one full day wide.
  const inclusiveEnd = addDays(e, 1);
  const endOffset = timelinePixelOffset(inclusiveEnd, timeline);
  return { left: startOffset, width: Math.max(2, endOffset - startOffset) };
}

// Format a tick label based on zoom.
function formatTick(date, zoom) {
  if (zoom === "Days") return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (zoom === "Weeks") return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (zoom === "Months") return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  if (zoom === "Quarters") {
    const q = Math.floor(date.getMonth() / 3) + 1;
    return `Q${q} ${String(date.getFullYear()).slice(2)}`;
  }
  if (zoom === "Years") return String(date.getFullYear());
  return date.toLocaleDateString();
}

// End of a tick period — used for hit-testing and drilldowns.
function getPeriodEnd(tickStart, zoom) {
  return nextTickDate(tickStart, zoom);
}

// Compute the indices of weekend days inside the timeline. Returns an array
// of `{ leftPx, widthPx }` so the caller can render shaded background bands.
// Only meaningful for Days and Weeks zoom — empty array otherwise.
function getWeekendBands(timeline) {
  if (!timeline || (timeline.zoom !== "Days" && timeline.zoom !== "Weeks")) return [];
  const bands = [];
  const cursor = new Date(timeline.minDate);
  while (cursor < timeline.maxDate) {
    const dow = cursor.getDay(); // Sun=0, Sat=6
    if (dow === 0 || dow === 6) {
      const left = timelinePixelOffset(cursor, timeline);
      const next = addDays(cursor, 1);
      const width = timelinePixelOffset(next, timeline) - left;
      bands.push({ leftPx: left, widthPx: width });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return bands;
}

// Convenience: where is "today" in the timeline, in pixels?
function getTodayLeftPx(timeline) {
  const today = new Date();
  if (today < timeline.minDate || today > timeline.maxDate) return -1;
  return timelinePixelOffset(today, timeline);
}

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

// ─── TaskGanttRow ────────────────────────────────────────────────────────────

// ─── StaffRequestRow (read-only status; PM may withdraw) ─────────────────────

export function StaffRequestRow({ r, isPM, isOffice, onWithdraw, onDelete }) {
  const [busy, setBusy] = useState(false);
  const wrap = async (fn) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const statusBadge = {
    pending: "bg-amber-100 text-amber-700",
    approved: "bg-emerald-100 text-emerald-700",
    denied: "bg-red-100 text-red-700",
  }[r.status] || "bg-slate-100 text-slate-600";
  return (
    <div className="flex items-start gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">
          <span className="mr-2 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold uppercase text-purple-700">Staff</span>
          {r.role}
          {r.assigned_name ? <span className="ml-2 font-normal text-emerald-700">→ {r.assigned_name}</span> : null}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          {r.start_date ? formatDate(r.start_date) : "—"}{r.end_date ? ` → ${formatDate(r.end_date)}` : ""}
          {isOffice && r.requested_by_name ? ` · ${r.requested_by_name}` : ""}
        </p>
        {r.notes && <p className="mt-0.5 text-xs text-slate-400">{r.notes}</p>}
      </div>
      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold capitalize ${statusBadge}`}>{r.status}</span>
      {isPM && r.status === "pending" && (
        <button disabled={busy} onClick={() => wrap(onWithdraw)} className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">Withdraw</button>
      )}
      {isOffice && onDelete && (
        <button disabled={busy} onClick={() => wrap(onDelete)} title="Delete request" className="shrink-0 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">Delete</button>
      )}
    </div>
  );
}

// ─── StaffRequestForm (project-level staffing request) ──────────────────────

export function StaffRequestForm({ form, setForm, roles, onSave, onCancel, busy }) {
  function updateField(field, value) { setForm((c) => ({ ...c, [field]: value })); }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Request Staff</h2>
            <p className="text-sm text-slate-500">Request a project role. The office assigns the actual person.</p>
          </div>
          <button onClick={onCancel} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button>
        </div>
        <div className="grid gap-4 p-5">
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Role</span>
            <select className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.role} onChange={(e) => updateField("role", e.target.value)}>
              {roles.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm font-medium text-slate-700">Start Date</span>
              <input type="date" className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.startDate} onChange={(e) => updateField("startDate", e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium text-slate-700">End Date</span>
              <input type="date" className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.endDate} onChange={(e) => updateField("endDate", e.target.value)} />
            </label>
          </div>
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Notes</span>
            <input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.notes} onChange={(e) => updateField("notes", e.target.value)} placeholder="Anything the office should know" />
          </label>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-200 p-5">
          <button onClick={onCancel} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button onClick={onSave} disabled={busy} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-300">{busy ? "Sending…" : "Submit Request"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── RequestsModal (Project Dashboard banner) ────────────────────────────────
// Lists pending crew + staff requests. Clicking one opens the Assign tool
// (handled by parent) and shows an availability recommendation for its window.

export function RequestsModal({ requests, activeRequest, availability, requestedTypes, laborManagement, onPick, onDelete, onContinue, onClose }) {
  // Staged selections for the active request. Reset whenever the active request
  // changes so picks don't bleed across requests.
  const [selCrewIds, setSelCrewIds] = useState([]);
  const [selPeopleIds, setSelPeopleIds] = useState([]);
  useEffect(() => { setSelCrewIds([]); setSelPeopleIds([]); }, [activeRequest && activeRequest.id, activeRequest && activeRequest.kind]);

  function toggleCrew(id) {
    setSelCrewIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }
  function togglePerson(id) {
    setSelPeopleIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }

  // Which resource types the labor management request allows. None → no people
  // section (crew-only assist). Super → superintendents (incl. general/asst).
  // Field Coordinator → field coordinators. Both → either.
  function personMatchesLabor(resourceType) {
    const t = String(resourceType || "").toLowerCase();
    const isSuper = t.includes("super");
    const isFC = t.includes("field coordinator");
    if (laborManagement === "Super") return isSuper;
    if (laborManagement === "Field Coordinator") return isFC;
    if (laborManagement === "Both") return isSuper || isFC;
    return false; // "None"
  }

  const filteredPeople = (availability && availability.freeResources ? availability.freeResources : [])
    .filter((r) => activeRequest && activeRequest.kind === "crew" ? personMatchesLabor(r.resourceType) : true);

  const selectionCount = selCrewIds.length + selPeopleIds.length;

  function handleContinue() {
    if (!availability) return;
    const crews = (availability.freeCrews || []).filter((c) => selCrewIds.includes(c.id));
    const people = (availability.freeResources || []).filter((r) => selPeopleIds.includes(r.id));
    onContinue && onContinue({ crews, people });
  }

  return (
    <div className="fixed inset-0 z-[86] flex items-center justify-center bg-slate-950/50 p-4">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 p-5">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Open Requests</h2>
            <p className="text-sm text-slate-500">Pick a request, stage the crews and labor management you want, then continue to the Assign tool.</p>
          </div>
          <button onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold hover:bg-slate-50">Close</button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
          {/* Left: request list */}
          <div className="min-h-0 overflow-auto border-r border-slate-200">
            {requests.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">No pending requests.</div>
            ) : requests.map((req) => {
              const active = activeRequest && activeRequest.id === req.id && activeRequest.kind === req.kind;
              return (
                <div key={`${req.kind}-${req.id}`}
                  className={`flex items-start gap-2 border-b border-slate-100 px-5 py-3 hover:bg-emerald-50 ${active ? "bg-emerald-50" : ""}`}>
                  <button onClick={() => onPick(req)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${req.kind === "crew" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"}`}>{req.kind}</span>
                      <span className="text-sm font-semibold text-slate-900">{req.label}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">{req.projectLabel}{req.requestedBy ? ` · ${req.requestedBy}` : ""}</p>
                    {(req.start || req.end) && (
                      <p className="mt-0.5 text-xs text-slate-400">{req.start ? formatDate(req.start) : "—"}{req.end ? ` → ${formatDate(req.end)}` : ""}</p>
                    )}
                  </button>
                  {onDelete && (
                    <button onClick={() => onDelete(req)} title="Delete request"
                      className="shrink-0 rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50">Delete</button>
                  )}
                </div>
              );
            })}
          </div>
          {/* Right: availability recommendation + staging */}
          <div className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-auto p-5">
            {!activeRequest ? (
              <div className="text-sm text-slate-400">Select a request to see availability.</div>
            ) : !availability ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                This request has no date window yet. Open the Assign tool and set mobilization dates — availability needs a start and end.
              </div>
            ) : (
              <>
                <h3 className="mb-2 text-sm font-bold text-slate-900">Available for this window</h3>
                <p className="mb-3 text-xs text-slate-500">Not booked on another project (and not on PTO) during the request’s dates. Tap to stage; you can pick several.</p>
                {activeRequest && activeRequest.kind === "crew" && laborManagement && laborManagement !== "None" && (
                  <div className="mb-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800">
                    Labor management requested: {laborManagement}. People below are filtered to {laborManagement === "Both" ? "superintendents and field coordinators" : laborManagement === "Super" ? "superintendents" : "field coordinators"}.
                  </div>
                )}
                {activeRequest && activeRequest.kind === "crew" && (requestedTypes || []).length > 0 && (
                  <div className="mb-3 flex items-center gap-3 text-[11px] font-semibold">
                    <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-emerald-500" /> matches all types</span>
                    <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-amber-400" /> matches some</span>
                    <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-slate-200" /> no type match</span>
                  </div>
                )}
                <div className="mb-4">
                  <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Crews ({availability.freeCrews.length})</p>
                  <div className="flex flex-wrap gap-1.5">
                    {availability.freeCrews.length === 0 ? <span className="text-xs text-slate-400">None free</span>
                      : availability.freeCrews.map((c) => {
                        const types = Array.isArray(c.crewType) ? c.crewType : [];
                        const needed = (activeRequest && activeRequest.kind === "crew") ? (requestedTypes || []) : [];
                        const matchCount = needed.filter((t) => types.includes(t)).length;
                        const picked = selCrewIds.includes(c.id);
                        const cls = picked
                          ? "bg-emerald-700 text-white ring-2 ring-emerald-900"
                          : needed.length === 0
                            ? "bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                            : matchCount === 0
                              ? "bg-slate-100 text-slate-600 hover:bg-slate-200"
                              : matchCount === needed.length
                                ? "bg-emerald-500 text-white hover:bg-emerald-600"
                                : "bg-amber-300 text-amber-900 hover:bg-amber-400";
                        return (
                          <button key={c.id} onClick={() => toggleCrew(c.id)} title={types.length ? `Types: ${types.join(", ")}` : "No crew type set"}
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>
                            {picked ? "✓ " : ""}{c.crewName}{types.length ? ` · ${types.join("/")}` : ""}
                          </button>
                        );
                      })}
                  </div>
                </div>
                {activeRequest && activeRequest.kind === "crew" && laborManagement === "None" ? null : (
                  <div>
                    <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                      {activeRequest && activeRequest.kind === "crew" ? "Labor Management" : "People"} ({filteredPeople.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {filteredPeople.length === 0 ? <span className="text-xs text-slate-400">None available for the requested role</span>
                        : filteredPeople.map((r) => {
                          const picked = selPeopleIds.includes(r.id);
                          return (
                            <button key={r.id} onClick={() => togglePerson(r.id)} title="Stage for assignment"
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${picked ? "bg-sky-700 text-white ring-2 ring-sky-900" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                              {picked ? "✓ " : ""}{r.name} · {r.resourceType}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}
              </>
            )}
            </div>
            {/* Footer: staged count + continue */}
            {activeRequest && availability && (
              <div className="shrink-0 border-t border-slate-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-slate-500">
                    {selectionCount === 0 ? "Nothing staged yet" : `${selCrewIds.length} crew${selCrewIds.length === 1 ? "" : "s"}, ${selPeopleIds.length} ${selPeopleIds.length === 1 ? "person" : "people"} staged`}
                  </span>
                  <button onClick={handleContinue} disabled={selectionCount === 0}
                    className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:bg-slate-300">
                    Continue to Assign →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// First name + last initial, e.g. "Aaron Poppe" -> "Aaron P."
function formatShortName(full) {
  if (!full) return "";
  const parts = String(full).trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function TaskGanttRow({ task, timeline, striped, dependsOnName, requests, assigned, onClick }) {
  const startD = task.eff_start || task.start_date;
  const endD = task.eff_end || task.end_date;
  const span = (startD && endD) ? timelineSpanPixels(startD, endD, timeline) : { left: 0, width: 0 };
  const reqs = (requests || []).filter((r) =>
    (r.task_crew_request_links || []).some((l) => l.task_id === task.id));
  const anyApproved = reqs.some((r) => r.status === "approved");
  const anyPending = reqs.some((r) => r.status === "pending");
  const barColor = anyApproved ? "bg-emerald-700" : anyPending ? "bg-amber-500" : "bg-slate-400";
  const isHeader = task.isHeader;
  const depth = task.depth || 0;

  return (
    <div className={`${striped && !isHeader ? "bg-slate-100/60" : ""}`} style={{ height: "32px" }}>
      <div className="grid grid-cols-[320px_1fr] items-center gap-0" style={{ height: "32px" }}>
        <button onClick={onClick} className={`sticky left-0 z-20 h-full text-left overflow-hidden ${isHeader ? "bg-slate-200 hover:bg-slate-300" : "bg-white hover:bg-slate-50"}`} style={{ paddingLeft: `${8 + depth * 16}px`, paddingRight: "12px" }}>
          <p className={`truncate ${isHeader ? "text-[12px] font-extrabold uppercase tracking-wide text-slate-800" : "text-[12px] font-semibold text-slate-900 hover:text-emerald-700"}`}>
            {isHeader ? "▸ " : ""}{task.name}
            {dependsOnName ? <span className="ml-1 font-normal text-slate-400">↳ {dependsOnName}</span> : null}
            {!isHeader && assigned && (() => {
              const labor = [...assigned.supers, ...assigned.fieldCoords].map(formatShortName).filter(Boolean);
              const crewBits = assigned.crews.map((c) => `${c.name}${c.men ? ` (${c.men})` : ""}`);
              const bits = [...labor, ...crewBits];
              return bits.length ? <span className="ml-1.5 font-normal text-[10px] text-emerald-700">· {bits.join(" · ")}</span> : null;
            })()}
          </p>
        </button>
        <div className="relative h-full" style={{ width: `${timeline.width}px` }}>
          {span.width > 0 && (
            <div
              className={`absolute h-5 overflow-hidden rounded-md px-2.5 text-[11px] font-semibold leading-5 text-white shadow-sm ${isHeader ? "bg-slate-700" : barColor}`}
              style={{ left: `${span.left}px`, width: `${span.width}px`, top: "6px" }}
              title={`${task.name}\n${startD ? formatDate(startD) : "?"} - ${endD ? formatDate(endD) : "?"}${reqs.length ? "\nCrew: " + reqs.map((r) => `${r.crew_specialty} (${r.status})`).join(", ") : ""}`}
            >
              {task.name}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── TaskDependencyArrows ────────────────────────────────────────────────────
// SVG overlay drawing predecessor → successor connectors on the task Gantt.
// Anchor points depend on the relationship type:
//   FS: predecessor END  → successor START
//   SS: predecessor START → successor START
//   FF: predecessor END  → successor END
//   SF: predecessor START → successor END
function TaskDependencyArrows({ tasks, timeline, rowHeight }) {
  const indexById = new Map(tasks.map((t, i) => [t.id, i]));
  const spanOf = (t) => {
    const s = t.eff_start || t.start_date, e = t.eff_end || t.end_date;
    return (s && e) ? timelineSpanPixels(s, e, timeline) : null;
  };
  const paths = [];
  tasks.forEach((t, i) => {
    if (!t.depends_on || !indexById.has(t.depends_on)) return;
    const depIdx = indexById.get(t.depends_on);
    const dep = tasks[depIdx];
    const depSpan = spanOf(dep);
    const curSpan = spanOf(t);
    if (!depSpan || !curSpan || depSpan.width <= 0 || curSpan.width <= 0) return;
    const type = t.dependency_type || "FS";
    const fromX = (type === "FS" || type === "FF") ? depSpan.left + depSpan.width : depSpan.left;
    const toX = (type === "FF" || type === "SF") ? curSpan.left + curSpan.width : curSpan.left;
    const fromY = depIdx * rowHeight + rowHeight / 2;
    const toY = i * rowHeight + rowHeight / 2;
    // Orthogonal elbow with a small horizontal stub, then arrowhead into the bar.
    const stub = 10;
    const dir = toX >= fromX ? 1 : -1;
    const midX = Math.max(fromX + stub, toX - stub);
    const d = `M ${fromX} ${fromY} H ${fromX + dir * stub} V ${toY} H ${toX - 6}`;
    paths.push(
      <g key={`${t.id}-arrow`}>
        <path d={d} fill="none" stroke="#64748b" strokeWidth="1.4" />
        <path d={`M ${toX - 6} ${toY - 3} L ${toX} ${toY} L ${toX - 6} ${toY + 3} Z`} fill="#64748b" />
      </g>
    );
  });
  return (
    <svg width={timeline.width} height={tasks.length * rowHeight} className="overflow-visible">
      {paths}
    </svg>
  );
}

// ─── TaskCrewRequestRow ──────────────────────────────────────────────────────

export function TaskCrewRequestRow({ r, isOffice, isPM, taskNameById, crews, onWithdraw, onDelete }) {
  const [busy, setBusy] = useState(false);
  const wrap = async (fn) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  const taskNames = (r.task_crew_request_links || [])
    .map((l) => taskNameById.get(l.task_id))
    .filter(Boolean);
  const assignedCrew = r.assigned_crew_id ? crews.find((c) => c.id === r.assigned_crew_id) : null;

  const statusBadge = {
    pending: "bg-amber-100 text-amber-700",
    approved: "bg-emerald-100 text-emerald-700",
    denied: "bg-red-100 text-red-700",
  }[r.status] || "bg-slate-100 text-slate-600";

  return (
    <div className="flex items-start gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">
          {r.crew_specialty}{r.men_count ? ` · ${r.men_count} men` : ""}
          {r.labor_management && r.labor_management !== "None" ? (
            <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800 align-middle">+ {r.labor_management}</span>
          ) : null}
          {assignedCrew ? <span className="ml-2 font-normal text-emerald-700">→ {assignedCrew.crewName}</span> : null}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          For: {taskNames.length ? taskNames.join(", ") : "—"}
          {isOffice && r.requested_by_name ? ` · ${r.requested_by_name}` : ""}
        </p>
        {r.notes && <p className="mt-0.5 text-xs text-slate-400">{r.notes}</p>}
      </div>

      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold capitalize ${statusBadge}`}>{r.status}</span>

      {isPM && r.status === "pending" && (
        <button disabled={busy} onClick={() => wrap(onWithdraw)} className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">Withdraw</button>
      )}
      {isOffice && onDelete && (
        <button disabled={busy} onClick={() => wrap(onDelete)} title="Delete request" className="shrink-0 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">Delete</button>
      )}
    </div>
  );
}

// ─── TaskForm (add/edit a project task) ──────────────────────────────────────

export function TaskForm({ form, setForm, tasks, editingTaskId, onSave, onCancel, onDelete }) {
  function updateField(field, value) { setForm((c) => ({ ...c, [field]: value })); }
  // Dependency options: every other NON-header task in this project.
  const depOptions = tasks.filter((t) => t.id !== editingTaskId && !t.is_header);
  // Header rows available as group parents.
  const headerOptions = tasks.filter((t) => t.is_header && t.id !== editingTaskId);
  const isHeader = !!form.isHeader;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{editingTaskId ? (isHeader ? "Edit Header" : "Edit Task") : (isHeader ? "Add Header" : "Add Task")}</h2>
            <p className="text-sm text-slate-500">{isHeader ? "A header groups tasks beneath it. Its bar spans its children." : "A task is a granular work item within this project."}</p>
          </div>
          <button onClick={onCancel} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button>
        </div>

        <div className="grid gap-4 p-5">
          <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 cursor-pointer hover:bg-slate-100">
            <input type="checkbox" className="h-4 w-4 rounded accent-emerald-600" checked={isHeader} onChange={(e) => updateField("isHeader", e.target.checked)} />
            <div>
              <p className="text-sm font-semibold text-slate-800">Header / group row</p>
              <p className="text-xs text-slate-500">Use this row to group tasks underneath it. No dates or dependency — its span comes from its children.</p>
            </div>
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">{isHeader ? "Header Name" : "Task Name"}</span>
            <input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.name} onChange={(e) => updateField("name", e.target.value)} placeholder={isHeader ? "e.g. Sitework" : "e.g. Form & Pour — Zone A"} />
          </label>

          {!isHeader && headerOptions.length > 0 && (
            <label className="space-y-1">
              <span className="text-sm font-medium text-slate-700">Group under (header)</span>
              <select className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.parentId} onChange={(e) => updateField("parentId", e.target.value)}>
                <option value="">None — top level</option>
                {headerOptions.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </label>
          )}

          {!isHeader && (
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Follows (dependency)</span>
            <select className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.dependsOn} onChange={(e) => updateField("dependsOn", e.target.value)}>
              <option value="">None — independent task</option>
              {depOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <span className="text-xs text-slate-500">If set and no start date is given, dates derive from the predecessor by type + lag.</span>
          </label>
          )}

          {!isHeader && form.dependsOn && (
            <div className="grid gap-4 md:grid-cols-[1fr_auto]">
              <label className="space-y-1">
                <span className="text-sm font-medium text-slate-700">Dependency Type</span>
                <select className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.dependencyType} onChange={(e) => updateField("dependencyType", e.target.value)}>
                  <option value="FS">Finish-to-Start (this starts after that finishes)</option>
                  <option value="SS">Start-to-Start (both start together)</option>
                  <option value="FF">Finish-to-Finish (both finish together)</option>
                  <option value="SF">Start-to-Finish (this finishes when that starts)</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium text-slate-700">Lag (days)</span>
                <input type="number" step="1" className="w-28 rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.dependencyLag} onChange={(e) => updateField("dependencyLag", e.target.value)} placeholder="0" />
                <span className="block text-xs text-slate-500">+ waits, − overlaps</span>
              </label>
            </div>
          )}

          {!isHeader && (<>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-1">
              <span className="text-sm font-medium text-slate-700">Start Date</span>
              <input type="date" className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.start} onChange={(e) => updateField("start", e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium text-slate-700">Duration (days)</span>
              <input type="number" min="1" className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.durationDays} onChange={(e) => updateField("durationDays", e.target.value)} placeholder="e.g. 5" />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium text-slate-700">End Date</span>
              <input type="date" className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.end} onChange={(e) => updateField("end", e.target.value)} />
            </label>
          </div>
          <p className="text-xs text-slate-500">Leave End blank to auto-fill from Start + Duration. End wins if both are given.</p>
          </>)}
        </div>

        <div className="flex justify-between gap-3 border-t border-slate-200 p-5">
          <div>{editingTaskId && <button onClick={() => onDelete(editingTaskId)} className="rounded-xl border border-red-200 px-4 py-2 font-semibold text-red-700 hover:bg-red-50">Delete Task</button>}</div>
          <div className="flex gap-3">
            <button onClick={onCancel} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={onSave} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800">{isHeader ? "Save Header" : "Save Task"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── TaskCrewRequestForm (request a crew TYPE across one or more tasks) ───────

export function TaskCrewRequestForm({ form, setForm, tasks, crewTypeOptions, onSave, onCancel, busy }) {
  function updateField(field, value) { setForm((c) => ({ ...c, [field]: value })); }
  function toggleType(t) {
    setForm((c) => {
      const cur = c.crewTypes || [];
      return { ...c, crewTypes: cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t] };
    });
  }
  function toggleTask(id) {
    setForm((c) => ({
      ...c,
      taskIds: c.taskIds.includes(id) ? c.taskIds.filter((x) => x !== id) : [...c.taskIds, id],
    }));
  }
  // Selecting a header toggles all of its child tasks at once. If every child
  // is already selected, it clears them; otherwise it selects them all.
  function toggleHeader(childIds) {
    setForm((c) => {
      const allSelected = childIds.length > 0 && childIds.every((id) => c.taskIds.includes(id));
      const set = new Set(c.taskIds);
      if (allSelected) childIds.forEach((id) => set.delete(id));
      else childIds.forEach((id) => set.add(id));
      return { ...c, taskIds: [...set] };
    });
  }
  // Build the same grouped/ordered view used by the Gantt: each header followed
  // by its children, then ungrouped tasks. Headers are display-only rows whose
  // checkbox controls their children.
  const orderedTaskRows = (() => {
    const headers = (tasks || []).filter((t) => t.is_header).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const rows = [];
    headers.forEach((h) => {
      const kids = (tasks || []).filter((c) => c.parent_id === h.id && !c.is_header).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      rows.push({ type: "header", task: h, childIds: kids.map((k) => k.id) });
      kids.forEach((k) => rows.push({ type: "task", task: k, depth: 1 }));
    });
    (tasks || []).filter((t) => !t.is_header && !t.parent_id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .forEach((t) => rows.push({ type: "task", task: t, depth: 0 }));
    return rows;
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Request Crew</h2>
            <p className="text-sm text-slate-500">Request a crew type for one or more tasks. The office assigns the actual crew.</p>
          </div>
          <button onClick={onCancel} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button>
        </div>

        <div className="grid gap-4 p-5 md:grid-cols-2">
          <div className="space-y-1 md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Crew Type(s) needed</span>
            <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              {(crewTypeOptions || []).length === 0 ? (
                <span className="text-xs text-slate-400">No crew types defined. Add them under Setup → Crews → Crew Type Settings.</span>
              ) : crewTypeOptions.map((t) => {
                const active = (form.crewTypes || []).includes(t);
                return (
                  <button key={t} type="button" onClick={() => toggleType(t)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${active ? "bg-emerald-700 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"}`}>
                    {t}
                  </button>
                );
              })}
            </div>
            <span className="text-xs text-slate-500">Select all types this crew must cover. We’ll match crews by these types.</span>
          </div>
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Men</span>
            <input type="number" min="0" className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.menCount} onChange={(e) => updateField("menCount", e.target.value)} placeholder="0" />
          </label>

          <div className="space-y-1 md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Labor Management Request</span>
            <div className="flex flex-wrap gap-2">
              {["None", "Super", "Field Coordinator", "Both"].map((opt) => {
                const active = (form.laborManagement || "None") === opt;
                return (
                  <button key={opt} type="button" onClick={() => updateField("laborManagement", opt)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${active ? "bg-emerald-700 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"}`}>
                    {opt}
                  </button>
                );
              })}
            </div>
            <span className="text-xs text-slate-500">Whether this crew also needs a superintendent and/or field coordinator. The office assigns the actual person.</span>
          </div>

          <div className="space-y-1 md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Tasks this crew is for</span>
            <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 p-2">
              {orderedTaskRows.length === 0 ? (
                <p className="p-2 text-sm text-slate-400">No tasks yet — add tasks first.</p>
              ) : orderedTaskRows.map((row) => {
                if (row.type === "header") {
                  const childIds = row.childIds;
                  const selectedCount = childIds.filter((id) => form.taskIds.includes(id)).length;
                  const allSelected = childIds.length > 0 && selectedCount === childIds.length;
                  const someSelected = selectedCount > 0 && !allSelected;
                  return (
                    <label key={row.task.id} className="flex cursor-pointer items-center gap-3 rounded-lg bg-slate-100 px-3 py-2 text-sm hover:bg-slate-200">
                      <input type="checkbox" className="h-4 w-4 accent-emerald-600"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected; }}
                        disabled={childIds.length === 0}
                        onChange={() => toggleHeader(childIds)} />
                      <span className="flex-1 font-extrabold uppercase tracking-wide text-slate-700">{row.task.name}</span>
                      <span className="rounded-full bg-slate-300 px-2 py-0.5 text-[10px] font-bold text-slate-700">HEADER · {childIds.length} task{childIds.length === 1 ? "" : "s"}</span>
                    </label>
                  );
                }
                const t = row.task;
                const checked = form.taskIds.includes(t.id);
                return (
                  <label key={t.id} className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-slate-50 ${checked ? "bg-emerald-50" : ""}`} style={{ paddingLeft: `${12 + (row.depth || 0) * 18}px` }}>
                    <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={checked} onChange={() => toggleTask(t.id)} />
                    <span className="flex-1 font-medium text-slate-800">{t.name}</span>
                    <span className="text-xs text-slate-400">
                      {t.start_date ? formatDate(t.start_date) : "—"}{t.end_date ? ` → ${formatDate(t.end_date)}` : ""}
                    </span>
                  </label>
                );
              })}
            </div>
            {form.taskIds.length > 1 && (
              <p className="text-xs text-emerald-700">This crew will be requested for {form.taskIds.length} tasks — they’ll all show on the request.</p>
            )}
          </div>

          <label className="space-y-1 md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Notes</span>
            <input className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" value={form.notes} onChange={(e) => updateField("notes", e.target.value)} placeholder="Anything the office should know" />
          </label>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 p-5">
          <button onClick={onCancel} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button onClick={onSave} disabled={busy} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-300">{busy ? "Sending…" : "Submit Request"}</button>
        </div>
      </div>
    </div>
  );
}

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

  // resourceType may be a single type string or an array of accepted
  // types (e.g. Superintendent + General Superintendent share one slot).
  const typeMatches = (r) => {
    if (!resourceType) return true;
    return Array.isArray(resourceType)
      ? resourceType.includes(r.resourceType)
      : r.resourceType === resourceType;
  };
  const filtered = resources.filter(
    (r) => typeMatches(r) && r.name.toLowerCase().includes(query.toLowerCase())
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

export function ProjectForm({ form, setForm, onSave, onCancel, onDelete, editing, certifications, projectTypes, pmProfiles = [], canEditPMs = false }) {
  function updateField(field, value) { setForm((c) => ({ ...c, [field]: value })); }
  function togglePm(id) {
    setForm((c) => {
      const cur = c.pmIds || [];
      return { ...c, pmIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
    });
  }

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
          <div className="md:col-span-2 space-y-1">
            <span className="text-sm font-medium text-slate-700">Project Managers</span>
            <p className="text-xs text-slate-500">{canEditPMs ? "Managers assigned here see this project in the Scheduling tool. Admins always see every project." : "Only an admin can change project managers."}</p>
            <div className="mt-1 flex flex-wrap gap-2 rounded-xl border border-slate-300 p-3">
              {pmProfiles.length === 0 && <span className="text-sm text-slate-400">No manager/admin users available.</span>}
              {pmProfiles.map((p) => {
                const on = (form.pmIds || []).includes(p.id);
                return (
                  <button type="button" key={p.id} disabled={!canEditPMs}
                    onClick={() => togglePm(p.id)}
                    className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${on ? "bg-emerald-700 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"} ${!canEditPMs ? "cursor-not-allowed opacity-60" : ""}`}>
                    {p.pmName}{p.role === "admin" ? " (admin)" : ""}
                  </button>
                );
              })}
            </div>
          </div>
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

export function AssignmentForm({ form, setForm, onSave, onCancel, onDelete, editing, resources, projects, crews, tasks }) {
  function updateField(field, value) { setForm((c) => ({ ...c, [field]: value })); }

  // Mobilizations whose end date is in the past start collapsed automatically.
  // Users can still expand/collapse any mobilization manually.
  const todayMidnight = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
  const isMobPassed = (mob) => { const e = mob && mob.end ? toDate(mob.end) : null; return !!(e && e < todayMidnight); };
  const [collapsedMobs, setCollapsedMobs] = useState({});
  const [mobCollapseInit, setMobCollapseInit] = useState(false);
  useEffect(() => {
    if (mobCollapseInit) return;
    const init = {};
    (form.mobilizations || []).forEach((m) => { if (isMobPassed(m)) init[m.id] = true; });
    setCollapsedMobs(init);
    setMobCollapseInit(true);
  }, [form.mobilizations, mobCollapseInit]);
  const toggleMobCollapse = (id) => setCollapsedMobs((c) => ({ ...c, [id]: !c[id] }));

  // Calculate end date by adding `durationWeeks` work weeks to `startDate`,
  // following GGC's specific rules:
  //
  //   - Work weeks are Mon–Fri (no weekends).
  //   - The end date is always a FRIDAY.
  //   - First-week rounding depends on which weekday the start is:
  //       Mon                 → end on Friday of SAME week
  //       Tue, Wed            → end on Friday of SAME week
  //       Thu, Fri            → end on Friday of NEXT week (a full week ahead)
  //       Sat, Sun            → treated as the following Monday
  //   - Each additional week adds 7 calendar days (the next Friday).
  //
  // Examples:
  //   Mon + 1 wk → Fri same week    (5 days)
  //   Mon + 2 wk → Fri week 2       (12 days)
  //   Wed + 1 wk → Fri same week    (3 days)
  //   Thu + 1 wk → Fri NEXT week    (8 days)
  //   Fri + 2 wk → Fri 2 weeks out  (14 days)
  function calculateEndDateFromWeeks(startDate, durationWeeks) {
    if (!startDate || durationWeeks === "" || durationWeeks === null || durationWeeks === undefined) return "";
    const start = toDate(startDate);
    const weeks = parseFloat(durationWeeks);
    if (!start || isNaN(weeks) || weeks <= 0) return "";

    // getDay(): Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6.
    const dow = start.getDay();

    // Step 1: figure out the Friday for the FIRST week.
    let firstFriday = new Date(start);
    if (dow === 0) {
      // Sunday → treat as following Monday → Friday is +5 days.
      firstFriday.setDate(firstFriday.getDate() + 5);
    } else if (dow === 6) {
      // Saturday → treat as following Monday → Friday is +6 days.
      firstFriday.setDate(firstFriday.getDate() + 6);
    } else if (dow >= 1 && dow <= 3) {
      // Mon, Tue, Wed → Friday of the same week.
      firstFriday.setDate(firstFriday.getDate() + (5 - dow));
    } else if (dow === 4 || dow === 5) {
      // Thu, Fri → Friday of NEXT week (skip ahead a full week from same-week Fri).
      firstFriday.setDate(firstFriday.getDate() + (5 - dow) + 7);
    }

    // Step 2: each additional week pushes the Friday forward by 7 days.
    const additionalWeeks = Math.max(0, Math.round(weeks) - 1);
    const end = new Date(firstFriday);
    end.setDate(end.getDate() + additionalWeeks * 7);

    // Format as YYYY-MM-DD in LOCAL time to avoid timezone drift turning
    // Friday into Thursday on the saved record.
    const yyyy = end.getFullYear();
    const mm = String(end.getMonth() + 1).padStart(2, "0");
    const dd = String(end.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
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

  // Which project task(s) a mobilization is for.
  function toggleMobilizationTask(mobId, taskId) {
    setForm((c) => ({
      ...c,
      mobilizations: (c.mobilizations || []).map((mob) => {
        if (mob.id !== mobId) return mob;
        const cur = Array.isArray(mob.taskIds) ? mob.taskIds : [];
        return { ...mob, taskIds: cur.includes(taskId) ? cur.filter((x) => x !== taskId) : [...cur, taskId] };
      }),
    }));
  }

  function addMobilization() {
    setForm((c) => ({
      ...c,
      mobilizations: [...(c.mobilizations || []), {
        id: crypto.randomUUID(), start: "", durationWeeks: "", end: "",
        superintendent: "", fieldCoordinator: "", crewIds: [], crewMenCounts: {}, crewOnly: false, unassignedNeeds: [], taskIds: [],
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
                <div key={mob.id} className={`rounded-xl border p-4 space-y-3 ${isMobPassed(mob) ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-white"}`}>
                  {/* Header row — click to collapse/expand */}
                  <div className="flex items-center justify-between">
                    <button type="button" onClick={() => toggleMobCollapse(mob.id)} className="flex items-center gap-2 text-left">
                      <span className="text-xs">{collapsedMobs[mob.id] ? "▸" : "▾"}</span>
                      <span className="font-semibold text-slate-700">Mobilization #{index + 1}</span>
                      {isMobPassed(mob) && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">PAST</span>}
                      {collapsedMobs[mob.id] && (
                        <span className="text-xs font-normal text-slate-500">
                          {mob.start ? formatDate(mob.start) : "?"}{mob.end ? ` → ${formatDate(mob.end)}` : ""}
                          {(mob.crewIds || []).filter(Boolean).length ? ` · ${(mob.crewIds || []).filter(Boolean).length} crew` : ""}
                          {mob.superintendent ? ` · ${mob.superintendent}` : ""}
                        </span>
                      )}
                    </button>
                    {(form.mobilizations || []).length > 1 && (
                      <button type="button" onClick={() => removeMobilization(mob.id)} className="rounded-lg border border-red-200 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50">Remove</button>
                    )}
                  </div>
                  {!collapsedMobs[mob.id] && (<>

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

                  {/* Which task(s) this mobilization is for */}
                  {(tasks || []).length > 0 && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Task(s) for this mobilization</p>
                      <div className="flex flex-wrap gap-2">
                        {tasks.map((t) => {
                          const active = (mob.taskIds || []).includes(t.id);
                          return (
                            <button key={`${mob.id}-task-${t.id}`} type="button" onClick={() => toggleMobilizationTask(mob.id, t.id)}
                              className={`rounded-full px-3 py-1 text-xs font-semibold ${active ? "bg-emerald-700 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"}`}>
                              {t.name}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-xs text-slate-400">Tagging tasks shows this crew/super on the task schedule.</p>
                    </div>
                  )}

                  {/* Per-mob roles — hidden if crew-only */}
                  {!mob.crewOnly && (
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-slate-600">Superintendent</span>
                        <SearchableResourceSelect value={mob.superintendent || ""} onChange={(v) => updateMobilization(mob.id, "superintendent", v)} resources={resources} resourceType={["Superintendent", "General Superintendent"]} placeholder="Search superintendent / general super..." />
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
                  </>)}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 p-5">
          {/* Delete sits on its own on the left so it can't be confused with
              Save/Cancel. Only appears when editing an existing assignment. */}
          <div>
            {editing && onDelete && (
              <button
                onClick={onDelete}
                className="rounded-xl border border-red-200 bg-white px-4 py-2 font-semibold text-red-700 hover:bg-red-50"
                title="Delete this assignment and all its mobilizations"
              >
                Delete Assignment
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={onCancel} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={onSave} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800">Save Assignment</button>
          </div>
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

export function CrewForm({ form, setForm, certifications, crewTypes, onSave, onCancel, onDelete, editing }) {
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
            <span className="text-sm font-medium text-slate-700">Crew Type</span>
            <CertificationPicker selected={form.crewType || []} onChange={(v) => updateField("crewType", v)} certifications={crewTypes || []} />
            <span className="text-xs text-slate-500">What kind of work this crew does. Used to match crew requests.</span>
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
  const todayLeft = getTodayLeftPx(timeline);
  return (
    <div
      className="sticky top-0 z-40 flex border-b border-slate-200 bg-white pb-2"
      style={{ width: `${timeline.width + 260}px` }}
    >
      <div className="sticky left-0 z-30 h-10 w-[320px] shrink-0 bg-white" />
      <div className="relative h-10" style={{ width: `${timeline.width}px` }}>
        {todayLeft >= 0 && (
          <div
            className="absolute top-0 z-20 h-10 border-l-2 border-dashed border-red-600"
            style={{ left: `${todayLeft}px` }}
          >
            <span className="ml-1 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">Today</span>
          </div>
        )}
        {timeline.ticks.map((tick, index) => {
          const left = timelinePixelOffset(tick, timeline);
          return (
            <div
              key={`${tick.toISOString()}-${index}`}
              className="absolute top-0 h-10 border-l border-slate-200 pl-2 text-xs font-medium text-slate-500"
              style={{ left: `${left}px` }}
            >
              {formatTick(tick, zoom)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── GanttBackdrop ───────────────────────────────────────────────────────────
//
// Renders the chart-wide background layer that sits BEHIND the rows:
//   - Vertical Today line that runs the full height of all rows
//   - Weekend shading (Days & Weeks zoom only)
//   - Tick gridlines (faint vertical lines at each major tick)
//
// Pointer events are disabled so clicks pass through to the row content.
// The parent row container should be `relative` so this can position itself
// absolutely inside it.

export function GanttBackdrop({ timeline }) {
  const weekendBands = getWeekendBands(timeline);
  const todayLeft = getTodayLeftPx(timeline);
  return (
    <div
      className="pointer-events-none absolute inset-y-0 z-0"
      style={{ left: 0, width: `${timeline.width}px` }}
    >
      {/* Weekend shading — Sat/Sun only at Days/Weeks zoom */}
      {weekendBands.map((band, i) => (
        <div
          key={`weekend-${i}`}
          className="absolute inset-y-0 bg-slate-200/50"
          style={{ left: `${band.leftPx}px`, width: `${band.widthPx}px` }}
        />
      ))}
      {/* Faint vertical gridlines at each tick */}
      {timeline.ticks.map((tick, i) => {
        const left = timelinePixelOffset(tick, timeline);
        return (
          <div
            key={`grid-${i}`}
            className="absolute inset-y-0 w-px bg-slate-200"
            style={{ left: `${left}px` }}
          />
        );
      })}
      {/* Today line — full chart height */}
      {todayLeft >= 0 && (
        <div
          className="absolute inset-y-0 z-10 border-l-2 border-dashed border-red-600"
          style={{ left: `${todayLeft}px` }}
        />
      )}
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
  const { left, width } = timelineSpanPixels(item.start, item.end, timeline);
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

  // If the bar starts to the LEFT of the visible chart area (because it
  // started in the past), shift the label inward so it stays visible.
  // The bar itself extends back to its true start position; only the label
  // text is pulled into view. Once the bar exits the chart on the right,
  // the whole thing disappears.
  const labelOffset = left < 0 ? -left + 6 : 0;

  // When zoomed out, the bar may be too narrow to contain its label. Allow
  // the label to overflow OUTSIDE the bar's right edge so it stays visible.
  // The bar itself uses overflow-visible; later bars in the same row paint
  // over earlier bars' overflowed labels (so conflicts hide cleanly). The
  // visible bar background still ends at the bar's true width.
  // Skip external labels for unassigned-need bars — the hatched pattern
  // already conveys the unassigned state, and rendering text on top of
  // the hatched pattern reads as visual noise.
  const tooNarrow = width < 70 && !isUnassigned;

  return (
    <div
      className={`absolute top-0 h-7 rounded-md ${colorClass} text-[11px] font-semibold leading-7 shadow-sm ${isUnassigned ? "text-slate-900" : "text-white"} ${tooNarrow ? "overflow-visible" : "overflow-hidden px-2.5"}`}
      style={{ left: `${left}px`, width: `${width}px`, ...patternStyle, ...conflictStyle }}
      title={tooltip}
    >
      {tooNarrow ? (
        <span
          className="pointer-events-none absolute left-full top-0 ml-1 whitespace-nowrap rounded bg-white/95 px-1.5 leading-7 text-slate-700 shadow-sm"
        >{label || "Unassigned"}</span>
      ) : (
        <>
          <span
            className={conflict ? "rounded bg-white/90 px-1.5 py-0.5 font-bold text-red-700" : ""}
            style={labelOffset ? { paddingLeft: `${labelOffset}px` } : undefined}
          >{label || "Unassigned"}</span>
          {conflict && <span className="ml-2 rounded bg-red-600 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-white">conflict</span>}
        </>
      )}
    </div>
  );
}

// ─── PtoOverlayBar ────────────────────────────────────────────────────────────

export function PtoOverlayBar({ pto, timeline }) {
  const start = toDate(pto.start);
  const end = toDate(pto.end);
  if (!start || !end || !rangesOverlap(start, addDays(end, 1), timeline.minDate, addDays(timeline.maxDate, 1))) return null;
  const { left, width } = timelineSpanPixels(start, end, timeline);
  return (
    <div
      className="absolute top-0 z-20 h-8 overflow-hidden rounded-md border-2 border-black bg-white/70 px-2.5 text-[11px] font-bold leading-7 text-black shadow"
      style={{ left: `${left}px`, width: `${width}px`, backgroundImage: "repeating-linear-gradient(135deg, transparent 0 8px, rgba(0,0,0,.95) 8px 10px)", backgroundSize: "14px 14px" }}
      title={`PTO ${pto.ptoId || ""}: ${formatDate(pto.start)} - ${formatDate(pto.end)}`}
    >
      PTO {pto.ptoId || ""}
    </div>
  );
}

// ─── DraggableGanttBar ────────────────────────────────────────────────────────
//
// Wraps GanttSegmentBar with drag handles that let the user adjust a
// mobilization's start, end, or both by dragging in the timeline. Used only
// on the Project Assignment Gantt — Resource and Crew Gantts use the plain
// non-draggable GanttSegmentBar.
//
// Drag modes:
//   - Left edge (6px hot zone): drag = adjust start date
//   - Right edge (6px hot zone): drag = adjust end date
//   - Middle: drag = shift both dates by the same amount
//
// Snap: whole days (`Math.round`).
// Save: NOT automatic. On mouseup, calls `onDragEnd({mobilizationId, newStart,
// newEnd})` and the parent shows a Save/Cancel confirmation dialog. Until
// the parent confirms, the visual position is reverted by re-render.
//
// Skipped for: unassigned-need placeholders (no mobilization ID) and items
// whose `id` doesn't correspond to a real DB mobilization. Falls back to a
// plain GanttSegmentBar in those cases.

export function DraggableGanttBar({ item, timeline, label, fullLabel, showLabel = true, laneTop = 0, onDragEnd }) {
  // Drag is enabled whenever a callback is provided and we have a real
  // mobilization id to write back to. Unassigned-need bars ARE draggable now —
  // dragging one moves the underlying mobilization it was synthesized from.
  if (!onDragEnd || !item.mobilizationId) {
    return <GanttSegmentBar item={item} timeline={timeline} label={label} />;
  }

  const project = item.project;

  // Per-mobilization crew presence. getAssignmentCrewIds prefers the
  // mob-level _crewIds array that buildGanttItems sets, so this is scoped
  // to THIS mobilization, not the whole assignment.
  const mobCrewIds = getAssignmentCrewIds(item.assignment || {});
  const hasSuper = !!(item.assignment?.superintendent && String(item.assignment.superintendent).trim());
  // "Needs crew": a normal (non crew-only) mob that has a superintendent
  // but no crew assigned on this mobilization. Rendered with border + dark
  // square hatch and NO division fill, so it reads as "staffed but missing
  // a crew" — the visual inverse of a crew-only bar (which keeps its fill).
  const needsCrew = !item.isCrewOnly && hasSuper && mobCrewIds.length === 0;
  const isUnassigned = !!item.isUnassignedNeed;
  // Division to color an unassigned-need bar by (the need's own division).
  const unassignedDiv = item.unassignedDivision || project.division;

  const colorClass = isUnassigned
    ? (pendingDivisionStyles[unassignedDiv] || "bg-slate-300")
    : needsCrew
      ? "bg-transparent"
      : project.status === "Pending Award"
        ? pendingDivisionStyles[project.division] || "bg-slate-300"
        : divisionStyles[project.division] || "bg-slate-700";

  const [dragState, setDragState] = React.useState(null); // null | {mode, startPxX, origStart, origEnd, currStart, currEnd}
  const containerRef = React.useRef(null);

  // Pixels per day from the new pixel-based timeline.
  const pxPerDay = timeline.pxPerDay || 1;

  // Use the dragState dates if dragging; otherwise the live item dates.
  const effectiveStart = dragState ? dragState.currStart : item.start;
  const effectiveEnd   = dragState ? dragState.currEnd   : item.end;
  const { left, width } = timelineSpanPixels(effectiveStart, effectiveEnd, timeline);

  function onPointerDown(mode, e) {
    e.preventDefault();
    e.stopPropagation();
    const startPxX = e.clientX;
    setDragState({
      mode,
      startPxX,
      pointerId: e.pointerId,
      origStart: item.start,
      origEnd: item.end,
      currStart: item.start,
      currEnd: item.end,
    });

    // ALWAYS capture on the root container (which owns onPointerMove/Up),
    // never on the small edge-handle children. This makes middle-drag and
    // edge-drag behave identically — move/up events route to the root.
    containerRef.current?.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    if (!dragState) return;
    const dx = e.clientX - dragState.startPxX;
    const dayDelta = Math.round(dx / pxPerDay);

    const origStartDate = toDate(dragState.origStart);
    const origEndDate   = toDate(dragState.origEnd);
    if (!origStartDate || !origEndDate) return;

    let newStartDate, newEndDate;
    if (dragState.mode === "left") {
      newStartDate = addDays(origStartDate, dayDelta);
      newEndDate   = origEndDate;
      // Don't allow start to cross end (would invert the bar).
      if (newStartDate >= origEndDate) newStartDate = addDays(origEndDate, -1);
    } else if (dragState.mode === "right") {
      newStartDate = origStartDate;
      newEndDate   = addDays(origEndDate, dayDelta);
      if (newEndDate <= origStartDate) newEndDate = addDays(origStartDate, 1);
    } else {
      // Middle: shift both equally.
      newStartDate = addDays(origStartDate, dayDelta);
      newEndDate   = addDays(origEndDate, dayDelta);
    }

    setDragState({
      ...dragState,
      currStart: toIsoDate(newStartDate),
      currEnd: toIsoDate(newEndDate),
    });
  }

  function onPointerUp(e) {
    if (!dragState) return;
    containerRef.current?.releasePointerCapture?.(dragState.pointerId ?? e.pointerId);
    const moved = dragState.currStart !== dragState.origStart || dragState.currEnd !== dragState.origEnd;
    const finalState = { ...dragState };
    setDragState(null);

    if (!moved) return; // click without drag — do nothing

    onDragEnd({
      mobilizationId: item.mobilizationId,
      assignmentId: item.assignment?.id,
      itemId: item.id,
      origStart: finalState.origStart,
      origEnd: finalState.origEnd,
      newStart: finalState.currStart,
      newEnd: finalState.currEnd,
      project,
      label,
    });
  }

  // Square-hatch overlay for crew-only mobs. Keeps the division color as
  // the bar background and lays a checker pattern on top so the user can
  // tell at a glance that the mobilization has no named roles, just crews.
  const crewOnlyOverlayStyle = item.isCrewOnly ? {
    backgroundImage: "repeating-linear-gradient(0deg, transparent 0 6px, rgba(255,255,255,0.35) 6px 8px), repeating-linear-gradient(90deg, transparent 0 6px, rgba(255,255,255,0.35) 6px 8px)",
    backgroundSize: "14px 14px, 14px 14px",
  } : null;

  // Super-but-no-crew: transparent fill + division-colored border + dark
  // square hatch. Uses the division SVG color so the border/hatch still
  // reads as the right division. Falls back to slate.
  const needsCrewColor = divisionSvgColors[project.division] || "#475569";
  const needsCrewOverlayStyle = needsCrew ? {
    border: `2px solid ${needsCrewColor}`,
    backgroundColor: "transparent",
    backgroundImage: `repeating-linear-gradient(0deg, transparent 0 6px, ${needsCrewColor}59 6px 8px), repeating-linear-gradient(90deg, transparent 0 6px, ${needsCrewColor}59 6px 8px)`,
    backgroundSize: "14px 14px, 14px 14px",
  } : null;

  // Unassigned-need bar keeps the diagonal hatch + dark outline so it still
  // reads as a placeholder, even though it's now draggable.
  const unassignedOverlayStyle = isUnassigned ? {
    border: "2px solid #111827",
    backgroundImage: "repeating-linear-gradient(135deg, rgba(17,24,39,.35) 0 2px, transparent 2px 9px)",
    backgroundSize: "14px 14px",
  } : null;

  return (
    <div
      ref={containerRef}
      className={`absolute h-7 overflow-visible rounded-md ${colorClass} text-[11px] font-semibold leading-7 shadow-sm ${(needsCrew || isUnassigned) ? "text-slate-900" : "text-white"} ${dragState ? "ring-2 ring-emerald-400 ring-offset-1" : ""}`}
      style={{ left: `${left}px`, top: `${laneTop}px`, width: `${width}px`, cursor: dragState?.mode === "middle" ? "grabbing" : "grab", touchAction: "none", ...(crewOnlyOverlayStyle || {}), ...(needsCrewOverlayStyle || {}), ...(unassignedOverlayStyle || {}) }}
      onPointerDown={(e) => onPointerDown("middle", e)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      title={
        (fullLabel ? `${fullLabel}\n` : "") + (
          item.isCrewOnly
            ? `${formatDate(effectiveStart)} - ${formatDate(effectiveEnd)}\nCrew-only mobilization (no named roles)\nDrag bar to shift • Drag edges to resize`
            : needsCrew
              ? `${formatDate(effectiveStart)} - ${formatDate(effectiveEnd)}\nSuperintendent assigned • NO CREW on this mobilization\nDrag bar to shift • Drag edges to resize`
              : `${formatDate(effectiveStart)} - ${formatDate(effectiveEnd)}\nDrag bar to shift • Drag edges to resize`
        )
      }
    >
      {/* Left edge handle — narrower so the bar's middle has a bigger hit
          zone. Visible on hover so the user knows it's grabbable. */}
      <div
        onPointerDown={(e) => onPointerDown("left", e)}
        className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-ew-resize hover:bg-white/40 hover:w-2 transition-all"
      />
      {/* Right edge handle */}
      <div
        onPointerDown={(e) => onPointerDown("right", e)}
        className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-ew-resize hover:bg-white/40 hover:w-2 transition-all"
      />
      {/* Bar label (overflow hidden so long labels don't escape).
          When the bar starts to the LEFT of the visible area, push the
          label inward so it remains readable until the bar exits right.
          When the bar is too narrow, render the label OUTSIDE on the right. */}
      {/* Mobilization boundary markers — a thin vertical line at the start
          and end edges of this mobilization so a mid-run change (e.g. a crew
          added partway through a project) is visible as a divider where the
          new mobilization begins. Sits above the fill, below the label. */}
      <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-px bg-slate-900/40" />
      <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-px bg-slate-900/40" />
      {/* On-bar label — only shown when the parent decided it FITS inside
          the bar (showLabel). Otherwise the label is rendered in a stacked
          row beneath the bar by ProjectGanttRow, so we render nothing here
          and let that below-row + leader line carry it. Clipped to the bar. */}
      {showLabel && (
        <span
          className="pointer-events-none absolute inset-y-0 right-0 z-20 overflow-hidden whitespace-nowrap px-2.5 leading-7"
          style={{
            // When the bar starts before the visible window (left < 0), the
            // bar's own left edge is off-screen. Push the label's left start
            // in by -left so the text begins at TODAY (the visible edge)
            // instead of scrolling out of view. Otherwise sit at the edge.
            left: left < 0 ? `${-left}px` : 0,
          }}
        >
          {label || "Unassigned"}
        </span>
      )}
      {/* Live tooltip while dragging — positions above the bar */}
      {dragState && (
        <div className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white shadow-lg">
          {formatDate(effectiveStart)} → {formatDate(effectiveEnd)}
        </div>
      )}
    </div>
  );
}

// Tiny helper: Date → ISO YYYY-MM-DD. Uses local timezone to avoid the
// classic "saved date is one day earlier" timezone bug. addDays is already
// defined in the imports.
function toIsoDate(d) {
  if (!d) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ─── ProjectGanttRow ──────────────────────────────────────────────────────────

// Approx pixel width of a bar label at the 11px semibold gantt font. Used to
// decide whether a label fits inside its bar; if not, it drops to a label
// row beneath the bar with a leader line pointing to where it belongs.
const GANTT_LABEL_PX_PER_CHAR = 6.2;
function estimateLabelWidthPx(label) {
  return Math.ceil(String(label || "").length * GANTT_LABEL_PX_PER_CHAR) + 16;
}

// Build the on-bar (abbreviated) and hover (full) labels for one item.
function buildItemLabels(item, crews) {
  if (item.isUnassignedNeed) {
    return {
      label: `${item.unassignedAbbreviation} - Unassigned`,
      fullLabel: `${item.unassignedDivision || item.unassignedAbbreviation} - Unassigned`,
    };
  }
  if (item.isCrewOnly) {
    const crewNamesAbbr = getAssignmentCrewIds(item.assignment)
      .map((id) => crews.find((c) => c.id === id))
      .filter(Boolean)
      .map((crew) => buildCrewChunk(crew, item.assignment, { abbreviate: true }));
    const crewNamesFull = getAssignmentCrewDisplayNames(item.assignment, crews);
    return {
      label: crewNamesAbbr.length ? `Crew Only · ${crewNamesAbbr.join(", ")}` : "Crew Only",
      fullLabel: crewNamesFull.length ? `Crew Only · ${crewNamesFull.join(", ")}` : "Crew Only",
    };
  }
  return {
    label: buildGanttBarLabel(item.assignment, crews),
    fullLabel: buildGanttBarFullLabel(item.assignment, crews),
  };
}

// Heights for the single-track project row + stacked below-label rows.
const GANTT_BAR_PX = 28;        // the one bar track
const GANTT_BELOW_ROW_PX = 22;  // each stacked label-below row

export function ProjectGanttRow({ assignment, project, items, timeline, crews, onDragEnd, onLabelClick }) {
  // ONE bar per project row. Every mobilization bar sits on the same track.
  // For each bar we decide whether its label fits inside the bar width; if
  // it does, the label rides on the bar. If it does NOT fit, the label drops
  // to a row beneath the bar with a leader line pointing up to the bar's
  // left edge. Multiple non-fitting labels stack on successive below-rows so
  // they never overlap each other.
  // Step 1 — pack BARS into lanes ONLY when they overlap in time. A bar that
  // doesn't time-overlap anything already placed stays in lane 0. This is the
  // same greedy date-overlap packing the Crew Gantt uses, so two assignments
  // running at the same time (e.g. two superintendents) get separate lanes and
  // are both visible, while sequential mobs share one lane.
  const byStart = [...items].sort((a, b) => {
    const as = toDate(a.start)?.getTime() ?? 0;
    const bs = toDate(b.start)?.getTime() ?? 0;
    return as - bs;
  });
  // Lanes are driven ONLY by real mobilization bars. Unassigned-need
  // placeholders share a mob's exact dates, so they must NOT count as an
  // overlap that forces a new lane — instead they inherit the lane of the
  // mobilization they were synthesized from (matched by mobilizationId, then
  // by identical start/end). This keeps the hatched unassigned bar in the
  // SAME lane as its mob rather than breaking it onto a new row.
  const laneEnds = []; // last end-date (ms) currently occupying each lane
  const laneOf = new Map();
  const laneByMobId = new Map();
  const realBars = byStart.filter((it) => !it.isUnassignedNeed);
  realBars.forEach((item) => {
    const s = toDate(item.start);
    const e = toDate(item.end);
    const sMs = s ? s.getTime() : 0;
    const eMs = e ? e.getTime() : sMs;
    let lane = laneEnds.findIndex((end) => sMs > end);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(eMs); }
    else { laneEnds[lane] = Math.max(laneEnds[lane], eMs); }
    laneOf.set(item.id, lane);
    if (item.mobilizationId != null) laneByMobId.set(item.mobilizationId, lane);
  });
  // Unassigned placeholders adopt their parent mob's lane (fallback: lane 0).
  byStart.filter((it) => it.isUnassignedNeed).forEach((item) => {
    const lane = (item.mobilizationId != null && laneByMobId.has(item.mobilizationId))
      ? laneByMobId.get(item.mobilizationId)
      : 0;
    laneOf.set(item.id, lane);
  });
  const barLaneCount = Math.max(1, laneEnds.length);

  // Step 2 — per bar, decide whether its label fits on the bar. Past-start
  // bars (negative left, i.e. started before the visible window) KEEP their
  // label on the bar — we just clip it. A label only goes below when its bar
  // is genuinely too narrow to show it.
  const prepared = byStart.map((item) => {
    const labels = buildItemLabels(item, crews);
    const span = timelineSpanPixels(item.start, item.end, timeline);
    const labelW = estimateLabelWidthPx(labels.label);
    const lane = laneOf.get(item.id) || 0;
    // Visible width of the bar within the chart (clip the off-screen-left part).
    const visibleWidth = span.left < 0 ? span.width + span.left : span.width;
    const fits = visibleWidth >= labelW;
    return { item, labels, span, lane, fits };
  });

  // Step 3 — labels that DON'T fit drop below. Stack them onto below-rows
  // ONLY when they would collide horizontally with one already placed on a
  // row; otherwise they share a row. Ordered by left edge so leaders don't
  // cross. Each below label reserves [leftPx, leftPx + labelWidth].
  const belowItems = prepared.filter((p) => !p.fits).sort((a, b) => a.span.left - b.span.left);
  const belowRowRights = []; // right px currently filled in each below-row
  belowItems.forEach((p) => {
    const startPx = Math.max(0, p.span.left);
    const endPx = startPx + estimateLabelWidthPx(p.labels.label) + 14; // +leader stub
    let row = belowRowRights.findIndex((r) => startPx >= r + 8);
    if (row === -1) { row = belowRowRights.length; belowRowRights.push(endPx); }
    else { belowRowRights[row] = endPx; }
    p.belowRow = row;
  });
  const belowRowCount = belowRowRights.length;

  const barsHeight = barLaneCount * GANTT_BAR_PX;
  const rowHeight = barsHeight + belowRowCount * GANTT_BELOW_ROW_PX + (belowRowCount ? 6 : 0);

  return (
    <div className="grid grid-cols-[320px_1fr] items-start gap-0">
      <button
        onClick={onLabelClick}
        className="sticky left-0 z-20 bg-white pr-3 text-left hover:bg-slate-50 overflow-hidden flex items-start pt-1"
        style={{ height: `${rowHeight}px` }}
      >
        <div className="flex items-center gap-2">
          <span className={`shrink-0 h-2.5 w-2.5 rounded-full ${project.status === "Pending Award" ? pendingDivisionStyles[project.division] : divisionStyles[project.division] || "bg-slate-600"}`} />
          <p className="truncate text-[12px] font-semibold text-slate-900 hover:text-emerald-700">
            {project.projectNumber ? `${project.projectNumber} - ` : ""}{project.name}
          </p>
        </div>
      </button>
      <div className="relative rounded-md" style={{ width: `${timeline.width}px`, height: `${rowHeight}px` }}>
        {/* Bars — one lane per time-overlap group */}
        {prepared.map((p) => (
          <DraggableGanttBar
            key={p.item.id}
            item={p.item}
            timeline={timeline}
            label={p.labels.label}
            fullLabel={p.labels.fullLabel}
            showLabel={p.fits}
            laneTop={p.lane * GANTT_BAR_PX}
            onDragEnd={onDragEnd}
          />
        ))}
        {/* Stacked label rows below the bars, each with a leader line up to
            the bar segment it describes. */}
        {belowItems.map((p) => {
          const barLeft = Math.max(0, p.span.left);
          const rowTop = barsHeight + 6 + p.belowRow * GANTT_BELOW_ROW_PX;
          return (
            <div key={`below-${p.item.id}`}>
              <div
                className="pointer-events-none absolute z-10 border-l border-slate-400"
                style={{ left: `${barLeft}px`, top: `${barsHeight}px`, height: `${rowTop - barsHeight + 8}px` }}
              />
              <div
                className="pointer-events-none absolute z-10 border-t border-slate-400"
                style={{ left: `${barLeft}px`, top: `${rowTop + 8}px`, width: "10px" }}
              />
              <span
                className="pointer-events-auto absolute z-10 whitespace-nowrap rounded bg-white px-1.5 text-[11px] font-semibold leading-[18px] text-slate-700 shadow-sm ring-1 ring-slate-200"
                style={{ left: `${barLeft + 12}px`, top: `${rowTop}px` }}
                title={p.labels.fullLabel}
              >
                {p.labels.label}
              </span>
            </div>
          );
        })}
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
    <div className="grid grid-cols-[320px_1fr] items-center gap-0 h-7">
      <div className="sticky left-0 z-20 h-7 bg-white pr-3 text-left overflow-hidden">
        <button onClick={() => onResourceClick?.(resource)} className="block w-full truncate text-left text-[12px] font-semibold text-slate-900 hover:text-emerald-700" title={`${resource.name} — ${resource.resourceType} • ${resource.homeDivision} • ${items.length} assignment${items.length === 1 ? "" : "s"}${ptoItems.length ? ` • ${ptoItems.length} PTO` : ""}`}>{resource.name}</button>
      </div>
      <div className="relative h-7 rounded-md" style={{ width: `${timeline.width}px` }}>
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

  return (
    <div className="grid grid-cols-[320px_1fr] items-center gap-0 h-7">
      <div className="sticky left-0 z-20 h-7 bg-white pr-3 text-left overflow-hidden">
        <p className="truncate text-[12px] font-semibold text-amber-800" title={`${resource.name} — ${resource.homeDivision} unassigned need${resource.projectLabel ? ` · ${resource.projectLabel}` : ""}`}>{resource.name}</p>
        {resource.projectLabel && <p className="truncate text-[10px] text-slate-500 leading-tight">{resource.projectLabel}</p>}
      </div>
      <div className="relative h-7 rounded-md" style={{ width: `${timeline.width}px` }}>
        {sortedItems.map((item) => (
          <GanttSegmentBar
            key={`${resource.id}-${item.id}`}
            item={item}
            timeline={timeline}
            label={`${item.unassignedAbbreviation} - Unassigned`}
          />
        ))}
      </div>
    </div>
  );
}

// ─── ReverseProjectGanttRow ─────────────────────────────────────────────────
// Used by the reversed Resource Gantt: one row per PROJECT, bars labeled with
// the resource(s) of the filtered title assigned to it (or "Unassigned").
export function ReverseProjectGanttRow({ row, timeline, striped, unassigned, onClick }) {
  const sortedItems = [...(row.items || [])].sort((a, b) => new Date(a.start) - new Date(b.start));
  const projectLabel = `${row.project.projectNumber ? row.project.projectNumber + " - " : ""}${row.project.name}`;
  const nameLabel = unassigned ? "Unassigned" : (row.names || []).join(", ");
  return (
    <div className={`grid grid-cols-[320px_1fr] items-center gap-0 h-7 ${striped ? "bg-slate-100/60" : ""}`}>
      <div className="sticky left-0 z-20 h-7 bg-white pr-3 text-left overflow-hidden">
        <button onClick={onClick} className="block w-full truncate text-left text-[12px] font-semibold text-slate-900 hover:text-emerald-700" title={`${projectLabel}${nameLabel ? " — " + nameLabel : ""}`}>
          {projectLabel}
          {nameLabel && <span className={`ml-1 font-normal text-[10px] ${unassigned ? "text-amber-700" : "text-emerald-700"}`}>· {nameLabel}</span>}
        </button>
      </div>
      <div className="relative h-7 rounded-md" style={{ width: `${timeline.width}px` }}>
        {sortedItems.map((item) => (
          <GanttSegmentBar
            key={`rev-${row.project.id}-${item.id}`}
            item={item}
            timeline={timeline}
            label={unassigned ? "Unassigned" : (row.names || []).join(", ")}
          />
        ))}
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
    <div className="grid grid-cols-[320px_1fr] items-start gap-0">
      <div className="sticky left-0 z-20 bg-white pr-3 text-left overflow-hidden" style={{ height: `${Math.max(28, lanes.length * 28)}px` }}>
        <p className="truncate text-[12px] font-semibold text-slate-900" title={`${getCrewDisplayName(crew)} — ${(crew.specialty || []).join(", ") || "No specialty"} • ${items.length} assignment${items.length === 1 ? "" : "s"}`}>{getCrewDisplayName(crew)}</p>
      </div>
      <div className="relative rounded-md" style={{ width: `${timeline.width}px`, height: `${Math.max(28, lanes.length * 28)}px` }}>
        {lanes.map((lane, laneIndex) =>
          lane.map((item) => {
            const span = timelineSpanPixels(item.start, item.end, timeline);
            const colorClass = item.project.status === "Pending Award"
              ? pendingDivisionStyles[item.project.division]
              : divisionStyles[item.project.division];
            const tooNarrow = span.width < 70;
            const labelOffset = span.left < 0 ? -span.left + 6 : 0;
            return (
              <div
                key={`${crew.id}-${item.id}`}
                className={`absolute h-7 rounded-md text-[11px] font-semibold leading-7 text-white shadow-sm ${colorClass || "bg-slate-700"} ${tooNarrow ? "overflow-visible" : "overflow-hidden px-2.5"}`}
                style={{ left: `${span.left}px`, width: `${span.width}px`, top: `${laneIndex * 28}px` }}
              >
                {tooNarrow ? (
                  <span className="pointer-events-none absolute left-full top-0 ml-1 whitespace-nowrap rounded bg-white/95 px-1.5 leading-7 text-slate-700 shadow-sm">
                    {item.project.name}
                  </span>
                ) : (
                  <span style={labelOffset ? { paddingLeft: `${labelOffset}px` } : undefined}>{item.project.name}</span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── ResourceDemandChart ──────────────────────────────────────────────────────

export function ResourceDemandChart({ items, timeline, zoom, totalResources, onExportPdf, onBarClick, onPeriodClick, getItemKeys, enlarged = false }) {
  // getItemKeys(item) -> string[] returns one or more keys identifying the
  // unique person/role slot that this item draws on. Multiple keys per item
  // happen when the user filters by multiple roles and the item has matching
  // people in more than one of them.
  //
  // Counting model: within each (period, division, status) bucket, for each
  // distinct key we tally MAX CONCURRENT mobilizations carrying that key
  // during the period. So one person on two SEQUENTIAL mobs collapses to 1
  // (they cover both via handoff). One person on two OVERLAPPING mobs counts
  // as 2 (they're stretched — both projects need full coverage during the
  // overlap). Unassigned needs each get a unique key, so they always count
  // their own concurrency (typically 1 each).
  const keysOf = (item) => {
    if (typeof getItemKeys === "function") {
      const ks = getItemKeys(item);
      if (Array.isArray(ks) && ks.length) return ks;
    }
    return [item.id];
  };
  // Compute max concurrent count of a list of mobilizations using a sweep.
  // End dates are treated as inclusive (a mob ending May 11 still occupies
  // May 11 entirely), so the end event fires at end+1 00:00. CRITICAL: when
  // two events fall at the same instant, end events (-1) MUST fire before
  // start events (+1). Otherwise sequential mobs (e.g. one ending May 11,
  // next starting May 12) would falsely register as overlapping at the
  // boundary.
  const maxConcurrency = (mobs) => {
    if (!mobs || mobs.length <= 1) return mobs ? mobs.length : 0;
    const events = [];
    mobs.forEach((m) => {
      const s = toDate(m.start);
      const e = toDate(m.end);
      if (!s || !e) return;
      events.push({ t: s.getTime(), delta: 1 });
      events.push({ t: e.getTime() + 86400000, delta: -1 });
    });
    // Same-time sort: -1 (end) before +1 (start). delta -1 < delta +1 so
    // ascending delta order does the right thing.
    events.sort((a, b) => a.t - b.t || a.delta - b.delta);
    let cur = 0, max = 0;
    events.forEach(({ delta }) => { cur += delta; if (cur > max) max = cur; });
    return max;
  };
  const periods = timeline.ticks.map((tick) => {
    const periodStart = tick;
    const periodEnd = getPeriodEnd(tick, zoom);

    // All items active in this period that pass the home-division filter (already applied upstream)
    const periodItems = items.filter((item) => {
      const itemStart = toDate(item.start);
      const itemEnd = toDate(item.end);
      return itemStart && itemEnd && rangesOverlap(itemStart, addDays(itemEnd, 1), periodStart, periodEnd);
    });

    // Bucket by PROJECT division so bar colors reflect the actual work being
    // done. Each bucket holds Map<key, mobs[]> rather than counts directly,
    // because we have to compute max concurrency per key after aggregating.
    const buckets = {};
    divisions.forEach((d) => { buckets[d] = { current: new Map(), pending: new Map() }; });

    periodItems.forEach((item) => {
      const projectDivision = item.project.division;
      if (!buckets[projectDivision]) return;
      const target = item.project.status === "Pending Award" ? buckets[projectDivision].pending
        : (item.project.status !== "Complete" ? buckets[projectDivision].current : null);
      if (!target) return;
      const ks = keysOf(item);
      ks.forEach((k) => {
        if (!target.has(k)) target.set(k, []);
        target.get(k).push(item);
      });
    });

    const sumBucket = (map) => {
      let total = 0;
      for (const mobs of map.values()) total += maxConcurrency(mobs);
      return total;
    };

    // Sort helper: group items by their primary demand key (so McKenna's
    // mobs cluster together, Jacob's together, etc.), then by start date
    // within the group. Falls back to project name if no keys.
    const sortByDemandKey = (arr) => [...arr].sort((a, b) => {
      const ak = keysOf(a)[0] || "";
      const bk = keysOf(b)[0] || "";
      if (ak !== bk) return ak.localeCompare(bk);
      const aStart = toDate(a.start)?.getTime() || 0;
      const bStart = toDate(b.start)?.getTime() || 0;
      return aStart - bStart;
    });

    const segments = [];
    divisions.forEach((d) => {
      const currentCount = sumBucket(buckets[d].current);
      const pendingCount = sumBucket(buckets[d].pending);
      const currentItems = sortByDemandKey(periodItems.filter((item) =>
        item.project.division === d &&
        item.project.status !== "Pending Award" &&
        item.project.status !== "Complete"
      ));
      const pendingItems = sortByDemandKey(periodItems.filter((item) =>
        item.project.division === d &&
        item.project.status === "Pending Award"
      ));
      const currentMobCount = currentItems.length;
      const pendingMobCount = pendingItems.length;
      const currentKeyCount = buckets[d].current.size;
      const pendingKeyCount = buckets[d].pending.size;
      if (currentCount > 0) segments.push({
        division: d, type: "Current", value: currentCount, mobCount: currentMobCount, keyCount: currentKeyCount, color: divisionSvgColors[d],
        segmentItems: currentItems,
      });
      if (pendingCount > 0) segments.push({
        division: d, type: "Pending", value: pendingCount, mobCount: pendingMobCount, keyCount: pendingKeyCount, color: pendingDivisionSvgColors[d],
        segmentItems: pendingItems,
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

    const count = divisions.reduce((sum, d) => sum + sumBucket(buckets[d].current) + sumBucket(buckets[d].pending), 0);
    // Period-wide drilldown also gets the grouped order
    const sortedPeriodItems = sortByDemandKey(periodItems);
    return { label: formatTick(tick, zoom), tick, periodStart, periodEnd, segments, count, periodItems: sortedPeriodItems, periodTimeline };
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
                    <g key={`${segment.division}-${segment.type}`}>
                      <rect x={x} y={rectY} width={barWidth} height={segmentHeight} rx="5" fill={segment.color}
                        onClick={() => onBarClick?.({ period, segment })}
                        style={{ cursor: "pointer" }}>
                        <title>{segment.division} {segment.type}: {segment.value} (from {segment.mobCount} mob{segment.mobCount === 1 ? "" : "s"} / {segment.keyCount} unique slot{segment.keyCount === 1 ? "" : "s"}) — click for details</title>
                      </rect>
                      {segmentHeight >= 16 && (
                        <text x={x + barWidth / 2} y={rectY + segmentHeight / 2 + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="white" pointerEvents="none">
                          {segment.value}
                        </text>
                      )}
                    </g>
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


// ─── TaskGrid (Smartsheet-style editable task table) ─────────────────────────
// Inline-editable rows with keyboard navigation. Tab/Shift+Tab move between
// editable cells; at the last cell of the last row, Tab commits and creates a
// new blank row. Enter commits the row and drops focus to the row below.
// Double-clicking a row opens the full edit pop-out for advanced options
// (dependency type, lag, header/parent, crew requests).
export function TaskGrid({
  rows, allTasks, taskNameById, requestsByTaskId, depTag,
  onCommitRow, onAddRow, onOpenPopout, onDelete, onRequestCrew, canEdit,
}) {
  const EDITABLE_COLS = ["name", "start", "end", "duration", "depends"];
  const NEW_ROW = "__new__";
  const [active, setActive] = React.useState({ rowId: null, col: null });
  const inputRefs = React.useRef({}); // `${rowId}:${col}` -> element
  // The draft is held in a ref (not state) so navigating between cells never
  // tears down/reloads the row mid-edit. We mirror it into state only to drive
  // the input values for the row currently being edited.
  const draftRef = React.useRef(null);
  const [draftRowId, setDraftRowId] = React.useState(null);
  const [, forceRender] = React.useState(0);
  const focusGuard = React.useRef(false); // true while we move focus programmatically
  const committingRef = React.useRef(false);

  const rowOrder = [...rows.map((r) => r.id), NEW_ROW];

  function seedDraft(rowId) {
    if (rowId === NEW_ROW) return { id: NEW_ROW, name: "", start: "", end: "", duration: "", depends: "" };
    const row = rows.find((r) => r.id === rowId);
    return {
      id: rowId,
      name: row?.name || "",
      // Seed from STORED dates (not effective) so editing a name on a
      // dependency-driven row doesn't pin its computed dates.
      start: row?.start_date || "",
      end: row?.end_date || "",
      duration: row?.duration_days || "",
      depends: row?.depends_on || "",
    };
  }

  function startEdit(rowId, col) {
    if (!canEdit) return;
    // If we move to a DIFFERENT row, commit the one we are leaving first.
    if (draftRef.current && draftRef.current.id !== rowId) {
      commit(draftRef.current);
    }
    if (!draftRef.current || draftRef.current.id !== rowId) {
      draftRef.current = seedDraft(rowId);
      setDraftRowId(rowId);
    }
    setActive({ rowId, col });
  }

  React.useEffect(() => {
    const key = `${active.rowId}:${active.col}`;
    const el = inputRefs.current[key];
    if (el) {
      focusGuard.current = true;
      el.focus();
      if (el.select) { try { el.select(); } catch (e) {} }
      // release the guard after the blur from the previous cell has flushed
      setTimeout(() => { focusGuard.current = false; }, 0);
    }
  }, [active]);

  async function commit(data) {
    const d = data || draftRef.current;
    if (!d) return null;
    if (committingRef.current) return null;
    if (!(d.name || "").trim()) { draftRef.current = null; setDraftRowId(null); return null; }
    committingRef.current = true;
    const wasNew = d.id === NEW_ROW;
    let newId = null;
    try {
      newId = await onCommitRow({
        name: d.name,
        start: d.start || "",
        end: d.end || "",
        durationDays: d.duration || "",
        dependsOn: d.depends || "",
      }, wasNew ? null : d.id);
    } finally {
      committingRef.current = false;
    }
    // Clear the draft AFTER the save+reload so the typed value stays visible
    // continuously (no blank flicker), unless we've already moved on to edit a
    // different row in the meantime.
    if (draftRef.current && draftRef.current.id === d.id) {
      draftRef.current = null;
      setDraftRowId(null);
    }
    return newId;
  }

  // Blur on a cell only commits when focus is actually leaving the grid (not
  // when we are programmatically hopping to the next cell).
  function handleBlur() {
    setTimeout(() => {
      if (focusGuard.current) return; // we moved focus on purpose; ignore
      if (draftRef.current) commit(draftRef.current);
    }, 60);
  }

  function moveTo(rowId, col) { startEdit(rowId, col); }

  async function handleKeyDown(e, rowId, col) {
    const colIdx = EDITABLE_COLS.indexOf(col);
    if (e.key === "Tab") {
      e.preventDefault();
      const dir = e.shiftKey ? -1 : 1;
      const nextCol = colIdx + dir;
      if (nextCol >= EDITABLE_COLS.length) {
        // end of row → commit this row, then open the next (or a fresh new row)
        focusGuard.current = true;
        await commit(draftRef.current);
        if (rowId === NEW_ROW) {
          draftRef.current = seedDraft(NEW_ROW); setDraftRowId(NEW_ROW);
          setActive({ rowId: NEW_ROW, col: "name" });
        } else {
          const ri = rowOrder.indexOf(rowId);
          const nxt = rowOrder[ri + 1] || NEW_ROW;
          moveTo(nxt, "name");
        }
        return;
      }
      if (nextCol < 0) {
        const ri = rowOrder.indexOf(rowId);
        const prev = rowOrder[ri - 1];
        if (prev) moveTo(prev, EDITABLE_COLS[EDITABLE_COLS.length - 1]);
        return;
      }
      // move within the SAME row — no commit, draft stays intact
      setActive({ rowId, col: EDITABLE_COLS[nextCol] });
    } else if (e.key === "Enter") {
      e.preventDefault();
      focusGuard.current = true;
      await commit(draftRef.current);
      const ri = rowOrder.indexOf(rowId);
      const nxt = rowOrder[ri + 1] || NEW_ROW;
      moveTo(nxt, "name");
    } else if (e.key === "Escape") {
      e.preventDefault();
      draftRef.current = null;
      setDraftRowId(null);
      setActive({ rowId: null, col: null });
    }
  }

  const setField = (k, v) => { if (draftRef.current) { draftRef.current = { ...draftRef.current, [k]: v }; forceRender((n) => n + 1); } };
  const cellRef = (rowId, col) => (el) => { if (el) inputRefs.current[`${rowId}:${col}`] = el; };
  const isEditing = (rowId, col) => active.rowId === rowId && active.col === col && draftRef.current && draftRef.current.id === rowId;

  const inputCls = "w-full bg-transparent px-2 py-1.5 text-sm outline-none focus:bg-emerald-50";
  const cellCls = "border-r border-slate-200 align-middle";

  function renderEditable(row, col, display) {
    const rowId = row ? row.id : NEW_ROW;
    if (isEditing(rowId, col)) {
      const d = draftRef.current || {};
      if (col === "depends") {
        return (
          <select ref={cellRef(rowId, col)} className={inputCls} value={d.depends || ""}
            onChange={(e) => setField("depends", e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, rowId, col)}
            onBlur={handleBlur}>
            <option value="">—</option>
            {allTasks.filter((t) => !t.is_header && t.id !== rowId).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        );
      }
      const type = (col === "start" || col === "end") ? "date" : (col === "duration" ? "number" : "text");
      const val = d[col] != null ? d[col] : "";
      return (
        <input ref={cellRef(rowId, col)} type={type} className={inputCls} value={val}
          min={col === "duration" ? 1 : undefined}
          onChange={(e) => setField(col, e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, rowId, col)}
          onBlur={handleBlur} />
      );
    }
    return (
      <div className={`px-2 py-1.5 text-sm ${canEdit ? "cursor-text" : ""}`} onClick={() => startEdit(rowId, col)}>
        {display}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[920px] border-collapse text-left">
        <thead className="bg-slate-100 text-slate-600">
          <tr>
            <th className="border-r border-slate-200 p-2 text-xs font-bold uppercase tracking-wide">Task</th>
            <th className="border-r border-slate-200 p-2 text-xs font-bold uppercase tracking-wide w-32">Start</th>
            <th className="border-r border-slate-200 p-2 text-xs font-bold uppercase tracking-wide w-32">End</th>
            <th className="border-r border-slate-200 p-2 text-center text-xs font-bold uppercase tracking-wide w-20">Dur</th>
            <th className="border-r border-slate-200 p-2 text-xs font-bold uppercase tracking-wide w-44">Predecessor</th>
            <th className="border-r border-slate-200 p-2 text-xs font-bold uppercase tracking-wide">Crew Requests</th>
            <th className="p-2 text-right text-xs font-bold uppercase tracking-wide w-28">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const sd = row.eff_start || row.start_date;
            const ed = row.eff_end || row.end_date;
            const dur = (sd && ed) ? workdayCountBetween(sd, ed) : null;
            const reqs = requestsByTaskId(row.id);
            if (row.isHeader) {
              return (
                <tr key={row.id} className="border-t border-slate-200 bg-slate-100" onDoubleClick={() => canEdit && onOpenPopout(row)}>
                  <td className={`${cellCls} px-2 py-1.5 text-sm font-extrabold uppercase tracking-wide text-slate-700`} style={{ paddingLeft: `${8 + (row.depth || 0) * 16}px` }}>
                    {renderEditable(row, "name", row.name)}
                  </td>
                  <td className={cellCls} colSpan={4}><span className="px-2 text-xs text-slate-400">Header — {(allTasks.filter((t) => t.parent_id === row.id && !t.is_header)).length} tasks</span></td>
                  <td className={cellCls}></td>
                  <td className="px-2 py-1.5 text-right">
                    {canEdit && (
                      <>
                        <button onClick={() => onOpenPopout(row)} className="mr-1 rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">Edit</button>
                        <button onClick={() => onDelete(row.id)} className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50">✕</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            }
            return (
              <tr key={row.id} className="border-t border-slate-200 hover:bg-slate-50/60" onDoubleClick={() => canEdit && onOpenPopout(row)}>
                <td className={cellCls} style={{ paddingLeft: `${(row.depth || 0) * 16}px` }}>
                  {renderEditable(row, "name", <span className="font-semibold text-slate-900">{row.name}</span>)}
                </td>
                <td className={cellCls}>{renderEditable(row, "start", sd ? <span>{formatDate(sd)}</span> : <span className="text-slate-300">—</span>)}</td>
                <td className={cellCls}>{renderEditable(row, "end", ed ? <span>{formatDate(ed)}</span> : <span className="text-slate-300">—</span>)}</td>
                <td className={`${cellCls} text-center`}>{renderEditable(row, "duration", dur != null ? <span className="font-semibold">{dur}<span className="ml-0.5 text-xs text-slate-400">d</span></span> : <span className="text-slate-300">—</span>)}</td>
                <td className={cellCls}>{renderEditable(row, "depends", row.depends_on ? <span>{taskNameById.get(row.depends_on) || "—"} <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{depTag(row.dependency_type, row.dependency_lag)}</span></span> : <span className="text-slate-300">—</span>)}</td>
                <td className={cellCls}>
                  {reqs.length === 0 ? <span className="px-2 text-slate-300">None</span> : (
                    <div className="flex flex-wrap gap-1 px-2 py-1">
                      {reqs.map((r) => (
                        <span key={r.id} className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.status === "approved" ? "bg-emerald-100 text-emerald-700" : r.status === "denied" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                          {r.crew_specialty}{r.men_count ? ` (${r.men_count})` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">
                  {canEdit && (
                    <>
                      <button onClick={() => onRequestCrew(row.id)} className="mr-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100" title="Request crew">Crew</button>
                      <button onClick={() => onOpenPopout(row)} className="mr-1 rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50" title="Advanced edit">Edit</button>
                      <button onClick={() => onDelete(row.id)} className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50" title="Delete">✕</button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
          {/* Trailing "new row" — click or tab into it to add a task */}
          {canEdit && (
            <tr className="border-t border-slate-200 bg-emerald-50/30">
              <td className={cellCls}>{renderEditable(null, "name", <span className="text-slate-400">+ Add task…</span>)}</td>
              <td className={cellCls}>{renderEditable(null, "start", <span className="text-slate-300">—</span>)}</td>
              <td className={cellCls}>{renderEditable(null, "end", <span className="text-slate-300">—</span>)}</td>
              <td className={`${cellCls} text-center`}>{renderEditable(null, "duration", <span className="text-slate-300">—</span>)}</td>
              <td className={cellCls}>{renderEditable(null, "depends", <span className="text-slate-300">—</span>)}</td>
              <td className={cellCls}></td>
              <td className="px-2 py-1.5 text-right">
                <button onClick={() => startEdit(NEW_ROW, "name")} className="rounded-lg border border-emerald-300 bg-emerald-600 px-2 py-1 text-xs font-bold text-white hover:bg-emerald-700">+ Row</button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
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
  const [assignmentTasks, setAssignmentTasks] = useState([]); // tasks for the project being assigned (for mob task tagging)
  const [allTaskNames, setAllTaskNames] = useState({}); // taskId -> name, for the assignments table "which task" display
  const [resourceForm, setResourceForm] = useState(blankResource);
  const [crewForm, setCrewForm] = useState(blankCrew);
  const [crewTypes, setCrewTypes] = useState([]);
  const [newCrewType, setNewCrewType] = useState("");
  const [showCrewTypeSettings, setShowCrewTypeSettings] = useState(false);

  const [zoom, setZoom] = useState("Months");
  const [resourceZoom, setResourceZoom] = useState("Months");
  const [crewZoom, setCrewZoom] = useState("Months");
  const [divisionFilter, setDivisionFilter] = useState([...divisions]);
  const [statusFilter, setStatusFilter] = useState([...statuses]);
  const [page, setPage] = useState("projectDash");
  const [setupTab, setSetupTab] = useState("projects");
  const [showCertSettings, setShowCertSettings] = useState(false);
  const [newCertification, setNewCertification] = useState("");
  const [resourceTypeFilter, setResourceTypeFilter] = useState([...resourceTypes]);
  const [dashboardResourceTypeFilter, setDashboardResourceTypeFilter] = useState([...defaultDashboardResourceTypes]);
  const [projectTabDivisionFilter, setProjectTabDivisionFilter] = useState([...divisions]);
  const [demandHomeDivisionFilter, setDemandHomeDivisionFilter] = useState([...divisions]);
  // Demand graph has its own resource type filter, independent of the
  // Resource Gantt's filter. PM is excluded from the OPTIONS list because
  // PM utilization is shown elsewhere; they can never be selected here.
  const demandResourceTypeOptions = resourceTypes.filter((rt) => rt !== "Project Manager");
  const [demandResourceTypeFilter, setDemandResourceTypeFilter] = useState(demandResourceTypeOptions);
  const [demandZoom, setDemandZoom] = useState("Weeks");
  const [expandedView, setExpandedView] = useState(null);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [authMode, setAuthMode] = useState("signin"); // "signin" | "signup"
  const [authMessage, setAuthMessage] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [showClaude, setShowClaude] = useState(false);
  const [session, setSession] = useState(null);
  const [currentUser, setCurrentUser] = useState("");
  const [userRole, setUserRole] = useState(null);
  const [pmName, setPmName] = useState(null);
  const [pmProfiles, setPmProfiles] = useState([]); // manager/admin logins assignable as PMs
  const [projectPmMap, setProjectPmMap] = useState({}); // { [projectId]: [profileId, ...] }
  const [authLoading, setAuthLoading] = useState(true);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [newUserForm, setNewUserForm] = useState({ email: "", password: "" });
  const [appUsers, setAppUsers] = useState([]);
  const [crewGanttFilter, setCrewGanttFilter] = useState([]);
  const [focusedResource, setFocusedResource] = useState(null);
  const [projectSort, setProjectSort] = useState({ key: "projectNumber", direction: "asc" });
  const [projectGanttSort, setProjectGanttSort] = useState("projectNumber");
  const [resourceGanttSort, setResourceGanttSort] = useState("name");
  const [crewGanttSort, setCrewGanttSort] = useState("crewName");
  const [resourceSort, setResourceSort] = useState({ key: "name", direction: "asc" });
  const [crewSort, setCrewSort] = useState({ key: "crewName", direction: "asc" });
  const [demandDrilldown, setDemandDrilldown] = useState(null);
  const [demandPeriodDrilldown, setDemandPeriodDrilldown] = useState(null);
  const [demandDrilldownReversed, setDemandDrilldownReversed] = useState(false);
  const [showAssignments, setShowAssignments] = useState(false);
  const [showUnassignedNeedRows, setShowUnassignedNeedRows] = useState(false);
  const [certAlertModal, setCertAlertModal] = useState(null);

  // ── Saved views + summary banner state ─────────────────────────────────────
  const [savedViews, setSavedViews] = useState([]);
  const [activeSavedViewId, setActiveSavedViewId] = useState(null);
  const [showSaveViewModal, setShowSaveViewModal] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const [summaryBannerDismissed, setSummaryBannerDismissed] = useState(false);
  const [conflictModal, setConflictModal] = useState(null); // 'conflicts' | 'pto' | null

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

    const [projectsRes, resourcesRes, crewsRes, assignmentsRes, mobilizationsRes, certsRes, forecastRes, settingsRes, pmProfilesRes, projectPmsRes] = await Promise.all([
      supabase.from("projects").select("*").order("created_at", { ascending: false }),
      supabase.from("resources").select("*").order("created_at", { ascending: false }),
      supabase.from("crews").select("*").order("created_at", { ascending: false }),
      supabase.from("assignments").select("*").order("created_at", { ascending: false }),
      supabase.from("mobilizations").select("*"),
      supabase.from("certifications").select("*").order("name", { ascending: true }),
      supabase.from("forecast").select("*"),
      supabase.from("forecast_settings").select("*").limit(1),
      supabase.from("profiles").select("id, email, role, pm_name").in("role", ["manager", "admin"]),
      supabase.from("project_pms").select("project_id, profile_id"),
    ]);

    if (projectsRes.error) console.error("Projects load error:", projectsRes.error);
    if (resourcesRes.error) console.error("Resources load error:", resourcesRes.error);
    if (crewsRes.error) console.error("Crews load error:", crewsRes.error);
    if (assignmentsRes.error) console.error("Assignments load error:", assignmentsRes.error);
    if (mobilizationsRes.error) console.error("Mobilizations load error:", mobilizationsRes.error);
    if (certsRes.error) console.error("Certifications load error:", certsRes.error);

    setProjects((projectsRes.data || []).map(mapProjectFromDbLocal));
    setPmProfiles((pmProfilesRes?.data || []).map((p) => ({ id: p.id, email: p.email, role: p.role, pmName: p.pm_name || p.email })));
    {
      const m = {};
      (projectPmsRes?.data || []).forEach((row) => {
        if (!m[row.project_id]) m[row.project_id] = [];
        m[row.project_id].push(row.profile_id);
      });
      setProjectPmMap(m);
    }
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
  useEffect(() => { if (currentUser) { loadAppUsers(); loadProjectTypes(); loadCrewTypes(); loadAllTaskNames(); loadSavedViews(); } }, [currentUser]);

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
    if (page === "projectDash") setShowAssignments(false);
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
  const rawGanttItems = buildGanttItems(projects, assignments);
  // The shared buildGanttItems helper may skip mobilizations that have no
  // named resources. We synthesize items for any mob the helper omitted so
  // nothing is lost. Crew-only mobs (flagged via mob.crewOnly) get an
  // isCrewOnly tag so the bar renderer can apply a hatched overlay.
  const existingMobIds = new Set(rawGanttItems.map((it) => it.mobilizationId).filter(Boolean));
  const crewOnlyExtras = [];
  assignments.forEach((assignment) => {
    const project = findProject(projects, assignment.projectId);
    if (!project) return;
    (assignment.mobilizations || []).forEach((mob) => {
      if (!mob.start || !mob.end) return;
      if (existingMobIds.has(mob.id)) return;
      crewOnlyExtras.push({
        id: `crewmob-${assignment.id}-${mob.id}`,
        mobilizationId: mob.id,
        project,
        assignment,
        start: mob.start,
        end: mob.end,
        isCrewOnly: true,
      });
    });
  });
  const ganttItems = (() => {
    const augmented = crewOnlyExtras.length ? [...rawGanttItems, ...crewOnlyExtras] : [...rawGanttItems];
    // Also flag any helper-produced items whose mob is marked crewOnly,
    // so the bar renderer applies the hatched overlay regardless of
    // whether the item came from the helper or our synth.
    return augmented.map((item) => {
      if (item.isCrewOnly) return item;
      if (!item.assignment || !item.mobilizationId) return item;
      const sourceMob = (item.assignment.mobilizations || []).find((m) => m.id === item.mobilizationId);
      if (sourceMob && sourceMob.crewOnly) {
        return { ...item, isCrewOnly: true };
      }
      return item;
    });
  })();

  const assignmentMatchesDashboardResourceType = (assignment) => {
    const names = [assignment.projectManager, assignment.superintendent, assignment.fieldCoordinator, assignment.fieldEngineer, assignment.safety].filter(Boolean);
    // Crew-only assignment — no named resources, always show
    if (!names.length) return true;
    // If ANY mobilization on this assignment is flagged crewOnly, always
    // show. The assignment-level role fields (Nate Chancey as PM, etc.)
    // are inherited defaults — but a per-mob `crewOnly: true` says
    // "this specific mob is staffed by crews, ignore the inherited
    // names." Without this, the resource-type filter could drop
    // crew-only mobs because their PM doesn't match the filter.
    const hasCrewOnlyMob = (assignment.mobilizations || []).some((mob) => !!mob.crewOnly);
    if (hasCrewOnlyMob) return true;
    // Always show assignments that have at least one mobilization with an
    // unassigned need (so mob holes always appear on the Gantt regardless
    // of which roles are currently filtered).
    const hasUnassignedNeed = (assignment.mobilizations || []).some((mob) =>
      normalizeUnassignedNeeds(mob.unassignedNeeds || mob._unassignedNeeds).length > 0
    );
    if (hasUnassignedNeed) return true;
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
  const resourceTimeline = useMemo(() => buildTimeline(visibleItems, resourceZoom), [visibleItems, resourceZoom]);
  const crewTimeline = useMemo(() => buildTimeline(visibleItems, crewZoom), [visibleItems, crewZoom]);
  const timelineVisibleItems = visibleItems.filter((item) => itemOverlapsTimeline(item.start, item.end, timeline));
  const resourceTimelineVisibleItems = visibleItems.filter((item) => itemOverlapsTimeline(item.start, item.end, resourceTimeline));
  const crewTimelineVisibleItems = visibleItems.filter((item) => itemOverlapsTimeline(item.start, item.end, crewTimeline));
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
  // Same set, but scoped to the resource gantt's independent timeline.
  // The Resource Gantt uses this when rendering unassigned-need rows so
  // that toggling the resource zoom narrows those rows accordingly.
  const resourceUnassignedNeedItems = resourceTimelineVisibleItems.flatMap((item) =>
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

  // Build a name → resource lookup so we can resolve "Chris Salmon" → home
  // division + resource type without scanning the full array each time.
  const resourceByName = useMemo(() => {
    const m = new Map();
    resources.forEach((r) => { if (r.name) m.set(r.name, r); });
    return m;
  }, [resources]);

  // Map resource type to the assignment role field that holds person names.
  // Used to ensure that when the user filters by (e.g.) "Superintendent",
  // we only look at the superintendent field on each mobilization, not all
  // five role fields.
  const RESOURCE_TYPE_TO_ROLE = {
    "Project Manager":       "projectManager",
    "Superintendent":        "superintendent",
    "General Superintendent":"superintendent",
    "Field Coordinator":     "fieldCoordinator",
    "Field Engineer":        "fieldEngineer",
    "Safety":                "safety",
  };

  // Filter rule for the demand chart:
  //   A mobilization is shown if AT LEAST ONE role-assigned person on it
  //   matches BOTH the resource-type filter AND the home-division filter.
  //   The bar color comes from the project's division (so a hardscape
  //   superintendent on a commercial project shows up as a commercial bar).
  // This matches: "filter by superintendents + hardscape" should show every
  // mobilization where a hardscape superintendent is named, regardless of
  // what division the project is in.
  //
  // Unassigned-need items also pass through if their `unassignedDivision`
  // matches the home-division filter AND the user has "Superintendent" in
  // their resource-type filter (unassigned needs are synthesized as
  // unfilled superintendent slots — see line ~1959 above).
  const demandFilteredItems = [...visibleItems, ...unassignedNeedItems]
    .filter((item) => itemOverlapsTimeline(item.start, item.end, demandTimeline))
    .filter((item) => {
      // Unassigned-need items have their own filter rule.
      if (item.isUnassignedNeed) {
        const needDivision = item.unassignedDivision;
        if (!needDivision) return false;
        if (!demandHomeDivisionFilter.includes(needDivision)) return false;
        // Unassigned needs represent unfilled SUPERINTENDENT slots in this
        // app. Only show them when superintendent is in the role filter.
        return demandResourceTypeFilter.includes("Superintendent");
      }

      // Regular items: walk the role fields the user has selected. For each,
      // check whether the named person on this mobilization is in the
      // home-division filter.
      const rolesToCheck = demandResourceTypeFilter
        .map((rt) => RESOURCE_TYPE_TO_ROLE[rt])
        .filter(Boolean);
      for (const roleField of rolesToCheck) {
        const personName = item.assignment[roleField];
        if (!personName) continue;
        const r = resourceByName.get(personName);
        // If we can't find the resource record, fall back to allowing the
        // person through — better than dropping data because of a name typo.
        if (!r) continue;
        if (demandHomeDivisionFilter.includes(r.homeDivision)) return true;
      }
      return false;
    });

  // Build the demand counting keys for each item. The upstream filter on
  // `demandFilteredItems` has already vetted that this item belongs in the
  // chart at all; here we just attribute its slots. For each selected role
  // with a non-empty person name on the item, emit a `Role:Name` key. The
  // chart then dedupes via maxConcurrency per (period, division, status,
  // key) bucket. Unassigned-need items each get a unique key so every
  // unfilled slot still counts.
  const getDemandKeys = (item) => {
    if (item.isUnassignedNeed) return [`UNASSIGNED:${item.id}`];
    const keys = [];
    for (const rt of demandResourceTypeFilter) {
      const roleField = RESOURCE_TYPE_TO_ROLE[rt];
      if (!roleField) continue;
      // Look at the assignment-level role first; fall back to a mob-level
      // override (item.superintendent, item.fieldCoordinator) if present
      // because mobilizations can override these fields on a per-mob basis.
      const personName = (item[roleField] || item.assignment?.[roleField] || "").trim();
      if (!personName) continue;
      keys.push(`${rt}:${personName}`);
    }
    // No role yielded a name (e.g. crew-only mob with no named roles).
    // Group by project so multi-mob crew-only projects still collapse to 1.
    return keys.length ? keys : [`PROJECT:${item.project?.id || item.id}`];
  };

  const activeCrews = crews.filter((c) => !isCrewDeactivated(c));

  // ── Project Task Scheduling (PM granular planning layer) ──────────────────
  // PMs pick a project, build a dependency-aware task Gantt, and request crew
  // TYPES per task. The office approves requests before any mobilization
  // change. This layer is additive: mobilizations remain independently
  // editable and never require a task schedule to exist.
  const [schedProjectId, setSchedProjectId] = useState("");
  const currentUserId = session?.user?.id || null;
  // Projects visible in the Scheduling tool:
  //  • admin → every project
  //  • manager → only projects they are a PM on
  //  • pm/viewer → fall back to PM-on-project too (managers + pms are scoped)
  const schedulableProjects = useMemo(() => {
    if (userRole === "admin") return projects;
    if (!currentUserId) return [];
    return projects.filter((p) => (projectPmMap[p.id] || []).includes(currentUserId));
  }, [projects, projectPmMap, userRole, currentUserId]);
  const [projectTasks, setProjectTasks] = useState([]);          // tasks for selected project
  const [taskCrewRequests, setTaskCrewRequests] = useState([]);  // requests (+ links) for selected project
  const [schedZoom, setSchedZoom] = useState("Weeks");
  const [tasksTableCollapsed, setTasksTableCollapsed] = useState(false);
  const [requestsPanelCollapsed, setRequestsPanelCollapsed] = useState(true);

  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [taskForm, setTaskForm] = useState({ name: "", start: "", durationDays: "", end: "", dependsOn: "", dependencyType: "FS", dependencyLag: 0, isHeader: false, parentId: "" });

  const [showTaskRequestForm, setShowTaskRequestForm] = useState(false);
  const [taskRequestForm, setTaskRequestForm] = useState({ crewSpecialty: "", crewTypes: [], menCount: "", notes: "", laborManagement: "None", taskIds: [] });
  const [taskRequestBusy, setTaskRequestBusy] = useState(false);

  // Load tasks + requests for the selected project.
  const loadProjectSchedule = React.useCallback(async (projectId) => {
    if (!supabase || !projectId) { setProjectTasks([]); setTaskCrewRequests([]); return; }
    const [tasksRes, reqRes] = await Promise.all([
      supabase.from("project_tasks").select("*").eq("project_id", projectId).order("sort_order", { ascending: true }),
      supabase.from("task_crew_requests")
        .select("*, task_crew_request_links ( task_id )")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false }),
    ]);
    if (tasksRes.error) console.error("Tasks load error:", tasksRes.error);
    if (reqRes.error) console.error("Task requests load error:", reqRes.error);
    setProjectTasks(tasksRes.data || []);
    setTaskCrewRequests(reqRes.data || []);
  }, []);

  useEffect(() => { if (schedProjectId) loadProjectSchedule(schedProjectId); }, [schedProjectId, loadProjectSchedule]);
  // If the selected project falls outside the user's scope (e.g. PM removed),
  // clear the selection so they don't keep viewing a project they can't see.
  useEffect(() => {
    if (schedProjectId && !schedulableProjects.some((p) => p.id === schedProjectId)) {
      setSchedProjectId("");
    }
  }, [schedulableProjects, schedProjectId]);

  // Realtime: refresh the selected project's schedule on any change.
  useEffect(() => {
    if (!supabase || !schedProjectId) return;
    const channel = supabase
      .channel("realtime:project_schedule")
      .on("postgres_changes", { event: "*", schema: "public", table: "project_tasks" }, () => loadProjectSchedule(schedProjectId))
      .on("postgres_changes", { event: "*", schema: "public", table: "task_crew_requests" }, () => loadProjectSchedule(schedProjectId))
      .on("postgres_changes", { event: "*", schema: "public", table: "task_crew_request_links" }, () => loadProjectSchedule(schedProjectId))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [schedProjectId, loadProjectSchedule]);

  // Compute a task's end date from start + duration (calendar days, inclusive).
  function taskEndFromDuration(start, durationDays) {
    const s = toDate(start);
    const d = parseInt(durationDays, 10);
    if (!s || !Number.isFinite(d) || d <= 0) return "";
    const end = workdayEnd(s, d); // weekends excluded
    return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  }

  function openAddTaskForm(opts) {
    setEditingTaskId(null);
    setTaskForm({ name: "", start: "", durationDays: "", end: "", dependsOn: "", dependencyType: "FS", dependencyLag: 0, isHeader: !!(opts && opts.isHeader), parentId: (opts && opts.parentId) || "" });
    setShowTaskForm(true);
  }
  function openEditTaskForm(t) {
    setEditingTaskId(t.id);
    setTaskForm({
      name: t.name || "",
      start: t.start_date || "",
      durationDays: t.duration_days || "",
      end: t.end_date || "",
      dependsOn: t.depends_on || "",
      dependencyType: t.dependency_type || "FS",
      dependencyLag: t.dependency_lag || 0,
      isHeader: !!t.is_header,
      parentId: t.parent_id || "",
    });
    setShowTaskForm(true);
  }

  async function saveTask() {
    if (!schedProjectId) { alert("Pick a project first."); return; }
    if (!taskForm.name.trim()) { alert("Task name is required."); return; }
    if (!supabase) { alert("Supabase is not connected."); return; }
    const { data: { user } } = await supabase.auth.getUser();
    // If a dependency is set and this task has no explicit start, default its
    // start to the day after the dependency ends.
    let start = taskForm.start || null;
    // Predecessor-driven scheduling. When the user hasn't pinned an explicit
    // start (or end, for finish-anchored types), derive it from the predecessor
    // using the relationship type + lag (in days; negative = lead/overlap).
    const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    let end = taskForm.end || null;
    if (taskForm.dependsOn) {
      const dep = projectTasks.find((t) => t.id === taskForm.dependsOn);
      const lag = Number(taskForm.dependencyLag) || 0;
      const depStart = dep?.start_date ? toDate(dep.start_date) : null;
      const depEnd = dep?.end_date ? toDate(dep.end_date) : null;
      const type = taskForm.dependencyType || "FS";
      if (!start && !end) {
        if (type === "FS" && depEnd) start = fmtDate(nextWorkday(addWorkDays(depEnd, 1 + lag)));
        else if (type === "SS" && depStart) start = fmtDate(nextWorkday(addWorkDays(depStart, lag)));
        else if (type === "FF" && depEnd) end = fmtDate(prevWorkday(addWorkDays(depEnd, lag)));
        else if (type === "SF" && depStart) end = fmtDate(prevWorkday(addWorkDays(depStart, lag)));
      }
    }
    // If we anchored an end (FF/SF) and have a duration, back-calc the start
    // across working days.
    if (!start && end && taskForm.durationDays) {
      const e = toDate(end);
      if (e) start = fmtDate(addWorkDays(prevWorkday(e), -((Number(taskForm.durationDays) || 1) - 1)));
    }
    if (!end) end = taskEndFromDuration(start, taskForm.durationDays) || null;
    const isHeader = !!taskForm.isHeader;
    const payload = {
      project_id: schedProjectId,
      name: taskForm.name.trim(),
      is_header: isHeader,
      parent_id: isHeader ? null : (taskForm.parentId || null),
      start_date: isHeader ? null : start,
      end_date: isHeader ? null : end,
      duration_days: isHeader ? null : (taskForm.durationDays ? Number(taskForm.durationDays) : null),
      depends_on: isHeader ? null : (taskForm.dependsOn || null),
      dependency_type: (!isHeader && taskForm.dependsOn) ? (taskForm.dependencyType || "FS") : "FS",
      dependency_lag: (!isHeader && taskForm.dependsOn) ? (Number(taskForm.dependencyLag) || 0) : 0,
      created_by_name: pmName || currentUser,
      updated_at: new Date().toISOString(),
    };
    if (editingTaskId) {
      const { error } = await supabase.from("project_tasks").update(payload).eq("id", editingTaskId);
      if (error) { console.error(error); alert(`Could not update task: ${error.message}`); return; }
    } else {
      payload.sort_order = projectTasks.length;
      payload.created_by = user.id;
      const { error } = await supabase.from("project_tasks").insert(payload);
      if (error) { console.error(error); alert(`Could not add task: ${error.message}`); return; }
    }
    setShowTaskForm(false);
    setEditingTaskId(null);
    loadProjectSchedule(schedProjectId);
  }

  // ── Inline grid helpers (Smartsheet-style editing) ────────────────────────
  // Compute weekend-aware start/end from whatever fields are present, mirroring
  // saveTask's logic but for a plain values object.
  function computeTaskDates({ start, end, durationDays, dependsOn, dependencyType, dependencyLag }) {
    const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    let s = start || null, e = end || null;
    if (dependsOn) {
      const dep = projectTasks.find((t) => t.id === dependsOn);
      const lag = Number(dependencyLag) || 0;
      const depStart = dep?.start_date ? toDate(dep.start_date) : null;
      const depEnd = dep?.end_date ? toDate(dep.end_date) : null;
      const type = dependencyType || "FS";
      if (!s && !e) {
        if (type === "FS" && depEnd) s = fmtDate(nextWorkday(addWorkDays(depEnd, 1 + lag)));
        else if (type === "SS" && depStart) s = fmtDate(nextWorkday(addWorkDays(depStart, lag)));
        else if (type === "FF" && depEnd) e = fmtDate(prevWorkday(addWorkDays(depEnd, lag)));
        else if (type === "SF" && depStart) e = fmtDate(prevWorkday(addWorkDays(depStart, lag)));
      }
    }
    if (!s && e && durationDays) { const d = toDate(e); if (d) s = fmtDate(addWorkDays(prevWorkday(d), -((Number(durationDays) || 1) - 1))); }
    if (!e) e = taskEndFromDuration(s, durationDays) || null;
    return { start: s, end: e };
  }

  // Upsert a single task from inline grid values. Returns the row id (existing
  // or newly created) so the grid can keep focus continuity.
  async function upsertTaskInline(values, existingId) {
    if (!schedProjectId || !supabase) return null;
    const isHeader = !!values.isHeader;
    const name = (values.name || "").trim();
    if (!name) return null; // never persist an empty row
    const { start, end } = isHeader ? { start: null, end: null } : computeTaskDates(values);
    const payload = {
      project_id: schedProjectId,
      name,
      is_header: isHeader,
      parent_id: isHeader ? null : (values.parentId || null),
      start_date: isHeader ? null : start,
      end_date: isHeader ? null : end,
      duration_days: isHeader ? null : (values.durationDays ? Number(values.durationDays) : null),
      depends_on: isHeader ? null : (values.dependsOn || null),
      dependency_type: (!isHeader && values.dependsOn) ? (values.dependencyType || "FS") : "FS",
      dependency_lag: (!isHeader && values.dependsOn) ? (Number(values.dependencyLag) || 0) : 0,
      updated_at: new Date().toISOString(),
    };
    if (existingId) {
      const { error } = await supabase.from("project_tasks").update(payload).eq("id", existingId);
      if (error) { console.error(error); alert(`Could not update task: ${error.message}`); return null; }
      await loadProjectSchedule(schedProjectId);
      return existingId;
    }
    const { data: { user } } = await supabase.auth.getUser();
    payload.sort_order = projectTasks.length;
    payload.created_by = user?.id || null;
    payload.created_by_name = pmName || currentUser;
    const { data, error } = await supabase.from("project_tasks").insert(payload).select().single();
    if (error) { console.error(error); alert(`Could not add task: ${error.message}`); return null; }
    await loadProjectSchedule(schedProjectId);
    return data?.id || null;
  }

  async function deleteTask(id) {
    if (!supabase) return;
    if (!confirm("Delete this task? Any crew requests linked only to it stay but lose this task.")) return;
    const { error } = await supabase.from("project_tasks").delete().eq("id", id);
    if (error) { console.error(error); alert("Could not delete task."); return; }
    loadProjectSchedule(schedProjectId);
  }

  // ── Crew-type requests against tasks ──────────────────────────────────────
  function openTaskRequestForm(preselectTaskId = null) {
    setTaskRequestForm({
      crewSpecialty: "", crewTypes: [], menCount: "", notes: "",
      laborManagement: "None",
      taskIds: preselectTaskId ? [preselectTaskId] : [],
    });
    setShowTaskRequestForm(true);
  }

  async function submitTaskRequest() {
    if (!schedProjectId) { alert("Pick a project first."); return; }
    const types = taskRequestForm.crewTypes || [];
    const labor = taskRequestForm.laborManagement || "None";
    if (!types.length && labor === "None") { alert("Select at least one crew type or a labor management request."); return; }
    if (!taskRequestForm.taskIds.length) { alert("Select at least one task this request is for."); return; }
    if (!supabase) { alert("Supabase is not connected."); return; }
    setTaskRequestBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: reqRow, error: reqErr } = await supabase
      .from("task_crew_requests")
      .insert({
        project_id: schedProjectId,
        crew_specialty: types.length ? types.join(", ") : (labor !== "None" ? `Labor: ${labor}` : ""),
        crew_types: types,
        labor_management: taskRequestForm.laborManagement || "None",
        men_count: taskRequestForm.menCount ? Number(taskRequestForm.menCount) : 0,
        notes: taskRequestForm.notes || null,
        requested_by: user.id,
        requested_by_name: pmName || currentUser,
        status: "pending",
      })
      .select()
      .single();
    if (reqErr) { setTaskRequestBusy(false); console.error(reqErr); alert(`Could not submit request: ${reqErr.message}`); return; }
    const links = taskRequestForm.taskIds.map((taskId) => ({ request_id: reqRow.id, task_id: taskId }));
    const { error: linkErr } = await supabase.from("task_crew_request_links").insert(links);
    setTaskRequestBusy(false);
    if (linkErr) { console.error(linkErr); alert(`Request saved but task links failed: ${linkErr.message}`); }
    setShowTaskRequestForm(false);
    loadProjectSchedule(schedProjectId);
  }

  async function withdrawTaskRequest(id) {
    if (!supabase) return;
    if (!confirm("Withdraw this crew request?")) return;
    const { error } = await supabase.from("task_crew_requests").delete().eq("id", id);
    if (error) { console.error(error); alert("Could not withdraw request."); return; }
    loadProjectSchedule(schedProjectId);
  }

  // Office can permanently delete any request (any status) — clears stuck rows.
  async function deleteTaskRequest(id) {
    if (!supabase) return;
    if (!confirm("Delete this crew request permanently?")) return;
    const { error } = await supabase.from("task_crew_requests").delete().eq("id", id);
    if (error) { console.error(error); alert("Could not delete request."); return; }
    if (schedProjectId) loadProjectSchedule(schedProjectId);
    loadAllRequests();
  }
  async function deleteStaffRequest(id) {
    if (!supabase) return;
    if (!confirm("Delete this staff request permanently?")) return;
    const { error } = await supabase.from("project_staff_requests").delete().eq("id", id);
    if (error) { console.error(error); alert("Could not delete request."); return; }
    if (schedProjectId) loadStaffRequests(schedProjectId);
    loadAllRequests();
  }

  // Office: approve (assign a crew) or deny. Does NOT touch mobilizations —
  // the office changes those separately, per the approval-first workflow.

  // Map task id -> task name for showing "which tasks" on each request.
  // Compact predecessor tag, e.g. "FS+2", "SS-1", "FF".
  function depTag(type, lag) {
    const t = type || "FS";
    const n = Number(lag) || 0;
    return n === 0 ? t : `${t}${n > 0 ? "+" : ""}${n}`;
  }
  const taskNameById = useMemo(() => {
    const m = new Map();
    projectTasks.forEach((t) => m.set(t.id, t.name));
    return m;
  }, [projectTasks]);

  // Quick crew name lookup.
  const crewNameByIdMap = useMemo(() => {
    const m = new Map();
    crews.forEach((c) => m.set(c.id, c.crewName));
    return m;
  }, [crews]);

  // What's actually assigned to each task — derived from the selected project's
  // assignment mobilizations that have been tagged with a task id. Shows under
  // each task row on the schedule.
  const assignedByTaskId = useMemo(() => {
    const map = new Map(); // taskId -> { crews:[{name,men}], supers:Set, fieldCoords:Set }
    if (!schedProjectId) return map;
    assignments
      .filter((a) => a.projectId === schedProjectId)
      .forEach((a) => {
        (a.mobilizations || []).forEach((mob) => {
          const taskIds = Array.isArray(mob.taskIds) ? mob.taskIds : [];
          if (!taskIds.length) return;
          taskIds.forEach((tid) => {
            if (!map.has(tid)) map.set(tid, { crews: [], supers: new Set(), fieldCoords: new Set() });
            const entry = map.get(tid);
            (mob.crewIds || []).filter(Boolean).forEach((cid) => {
              const name = crewNameByIdMap.get(cid) || "Crew";
              const men = (mob.crewMenCounts || {})[cid];
              if (!entry.crews.some((x) => x.name === name)) entry.crews.push({ name, men: men || 0 });
            });
            if (mob.superintendent) entry.supers.add(mob.superintendent);
            if (mob.fieldCoordinator) entry.fieldCoords.add(mob.fieldCoordinator);
          });
        });
      });
    return map;
  }, [assignments, schedProjectId, crewNameByIdMap]);

  // Build a Gantt timeline scoped to the selected project's tasks.
  // ── Effective task scheduling (honor dependency type + lag at render time) ──
  // Stored dates may be stale or only reflect the old FS-only logic, so we
  // recompute each non-header task's start/end from its predecessor here. This
  // makes the Gantt bars reflect SS / FF / SF / FS + lag regardless of what's
  // stored. Headers derive their span from their children.
  const scheduledById = useMemo(() => {
    const byId = new Map(projectTasks.map((t) => [t.id, t]));
    const result = new Map(); // id -> { start: Date|null, end: Date|null }
    const visiting = new Set();
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const durOf = (t) => {
      if (t.duration_days) return Number(t.duration_days);
      if (t.start_date && t.end_date) {
        const s = toDate(t.start_date), e = toDate(t.end_date);
        if (s && e) return Math.round((e - s) / 86400000) + 1;
      }
      return 1;
    };
    function compute(id) {
      if (result.has(id)) return result.get(id);
      const t = byId.get(id);
      if (!t) return { start: null, end: null };
      if (visiting.has(id)) { // cycle guard — fall back to stored dates
        const s = t.start_date ? toDate(t.start_date) : null;
        const e = t.end_date ? toDate(t.end_date) : null;
        return { start: s, end: e };
      }
      visiting.add(id);
      let start = t.start_date ? toDate(t.start_date) : null;
      let end = t.end_date ? toDate(t.end_date) : null;
      const dur = durOf(t);
      if (t.depends_on && byId.has(t.depends_on)) {
        const dep = compute(t.depends_on);
        const lag = Number(t.dependency_lag) || 0;
        const type = t.dependency_type || "FS";
        if (dep.start || dep.end) {
          if (type === "FS" && dep.end) { start = nextWorkday(addWorkDays(dep.end, 1 + lag)); end = workdayEnd(start, dur); }
          else if (type === "SS" && dep.start) { start = nextWorkday(addWorkDays(dep.start, lag)); end = workdayEnd(start, dur); }
          else if (type === "FF" && dep.end) { end = prevWorkday(addWorkDays(dep.end, lag)); start = addWorkDays(end, -(dur - 1)); }
          else if (type === "SF" && dep.start) { end = prevWorkday(addWorkDays(dep.start, lag)); start = addWorkDays(end, -(dur - 1)); }
        }
      }
      visiting.delete(id);
      const out = { start: start || null, end: end || null };
      result.set(id, out);
      return out;
    }
    projectTasks.forEach((t) => { if (!t.is_header) compute(t.id); });
    // Headers: span across their children's computed dates.
    projectTasks.filter((t) => t.is_header).forEach((h) => {
      const kids = projectTasks.filter((c) => c.parent_id === h.id && !c.is_header);
      let s = null, e = null;
      kids.forEach((c) => {
        const cc = result.get(c.id);
        if (cc && cc.start && (!s || cc.start < s)) s = cc.start;
        if (cc && cc.end && (!e || cc.end > e)) e = cc.end;
      });
      result.set(h.id, { start: s, end: e });
    });
    // Convert to ISO strings for downstream consumers.
    const iso = new Map();
    result.forEach((v, k) => iso.set(k, { start: v.start ? fmt(v.start) : null, end: v.end ? fmt(v.end) : null }));
    return iso;
  }, [projectTasks]);

  // Ordered, grouped task list for the Gantt: headers first, each followed by
  // its children (in sort order); orphan (ungrouped) tasks fall under a virtual
  // bucket at the end. Each entry carries effective start/end + depth.
  const groupedTasks = useMemo(() => {
    const eff = (t) => {
      const e = scheduledById.get(t.id) || {};
      return { ...t, eff_start: e.start || t.start_date || null, eff_end: e.end || t.end_date || null };
    };
    const headers = projectTasks.filter((t) => t.is_header).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const out = [];
    headers.forEach((h) => {
      out.push({ ...eff(h), depth: 0, isHeader: true });
      projectTasks
        .filter((c) => c.parent_id === h.id && !c.is_header)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
        .forEach((c) => out.push({ ...eff(c), depth: 1, isHeader: false }));
    });
    // Ungrouped tasks (no parent, not a header) shown at the top level.
    const ungrouped = projectTasks
      .filter((t) => !t.is_header && !t.parent_id)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    ungrouped.forEach((t) => out.push({ ...eff(t), depth: 0, isHeader: false }));
    return out;
  }, [projectTasks, scheduledById]);

  const schedTimeline = useMemo(() => {
    const items = groupedTasks
      .filter((t) => t.eff_start && t.eff_end)
      .map((t) => ({ start: t.eff_start, end: t.eff_end }));
    return buildTimeline(items, schedZoom);
  }, [groupedTasks, schedZoom]);

  const schedPendingRequests = taskCrewRequests.filter((r) => r.status === "pending");
  const schedResolvedRequests = taskCrewRequests.filter((r) => r.status !== "pending");

  // ── Project-level STAFF requests (super / asst super / field coord / eng) ──
  // Role-only requests (office assigns the person). Stored separately but
  // shown in the SAME unified request list as crew requests.
  const STAFF_ROLES = ["Superintendent", "Assistant Superintendent", "Field Coordinator", "Field Engineer"];
  const [staffRequests, setStaffRequests] = useState([]);            // for selected sched project
  const [allStaffRequests, setAllStaffRequests] = useState([]);      // across all projects (for banner)
  const [allCrewRequests, setAllCrewRequests] = useState([]);        // across all projects (for banner)
  const [showStaffRequestForm, setShowStaffRequestForm] = useState(false);
  const [staffRequestForm, setStaffRequestForm] = useState({ role: "Superintendent", startDate: "", endDate: "", notes: "" });
  const [staffRequestBusy, setStaffRequestBusy] = useState(false);

  // Banner "Requests" modal (Project Dashboard) state.
  const [showRequestsModal, setShowRequestsModal] = useState(false);
  const [activeRequest, setActiveRequest] = useState(null); // request clicked → drives availability panel
  const [fulfillingRequest, setFulfillingRequest] = useState(null); // request being turned into an assignment (approved on save)

  // Load staff requests for the selected scheduling project.
  const loadStaffRequests = React.useCallback(async (projectId) => {
    if (!supabase || !projectId) { setStaffRequests([]); return; }
    const { data, error } = await supabase
      .from("project_staff_requests").select("*")
      .eq("project_id", projectId).order("created_at", { ascending: false });
    if (error) { console.error("Staff requests load error:", error); return; }
    setStaffRequests(data || []);
  }, []);
  useEffect(() => { if (schedProjectId) loadStaffRequests(schedProjectId); }, [schedProjectId, loadStaffRequests]);

  // Load ALL pending requests across projects for the dashboard banner.
  const loadAllRequests = React.useCallback(async () => {
    if (!supabase) return;
    const [crewRes, staffRes] = await Promise.all([
      supabase.from("task_crew_requests_with_window")
        .select("*, projects ( id, project_number, name ), task_crew_request_links ( task_id )")
        .order("created_at", { ascending: false }),
      supabase.from("project_staff_requests")
        .select("*, projects ( id, project_number, name )")
        .order("created_at", { ascending: false }),
    ]);
    if (!crewRes.error) setAllCrewRequests(crewRes.data || []);
    if (!staffRes.error) setAllStaffRequests(staffRes.data || []);
  }, []);
  useEffect(() => { if (currentUser) loadAllRequests(); }, [currentUser, loadAllRequests]);

  // Realtime for staff requests (keeps both scoped + banner lists fresh).
  useEffect(() => {
    if (!supabase || !currentUser) return;
    const channel = supabase
      .channel("realtime:staff_requests")
      .on("postgres_changes", { event: "*", schema: "public", table: "project_staff_requests" }, () => {
        loadAllRequests();
        if (schedProjectId) loadStaffRequests(schedProjectId);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "task_crew_requests" }, () => loadAllRequests())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentUser, schedProjectId, loadAllRequests, loadStaffRequests]);

  function openStaffRequestForm() {
    setStaffRequestForm({ role: "Superintendent", startDate: "", endDate: "", notes: "" });
    setShowStaffRequestForm(true);
  }

  async function submitStaffRequest() {
    if (!schedProjectId) { alert("Pick a project first."); return; }
    if (!supabase) { alert("Supabase is not connected."); return; }
    setStaffRequestBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("project_staff_requests").insert({
      project_id: schedProjectId,
      role: staffRequestForm.role,
      start_date: staffRequestForm.startDate || null,
      end_date: staffRequestForm.endDate || null,
      notes: staffRequestForm.notes || null,
      requested_by: user.id,
      requested_by_name: pmName || currentUser,
      status: "pending",
    });
    setStaffRequestBusy(false);
    if (error) { console.error(error); alert(`Could not submit staff request: ${error.message}`); return; }
    setShowStaffRequestForm(false);
    loadStaffRequests(schedProjectId);
    loadAllRequests();
  }

  async function withdrawStaffRequest(id) {
    if (!supabase) return;
    if (!confirm("Withdraw this staff request?")) return;
    const { error } = await supabase.from("project_staff_requests").delete().eq("id", id);
    if (error) { console.error(error); alert("Could not withdraw request."); return; }
    loadStaffRequests(schedProjectId);
    loadAllRequests();
  }

  // ── Unified pending request list for the dashboard banner ─────────────────
  // Normalizes crew + staff requests into one shape so the modal renders one
  // list. `kind` distinguishes them; `window` is the [start,end] used for the
  // availability recommendation and to prefill the Assign tool.
  const bannerRequests = useMemo(() => {
    const taskById = new Map(); // not project-scoped here; we only need dates if present
    const crew = (allCrewRequests || [])
      .filter((r) => r.status === "pending")
      .map((r) => {
        // crew request window = min start / max end across its linked tasks,
        // resolved from the tasks we have loaded for the active project; for
        // banner we may not have all tasks, so fall back to null (office can
        // still set dates in the Assign tool).
        return {
          kind: "crew",
          id: r.id,
          projectId: r.project_id,
          projectLabel: r.projects ? `${r.projects.project_number ? r.projects.project_number + " - " : ""}${r.projects.name}` : "—",
          label: `${r.crew_specialty}${r.men_count ? ` · ${r.men_count} men` : ""}${r.labor_management && r.labor_management !== "None" ? ` · +${r.labor_management}` : ""}`,
          specialty: r.crew_specialty,
          crewTypes: Array.isArray(r.crew_types) ? r.crew_types : [],
          menCount: r.men_count || 0,
          laborManagement: r.labor_management || "None",
          taskIds: (r.task_crew_request_links || []).map((l) => l.task_id),
          requestedBy: r.requested_by_name,
          start: r.window_start || null, end: r.window_end || null,
          raw: r,
        };
      });
    const staff = (allStaffRequests || [])
      .filter((r) => r.status === "pending")
      .map((r) => ({
        kind: "staff",
        id: r.id,
        projectId: r.project_id,
        projectLabel: r.projects ? `${r.projects.project_number ? r.projects.project_number + " - " : ""}${r.projects.name}` : "—",
        label: r.role,
        role: r.role,
        crewTypes: [],
        requestedBy: r.requested_by_name,
        start: r.start_date, end: r.end_date,
        raw: r,
      }));
    return [...staff, ...crew];
  }, [allCrewRequests, allStaffRequests]);

  const bannerRequestCount = bannerRequests.length;

  // Availability for a window: which resources/crews are NOT booked in [start,end].
  function computeAvailability(start, end) {
    const s = toDate(start);
    const e = toDate(end);
    if (!s || !e) return null;
    const busyResourceNames = new Set();
    const busyCrewIds = new Set();
    ganttItems.forEach((item) => {
      const is = toDate(item.start), ie = toDate(item.end);
      if (!is || !ie) return;
      if (!rangesOverlap(is, addDays(ie, 1), s, addDays(e, 1))) return;
      [item.assignment.projectManager, item.assignment.superintendent, item.assignment.fieldCoordinator, item.assignment.fieldEngineer, item.assignment.safety]
        .filter(Boolean).forEach((n) => busyResourceNames.add(n));
      getAssignmentCrewIds(item.assignment).forEach((id) => busyCrewIds.add(id));
    });
    // PTO also makes a resource unavailable.
    resources.forEach((r) => {
      (r.pto || []).forEach((p) => {
        const ps = toDate(p.start), pe = toDate(p.end);
        if (ps && pe && rangesOverlap(ps, addDays(pe, 1), s, addDays(e, 1))) busyResourceNames.add(r.name);
      });
    });
    return {
      freeResources: resources.filter((r) => !busyResourceNames.has(r.name)),
      freeCrews: activeCrews.filter((c) => !busyCrewIds.has(c.id)),
    };
  }

  // Map a resource type to the assignment form field it fills.
  function roleFieldForResourceType(rt) {
    const t = String(rt || "").toLowerCase();
    if (t.includes("project manager")) return "projectManager";
    if (t.includes("field engineer")) return "fieldEngineer";
    if (t.includes("field coordinator")) return "fieldCoordinator";
    if (t.includes("safety")) return "safety";
    if (t.includes("super")) return "superintendent"; // super + general/assistant super
    return null;
  }

  // From the Open Requests modal: the office stages one or more crews + people,
  // then clicks "Continue to Assign". We build a single assignment with the
  // whole selection applied to the first mobilization (crew men counts, super /
  // field coordinator) and open the Assign tool for final review.
  function buildAssignmentFromSelection(selection) {
    if (!activeRequest) return;
    const sel = selection || { crews: [], people: [] };
    const selCrews = sel.crews || [];
    const selPeople = sel.people || [];
    setFulfillingRequest(activeRequest);
    loadAssignmentTasks(activeRequest.projectId);
    const reqTaskIds = Array.isArray(activeRequest.taskIds) ? activeRequest.taskIds : [];
    const reqMen = Number(activeRequest.menCount) || 0;
    const existing = assignments.find((a) => a.projectId === activeRequest.projectId);
    const base = existing
      ? { ...blankAssignment, ...existing }
      : { ...blankAssignment, projectId: activeRequest.projectId,
          mobilizations: [{ id: crypto.randomUUID(), start: activeRequest.start || "", durationWeeks: "", end: activeRequest.end || "", superintendent: "", fieldCoordinator: "", crewIds: [], crewMenCounts: {}, crewOnly: false, unassignedNeeds: [], taskIds: [] }] };
    const mobs = base.mobilizations && base.mobilizations.length ? [...base.mobilizations] : [{ id: crypto.randomUUID(), start: activeRequest.start || "", durationWeeks: "", end: activeRequest.end || "", superintendent: "", fieldCoordinator: "", crewIds: [], crewMenCounts: {}, crewOnly: false, unassignedNeeds: [], taskIds: [] }];
    let m0 = { ...mobs[0] };

    // Crews → first mobilization, with the requested men count as a default.
    const existingCrewIds = m0.crewIds || [];
    const addCrewIds = selCrews.map((c) => c.id).filter((id) => !existingCrewIds.includes(id));
    const newCrewIds = [...existingCrewIds, ...addCrewIds];
    const newMen = { ...(m0.crewMenCounts || {}) };
    selCrews.forEach((c) => { if (reqMen && !newMen[c.id]) newMen[c.id] = reqMen; });

    // People → matching role. PM / field engineer / safety are assignment-level;
    // super / field coordinator live on the first mobilization.
    selPeople.forEach((resource) => {
      const field = roleFieldForResourceType(resource.resourceType);
      if (field === "projectManager" || field === "fieldEngineer" || field === "safety") {
        base[field] = resource.name;
      } else if (field === "superintendent" || field === "fieldCoordinator") {
        m0[field] = resource.name;
      }
    });

    const mergedTasks = Array.from(new Set([...(m0.taskIds || []), ...reqTaskIds]));
    m0 = { ...m0, crewIds: newCrewIds, crewMenCounts: newMen, taskIds: mergedTasks };
    mobs[0] = m0;
    base.mobilizations = mobs;
    setEditingAssignmentId(existing ? existing.id : null);
    setAssignmentForm(base);
    setShowRequestsModal(false);
    setShowAssignmentForm(true);
  }

  // ── Role-based UI gating ───────────────────────────────────────────────────
  // canWrite = manager or admin (can create/edit/delete data).
  // isAdmin  = admin only (can manage users/roles).
  // Viewers get read-only: write controls are hidden. The database also
  // enforces this via RLS, so this is purely to avoid showing buttons that
  // would fail.
  const canWrite = userRole === "manager" || userRole === "admin";
  const isAdmin = userRole === "admin";
  const isPM = userRole === "pm";
  const isOffice = userRole === "admin" || userRole === "manager";

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

  // ── Attention rollups (feed the summary banner + conflict/PTO modal) ────────
  // Computed from the UNFILTERED gantt item set so the banner reflects the true
  // state of the schedule regardless of which dashboard filters are active.
  const ROLE_FIELDS = ["projectManager", "superintendent", "fieldCoordinator", "fieldEngineer", "safety"];
  // (reuses the resourceByName Map declared above)

  // Group every scheduled item by the resource(s) staffing it.
  const itemsByResourceName = (() => {
    const m = new Map();
    ganttItems.forEach((item) => {
      if (!item.assignment || !item.start || !item.end) return;
      ROLE_FIELDS.forEach((field) => {
        const name = item.assignment[field];
        if (!name) return;
        if (!m.has(name)) m.set(name, []);
        m.get(name).push({ item, role: field });
      });
    });
    return m;
  })();

  // #1 Conflicts: a resource double-booked across two time-overlapping items.
  // Only Superintendents and Field Coordinators count — PMs, Safety, and Field
  // Engineers routinely span multiple jobs at once, so overlaps there are normal.
  const CONFLICT_ROLES = new Set(["superintendent", "fieldCoordinator"]);
  const conflictRows = (() => {
    const rows = [];
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    itemsByResourceName.forEach((entries, name) => {
      const sorted = [...entries].filter((e) => CONFLICT_ROLES.has(e.role)).sort((a, b) => toDate(a.item.start) - toDate(b.item.start));
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const a = sorted[i].item, b = sorted[j].item;
          // Skip two roles on the SAME mobilization (not a real conflict).
          if (a.mobilizationId && b.mobilizationId && a.mobilizationId === b.mobilizationId) continue;
          if (rangesOverlap(toDate(a.start), addDays(toDate(a.end), 1), toDate(b.start), addDays(toDate(b.end), 1))) {
            // Skip conflicts whose overlap has already fully passed — only
            // surface ones still active or upcoming. The overlap ends at the
            // EARLIER of the two end dates; if that's before today, it's done.
            const overlapEnd = toDate(a.end) < toDate(b.end) ? toDate(a.end) : toDate(b.end);
            if (overlapEnd < todayStart) continue;
            rows.push({
              resourceName: name,
              resource: resourceByName.get(name) || null,
              a, b,
              roleA: sorted[i].role, roleB: sorted[j].role,
            });
          }
        }
      }
    });
    return rows;
  })();

  // #2 Upcoming PTO: any resource PTO window that STARTS within the next 60 days.
  const ptoCollisionRows = (() => {
    const rows = [];
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const horizon = addDays(todayStart, 60);
    resources.forEach((res) => {
      (res.pto || []).filter((p) => p.start && p.end).forEach((pto) => {
        const s = toDate(pto.start);
        if (s >= todayStart && s <= horizon) {
          rows.push({ resourceName: res.name, resource: res, pto });
        }
      });
    });
    rows.sort((a, b) => toDate(a.pto.start) - toDate(b.pto.start));
    return rows;
  })();

  // Mobs starting this week / next week (Sunday-based weeks). Keep the actual
  // item rows so the banner chips can open a breakdown.
  const mobWeekRows = (() => {
    const today = new Date();
    const thisWeekStart = startOfWeek(today);
    const nextWeekStart = addDays(thisWeekStart, 7);
    const weekAfterStart = addDays(thisWeekStart, 14);
    const thisWeek = [], nextWeek = [];
    ganttItems.forEach((item) => {
      if (!item.start || !item.mobilizationId) return;
      const s = toDate(item.start);
      if (s >= thisWeekStart && s < nextWeekStart) thisWeek.push(item);
      else if (s >= nextWeekStart && s < weekAfterStart) nextWeek.push(item);
    });
    const byStart = (a, b) => toDate(a.start) - toDate(b.start);
    thisWeek.sort(byStart); nextWeek.sort(byStart);
    return { thisWeek, nextWeek };
  })();

  // Unassigned needs: every open role-slot across all mobilizations, with context.
  const unassignedNeedRows = assignments.flatMap((a) => {
    const project = findProject(projects, a.projectId) || null;
    return (a.mobilizations || []).flatMap((mob) =>
      normalizeUnassignedNeeds(mob.unassignedNeeds || mob._unassignedNeeds).map((division) => ({
        project, assignment: a, mob, division,
        start: mob.start || "",
        end: mob.end || "",
      }))
    );
  });

  const attentionCounts = {
    conflicts: conflictRows.length,
    pto: ptoCollisionRows.length,
    certs: expiringCertificationRows.length,
    mobsThisWeek: mobWeekRows.thisWeek.length,
    mobsNextWeek: mobWeekRows.nextWeek.length,
    unassigned: unassignedNeedRows.length,
  };
  const attentionTotal = attentionCounts.conflicts + attentionCounts.pto + attentionCounts.certs + attentionCounts.unassigned;
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
    const items = resourceTimelineVisibleItems.filter((item) =>
      [item.assignment.projectManager, item.assignment.superintendent, item.assignment.fieldCoordinator, item.assignment.fieldEngineer, item.assignment.safety].includes(resource.name)
    );
    if (!items.length) return null;
    return { resource, items, isUnassignedNeedRow: false };
  }).filter(Boolean);

  const unassignedNeedResourceRows = showUnassignedNeedRows
    ? Object.values(resourceUnassignedNeedItems.reduce((groups, item) => {
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

  const resourceGanttRowsWithUnassigned = (() => {
    const all = [...resourceGanttRows, ...unassignedNeedResourceRows];
    const earliestStart = (row) => {
      const dates = (row.items || []).map((i) => toDate(i.start)).filter(Boolean);
      return dates.length ? Math.min(...dates.map((d) => d.getTime())) : Number.MAX_SAFE_INTEGER;
    };
    const latestEnd = (row) => {
      const dates = (row.items || []).map((i) => toDate(i.end)).filter(Boolean);
      return dates.length ? Math.max(...dates.map((d) => d.getTime())) : 0;
    };
    return [...all].sort((a, b) => {
      // Always keep unassigned-need rows at the bottom
      const aUn = a.isUnassignedNeedRow ? 1 : 0;
      const bUn = b.isUnassignedNeedRow ? 1 : 0;
      if (aUn !== bUn) return aUn - bUn;

      if (resourceGanttSort === "name") return compareValues(a.resource.name, b.resource.name, "asc");
      if (resourceGanttSort === "homeDivision") return compareValues(a.resource.homeDivision, b.resource.homeDivision, "asc")
        || compareValues(a.resource.name, b.resource.name, "asc");
      if (resourceGanttSort === "resourceType") return compareValues(a.resource.resourceType, b.resource.resourceType, "asc")
        || compareValues(a.resource.name, b.resource.name, "asc");
      if (resourceGanttSort === "startDate") return earliestStart(a) - earliestStart(b);
      if (resourceGanttSort === "endDate") return latestEnd(a) - latestEnd(b);
      return 0;
    });
  })();

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
        itemOverlapsTimeline(item.start, item.end, crewTimeline) &&
        divisionFilter.includes(item.project.division) &&
        statusFilter.includes(item.project.status)
      );
      if (!items.length) return null;
      return { crew, items };
    }).filter(Boolean)
    .sort((a, b) => {
      const earliestStart = (row) => {
        const dates = (row.items || []).map((i) => toDate(i.start)).filter(Boolean);
        return dates.length ? Math.min(...dates.map((d) => d.getTime())) : Number.MAX_SAFE_INTEGER;
      };
      const latestEnd = (row) => {
        const dates = (row.items || []).map((i) => toDate(i.end)).filter(Boolean);
        return dates.length ? Math.max(...dates.map((d) => d.getTime())) : 0;
      };
      if (crewGanttSort === "crewName") return compareValues(a.crew.crewName, b.crew.crewName, "asc");
      if (crewGanttSort === "foremanName") return compareValues(a.crew.foremanName || "", b.crew.foremanName || "", "asc");
      if (crewGanttSort === "totalMembers") return (a.crew.totalMembers || 0) - (b.crew.totalMembers || 0);
      if (crewGanttSort === "startDate") return earliestStart(a) - earliestStart(b);
      if (crewGanttSort === "endDate") return latestEnd(a) - latestEnd(b);
      return 0;
    });

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
    const MIN_DAYS_CONTINUOUS = 28; // 4 weeks of continuous on-site time
    const byProject = new Map();

    ganttItems.forEach((item) => {
      const names = [item.assignment.projectManager, item.assignment.superintendent, item.assignment.fieldCoordinator, item.assignment.fieldEngineer, item.assignment.safety].filter(Boolean);
      if (!names.includes(resource.name)) return;
      const start = toDate(item.start);
      const end = toDate(item.end);
      if (!start || !end) return;
      if (start > today) return; // no future projects
      if (end < fiveYearsAgo) return;

      // Only count this mobilization if it is at least MIN_DAYS_CONTINUOUS
      // long ON ITS OWN. This is a per-mobilization filter — short hits are
      // dropped even if the resource visited the same project repeatedly.
      // The aggregate for a project is the union of qualifying mobilizations.
      const durationDays = Math.round((end - start) / (1000 * 60 * 60 * 24));
      if (durationDays < MIN_DAYS_CONTINUOUS) return;

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

  // Print the task schedule as a clean, paginated HTML Gantt (table-based so it
  // renders crisply and breaks across pages, rather than a screenshot).
  // Generic Gantt printer (table-based, paginates cleanly, weekend bands).
  // rows: [{ label, sublabel?, depth?, isHeader?, bars:[{start,end}], extra? }]
  // opts: { title, subtitle?, showExtra?, extraHeader? }
  function printGantt({ title, subtitle, rows, showExtra, extraHeader, legend, windowStart, windowEnd }) {
    const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch] || ch));
    const allBars = rows.flatMap((r) => r.bars || []);
    const dayMs = 86400000;
    // Two modes:
    //  • Pinned window (windowStart/windowEnd given): print EXACTLY the window
    //    being viewed — e.g. the single week the demand pop-out is showing.
    //    Bars are clipped to both ends of that window.
    //  • Default (no window): timeline starts at TODAY and runs to the latest bar.
    const pinned = Boolean(windowStart && windowEnd);
    let minD, maxD;
    if (pinned) {
      minD = toDate(windowStart); minD.setHours(0, 0, 0, 0);
      maxD = toDate(windowEnd); maxD.setHours(0, 0, 0, 0);
    } else {
      maxD = null;
      allBars.forEach((b) => { const e = toDate(b.end); if (e && (!maxD || e > maxD)) maxD = e; });
      if (!maxD) { alert("Nothing with dates to print."); return; }
      const today = new Date(); today.setHours(0, 0, 0, 0);
      minD = today;
      if (maxD < minD) maxD = minD;
    }
    if (!minD || !maxD) { alert("Nothing with dates to print."); return; }
    const totalDays = Math.max(1, Math.round((maxD - minD) / dayMs) + 1);
    const clampStart = (d) => { const x = toDate(d); return (x && x < minD) ? minD : x; };
    const clampEnd = (d) => { const x = toDate(d); return (x && x > maxD) ? maxD : x; };
    const pct = (d) => ((clampStart(d) - minD) / dayMs) / totalDays * 100;
    const barW = (s, e) => {
      const cs = clampStart(s), ce = clampEnd(e);
      if (!cs || !ce || ce < minD || cs > maxD) return 0; // outside the window → no bar
      return Math.max(0.6, (((ce - cs) / dayMs) + 1) / totalDays * 100);
    };

    // Month gridline marks, positioned as a % of the timeline column. Rendered
    // inside a table cell so they line up exactly with the bars below them.
    const monthMarks = (() => {
      const marks = [];
      const cur = new Date(minD.getFullYear(), minD.getMonth(), 1);
      // start at the first month boundary on/after today
      if (cur < minD) cur.setMonth(cur.getMonth() + 1);
      while (cur <= maxD) {
        const p = ((cur - minD) / dayMs) / totalDays * 100;
        if (p >= 0 && p <= 100) marks.push(`<span class="mark" style="left:${p}%"><span class="tick"></span><span class="lbl">${cur.toLocaleDateString(undefined, { month: "short", year: "2-digit" })}</span></span>`);
        cur.setMonth(cur.getMonth() + 1);
      }
      // vertical gridlines behind the bars too
      return marks.join("");
    })();

    const gridlines = (() => {
      let g = "", cur = new Date(minD.getFullYear(), minD.getMonth(), 1);
      if (cur < minD) cur.setMonth(cur.getMonth() + 1);
      while (cur <= maxD) {
        const p = ((cur - minD) / dayMs) / totalDays * 100;
        if (p >= 0 && p <= 100) g += `<span class="grid" style="left:${p}%"></span>`;
        cur.setMonth(cur.getMonth() + 1);
      }
      return g;
    })();
    const rowsHtml = rows.map((r) => {
      const bars = (r.bars || []).map((b) => {
        const w = barW(b.start, b.end);
        if (w <= 0) return ""; // fully in the past — table still shows real dates
        const color = b.color || (r.isHeader ? "#334155" : "#047857");
        return `<div class="bar" style="left:${pct(b.start)}%;width:${w}%;background:${color}"></div>`;
      }).join("");
      const firstStart = (r.bars && r.bars.length) ? r.bars.reduce((m, b) => (!m || toDate(b.start) < toDate(m) ? b.start : m), null) : null;
      const lastEnd = (r.bars && r.bars.length) ? r.bars.reduce((m, b) => (!m || toDate(b.end) > toDate(m) ? b.end : m), null) : null;
      const cls = r.isHeader ? "hdr" : "";
      return `<tr class="${cls}">
        <td class="name" style="padding-left:${8 + (r.depth || 0) * 16}px">${esc(r.label)}${r.sublabel ? `<br><span class="pred">${esc(r.sublabel)}</span>` : ""}</td>
        <td class="date">${firstStart ? esc(formatDate(firstStart)) : "—"}</td>
        <td class="date">${lastEnd ? esc(formatDate(lastEnd)) : "—"}</td>
        ${showExtra ? `<td class="assigned">${r.extra ? esc(r.extra) : "<span class='muted'>—</span>"}</td>` : ""}
        <td class="barcell"><div class="track">${gridlines}${bars}</div></td>
      </tr>`;
    }).join("");

    const nameW = showExtra ? 20 : 24, dateW = 8, extraW = 16, barW2 = showExtra ? 48 : 60;
    const html = `<!doctype html><html><head><title>${esc(title)}</title><style>
      @page{size:17in 11in;margin:.4in} *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact} body{font-family:Arial,sans-serif;color:#0f172a;font-size:10px;margin:0}
      .header{display:flex;justify-content:space-between;align-items:center;gap:18px;border-bottom:4px solid #047857;padding-bottom:10px;margin-bottom:8px}
      .header-left{display:flex;align-items:center;gap:12px}.logo{height:46px;width:auto;display:block}
      h1{font-size:18px;margin:0}.sub{color:#64748b;font-size:11px}
      .axisrow th{background:#fff;border-bottom:1px solid #cbd5e1;padding:0}
      .axiscell{padding:0 6px !important}
      .axis{position:relative;height:14px}
      .mark{position:absolute;font-size:8px;color:#64748b}
      .mark .tick{position:absolute;top:12px;left:0;width:1px;height:4px;background:#cbd5e1}
      .mark .lbl{position:absolute;top:2px;left:2px;white-space:nowrap}
      .grid{position:absolute;top:0;bottom:0;width:1px;background:#eef2f7}
      .legend{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 4px;font-size:9px;color:#334155}
      .legend .lg{display:inline-flex;align-items:center;gap:4px}
      .legend .sw{display:inline-block;width:12px;height:10px;border-radius:2px}
      table{width:100%;border-collapse:collapse;table-layout:fixed}
      thead{display:table-header-group}
      th{background:#f1f5f9;text-align:left;padding:5px 6px;border-bottom:2px solid #cbd5e1;font-size:9px;text-transform:uppercase;letter-spacing:.03em}
      td{padding:5px 6px;border-bottom:1px solid #e2e8f0;vertical-align:middle}
      tr{break-inside:avoid}
      col.c-name{width:${nameW}%}col.c-date{width:${dateW}%}col.c-assigned{width:${extraW}%}col.c-bar{width:${barW2}%}
      .name{font-weight:600}.pred{color:#64748b;font-weight:400;font-size:8.5px}
      .date{color:#334155;white-space:nowrap}.assigned{color:#065f46;font-size:9px}.muted{color:#94a3b8}
      .barcell{padding:4px 6px}.track{position:relative;height:14px;background:#f1f5f9;border-radius:7px}
      .bar{position:absolute;top:0;height:14px;background:#047857;border-radius:7px;min-width:3px}
      tr.hdr td{background:#e2e8f0;font-weight:800;text-transform:uppercase;font-size:9px;letter-spacing:.03em}
      .hdrbar{background:#334155}
    </style></head><body>
      <div class="header">
        <div class="header-left"><img id="ggc-logo" class="logo" src="${window.location.origin}/logo.png" alt="GGC" onerror="this.style.display='none';window.__logoDone&&window.__logoDone();" onload="window.__logoDone&&window.__logoDone();"/>
          <div><h1>${esc(title)}</h1><p class="sub">${esc(subtitle || "")} · Timeline ${esc(formatDate(minD.toISOString()))} – ${esc(formatDate(maxD.toISOString()))}${pinned ? "" : " (today forward)"}</p></div></div>
        <div class="sub">Generated ${new Date().toLocaleDateString()}</div>
      </div>
      ${(legend && legend.length) ? `<div class="legend">${legend.map((l) => `<span class="lg"><span class="sw" style="background:${l[0]}"></span>${esc(l[1])}</span>`).join("")}</div>` : ""}
      <table>
        <colgroup><col class="c-name"/><col class="c-date"/><col class="c-date"/>${showExtra ? '<col class="c-assigned"/>' : ""}<col class="c-bar"/></colgroup>
        <thead>
          <tr><th>${esc(extraHeader && extraHeader.name ? extraHeader.name : "Item")}</th><th>Start</th><th>End</th>${showExtra ? `<th>${esc(extraHeader && extraHeader.extra ? extraHeader.extra : "Detail")}</th>` : ""}<th>Timeline</th></tr>
          <tr class="axisrow"><th colspan="${showExtra ? 4 : 3}"></th><th class="axiscell"><div class="axis">${monthMarks}</div></th></tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <script>(function(){var done=false;window.__logoDone=function(){if(done)return;done=true;setTimeout(function(){window.print();},100);};setTimeout(function(){if(!done){done=true;window.print();}},2500);})();<\/script>
    </body></html>`;
    const w = window.open("", "_blank", "width=1200,height=900");
    if (!w) { alert("Allow pop-ups to print."); return; }
    w.document.write(html);
    w.document.close();
  }

  function printTaskSchedule() {
    if (!schedProjectId) { alert("Pick a project first."); return; }
    const proj = findProject(projects, schedProjectId);
    const tasks = (groupedTasks || []).filter((t) => t.eff_start && t.eff_end);
    if (!tasks.length) { alert("This project has no dated tasks to print."); return; }
    const title = proj ? `${proj.projectNumber ? proj.projectNumber + " - " : ""}${proj.name}` : "Task Schedule";
    const statusColor = (t) => {
      if (t.isHeader) return "#334155";
      const rq = (taskCrewRequests || []).filter((r) => (r.task_crew_request_links || []).some((l) => l.task_id === t.id));
      if (rq.some((r) => r.status === "approved")) return "#047857"; // emerald
      if (rq.some((r) => r.status === "pending")) return "#f59e0b";  // amber
      return "#94a3b8"; // slate
    };
    const rows = (groupedTasks || []).map((t) => {
      const has = t.eff_start && t.eff_end;
      const predName = (!t.isHeader && t.depends_on) ? (taskNameById.get(t.depends_on) || "") : "";
      const predTag = (!t.isHeader && t.depends_on) ? depTag(t.dependency_type, t.dependency_lag) : "";
      return {
        label: t.name,
        sublabel: predName ? `↳ ${predName} ${predTag}` : "",
        depth: t.depth || 0,
        isHeader: !!t.isHeader,
        bars: has ? [{ start: t.eff_start, end: t.eff_end, color: statusColor(t) }] : [],
      };
    });
    // Client-facing schedule: no assigned crew/labor info. Colors match the
    // on-screen status (emerald = approved, amber = pending, slate = none).
    printGantt({ title, subtitle: "Task Schedule", rows, showExtra: false, extraHeader: { name: "Task / Predecessor" },
      legend: [["#047857", "Approved"], ["#f59e0b", "Pending"], ["#94a3b8", "No crew request"]] });
  }

  function printProjectGantt() {
    const usedDivs = new Set();
    const rows = (projectGanttRows || []).map((row) => {
      const color = divisionSvgColors[row.project.division] || "#475569";
      if (row.project.division) usedDivs.add(row.project.division);
      const bars = (row.items || []).filter((i) => i.start && i.end).map((i) => ({ start: i.start, end: i.end, color }));
      return {
        label: `${row.project.projectNumber ? row.project.projectNumber + " - " : ""}${row.project.name}`,
        sublabel: row.project.status || "",
        bars,
      };
    }).filter((r) => r.bars.length);
    if (!rows.length) { alert("Nothing to print in the Project Assignment Gantt."); return; }
    const legend = [...usedDivs].map((d) => [divisionSvgColors[d] || "#475569", d]);
    printGantt({ title: "Project Assignment Gantt", subtitle: "Projects", rows, showExtra: false, extraHeader: { name: "Project" }, legend });
  }

  function printResourceGantt() {
    const usedDivs = new Set();
    const rows = (resourceGanttRowsWithUnassigned || []).map((row) => {
      const bars = (row.items || []).filter((i) => i.start && i.end).map((i) => {
        const div = i.project && i.project.division;
        if (div) usedDivs.add(div);
        return { start: i.start, end: i.end, color: divisionSvgColors[div] || "#475569" };
      });
      return {
        label: row.resource.name,
        sublabel: row.resource.resourceType || "",
        bars,
      };
    }).filter((r) => r.bars.length);
    if (!rows.length) { alert("Nothing to print in the Resource Gantt."); return; }
    const legend = [...usedDivs].map((d) => [divisionSvgColors[d] || "#475569", d]);
    printGantt({ title: "Resource Gantt", subtitle: "Resources", rows, showExtra: false, extraHeader: { name: "Resource" }, legend });
  }

  function printCrewGantt() {
    const usedDivs = new Set();
    const rows = (crewGanttRows || []).map((row) => {
      const bars = (row.items || []).filter((i) => i.start && i.end).map((i) => {
        const div = i.project && i.project.division;
        if (div) usedDivs.add(div);
        return { start: i.start, end: i.end, color: divisionSvgColors[div] || "#475569" };
      });
      return {
        label: row.crew.crewName,
        sublabel: row.crew.foremanName || "",
        bars,
      };
    }).filter((r) => r.bars.length);
    if (!rows.length) { alert("Nothing to print in the Crew Gantt."); return; }
    const legend = [...usedDivs].map((d) => [divisionSvgColors[d] || "#475569", d]);
    printGantt({ title: "Crew Gantt", subtitle: "Crews", rows, showExtra: false, extraHeader: { name: "Crew" }, legend });
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
      @page{size:letter;margin:.45in} body{font-family:Arial,sans-serif;color:#0f172a;font-size:11px} h1{font-size:24px;margin:0} h2{font-size:14px;margin:18px 0 6px;border-bottom:2px solid #047857;padding-bottom:4px} h3{font-size:12px;margin:0 0 6px;color:#065f46}.header{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;border-bottom:4px solid #047857;padding-bottom:12px}.header-left{display:flex;align-items:center;gap:14px}.logo{height:54px;width:auto;flex-shrink:0;display:block}.muted{color:#64748b}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.stat{border:1px solid #e2e8f0;border-radius:10px;padding:10px;background:#f8fafc}.stat ol{margin:0;padding-left:18px}.stat li{margin:4px 0}.stat li strong{float:right} table{width:100%;border-collapse:collapse} th{background:#f1f5f9;text-align:left;padding:6px;border-bottom:2px solid #cbd5e1}td{padding:6px;border-bottom:1px solid #e2e8f0;vertical-align:top}span{color:#64748b}.small{font-size:10px;color:#64748b}.criteria{font-size:9px;color:#64748b;font-style:italic;margin:0 0 6px}
    </style></head><body>
      <div class="header"><div class="header-left"><img id="ggc-logo" class="logo" src="${window.location.origin}/logo.png" alt="GGC" onerror="this.style.display='none';window.__logoDone&&window.__logoDone();" onload="window.__logoDone&&window.__logoDone();"/><div><h1>${escapeHtml(resource.name)}</h1><p class="muted">${escapeHtml(resource.resourceType)} • ${escapeHtml(resource.homeDivision)}</p></div></div><div class="small">${escapeHtml(resource.phone)}<br>${escapeHtml(resource.email)}<br>Generated ${new Date().toLocaleDateString()}</div></div>
      <h2>Top Experience Stats</h2><div class="grid">${statList("Owners", stats.owners)}${statList("Architects", stats.architects)}${statList("Engineers", stats.engineers)}${statList("Project Types", stats.projectTypes)}</div>
      <h2>Current Certifications</h2><table><thead><tr><th>Certification</th><th>Start Date</th><th>Expiration Date</th></tr></thead><tbody>${certRows || `<tr><td colspan="3" class="muted">No current certifications listed.</td></tr>`}</tbody></table>
      <h2>Project Experience — Past 5 Years</h2><p class="criteria">Includes only continuous on-site assignments of 4 weeks or longer. Future projects are excluded.</p><table><thead><tr><th>Project</th><th>Type</th><th>Owner</th><th>Architect</th><th>Engineer</th><th>Dates</th></tr></thead><tbody>${projectRows || `<tr><td colspan="6" class="muted">No qualifying project history found.</td></tr>`}</tbody></table>
      <script>
        // Wait for the logo to finish loading (or fail) before triggering
        // print, so the logo isn't missing in the printed PDF. Fallback
        // timeout in case onload/onerror never fires.
        (function(){
          var done = false;
          window.__logoDone = function(){ if (done) return; done = true; setTimeout(function(){window.print();}, 100); };
          setTimeout(function(){ if (!done) { done = true; window.print(); } }, 2500);
        })();
      <\/script>
    </body></html>`;
    const w = window.open("", "_blank", "width=950,height=1100");
    if (!w) { alert("Please allow pop-ups to export the resume."); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  // ── CRUD: Projects ─────────────────────────────────────────────────────────
  function openAddProjectForm() { setEditingProjectId(null); setProjectForm({ ...blankProject, pmIds: [] }); setShowProjectForm(true); }
  function openEditProjectForm(project) { setEditingProjectId(project.id); setProjectForm({ ...blankProject, ...project, pmIds: projectPmMap[project.id] || [] }); setShowProjectForm(true); }

  async function saveProject() {
    if (!projectForm.name.trim()) { alert("Project name is required."); return; }
    if (!supabase) { alert("Supabase is not connected. Check Vercel environment variables."); return; }
    const payload = projectToDbLocal(projectForm);
    const pmIds = projectForm.pmIds || [];
    let savedId = editingProjectId;
    if (editingProjectId) {
      const { data, error } = await supabase.from("projects").update(payload).eq("id", editingProjectId).select().single();
      if (error) { console.error(error); alert("Could not update project."); return; }
      setProjects((current) => current.map((p) => (p.id === editingProjectId ? mapProjectFromDbLocal(data) : p)));
    } else {
      const { data, error } = await supabase.from("projects").insert(payload).select().single();
      if (error) { console.error(error); alert("Could not save project."); return; }
      setProjects((current) => [mapProjectFromDbLocal(data), ...current]);
      savedId = data.id;
    }
    // Persist PM assignments (admin only — RLS will reject others). Replace the
    // full set: delete existing rows then insert the chosen ones.
    if (isAdmin && savedId) {
      const { error: delErr } = await supabase.from("project_pms").delete().eq("project_id", savedId);
      if (delErr) console.error("Clear PMs error:", delErr);
      if (pmIds.length) {
        const rows = pmIds.map((profile_id) => ({ project_id: savedId, profile_id }));
        const { error: insErr } = await supabase.from("project_pms").insert(rows);
        if (insErr) console.error("Insert PMs error:", insErr);
      }
      setProjectPmMap((m) => ({ ...m, [savedId]: [...pmIds] }));
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
  async function loadAssignmentTasks(projectId) {
    if (!supabase || !projectId) { setAssignmentTasks([]); return; }
    const { data, error } = await supabase
      .from("project_tasks").select("*").eq("project_id", projectId).order("sort_order", { ascending: true });
    if (error) { console.warn("Could not load tasks for assignment:", error); setAssignmentTasks([]); return; }
    setAssignmentTasks(data || []);
  }

  function openAddAssignmentForm() {
    setEditingAssignmentId(null);
    setAssignmentTasks([]);
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
        taskIds: Array.isArray(mob.taskIds) ? mob.taskIds : [],
      };
    });
    setAssignmentForm({
      projectId: assignment.projectId || "",
      projectManager: assignment.projectManager || "",
      fieldEngineer: assignment.fieldEngineer || "",
      safety: assignment.safety || "",
      mobilizations: mobs,
    });
    loadAssignmentTasks(assignment.projectId);
    setShowAssignmentForm(true);
  }

  // ── Drag-to-adjust on the Project Assignment Gantt ────────────────────────
  // When a bar is dragged in the Project Gantt, DraggableGanttBar calls this
  // with the new dates. We open a Save/Cancel confirmation dialog; the user
  // must explicitly confirm before the database is touched.
  const [pendingDragChange, setPendingDragChange] = useState(null);
  const [savingDragChange, setSavingDragChange] = useState(false);

  function handleProjectGanttDragEnd(payload) {
    setPendingDragChange(payload);
  }

  async function applyPendingDragChange() {
    if (!pendingDragChange || !supabase) return;
    setSavingDragChange(true);
    const { mobilizationId, assignmentId, newStart, newEnd } = pendingDragChange;
    try {
      // Update the mobilization row in place. Note the column names are
      // `start_date` / `end_date` in Supabase even though we use `start` /
      // `end` in our local state — see mobilizationToDb mapper for the
      // canonical mapping. Sending `start`/`end` here would fail with a
      // generic 400 because those columns don't exist on the table.
      const { error } = await supabase
        .from("mobilizations")
        .update({ start_date: newStart, end_date: newEnd })
        .eq("id", mobilizationId);
      if (error) {
        console.error("Drag save error:", error);
        alert(`Could not save the date change.\n\nReason: ${error.message || error.hint || "Unknown error"}\n\nOpen DevTools (F12) → Console for details.`);
        setSavingDragChange(false);
        return;
      }
      // Optimistically patch local state so the UI reflects the saved
      // values immediately, without waiting for a refetch.
      setAssignments((current) => current.map((a) => {
        if (a.id !== assignmentId) return a;
        const newMobs = (a.mobilizations || []).map((m) =>
          m.id === mobilizationId ? { ...m, start: newStart, end: newEnd } : m
        );
        // For the first mobilization we also mirror onto the assignment-level
        // start/end so the rest of the app stays consistent with how
        // saveAssignment writes data.
        const isFirst = a.mobilizations?.[0]?.id === mobilizationId;
        return {
          ...a,
          mobilizations: newMobs,
          ...(isFirst ? { start: newStart, end: newEnd } : {}),
        };
      }));
      setPendingDragChange(null);
    } finally {
      setSavingDragChange(false);
    }
  }

  function cancelPendingDragChange() {
    setPendingDragChange(null);
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
    // Match by start+end date first since mapped mobs come back sorted, which
    // may not match the form's original ordering.
    const formMobs = (assignmentForm.mobilizations || []).filter((m) => m.start && m.end);
    mapped = {
      ...mapped,
      mobilizations: (mapped.mobilizations || []).map((mob, index) => {
        const formMob = formMobs.find((m) => String(m.start || "") === String(mob.start || "") && String(m.end || "") === String(mob.end || "")) || formMobs[index];
        return formMob ? { ...mob, unassignedNeeds: normalizeUnassignedNeeds(formMob.unassignedNeeds) } : mob;
      }),
    };
    if (editingAssignmentId) setAssignments((current) => current.map((a) => (a.id === editingAssignmentId ? mapped : a)));
    else setAssignments((current) => [mapped, ...current]);

    // If this assignment was created to fulfill a crew request, mark that
    // request approved and record the assigned crew + the saved mobilization.
    if (fulfillingRequest && fulfillingRequest.kind === "crew" && supabase) {
      const reqTaskIds = Array.isArray(fulfillingRequest.taskIds) ? fulfillingRequest.taskIds : [];
      // Find the saved mobilization that covers this request's tasks (fallback: first).
      const mobForReq = (savedMobs || []).find((m) =>
        Array.isArray(m.task_ids) && reqTaskIds.some((tid) => m.task_ids.includes(tid))
      ) || (savedMobs || [])[0];
      const assignedCrewId = mobForReq && Array.isArray(mobForReq.crew_ids) && mobForReq.crew_ids.length ? mobForReq.crew_ids[0] : null;
      const { error: apprErr } = await supabase
        .from("task_crew_requests")
        .update({
          status: "approved",
          assigned_crew_id: assignedCrewId,
          mobilization_id: mobForReq ? mobForReq.id : null,
          resolved_by: (await supabase.auth.getUser()).data.user?.id || null,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", fulfillingRequest.id);
      if (apprErr) console.error("Could not mark request approved:", apprErr);
      if (schedProjectId) loadProjectSchedule(schedProjectId);
      loadAllRequests();
    }
    setFulfillingRequest(null);
    setActiveRequest(null);

    setShowAssignmentForm(false); setEditingAssignmentId(null);
    setAssignmentTasks([]);
    setAssignmentForm({ ...blankAssignment, mobilizations: [{ id: crypto.randomUUID(), start: "", durationWeeks: "", end: "", superintendent: "", fieldCoordinator: "", crewIds: [], crewMenCounts: {}, crewOnly: false, unassignedNeeds: [] }] });
  }

  async function deleteAssignment(id) {
    const assignment = assignments.find((a) => a.id === id);
    const project = assignment ? findProject(projects, assignment.projectId) : null;
    if (!confirm(`Delete assignment for ${project?.name || "this project"}?`)) return false;
    if (!supabase) { alert("Supabase is not connected."); return false; }
    const { error } = await supabase.from("assignments").delete().eq("id", id);
    if (error) { console.error(error); alert("Could not delete assignment."); return false; }
    setAssignments((current) => current.filter((a) => a.id !== id));
    return true;
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
  function openAddCrewForm() { setEditingCrewId(null); setCrewForm({ ...blankCrew, crewType: [] }); setShowCrewForm(true); }
  function openEditCrewForm(crew) { setEditingCrewId(crew.id); setCrewForm({ ...blankCrew, ...crew, crewType: Array.isArray(crew.crewType) ? crew.crewType : [], deactivated: isCrewDeactivated(crew) }); setShowCrewForm(true); }

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

  async function loadCrewTypes() {
    if (!supabase) return;
    const { data, error } = await supabase.from("crew_types").select("name").order("name", { ascending: true });
    if (error) { console.warn("Crew types table is not set up yet:", error); return; }
    if (data?.length) setCrewTypes(data.map((row) => row.name));
  }
  async function loadAllTaskNames() {
    if (!supabase) return;
    const { data, error } = await supabase.from("project_tasks").select("id, name");
    if (error) { console.warn("Could not load task names:", error); return; }
    const map = {};
    (data || []).forEach((t) => { map[t.id] = t.name; });
    setAllTaskNames(map);
  }
  async function addCrewType() {
    const type = newCrewType.trim();
    if (!type) return;
    if (crewTypes.includes(type)) { setNewCrewType(""); return; }
    if (supabase) {
      const { error } = await supabase.from("crew_types").insert({ name: type });
      if (error) { console.error(error); alert("Could not add crew type."); return; }
    }
    setCrewTypes((current) => current.includes(type) ? current : [...current, type].sort());
    setNewCrewType("");
  }
  async function deleteCrewType(type) {
    if (!confirm(`Delete crew type ${type}? Existing crews keep their saved value.`)) return;
    if (supabase) {
      const { error } = await supabase.from("crew_types").delete().eq("name", type);
      if (error) { console.error(error); alert("Could not delete crew type."); return; }
    }
    setCrewTypes((current) => current.filter((item) => item !== type));
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

  // Get the number of UNIQUE onsite days a project has in a given month.
  //
  // A project usually has multiple assignment rows (one per role: PM,
  // Superintendent, Field Coordinator, etc), and each role's row holds its
  // own mobilization records. Different roles often have overlapping
  // mobilizations covering the same calendar dates. We must NOT count those
  // overlaps multiple times — the project is physically onsite for one
  // stretch regardless of how many people are working it.
  //
  // Algorithm: gather every mobilization range, merge overlaps into a set
  // of disjoint ranges, then sum days that fall inside the requested month.
  function getProjectDaysInMonth(projectId, monthKey) {
    const [year, month] = monthKey.split("-").map(Number);
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0); // last day of the month

    // Step 1: collect every mobilization range for this project.
    const ranges = [];
    assignments
      .filter((a) => a.projectId === projectId)
      .forEach((a) => {
        (a.mobilizations || []).forEach((mob) => {
          const s = toDate(mob.start);
          const e = toDate(mob.end);
          if (s && e && s <= e) ranges.push([s, e]);
        });
      });
    if (ranges.length === 0) return 0;

    // Step 2: merge overlapping/adjacent ranges. Sort by start, then walk
    // through; each new range either extends the current cluster or starts
    // a new one.
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [ranges[0].slice()];
    for (let i = 1; i < ranges.length; i++) {
      const last = merged[merged.length - 1];
      const [s, e] = ranges[i];
      if (s <= last[1]) {
        // Overlapping or touching — extend the cluster's end if needed.
        if (e > last[1]) last[1] = e;
      } else {
        merged.push([s, e]);
      }
    }

    // Step 3: for each merged range, count days that fall inside the month.
    let days = 0;
    for (const [s, e] of merged) {
      const overlapStart = s > monthStart ? s : monthStart;
      const overlapEnd   = e < monthEnd   ? e : monthEnd;
      if (overlapStart <= overlapEnd) {
        days += Math.ceil((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)) + 1;
      }
    }
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

    // Locked months show their original day-weighted spread amount but the
    // user can't change them. Their value still counts against the contract,
    // so they MUST be subtracted from remaining before redistributing the
    // rest. Otherwise the locked months and the redistributed months together
    // sum to MORE than the contract value (the bug we just fixed).
    const baseSpread = spreadRevenue(row.contractValue || 0, allMonths, row.spreadRule, projectId);
    const lockedTotal = allMonths
      .filter((m) => isMonthLocked(m) && actuals[m] === undefined)
      .reduce((s, m) => s + (baseSpread[m] || 0), 0);

    const remaining = (row.contractValue || 0) - totalActuals - lockedTotal;
    const remainingMonths = allMonths.filter((m) => actuals[m] === undefined && !isMonthLocked(m));
    if (remainingMonths.length > 0 && remaining !== 0) {
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

  // Per-render cache so getMonthValue doesn't recompute the same project's
  // spread 12 times in a row (once per month cell). Keyed by projectId →
  // {baseSpread, redistributed, allMonths, actuals}. Cleared by re-render
  // because the Map is a useRef whose .current we wipe on dependency change.
  const spreadCacheRef = useRef(new Map());
  // Bust the cache whenever forecast data, lock state, or assignments change.
  // We use a dependency-tracking effect rather than useMemo because the cache
  // is populated lazily by getMonthValue calls during render.
  useEffect(() => { spreadCacheRef.current = new Map(); },
    [forecastData, globalLockThrough, assignments, projects, forecastKey]);

  function computeProjectSpread(projectId) {
    const cached = spreadCacheRef.current.get(projectId);
    if (cached) return cached;

    const row = getForecastRow(projectId);
    const allMonths = getProjectMonths(projectId);
    const actuals = row.actuals || {};
    const contractValue = row.contractValue || 0;

    const baseSpread = spreadRevenue(contractValue, allMonths, row.spreadRule, projectId);
    const totalActuals = Object.values(actuals).reduce((s, v) => s + v, 0);
    const lockedTotal = allMonths
      .filter((m) => isMonthLocked(m) && actuals[m] === undefined)
      .reduce((s, m) => s + (baseSpread[m] || 0), 0);

    const remaining = contractValue - totalActuals - lockedTotal;
    const remainingMonths = allMonths.filter((m) => actuals[m] === undefined && !isMonthLocked(m));
    const redistributed = (remainingMonths.length > 0 && remaining !== 0)
      ? spreadRevenue(remaining, remainingMonths, row.spreadRule, projectId)
      : {};

    const result = { baseSpread, redistributed, allMonths, actuals };
    spreadCacheRef.current.set(projectId, result);
    return result;
  }

  // Get the value to display for a single month.
  //   - Actual entered → return that.
  //   - Month is locked (no actual) → return base-spread amount.
  //   - Otherwise → return redistributed amount, but only flag the cell as
  //     "isRedistributed" when there's an actual value to show. Months
  //     with no onsite days return value=0 with no flag, so the cell
  //     renders blank rather than as a styled "0" placeholder.
  function getMonthValue(projectId, monthKey, _legacySpreadIgnored) {
    const row = getForecastRow(projectId);
    const actuals = row.actuals || {};
    if (actuals[monthKey] !== undefined) {
      return { value: actuals[monthKey], isActual: true };
    }
    const { baseSpread, redistributed } = computeProjectSpread(projectId);
    if (isMonthLocked(monthKey)) {
      return { value: baseSpread[monthKey] || 0, isActual: false };
    }
    const v = redistributed[monthKey];
    if (v === undefined || v === 0) {
      return { value: 0, isActual: false };
    }
    return { value: v, isActual: false, isRedistributed: true };
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

    // Subtract locked-month spread values from remaining too — see comment
    // on recalculateProject. Without this, redistribution over-allocates.
    const baseSpread = spreadRevenue(row.contractValue || 0, allMonths, row.spreadRule, projectId);
    const lockedTotal = allMonths
      .filter((m) => isMonthLocked(m) && newActuals[m] === undefined)
      .reduce((s, m) => s + (baseSpread[m] || 0), 0);

    const remaining = (row.contractValue || 0) - totalActuals - lockedTotal;
    const remainingMonths = allMonths.filter((m) => newActuals[m] === undefined && !isMonthLocked(m));

    if (remainingMonths.length > 0 && remaining !== 0) {
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

    // Use the NEW rule when calculating locked-month base spread, since
    // changing the rule changes how locked months would have been
    // distributed in the original spread.
    const baseSpread = spreadRevenue(row.contractValue || 0, allMonths, newRule, projectId);
    const lockedTotal = allMonths
      .filter((m) => isMonthLocked(m) && actuals[m] === undefined)
      .reduce((s, m) => s + (baseSpread[m] || 0), 0);

    const remaining = (row.contractValue || 0) - totalActuals - lockedTotal;
    const remainingMonths = allMonths.filter((m) => actuals[m] === undefined && !isMonthLocked(m));
    const redistributed = remainingMonths.length > 0 && remaining !== 0
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
  // Single source of truth for "which projects are visible on the Forecast
  // screen right now." Used by the on-screen render AND both export
  // functions, so a CSV / PDF download always matches what the user sees.
  // Includes division filter, status (no Complete), include-in-forecast
  // (with the Pending Award opt-in rule), and the search box.
  // Pending Award projects sort to the bottom of the table (within the
  // already-filtered set). Within each group (current first, pending after),
  // original project order is preserved.
  function getVisibleForecastProjects() {
    const filtered = projects.filter((p) => {
      if (!forecastDivisionFilter.includes(p.division)) return false;
      if (p.status === "Complete") return false;
      if (p.status === "Pending Award" && !p.includeInForecast) return false;
      if (!p.includeInForecast) return false;
      if (forecastSearch) {
        const q = forecastSearch.toLowerCase();
        return (p.projectNumber || "").toLowerCase().includes(q)
          || p.name.toLowerCase().includes(q)
          || (p.client || "").toLowerCase().includes(q);
      }
      return true;
    });
    // Stable partition: non-pending first, pending last. Array.sort with
    // a (a,b)=>0 tiebreaker is stable in modern JS engines, preserving
    // input order within each group.
    return filtered.sort((a, b) => {
      const aPending = a.status === "Pending Award" ? 1 : 0;
      const bPending = b.status === "Pending Award" ? 1 : 0;
      return aPending - bPending;
    });
  }

  function exportForecastCsv() {
    const months = Array.from({ length: 12 }, (_, i) => `${forecastYear}-${String(i + 1).padStart(2, "0")}`);
    const headers = ["Project #", "Project Name", "Division", "Status", "Contract Value", "Spread Rule", "Per-Project Lock", ...months.map((m) => m), "Year Total", "Thereafter"];
    const forecastProjects = getVisibleForecastProjects();
    const rows = forecastProjects.map((p) => {
      const row = getForecastRow(p.id);
      const allMonths = getProjectMonths(p.id);
      const spread = spreadRevenue(row.contractValue, allMonths, row.spreadRule);
      const yearValues = months.map((m) => getMonthValue(p.id, m, spread).value);
      const yearTotal = yearValues.reduce((s, v) => s + v, 0);
      const thereafter = allMonths.filter((m) => m > `${forecastYear}-12`).reduce((s, m) => s + getMonthValue(p.id, m).value, 0);
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
    const forecastProjects = getVisibleForecastProjects()
      .sort((a, b) => compareValues(a[forecastSort.key], b[forecastSort.key], forecastSort.direction));
    const fmt = (v) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v || 0);

    const rows = forecastProjects.map((p, idx) => {
      const row = getForecastRow(p.id);
      const allMonths = getProjectMonths(p.id);
      const spread = spreadRevenue(row.contractValue, allMonths, row.spreadRule);
      const monthValues = months.map((m) => getMonthValue(p.id, m.key, spread));
      const yearTotal = monthValues.reduce((s, mv) => s + mv.value, 0);
      const thereafter = allMonths.filter((m) => m > `${forecastYear}-12`).reduce((s, m) => s + getMonthValue(p.id, m).value, 0);
      const bg = idx % 2 === 0 ? "#f8fafc" : "#ffffff";
      const cells = monthValues.map((mv) => `<td style="padding:4px 6px;text-align:right;color:${mv.isActual ? "#065f46" : (mv.value < 0 ? "#b91c1c" : "#334155")};font-weight:${mv.isActual ? "600" : "400"}">${mv.value !== 0 ? fmt(mv.value) : ""}</td>`).join("");
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
      const allMonths = getProjectMonths(p.id);
      return s + allMonths.filter((m) => m > `${forecastYear}-12`).reduce((ms, m) => ms + getMonthValue(p.id, m).value, 0);
    }, 0);
    // Sum of all visible projects' contract values — shows up in the
    // Monthly Total row's Contract Value column so the PDF matches what
    // the on-screen Forecast tab now displays.
    const contractValueTotal = forecastProjects.reduce((s, p) => {
      const row = getForecastRow(p.id);
      return s + (Number(row.contractValue) || 0);
    }, 0);
    const cumulative = monthTotals.map((_, i) => monthTotals.slice(0, i + 1).reduce((s, v) => s + v, 0));

    const headerCells = months.map((m) => `<th style="padding:4px 6px;text-align:right;background:#f1f5f9">${m.label}</th>`).join("");
    const totalCells = monthTotals.map((v) => `<td style="padding:4px 6px;text-align:right;font-weight:700">${fmt(v)}</td>`).join("");
    const cumCells = cumulative.map((v) => `<td style="padding:4px 6px;text-align:right;color:#065f46">${fmt(v)}</td>`).join("");

    // Build the page: branded header (GGC logo + title) + table.
    // Print is delayed until the logo image has loaded (or fails to load)
    // so the logo doesn't disappear from the printed PDF — same pattern as
    // the resume export. 2.5s fallback in case onload/onerror never fires.
    const html = `<!doctype html><html><head><title>GGC Forecast ${forecastYear}</title><style>
      @page{size:landscape;margin:.3in}
      body{font-family:Arial,sans-serif;font-size:10px;color:#0f172a;margin:0}
      table{border-collapse:collapse;width:100%}
      th{background:#f1f5f9;padding:4px 6px;text-align:left;border-bottom:2px solid #cbd5e1}
      td{border-bottom:1px solid #e2e8f0}
      .header{display:flex;justify-content:space-between;align-items:flex-end;gap:18px;border-bottom:4px solid #047857;padding-bottom:10px;margin-bottom:10px}
      .header-left{display:flex;align-items:center;gap:14px}
      .logo{height:48px;width:auto;flex-shrink:0;display:block}
      h1{font-size:18px;margin:0;color:#0f172a}
      .subtitle{font-size:11px;color:#64748b;margin-top:2px}
      .small{font-size:10px;color:#64748b;text-align:right}
    </style></head><body>
      <div class="header">
        <div class="header-left">
          <img id="ggc-logo" class="logo" src="${window.location.origin}/logo.png" alt="GGC" onerror="this.style.display='none';window.__logoDone&&window.__logoDone();" onload="window.__logoDone&&window.__logoDone();"/>
          <div>
            <h1>Revenue Forecast — ${forecastYear}</h1>
            <p class="subtitle">${forecastProjects.length} projects · ${forecastDivisionFilter.join(", ")}</p>
          </div>
        </div>
        <div class="small">Generated ${new Date().toLocaleDateString()}</div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th>Division</th>
            <th style="text-align:right">Contract Value</th>
            ${headerCells}
            <th style="text-align:right;background:#e2e8f0">Thereafter</th>
            <th style="text-align:right;background:#e2e8f0">Year Total</th>
          </tr>
        </thead>
        <tbody>
          ${rows.join("")}
          <tr style="background:#f1f5f9;font-weight:700">
            <td colspan="2" style="padding:4px 6px">Monthly Total</td>
            <td style="padding:4px 6px;text-align:right">${fmt(contractValueTotal)}</td>
            ${totalCells}
            <td style="padding:4px 6px;text-align:right">${fmt(thereafterTotal)}</td>
            <td style="padding:4px 6px;text-align:right">${fmt(yearGrandTotal)}</td>
          </tr>
          <tr style="background:#ecfdf5;color:#065f46">
            <td colspan="3" style="padding:4px 6px;font-weight:700">Cumulative YTD</td>
            ${cumCells}
            <td></td>
            <td style="padding:4px 6px;text-align:right;font-weight:700">${fmt(yearGrandTotal)}</td>
          </tr>
        </tbody>
      </table>
      <script>
        (function(){
          var done = false;
          window.__logoDone = function(){ if (done) return; done = true; setTimeout(function(){window.print();}, 100); };
          setTimeout(function(){ if (!done) { done = true; window.print(); } }, 2500);
        })();
      <\/script>
    </body></html>`;
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

  // ── Auth (Supabase Auth) ─────────────────────────────────────────────────
  // Fetch the role from the profiles table for a given user id.
  async function fetchUserRole(userId) {
    if (!supabase || !userId) { setUserRole(null); setPmName(null); return; }
    const { data, error } = await supabase.from("profiles").select("role, pm_name").eq("id", userId).single();
    if (error) { console.error("Could not load role:", error); setUserRole(null); setPmName(null); return; }
    setUserRole(data?.role || "viewer");
    setPmName(data?.pm_name || null);
  }

  // Establish the session on mount and subscribe to auth changes.
  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setCurrentUser(session?.user?.email || "");
      if (session?.user) fetchUserRole(session.user.id);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setCurrentUser(session?.user?.email || "");
      if (session?.user) fetchUserRole(session.user.id);
      else setUserRole(null);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleLogin(event) {
    event.preventDefault();
    if (!supabase) { alert("Supabase is not connected."); return; }
    setAuthBusy(true);
    setAuthMessage(null);
    const { email, password } = loginForm;
    const fn = authMode === "signin"
      ? supabase.auth.signInWithPassword({ email, password })
      : supabase.auth.signUp({ email, password });
    const { error } = await fn;
    setAuthBusy(false);
    if (error) { setAuthMessage({ type: "error", text: error.message }); return; }
    if (authMode === "signup") {
      setAuthMessage({ type: "ok", text: "Account created. You can sign in now." });
      setAuthMode("signin");
      setLoginForm((c) => ({ ...c, password: "" }));
      return;
    }
    setLoginForm({ email: "", password: "" });
    // onAuthStateChange handles setting session/user/role.
  }

  async function loadAppUsers() {
    if (!supabase) return;
    const { data, error } = await supabase.from("profiles").select("id, email, role, created_at").order("created_at", { ascending: true });
    if (error) { console.error("Could not load users:", error); return; }
    setAppUsers(data || []);
  }

  // ── Saved views ────────────────────────────────────────────────────────────
  // A saved view captures the current page's filter + zoom + sort state so a
  // user can flip between e.g. 'My Hardscape board' and 'Pending awards only'.
  // Stored per-user in Supabase (RLS: each user sees only their own rows).
  async function loadSavedViews() {
    if (!supabase) return;
    const { data, error } = await supabase.from("saved_views").select("*").order("created_at", { ascending: true });
    if (error) { console.warn("Could not load saved views:", error); return; }
    setSavedViews(data || []);
  }

  // Snapshot the filter/zoom/sort state relevant to the current page.
  function captureViewConfig() {
    return {
      page,
      divisionFilter, statusFilter,
      zoom, resourceZoom, crewZoom, demandZoom,
      dashboardResourceTypeFilter,
      resourceTypeFilter,
      projectTabDivisionFilter,
      demandHomeDivisionFilter, demandResourceTypeFilter,
      forecastDivisionFilter,
      projectGanttSort, resourceGanttSort, crewGanttSort,
      showUnassignedNeedRows,
    };
  }

  // Apply a saved config back onto state. Guards each key so an older saved
  // view missing a field doesn't blow away current state with undefined.
  function applyViewConfig(cfg) {
    if (!cfg) return;
    if (cfg.page) setPage(cfg.page);
    if (Array.isArray(cfg.divisionFilter)) setDivisionFilter(cfg.divisionFilter);
    if (Array.isArray(cfg.statusFilter)) setStatusFilter(cfg.statusFilter);
    if (cfg.zoom) setZoom(cfg.zoom);
    if (cfg.resourceZoom) setResourceZoom(cfg.resourceZoom);
    if (cfg.crewZoom) setCrewZoom(cfg.crewZoom);
    if (cfg.demandZoom) setDemandZoom(cfg.demandZoom);
    if (Array.isArray(cfg.dashboardResourceTypeFilter)) setDashboardResourceTypeFilter(cfg.dashboardResourceTypeFilter);
    if (Array.isArray(cfg.resourceTypeFilter)) setResourceTypeFilter(cfg.resourceTypeFilter);
    if (Array.isArray(cfg.projectTabDivisionFilter)) setProjectTabDivisionFilter(cfg.projectTabDivisionFilter);
    if (Array.isArray(cfg.demandHomeDivisionFilter)) setDemandHomeDivisionFilter(cfg.demandHomeDivisionFilter);
    if (Array.isArray(cfg.demandResourceTypeFilter)) setDemandResourceTypeFilter(cfg.demandResourceTypeFilter);
    if (Array.isArray(cfg.forecastDivisionFilter)) setForecastDivisionFilter(cfg.forecastDivisionFilter);
    if (cfg.projectGanttSort) setProjectGanttSort(cfg.projectGanttSort);
    if (cfg.resourceGanttSort) setResourceGanttSort(cfg.resourceGanttSort);
    if (cfg.crewGanttSort) setCrewGanttSort(cfg.crewGanttSort);
    if (typeof cfg.showUnassignedNeedRows === "boolean") setShowUnassignedNeedRows(cfg.showUnassignedNeedRows);
  }

  async function saveCurrentView() {
    const name = newViewName.trim();
    if (!name) { alert("Give the view a name."); return; }
    if (!supabase) { alert("Supabase is not connected."); return; }
    const userId = session?.user?.id;
    if (!userId) { alert("You must be signed in to save a view."); return; }
    const config = captureViewConfig();
    const { data, error } = await supabase.from("saved_views").insert({ user_id: userId, name, page, config }).select().single();
    if (error) { console.error(error); alert(`Could not save view: ${error.message}`); return; }
    setSavedViews((cur) => [...cur, data]);
    setActiveSavedViewId(data.id);
    setShowSaveViewModal(false);
    setNewViewName("");
  }

  function applySavedView(id) {
    const v = savedViews.find((x) => x.id === id);
    if (!v) { setActiveSavedViewId(null); return; }
    applyViewConfig(v.config);
    setActiveSavedViewId(id);
  }

  async function deleteSavedView(id) {
    if (!supabase) return;
    const v = savedViews.find((x) => x.id === id);
    if (!confirm(`Delete saved view "${v?.name || "this view"}"?`)) return;
    const { error } = await supabase.from("saved_views").delete().eq("id", id);
    if (error) { console.error(error); alert("Could not delete view."); return; }
    setSavedViews((cur) => cur.filter((x) => x.id !== id));
    if (activeSavedViewId === id) setActiveSavedViewId(null);
  }

  async function loadProjectTypes() {
    if (!supabase) return;
    const { data, error } = await supabase.from("project_types").select("name").order("name", { ascending: true });
    if (error) { console.warn("Project type settings table is not set up yet:", error); return; }
    if (data?.length) setProjectTypes(data.map((row) => row.name));
  }

  // New users self-serve via the login screen's "Sign up" toggle. The User
  // Settings modal can change a user's role and delete their profile row.
  async function updateUserRole(userId, role) {
    if (!supabase) { alert("Supabase is not connected."); return; }
    const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
    if (error) { console.error(error); alert("Could not update role. (Admins only — check RLS policies.)"); return; }
    await loadAppUsers();
  }

  async function deleteAppUser(userId, email) {
    if (email === currentUser) { alert("You cannot delete the user currently signed in."); return; }
    if (!confirm(`Delete login user ${email}? This removes their profile/role. To fully revoke access, also delete them under Authentication → Users in Supabase.`)) return;
    if (!supabase) { alert("Supabase is not connected."); return; }
    const { error } = await supabase.from("profiles").delete().eq("id", userId);
    if (error) { console.error(error); alert("Could not delete user."); return; }
    await loadAppUsers();
  }

  async function logout() {
    if (supabase) await supabase.auth.signOut();
    setSession(null);
    setCurrentUser("");
    setUserRole(null);
  }

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

  // Lazy-load html2canvas and jsPDF the first time a screenshot export is
  // triggered. We append <script> tags to the document and resolve once each
  // library has populated its global. After the first load they stay cached
  // for the session, so subsequent exports are instant.

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

  // ── Loading gate ─────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-sm font-semibold text-slate-500">Loading…</p>
      </main>
    );
  }

  // ── Login Screen ───────────────────────────────────────────────────────────
  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="w-full max-w-md">
          <form onSubmit={handleLogin} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="h-1 w-24 rounded-full bg-emerald-700" />
            <h1 className="mt-4 text-2xl font-bold text-slate-900">GGC Resource Planning</h1>
            <p className="mt-1 text-sm text-slate-500">{authMode === "signin" ? "Sign in to access the scheduling system." : "Create an account to request access."}</p>
            <label className="mt-6 block space-y-1">
              <span className="text-sm font-semibold text-slate-700">Email</span>
              <input type="email" autoComplete="email" value={loginForm.email} onChange={(e) => setLoginForm((c) => ({ ...c, email: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" />
            </label>
            <label className="mt-4 block space-y-1">
              <span className="text-sm font-semibold text-slate-700">Password</span>
              <input type="password" autoComplete={authMode === "signin" ? "current-password" : "new-password"} value={loginForm.password} onChange={(e) => setLoginForm((c) => ({ ...c, password: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600" />
            </label>
            {authMessage && (
              <p className={`mt-3 text-sm font-semibold ${authMessage.type === "error" ? "text-red-700" : "text-emerald-700"}`}>{authMessage.text}</p>
            )}
            <div className="mt-6 flex gap-2">
              <button type="submit" disabled={authBusy} className="flex-1 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white hover:bg-emerald-800 disabled:bg-slate-300">
                {authBusy ? "Working…" : authMode === "signin" ? "Log In" : "Sign Up"}
              </button>
              <button
                type="button"
                onClick={() => setShowClaude(true)}
                title="Connect Claude (optional)"
                className="flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 font-semibold text-emerald-800 hover:bg-emerald-100"
              >
                <Sparkles size={16} /> Claude
              </button>
            </div>
            <button type="button" onClick={() => { setAuthMode(authMode === "signin" ? "signup" : "signin"); setAuthMessage(null); }} className="mt-4 w-full text-center text-sm font-semibold text-emerald-700 hover:underline">
              {authMode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
            </button>
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
        <div className="mx-auto flex max-w-[1700px] items-center justify-between gap-6 px-4 py-4">
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
              {isAdmin && <button onClick={() => setShowUserSettings(true)} className="rounded-lg p-1 hover:bg-slate-200" title="User settings"><Settings size={16} /></button>}
              <button onClick={logout} className="rounded-lg px-2 py-1 text-xs text-red-700 hover:bg-red-50">Logout</button>
            </div>
          </div>
        </div>
        <div className="border-t border-slate-100 bg-white">
          <div className="mx-auto flex max-w-[1700px] items-center justify-between gap-3 px-4 py-3">
            <nav className="flex min-w-0 flex-1 flex-nowrap gap-2 overflow-x-auto">
              {[
                { key: "projectDash", label: "Project Dashboard" },
                { key: "scheduling", label: "Scheduling" },
                { key: "resourceDash", label: "Resource Dashboard" },
                { key: "crewDash", label: "Crew Dashboard" },
                { key: "forecast", label: "Forecast" },
                { key: "setup", label: "Setup" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setPage(tab.key)}
                  className={`shrink-0 rounded-xl px-4 py-2.5 font-semibold shadow-sm ${page === tab.key ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
            <div className="flex shrink-0 items-center gap-2">
              {["projectDash", "resourceDash", "crewDash"].includes(page) && (
                <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5">
                  <select
                    value={activeSavedViewId || ""}
                    onChange={(e) => { const v = e.target.value; if (v) applySavedView(v); else setActiveSavedViewId(null); }}
                    title="Saved views"
                    className="max-w-[160px] rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-emerald-600"
                  >
                    <option value="">Saved views…</option>
                    {savedViews.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                  {activeSavedViewId && (
                    <button onClick={() => deleteSavedView(activeSavedViewId)} title="Delete this view" className="rounded-lg p-1 text-red-600 hover:bg-red-50"><Trash2 size={15} /></button>
                  )}
                  <button onClick={() => { setNewViewName(""); setShowSaveViewModal(true); }} title="Save current filters as a view" className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-700 hover:bg-slate-100">Save view</button>
                </div>
              )}
              {page === "projectDash" && canWrite && <button onClick={openAddAssignmentForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 font-semibold text-white shadow-sm hover:bg-emerald-800"><ClipboardCheck size={18} /> Assign</button>}
              {page === "setup" && setupTab === "projects" && canWrite && (
                <>
                  <CmicPullProjects projects={projects} onApplied={() => loadSupabaseData()} />
                  <button onClick={openAddProjectForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 font-semibold text-white shadow-sm hover:bg-emerald-800"><Plus size={18} /> Add Project</button>
                </>
              )}
              {page === "setup" && setupTab === "resources" && canWrite && <button onClick={openAddResourceForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 font-semibold text-white shadow-sm hover:bg-emerald-800"><Plus size={18} /> Add Resource</button>}
              {page === "setup" && setupTab === "crews" && canWrite && <button onClick={openAddCrewForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 font-semibold text-white shadow-sm hover:bg-emerald-800"><Plus size={18} /> Add Crew</button>}
            </div>
          </div>
        </div>
      </header>

      {/* ── Attention banner + saved views (dashboard pages only) ── */}
      {["projectDash", "resourceDash", "crewDash"].includes(page) && !summaryBannerDismissed && (
        <div className="border-b border-amber-200 bg-amber-50">
          <div className="mx-auto flex max-w-[1700px] flex-wrap items-center gap-2 px-4 py-2.5">
            <span className="mr-1 text-xs font-bold uppercase tracking-wide text-amber-800">Needs attention</span>
            {attentionCounts.conflicts > 0 && (
              <button onClick={() => setConflictModal("conflicts")} className="flex items-center gap-1.5 rounded-full border border-red-300 bg-red-100 px-3 py-1 text-xs font-semibold text-red-800 hover:bg-red-200">
                <AlertTriangle size={13} /> {attentionCounts.conflicts} conflict{attentionCounts.conflicts === 1 ? "" : "s"}
              </button>
            )}
            {attentionCounts.pto > 0 && (
              <button onClick={() => setConflictModal("pto")} className="flex items-center gap-1.5 rounded-full border border-orange-300 bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-800 hover:bg-orange-200">
                <Calendar size={13} /> {attentionCounts.pto} PTO upcoming (60d)
              </button>
            )}
            {attentionCounts.certs > 0 && (
              <button onClick={() => { setPage("resourceDash"); setCertAlertModal("expiring"); }} className="flex items-center gap-1.5 rounded-full border border-yellow-300 bg-yellow-100 px-3 py-1 text-xs font-semibold text-yellow-800 hover:bg-yellow-200">
                <BadgeCheck size={13} /> {attentionCounts.certs} cert{attentionCounts.certs === 1 ? "" : "s"} expiring
              </button>
            )}
            {attentionCounts.mobsThisWeek > 0 && (
              <button onClick={() => setConflictModal("mobsThisWeek")} className="flex items-center gap-1.5 rounded-full border border-sky-300 bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-800 hover:bg-sky-200">
                <Calendar size={13} /> {attentionCounts.mobsThisWeek} mob{attentionCounts.mobsThisWeek === 1 ? "" : "s"} this week
              </button>
            )}
            {attentionCounts.mobsNextWeek > 0 && (
              <button onClick={() => setConflictModal("mobsNextWeek")} className="flex items-center gap-1.5 rounded-full border border-indigo-300 bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-800 hover:bg-indigo-200">
                <Calendar size={13} /> {attentionCounts.mobsNextWeek} next week
              </button>
            )}
            {attentionCounts.unassigned > 0 && (
              <button onClick={() => setConflictModal("unassigned")} className="flex items-center gap-1.5 rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200">
                <Users size={13} /> {attentionCounts.unassigned} unassigned need{attentionCounts.unassigned === 1 ? "" : "s"}
              </button>
            )}
            {attentionTotal === 0 && attentionCounts.mobsThisWeek === 0 && attentionCounts.mobsNextWeek === 0 && (
              <span className="text-xs font-medium text-emerald-700">All clear — no conflicts, collisions, or expiring certs.</span>
            )}
            <button onClick={() => setShowRequestsModal(true)} className="flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-200">
              <ClipboardCheck size={13} /> {bannerRequestCount} request{bannerRequestCount === 1 ? "" : "s"}
            </button>
            <button onClick={() => setSummaryBannerDismissed(true)} title="Dismiss" className="ml-auto rounded-lg p-1 text-amber-700 hover:bg-amber-200"><X size={15} /></button>
          </div>
        </div>
      )}

      {/* ── Setup: Crews ── */}
      {page === "setup" && setupTab === "crews" && (
        <section className="mx-auto max-w-[1700px] space-y-6 px-4 py-6">
          {/* Setup sub-tabs */}
          <div className="flex gap-2 border-b border-slate-200 pb-3">
            {[
              { key: "projects", label: "Projects" },
              { key: "resources", label: "Resources" },
              { key: "crews", label: "Crews" },
            ].map((t) => (
              <button key={t.key} onClick={() => setSetupTab(t.key)} className={`rounded-xl px-4 py-2 text-sm font-semibold ${setupTab === t.key ? "bg-emerald-700 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>{t.label}</button>
            ))}
          </div>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div><h2 className="text-2xl font-bold">Crews</h2><p className="text-sm text-slate-500">Master crew list used by assignment crew dropdowns.</p></div>
              <div className="flex flex-wrap gap-3 items-center">
                <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2">
                  <Search size={15} className="text-slate-400" />
                  <input className="outline-none text-sm w-44" placeholder="Search crews…" value={crewSearch} onChange={(e) => setCrewSearch(e.target.value)} />
                </div>
                <button onClick={exportCrewsExcel} className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">Export Excel</button>
                {canWrite && <label className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">Import CSV<input type="file" accept=".csv" onChange={importCrewsCsv} className="hidden" /></label>}
                {canWrite && <button onClick={() => setShowCrewTypeSettings((c) => !c)} className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"><Settings size={17} /> Crew Type Settings</button>}
                {canWrite && <button onClick={openAddCrewForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800"><Plus size={17} /> Add Crew</button>}
              </div>
            </div>
            {showCrewTypeSettings && (
              <div className="mb-5 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                <h3 className="font-bold text-slate-900">Crew Types</h3>
                <p className="text-sm text-slate-500">Types of crews (Sidewalk, Paver, Rodbuster, Wall, Foundations, …). Used to match crew requests.</p>
                <div className="mt-3 flex gap-2">
                  <input value={newCrewType} onChange={(e) => setNewCrewType(e.target.value)} placeholder="Add crew type" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none focus:border-emerald-600" />
                  <button onClick={addCrewType} className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white">Add</button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {crewTypes.map((type) => (
                    <span key={type} className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">
                      {type}<button onClick={() => deleteCrewType(type)} className="text-red-600">×</button>
                    </span>
                  ))}
                  {crewTypes.length === 0 && <span className="text-xs text-slate-400">No crew types yet.</span>}
                </div>
              </div>
            )}
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[850px] text-left text-sm">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th onClick={() => toggleSort(setCrewSort, "crewName")} className="cursor-pointer p-3 hover:bg-slate-200">Crew Name</th>
                    <th onClick={() => toggleSort(setCrewSort, "foremanName")} className="cursor-pointer p-3 hover:bg-slate-200">Foreman Name</th>
                    <th className="p-3 text-center">Total Members</th>
                    <th className="p-3 text-center">Status</th>
                    <th className="p-3">Crew Type</th>
                    <th className="p-3">Specialty</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCrews.map((crew) => (
                    <tr key={crew.id} onClick={() => canWrite && openEditCrewForm(crew)} className={`border-t border-slate-200 align-top ${canWrite ? "cursor-pointer hover:bg-emerald-50" : ""}`}>
                      <td className="p-3 font-medium">{crew.crewName}</td>
                      <td className="p-3">{crew.foremanName}</td>
                      <td className="p-3 text-center font-semibold">{crew.totalMembers || <span className="text-slate-300">—</span>}</td>
                      <td className="p-3 text-center">
                        <span className={`rounded-full px-2 py-1 text-xs font-bold ${isCrewDeactivated(crew) ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                          {isCrewDeactivated(crew) ? "Deactivated" : "Active"}
                        </span>
                      </td>
                      <td className="p-3">{(crew.crewType || []).join(", ") || <span className="text-slate-300">—</span>}</td>
                      <td className="p-3">{(crew.specialty || []).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      )}

      {/* ── Setup: Resources ── */}
      {page === "setup" && setupTab === "resources" && (
        <section className="mx-auto max-w-[1700px] space-y-6 px-4 py-6">
          {/* Setup sub-tabs */}
          <div className="flex gap-2 border-b border-slate-200 pb-3">
            {[
              { key: "projects", label: "Projects" },
              { key: "resources", label: "Resources" },
              { key: "crews", label: "Crews" },
            ].map((t) => (
              <button key={t.key} onClick={() => setSetupTab(t.key)} className={`rounded-xl px-4 py-2 text-sm font-semibold ${setupTab === t.key ? "bg-emerald-700 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>{t.label}</button>
            ))}
          </div>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div><h2 className="text-2xl font-bold">Resources</h2><p className="text-sm text-slate-500">Master resource list used by Dashboard assignment dropdowns.</p></div>
              <div className="flex flex-wrap gap-3">
                <button onClick={exportResourcesExcel} className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">Export Excel</button>
                {canWrite && <label className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">Import CSV<input type="file" accept=".csv" onChange={importResourcesCsv} className="hidden" /></label>}
                {canWrite && <button onClick={() => setShowCertSettings((c) => !c)} className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"><Settings size={17} /> Certification Settings</button>}
                {canWrite && <button onClick={openAddResourceForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800"><Plus size={17} /> Add Resource</button>}
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
                    <tr key={resource.id} onClick={() => canWrite && openEditResourceForm(resource)} className={`border-t border-slate-200 align-top ${canWrite ? "cursor-pointer hover:bg-emerald-50" : ""}`}>
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

      {/* ── Setup: Projects ── */}
      {page === "setup" && setupTab === "projects" && (
        <section className="mx-auto max-w-[1700px] space-y-6 px-4 py-6">
          {/* Setup sub-tabs */}
          <div className="flex gap-2 border-b border-slate-200 pb-3">
            {[
              { key: "projects", label: "Projects" },
              { key: "resources", label: "Resources" },
              { key: "crews", label: "Crews" },
            ].map((t) => (
              <button key={t.key} onClick={() => setSetupTab(t.key)} className={`rounded-xl px-4 py-2 text-sm font-semibold ${setupTab === t.key ? "bg-emerald-700 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>{t.label}</button>
            ))}
          </div>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div><h2 className="text-2xl font-bold">Projects</h2><p className="text-sm text-slate-500">Create and edit projects here only. Resource assignments happen on the Dashboard.</p></div>
              <div className="flex flex-wrap gap-3">
                <button onClick={exportProjectsExcel} className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">Export Excel</button>
                {canWrite && <label className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">Import CSV<input type="file" accept=".csv" onChange={importProjectsCsv} className="hidden" /></label>}
                {canWrite && <button onClick={() => setShowProjectTypeSettings((c) => !c)} className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"><Settings size={17} /> Project Type Settings</button>}
                {canWrite && <button onClick={openAddProjectForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800"><Plus size={17} /> Add Project</button>}
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
                    <tr key={project.id} onClick={() => canWrite && openEditProjectForm(project)} className={`border-t border-slate-200 align-top ${canWrite ? "cursor-pointer hover:bg-emerald-50" : ""}`}>
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

      {/* ── Project Dashboard ── */}
      {page === "projectDash" && (
        <section className="mx-auto max-w-[1700px] space-y-6 px-4 py-6">
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
                <button onClick={printProjectGantt} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Print</button>
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
            <div className="overflow-auto rounded-xl border border-slate-200 p-4 max-h-[70vh]">
              <GanttHeader timeline={timeline} zoom={zoom} />
              <div className="relative mt-3" style={{ minWidth: `${timeline.width + 340}px` }}>
                {/* Backdrop: weekend bands + today line. Offset 260px to skip sticky label column. */}
                <div className="absolute inset-y-0 z-0 pointer-events-none" style={{ left: "320px", width: `${timeline.width}px` }}>
                  <GanttBackdrop timeline={timeline} />
                </div>
                <div className="relative z-10">
                  {projectGanttRows.map((row, idx) => (
                    <div
                      key={row.project.id}
                      className={`block w-full text-left py-0.5 ${idx % 2 === 1 ? "bg-slate-100/60" : ""}`}
                    >
                      <ProjectGanttRow
                        assignment={row.assignment}
                        project={row.project}
                        items={row.items}
                        timeline={timeline}
                        crews={crews}
                        onLabelClick={() => openEditAssignmentForm(row.assignment)}
                        onDragEnd={canWrite ? handleProjectGanttDragEnd : undefined}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Assignments table moved to Project Dashboard */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div><h2 className="text-xl font-bold">Assignments</h2><p className="text-sm text-slate-500">Assign existing projects to resources and crews.</p></div>
              <div className="flex flex-wrap gap-3">
                <button onClick={() => setShowAssignments((c) => !c)} className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">{showAssignments ? "Collapse" : "Expand"}</button>
                {canWrite && <label className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">Import CSV<input type="file" accept=".csv" onChange={importAssignmentsCsv} className="hidden" /></label>}
                {canWrite && <button onClick={openAddAssignmentForm} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800"><ClipboardCheck size={17} /> Assign</button>}
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
                          <td className="p-3">
                            <div className="space-y-1">
                              {(assignment.mobilizations || []).map((m, i) => {
                                const taskNames = (Array.isArray(m.taskIds) ? m.taskIds : []).map((tid) => allTaskNames[tid]).filter(Boolean);
                                return (
                                  <div key={m.id || i} className="whitespace-nowrap">
                                    <span className="font-semibold text-slate-700">#{i + 1}:</span> {formatDate(m.start)} - {formatDate(m.end)}
                                    {taskNames.length > 0 && (
                                      <span className="ml-1 text-xs text-emerald-700">· {taskNames.join(", ")}</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                          <td className="p-3 text-right">
                            {canWrite ? (
                              <>
                                <button onClick={() => openEditAssignmentForm(assignment)} className="mr-2 rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50">Edit</button>
                                <button onClick={() => deleteAssignment(assignment.id)} className="rounded-lg border border-red-200 px-3 py-1.5 font-medium text-red-700 hover:bg-red-50">Delete</button>
                              </>
                            ) : <span className="text-xs text-slate-400">View only</span>}
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

      {/* ── Scheduling (PM project task builder + crew-type requests) ── */}
      {page === "scheduling" && (
        <section className="mx-auto max-w-[1700px] space-y-6 px-4 py-6">
          {(!userRole || !["admin", "manager", "pm", "viewer"].includes(userRole)) ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
              You don’t have access to scheduling. Ask an admin if you need it.
            </div>
          ) : (isPM && !pmName) ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm font-semibold text-amber-800 shadow-sm">
              Your account isn’t linked to a PM name yet, so requests can’t be attributed. Ask an admin to set your PM name in User Settings.
            </div>
          ) : (
            <>
              {/* Project picker */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <label className="block w-full max-w-md space-y-1">
                    <span className="text-sm font-semibold text-slate-700">Project</span>
                    <select
                      value={schedProjectId}
                      onChange={(e) => setSchedProjectId(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600"
                    >
                      <option value="">Select a project to schedule…</option>
                      {[...schedulableProjects]
                        .sort((a, b) => String(a.projectNumber || "").localeCompare(String(b.projectNumber || ""), undefined, { numeric: true }))
                        .map((p) => (
                          <option key={p.id} value={p.id}>{p.projectNumber ? `${p.projectNumber} - ` : ""}{p.name}</option>
                        ))}
                    </select>
                  </label>
                  {schedProjectId && (
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <ZoomIn size={16} className="text-slate-500" />
                        <span className="text-sm font-medium text-slate-700">Zoom</span>
                        <select value={schedZoom} onChange={(e) => setSchedZoom(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-emerald-600">
                          {zoomModes.map((m) => <option key={m}>{m}</option>)}
                        </select>
                      </div>
                      <button onClick={printTaskSchedule} disabled={!projectTasks.length} title="Print the task schedule" className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                        <ClipboardCheck size={16} /> Print Schedule
                      </button>
                      {(isPM || isOffice) && (
                        <>
                          <button onClick={() => openAddTaskForm()} className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                            <Plus size={16} /> Add Task
                          </button>
                          <button onClick={() => openAddTaskForm({ isHeader: true })} className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                            <Plus size={16} /> Add Header
                          </button>
                          <button onClick={() => openTaskRequestForm()} disabled={!projectTasks.length} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-300">
                            <Plus size={16} /> Request Crew
                          </button>
                          <button onClick={openStaffRequestForm} className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">
                            <Plus size={16} /> Request Staff
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </section>

              {!schedProjectId ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
                  Pick a project above to build its task schedule and request crews.
                </div>
              ) : (
                <>
                  {/* Task Gantt */}
                  <section id="scheduling-task-gantt" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-4">
                      <h2 className="text-xl font-bold">Task Schedule</h2>
                      <p className="text-sm text-slate-500">Each row is a task. Dependencies start a task after the one it follows.</p>
                    </div>
                    {projectTasks.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                        No tasks yet. Use <strong>Add Task</strong> to start building this project’s schedule.
                      </div>
                    ) : (
                      <div className="overflow-auto rounded-xl border border-slate-200 p-4 max-h-[60vh]">
                        <GanttHeader timeline={schedTimeline} zoom={schedZoom} />
                        <div className="relative mt-3" style={{ minWidth: `${schedTimeline.width + 340}px` }}>
                          <div className="absolute inset-y-0 z-0 pointer-events-none" style={{ left: "320px", width: `${schedTimeline.width}px` }}>
                            <GanttBackdrop timeline={schedTimeline} />
                          </div>
                          {/* Dependency arrows overlay (aligned to the timeline area). */}
                          <div className="absolute top-0 z-[15] pointer-events-none" style={{ left: "320px", width: `${schedTimeline.width}px`, height: `${groupedTasks.length * 32}px` }}>
                            <TaskDependencyArrows tasks={groupedTasks} timeline={schedTimeline} rowHeight={32} />
                          </div>
                          <div className="relative z-10">
                            {groupedTasks.map((t, idx) => (
                              <TaskGanttRow
                                key={t.id}
                                task={t}
                                timeline={schedTimeline}
                                striped={idx % 2 === 1}
                                dependsOnName={t.depends_on ? `${taskNameById.get(t.depends_on)} (${depTag(t.dependency_type, t.dependency_lag)})` : null}
                                requests={taskCrewRequests}
                                assigned={assignedByTaskId.get(t.id)}
                                onClick={() => (isPM || isOffice) && openEditTaskForm(t)}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </section>

                  {/* Task list — Smartsheet-style inline grid */}
                  {(
                    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                      <button onClick={() => setTasksTableCollapsed((c) => !c)} className="mb-3 flex w-full items-center justify-between text-left">
                        <h2 className="text-lg font-bold">Tasks <span className="ml-1 text-sm font-normal text-slate-400">({projectTasks.filter((t) => !t.is_header).length})</span></h2>
                        <span className="flex items-center gap-1 text-sm font-semibold text-slate-500">{tasksTableCollapsed ? "Show" : "Hide"} <span className="text-xs">{tasksTableCollapsed ? "▸" : "▾"}</span></span>
                      </button>
                      {!tasksTableCollapsed && (
                      <>
                        <p className="mb-2 text-xs text-slate-500">Click a cell to edit · Tab moves across, Enter down, a new row appears at the end · double-click a row for advanced options (dependency type, lag, header/parent).</p>
                        <TaskGrid
                          rows={groupedTasks}
                          allTasks={projectTasks}
                          taskNameById={taskNameById}
                          depTag={depTag}
                          requestsByTaskId={(id) => taskCrewRequests.filter((r) => (r.task_crew_request_links || []).some((l) => l.task_id === id))}
                          onCommitRow={upsertTaskInline}
                          onOpenPopout={openEditTaskForm}
                          onDelete={deleteTask}
                          onRequestCrew={openTaskRequestForm}
                          canEdit={isPM || isOffice}
                        />
                      </>
                      )}
                    </section>
                  )}

                  {/* Crew requests panel */}
                  <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <button onClick={() => setRequestsPanelCollapsed((c) => !c)} className="flex w-full items-center justify-between border-b border-slate-200 px-5 py-4 text-left">
                      <div className="flex items-center gap-3">
                        <h2 className="text-xl font-bold text-slate-900">{isOffice ? "Requests" : "My Requests"}</h2>
                        {schedPendingRequests.length > 0 && (
                          <span className="rounded-full bg-emerald-700 px-2.5 py-0.5 text-xs font-bold text-white">{schedPendingRequests.length} pending</span>
                        )}
                      </div>
                      <span className="flex items-center gap-1 text-sm font-semibold text-slate-500">{requestsPanelCollapsed ? "Show" : "Hide"} <span className="text-xs">{requestsPanelCollapsed ? "▸" : "▾"}</span></span>
                    </button>
                    {!requestsPanelCollapsed && (
                    <div className="divide-y divide-slate-100">
                      {taskCrewRequests.length === 0 && staffRequests.length === 0 ? (
                        <div className="px-5 py-6 text-sm text-slate-500">No requests for this project yet.</div>
                      ) : (
                        <>
                          {isOffice && schedPendingRequests.length > 0 && (
                            <p className="px-5 pt-3 text-xs font-bold uppercase tracking-wide text-slate-500">Needs action</p>
                          )}
                          {schedPendingRequests.map((r) => (
                            <TaskCrewRequestRow key={r.id} r={r} isOffice={isOffice} isPM={isPM}
                              taskNameById={taskNameById} crews={activeCrews}
                              onWithdraw={() => withdrawTaskRequest(r.id)}
                              onDelete={() => deleteTaskRequest(r.id)} />
                          ))}
                          {schedResolvedRequests.length > 0 && (
                            <p className="px-5 pt-3 text-xs font-bold uppercase tracking-wide text-slate-500">Resolved</p>
                          )}
                          {schedResolvedRequests.map((r) => (
                            <TaskCrewRequestRow key={r.id} r={r} isOffice={isOffice} isPM={isPM}
                              taskNameById={taskNameById} crews={activeCrews}
                              onDelete={() => deleteTaskRequest(r.id)} />
                          ))}
                        </>
                      )}
                      {/* Project-level staff requests */}
                      {staffRequests.map((r) => (
                        <StaffRequestRow key={r.id} r={r} isPM={isPM} isOffice={isOffice}
                          onWithdraw={() => withdrawStaffRequest(r.id)}
                          onDelete={() => deleteStaffRequest(r.id)} />
                      ))}
                    </div>
                    )}
                  </section>
                </>
              )}
            </>
          )}
        </section>
      )}

      {/* ── Resource Dashboard ── */}
      {page === "resourceDash" && (
        <section className="mx-auto max-w-[1700px] space-y-6 px-4 py-6">
          {/* Certification alerts */}
          <div className="grid gap-4 md:grid-cols-2">
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
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                  Sort by
                  <select
                    value={resourceGanttSort}
                    onChange={(e) => setResourceGanttSort(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-700 outline-none focus:border-emerald-600"
                  >
                    <option value="name">Name</option>
                    <option value="resourceType">Resource Type</option>
                    <option value="homeDivision">Home Division</option>
                    <option value="startDate">Earliest Assignment</option>
                    <option value="endDate">Latest Assignment</option>
                  </select>
                </label>
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <ZoomIn size={16} className="text-slate-500" />
                  <span className="text-sm font-medium text-slate-700">Zoom</span>
                  <select value={resourceZoom} onChange={(e) => setResourceZoom(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-emerald-600">
                    {zoomModes.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <button onClick={printResourceGantt} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Print</button>
              </div>
            </div>
            <div className="overflow-auto rounded-xl border border-slate-200 p-4 max-h-[70vh]">
              <GanttHeader timeline={resourceTimeline} zoom={resourceZoom} />
              <div className="relative mt-3" style={{ minWidth: `${resourceTimeline.width + 340}px` }}>
                <div className="absolute inset-y-0 z-0 pointer-events-none" style={{ left: "320px", width: `${resourceTimeline.width}px` }}>
                  <GanttBackdrop timeline={resourceTimeline} />
                </div>
                <div className="relative z-10">
                  {resourceGanttRowsWithUnassigned.map((row, idx) => (
                    <div key={row.resource.id} className={`py-0.5 ${idx % 2 === 1 ? "bg-slate-100/60" : ""}`}>
                      {row.isUnassignedNeedRow
                        ? <UnassignedNeedGanttRow resource={row.resource} items={row.items} timeline={resourceTimeline} />
                        : <ResourceGanttRow resource={row.resource} items={row.items} timeline={resourceTimeline} onResourceClick={setFocusedResource} />}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Demand Chart */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap gap-4 items-start">
              <div className="flex-1 min-w-[200px]">
                <MultiSelectFilter label="Resource Demand Type Filter" options={demandResourceTypeOptions} selected={demandResourceTypeFilter} setSelected={setDemandResourceTypeFilter} />
              </div>
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
            totalResources={resources.filter((r) => demandResourceTypeFilter.includes(r.resourceType) && demandHomeDivisionFilter.includes(r.homeDivision)).length}
            onExportPdf={() => exportSectionPdf("resource-demand-graph", "Resource Demand Graph")}
            onBarClick={setDemandDrilldown}
            onPeriodClick={setDemandPeriodDrilldown}
            getItemKeys={getDemandKeys}
          />

          {/* Project Manager Utilization (moved into Resource Dashboard) */}
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
        </section>
      )}

      {/* ── Crew Dashboard ── */}
      {page === "crewDash" && (
        <section className="mx-auto max-w-[1700px] space-y-6 px-4 py-6">
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
              <button onClick={printCrewGantt} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Print</button>
            </div>
            <div className="mb-4 flex flex-wrap gap-3 items-start">
              <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2">
                <Search size={15} className="text-slate-400" />
                <input className="outline-none text-sm w-40" placeholder="Search crews…" value={dashboardCrewSearch} onChange={(e) => setDashboardCrewSearch(e.target.value)} />
              </div>
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                Sort by
                <select
                  value={crewGanttSort}
                  onChange={(e) => setCrewGanttSort(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-700 outline-none focus:border-emerald-600"
                >
                  <option value="crewName">Crew Name</option>
                  <option value="foremanName">Foreman</option>
                  <option value="totalMembers">Total Members</option>
                  <option value="startDate">Earliest Assignment</option>
                  <option value="endDate">Latest Assignment</option>
                </select>
              </label>
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <ZoomIn size={16} className="text-slate-500" />
                <span className="text-sm font-medium text-slate-700">Zoom</span>
                <select value={crewZoom} onChange={(e) => setCrewZoom(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-emerald-600">
                  {zoomModes.map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div className="overflow-auto rounded-xl border border-slate-200 p-4 max-h-[70vh]">
              <GanttHeader timeline={crewTimeline} zoom={crewZoom} />
              <div className="relative mt-3" style={{ minWidth: `${crewTimeline.width + 340}px` }}>
                <div className="absolute inset-y-0 z-0 pointer-events-none" style={{ left: "320px", width: `${crewTimeline.width}px` }}>
                  <GanttBackdrop timeline={crewTimeline} />
                </div>
                <div className="relative z-10">
                  {crewGanttRows.map((row, idx) => (
                    <div key={row.crew.id} className={`py-0.5 ${idx % 2 === 1 ? "bg-slate-100/60" : ""}`}>
                      <CrewGanttRow crew={row.crew} items={row.items} timeline={crewTimeline} />
                    </div>
                  ))}
                </div>
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
              <div className="relative mt-3" style={{ minWidth: `${timeline.width + 340}px` }}>
                <div className="absolute inset-y-0 z-0 pointer-events-none" style={{ left: "320px", width: `${timeline.width}px` }}>
                  <GanttBackdrop timeline={timeline} />
                </div>
                <div className="relative z-10">
                  {focusedResourceItems.map((item, idx) => (
                    <div key={`focused-${item.id}`} className={`py-0.5 ${idx % 2 === 1 ? "bg-slate-100/60" : ""}`}>
                      <div className="grid grid-cols-[320px_1fr] items-center gap-0 h-7">
                        <button
                          type="button"
                          onClick={() => { setFocusedResource(null); openEditAssignmentForm(item.assignment); }}
                          className="sticky left-0 z-20 h-7 bg-white pr-3 text-left overflow-hidden hover:bg-slate-50"
                          title={`${item.project.projectNumber ? `${item.project.projectNumber} - ` : ""}${item.project.name} — click to edit assignment`}
                        >
                          <p className="truncate text-[12px] font-semibold text-slate-900 hover:text-emerald-700">{item.project.projectNumber ? `${item.project.projectNumber} - ` : ""}{item.project.name}</p>
                        </button>
                        <div className="relative h-7 rounded-md" style={{ width: `${timeline.width}px` }}>
                          <GanttSegmentBar item={item} timeline={timeline} label={item.project.name} />
                        </div>
                      </div>
                    </div>
                  ))}
                  {/* PTO rows */}
                  {(focusedResource.pto || []).filter((p) => p.start && p.end).map((pto, idx) => {
                    const offsetIdx = focusedResourceItems.length + idx;
                    return (
                      <div key={`focused-pto-${pto.id || pto.ptoId}`} className={`py-0.5 ${offsetIdx % 2 === 1 ? "bg-slate-100/60" : ""}`}>
                        <div className="grid grid-cols-[320px_1fr] items-center gap-0 h-7">
                          <div className="sticky left-0 z-20 h-7 bg-white pr-3 text-left overflow-hidden">
                            <p className="truncate text-[12px] font-semibold text-slate-900" title={`PTO — ${pto.ptoId || "Unspecified"}`}>PTO — {pto.ptoId || "Unspecified"}</p>
                          </div>
                          <div className="relative h-7 rounded-md" style={{ width: `${timeline.width}px` }}>
                            <PtoOverlayBar pto={pto} timeline={timeline} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {focusedResourceItems.length === 0 && (focusedResource.pto || []).filter((p) => p.start && p.end).length === 0 && (
                    <p className="text-sm text-slate-400">No assignments or PTO in the current timeline window.</p>
                  )}
                </div>
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
                <div className="flex gap-2">
                  <button onClick={() => printGantt({
                    title: `${getCrewDisplayName(selectedUtilizationCrew)} — Utilization`,
                    subtitle: `${utilizationStart} to ${utilizationEnd}`,
                    rows: items.map((item) => ({
                      label: `${item.project.projectNumber ? item.project.projectNumber + " - " : ""}${item.project.name}`,
                      sublabel: `${getCrewMenForItem(item)} men`,
                      bars: (item.start && item.end) ? [{ start: item.start, end: item.end, color: divisionSvgColors[item.project.division] || "#475569" }] : [],
                    })).filter((r) => r.bars.length),
                    showExtra: false,
                    extraHeader: { name: "Project" },
                  })} disabled={!validRange || items.length === 0} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Print</button>
                  <button onClick={() => setSelectedUtilizationCrew(null)} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold hover:bg-slate-50">Close</button>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-5">
                {!validRange && <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-800">Choose a valid Crew Utilization date range first.</div>}
                {validRange && (
                  <>
                    <GanttHeader timeline={popupTimeline} zoom="Weeks" />
                    <div className="relative mt-3" style={{ minWidth: `${popupTimeline.width + 340}px` }}>
                      <div className="absolute inset-y-0 z-0 pointer-events-none" style={{ left: "320px", width: `${popupTimeline.width}px` }}>
                        <GanttBackdrop timeline={popupTimeline} />
                      </div>
                      <div className="relative z-10">
                        {items.length === 0 && <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">No assignments found for this crew during the selected period.</div>}
                        {items.map((item, idx) => {
                          const rowMen = getCrewMenForItem(item);
                          return (
                            <div key={`util-drilldown-${item.id}`} className={`py-0.5 ${idx % 2 === 1 ? "bg-slate-100/60" : ""}`}>
                              <div className="grid grid-cols-[320px_1fr] items-center gap-0 h-7">
                                <button
                                  type="button"
                                  onClick={() => { setSelectedUtilizationCrew(null); openEditAssignmentForm(item.assignment); }}
                                  className="sticky left-0 z-20 flex h-7 items-center justify-between gap-2 bg-white pr-3 text-left overflow-hidden hover:bg-slate-50"
                                  title={`${item.project.projectNumber ? `${item.project.projectNumber} - ` : ""}${item.project.name} — click to edit assignment`}
                                >
                                  <p className="truncate text-[12px] font-semibold text-slate-900 hover:text-emerald-700">{item.project.projectNumber ? `${item.project.projectNumber} - ` : ""}{item.project.name}</p>
                                  <span className="shrink-0 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white">{rowMen}</span>
                                </button>
                                <div className="relative h-7 rounded-md" style={{ width: `${popupTimeline.width}px` }}>
                                  <GanttSegmentBar item={item} timeline={popupTimeline} label={`${item.project.name} · ${rowMen} men`} />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {items.length > 0 && (
                          <div className="mt-3 grid grid-cols-[320px_1fr] items-center gap-5 border-t border-slate-200 pt-3">
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
                    <div className="relative mt-3" style={{ minWidth: `${pmTimeline.width + 340}px` }}>
                      <div className="absolute inset-y-0 z-0 pointer-events-none" style={{ left: "320px", width: `${pmTimeline.width}px` }}>
                        <GanttBackdrop timeline={pmTimeline} />
                      </div>
                      <div className="relative z-10">
                        {pmRows.map((row, idx) => {
                          const start = getProjectStartFromItems(row.items);
                          const end = getProjectEndFromItems(row.items);
                          const span = (start && end)
                            ? timelineSpanPixels(start, end, pmTimeline)
                            : { left: 0, width: 0 };
                          const divisionColor = divisionSvgColors[row.project.division] || "#475569";
                          return (
                            <div key={`pm-util-${row.project.id}`} className={`py-0.5 ${idx % 2 === 1 ? "bg-slate-100/60" : ""}`}>
                              <div className="grid grid-cols-[320px_1fr] items-center gap-0 h-7">
                                <button
                                  type="button"
                                  onClick={() => { setSelectedProjectManagerUtilization(null); openEditAssignmentForm(row.items[0].assignment); }}
                                  className="sticky left-0 z-20 h-7 bg-white pr-3 text-left overflow-hidden hover:bg-slate-50"
                                  title={`${row.project.projectNumber ? `${row.project.projectNumber} - ` : ""}${row.project.name} — click to edit assignment`}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className={`shrink-0 h-2.5 w-2.5 rounded-full ${row.project.status === "Pending Award" ? pendingDivisionStyles[row.project.division] : divisionStyles[row.project.division] || "bg-slate-600"}`} />
                                    <p className="truncate text-[12px] font-semibold text-slate-900 hover:text-emerald-700">{row.project.projectNumber ? `${row.project.projectNumber} - ` : ""}{row.project.name}</p>
                                  </div>
                                </button>
                                <div className="relative h-7 rounded-md" style={{ width: `${pmTimeline.width}px` }}>
                                  {/* Continuous hatched bar: PM is on project
                                      for the entire duration, even between
                                      mobs. Sits BEHIND mob bars (z-0). */}
                                  {span.width > 0 && (
                                    <div
                                      className="absolute top-0 z-0 h-7 rounded-md"
                                      style={{
                                        left: `${span.left}px`,
                                        width: `${span.width}px`,
                                        backgroundColor: divisionColor,
                                        opacity: 0.25,
                                        backgroundImage: `repeating-linear-gradient(135deg, transparent 0 8px, ${divisionColor} 8px 10px)`,
                                        backgroundSize: "14px 14px",
                                      }}
                                      title={`${formatDate(start)} – ${formatDate(end)} (PM on project)`}
                                    />
                                  )}
                                  {row.items.map((item) => (
                                    <GanttSegmentBar key={`pm-util-${row.project.id}-${item.id}`} item={item} timeline={pmTimeline} label={row.project.name} />
                                  ))}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
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
                  <p className="text-sm text-slate-500">{items.length} {segment.division} {segment.type.toLowerCase()} mobilization{items.length === 1 ? "" : "s"} active here. Bar shows peak concurrent demand: same-person sequential mobs count as 1, overlapping mobs count separately.</p>
                </div>
                <button onClick={() => setDemandDrilldown(null)} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold hover:bg-slate-50">Close</button>
              </div>
              <div className="flex-1 overflow-auto p-5">
                <GanttHeader timeline={periodTimeline} zoom={demandZoom} />
                <div className="relative mt-3" style={{ minWidth: `${periodTimeline.width + 340}px` }}>
                  <div className="absolute inset-y-0 z-0 pointer-events-none" style={{ left: "320px", width: `${periodTimeline.width}px` }}>
                    <GanttBackdrop timeline={periodTimeline} />
                  </div>
                  <div className="relative z-10">
                    {items.length === 0 && <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">No assignments found for this segment.</div>}
                    {items.map((item, idx) => (
                      <div key={`seg-drilldown-${item.id}`} className={`py-0.5 ${idx % 2 === 1 ? "bg-slate-100/60" : ""}`}>
                        <div className="grid grid-cols-[320px_1fr] items-center gap-0 h-7">
                          <button
                            type="button"
                            onClick={() => { setDemandDrilldown(null); openEditAssignmentForm(item.assignment); }}
                            className="sticky left-0 z-20 h-7 bg-white pr-3 text-left overflow-hidden hover:bg-slate-50"
                            title={`${item.project.projectNumber ? `${item.project.projectNumber} - ` : ""}${item.project.name} — click to edit assignment`}
                          >
                            <p className="truncate text-[12px] font-semibold text-slate-900 hover:text-emerald-700">{item.project.projectNumber ? `${item.project.projectNumber} - ` : ""}{item.project.name}</p>
                          </button>
                          <div className="relative h-7 rounded-md" style={{ width: `${periodTimeline.width}px` }}>
                            <GanttSegmentBar item={item} timeline={periodTimeline} label={getAssignmentPeopleLabel(item.assignment, crews) || item.project.name} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Period-wide Gantt Drilldown — all assignments active in that period */}
      {demandPeriodDrilldown && (() => {
        const { label, periodItems, periodTimeline } = demandPeriodDrilldown;
        // Role fields currently filtered on the demand graph (e.g. Superintendent).
        const roleFields = [...new Set((demandResourceTypeFilter || []).map((rt) => RESOURCE_TYPE_TO_ROLE[rt]).filter(Boolean))];
        const filterTitle = (demandResourceTypeFilter || []).join(" / ") || "resource";

        // ── Reverse grouping: one row per RESOURCE of the filtered title, bars =
        // their project(s) in this period. Projects with no such resource go to
        // an Unassigned bucket at the bottom.
        const buildReversed = () => {
          const byResource = new Map();
          const unassignedItems = [];
          periodItems.forEach((item) => {
            // Synthetic "unassigned need" items (unfilled slots) are unassigned by
            // definition — they always belong in the Unassigned segment.
            if (item.isUnassignedNeed) { unassignedItems.push(item); return; }
            const names = [];
            roleFields.forEach((rf) => {
              const n = (item[rf] || item.assignment?.[rf] || "").trim();
              if (n) {
                const rec = resourceByName.get(n);
                if (!rec || (demandResourceTypeFilter || []).includes(rec.resourceType)) names.push(n);
              }
            });
            if (names.length === 0) { unassignedItems.push(item); return; }
            [...new Set(names)].forEach((n) => {
              if (!byResource.has(n)) byResource.set(n, { name: n, items: [] });
              byResource.get(n).items.push(item);
            });
          });
          const earliest = (row) => {
            const ds = (row.items || []).map((i) => toDate(i.start)).filter(Boolean);
            return ds.length ? Math.min(...ds.map((d) => d.getTime())) : Number.MAX_SAFE_INTEGER;
          };
          const assigned = [...byResource.values()].sort((a, b) => a.name.localeCompare(b.name));
          return { assigned, unassignedItems: unassignedItems.sort((a, b) => earliest({ items: [a] }) - earliest({ items: [b] })) };
        };
        const reversed = demandDrilldownReversed ? buildReversed() : null;

        // Print: respects the current orientation.
        const handlePrint = () => {
          const usedDivs = new Set();
          if (!demandDrilldownReversed) {
            const rows = periodItems.map((item) => {
              const div = item.project?.division; if (div) usedDivs.add(div);
              return {
                label: `${item.project.projectNumber ? item.project.projectNumber + " - " : ""}${item.project.name}`,
                sublabel: getAssignmentPeopleLabel(item.assignment, crews) || "",
                bars: (item.start && item.end) ? [{ start: item.start, end: item.end, color: divisionSvgColors[div] || "#475569" }] : [],
              };
            }).filter((r) => r.bars.length);
            const legend = [...usedDivs].map((d) => [divisionSvgColors[d] || "#475569", d]);
            printGantt({ title: `Demand — ${label}`, subtitle: `Projects · ${label}`, rows, showExtra: false, extraHeader: { name: "Project · Assigned" }, legend, windowStart: periodTimeline.minDate, windowEnd: periodTimeline.maxDate });
          } else {
            const mkRows = (items) => items.filter((i) => i.start && i.end).map((i) => {
              const div = i.project?.division; if (div) usedDivs.add(div);
              return { start: i.start, end: i.end, color: divisionSvgColors[div] || "#475569" };
            });
            const rows = reversed.assigned.map((r) => ({
              label: r.name,
              sublabel: `${r.items.length} project${r.items.length === 1 ? "" : "s"}`,
              bars: mkRows(r.items),
            })).filter((r) => r.bars.length);
            if (reversed.unassignedItems.length) {
              rows.push({ label: `UNASSIGNED — no ${filterTitle}`, isHeader: true, bars: [] });
              reversed.unassignedItems.forEach((item) => rows.push({
                label: `${item.project.projectNumber ? item.project.projectNumber + " - " : ""}${item.project.name}`,
                sublabel: "Unassigned",
                bars: mkRows([item]),
              }));
            }
            if (!rows.length) { alert("Nothing to print."); return; }
            const legend = [...usedDivs].map((d) => [divisionSvgColors[d] || "#475569", d]);
            printGantt({ title: `Demand — ${label} (Reversed)`, subtitle: `By ${filterTitle} · ${label}`, rows, showExtra: false, extraHeader: { name: `${filterTitle} · Project` }, legend, windowStart: periodTimeline.minDate, windowEnd: periodTimeline.maxDate });
          }
        };

        return (
          <div className="fixed inset-0 z-[85] bg-slate-950/70 p-4">
            <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white p-5">
                <div>
                  <h2 className="text-2xl font-bold">All Assignments — {label}</h2>
                  <p className="text-sm text-slate-500">
                    {demandDrilldownReversed
                      ? `Reversed: rows are ${filterTitle}. Bars show their project(s); projects with none are listed under Unassigned.`
                      : `${periodItems.length} mobilization${periodItems.length === 1 ? "" : "s"} active here. Bar shows peak concurrent demand: same-person sequential mobs count as 1, overlapping mobs count separately.`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setDemandDrilldownReversed((v) => !v)} className={`rounded-xl px-4 py-2 text-sm font-semibold ${demandDrilldownReversed ? "bg-emerald-700 text-white hover:bg-emerald-800" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`} title="Flip between projects-as-rows and resources-as-rows">⇄ {demandDrilldownReversed ? "Reversed" : "Reverse"}</button>
                  <button onClick={handlePrint} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Print</button>
                  <button onClick={() => { setDemandPeriodDrilldown(null); setDemandDrilldownReversed(false); }} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold hover:bg-slate-50">Close</button>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-5">
                <GanttHeader timeline={periodTimeline} zoom={demandZoom} />
                <div className="relative mt-3" style={{ minWidth: `${periodTimeline.width + 340}px` }}>
                  <div className="absolute inset-y-0 z-0 pointer-events-none" style={{ left: "320px", width: `${periodTimeline.width}px` }}>
                    <GanttBackdrop timeline={periodTimeline} />
                  </div>
                  <div className="relative z-10">
                    {periodItems.length === 0 && <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">No assignments active in this period.</div>}

                    {!demandDrilldownReversed && periodItems.map((item, idx) => (
                      <div key={`period-drilldown-${item.id}`} className={`py-0.5 ${idx % 2 === 1 ? "bg-slate-100/60" : ""}`}>
                        <div className="grid grid-cols-[320px_1fr] items-center gap-0 h-7">
                          <button
                            type="button"
                            onClick={() => { setDemandPeriodDrilldown(null); openEditAssignmentForm(item.assignment); }}
                            className="sticky left-0 z-20 h-7 bg-white pr-3 text-left overflow-hidden hover:bg-slate-50"
                            title={`${item.project.projectNumber ? `${item.project.projectNumber} - ` : ""}${item.project.name} — click to edit assignment`}
                          >
                            <p className="truncate text-[12px] font-semibold text-slate-900 hover:text-emerald-700">{item.project.projectNumber ? `${item.project.projectNumber} - ` : ""}{item.project.name}</p>
                          </button>
                          <div className="relative h-7 rounded-md" style={{ width: `${periodTimeline.width}px` }}>
                            <GanttSegmentBar item={item} timeline={periodTimeline} label={getAssignmentPeopleLabel(item.assignment, crews) || item.project.name} />
                          </div>
                        </div>
                      </div>
                    ))}

                    {demandDrilldownReversed && reversed && (
                      <>
                        {reversed.assigned.map((row, idx) => (
                          <div key={`rev-res-${row.name}`} className={`py-0.5 ${idx % 2 === 1 ? "bg-slate-100/60" : ""}`}>
                            <div className="grid grid-cols-[320px_1fr] items-start gap-0">
                              <div className="sticky left-0 z-20 bg-white pr-3 text-left overflow-hidden">
                                <p className="truncate text-[12px] font-bold text-slate-900" title={row.name}>{row.name}</p>
                                <p className="truncate text-[10px] text-slate-500 leading-tight">{row.items.length} project{row.items.length === 1 ? "" : "s"}</p>
                              </div>
                              <div className="relative rounded-md" style={{ width: `${periodTimeline.width}px` }}>
                                {[...row.items].sort((a, b) => new Date(a.start) - new Date(b.start)).map((item) => (
                                  <div key={`rev-${row.name}-${item.id}`} className="relative h-7">
                                    <GanttSegmentBar item={item} timeline={periodTimeline} label={`${item.project.projectNumber ? item.project.projectNumber + " - " : ""}${item.project.name}`} />
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        ))}
                        {reversed.unassignedItems.length > 0 && (
                          <>
                            <div className="sticky left-0 z-20 mt-2 mb-1 bg-amber-50 px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-amber-800" style={{ width: "320px" }}>Unassigned — no {filterTitle}</div>
                            {reversed.unassignedItems.map((item, idx) => {
                              const unLabel = item.isUnassignedNeed ? `${item.unassignedAbbreviation} - Unassigned` : "Unassigned";
                              return (
                              <div key={`rev-un-${item.id}`} className={`py-0.5 ${idx % 2 === 1 ? "bg-slate-100/60" : ""}`}>
                                <div className="grid grid-cols-[320px_1fr] items-center gap-0 h-7">
                                  <button
                                    type="button"
                                    onClick={() => { if (!item.assignment) return; setDemandPeriodDrilldown(null); setDemandDrilldownReversed(false); openEditAssignmentForm(item.assignment); }}
                                    className="sticky left-0 z-20 h-7 bg-white pr-3 text-left overflow-hidden hover:bg-slate-50"
                                    title={`${item.project.projectNumber ? `${item.project.projectNumber} - ` : ""}${item.project.name}${item.assignment ? " — click to edit assignment" : " — unfilled need"}`}
                                  >
                                    <p className="truncate text-[12px] font-semibold text-amber-800">{item.project.projectNumber ? `${item.project.projectNumber} - ` : ""}{item.project.name}</p>
                                  </button>
                                  <div className="relative h-7 rounded-md" style={{ width: `${periodTimeline.width}px` }}>
                                    <GanttSegmentBar item={item} timeline={periodTimeline} label={unLabel} />
                                  </div>
                                </div>
                              </div>
                              );
                            })}
                          </>
                        )}
                      </>
                    )}
                  </div>
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
                  <div className="relative mt-3" style={{ minWidth: `${timeline.width + 340}px` }}>
                    <div className="absolute inset-y-0 z-0 pointer-events-none" style={{ left: "320px", width: `${timeline.width}px` }}>
                      <GanttBackdrop timeline={timeline} />
                    </div>
                    <div className="relative z-10">
                      {projectGanttRows.map((row, idx) => (
                        <div key={row.project.id} className={`py-0.5 ${idx % 2 === 1 ? "bg-slate-100/60" : ""}`}>
                          <ProjectGanttRow
                            assignment={row.assignment}
                            project={row.project}
                            items={row.items}
                            timeline={timeline}
                            crews={crews}
                            onLabelClick={() => openEditAssignmentForm(row.assignment)}
                            onDragEnd={canWrite ? handleProjectGanttDragEnd : undefined}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {expandedView === "resource" && (
                <div>
                  <GanttHeader timeline={resourceTimeline} zoom={resourceZoom} />
                  <div className="relative mt-3" style={{ minWidth: `${resourceTimeline.width + 340}px` }}>
                    <div className="absolute inset-y-0 z-0 pointer-events-none" style={{ left: "320px", width: `${resourceTimeline.width}px` }}>
                      <GanttBackdrop timeline={resourceTimeline} />
                    </div>
                    <div className="relative z-10">
                      {resourceGanttRowsWithUnassigned.map((row, idx) => (
                        <div key={row.resource.id} className={`py-0.5 ${idx % 2 === 1 ? "bg-slate-100/60" : ""}`}>
                          {row.isUnassignedNeedRow
                            ? <UnassignedNeedGanttRow resource={row.resource} items={row.items} timeline={resourceTimeline} />
                            : <ResourceGanttRow resource={row.resource} items={row.items} timeline={resourceTimeline} onResourceClick={setFocusedResource} />}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {expandedView === "crew" && (
                <div>
                  <GanttHeader timeline={crewTimeline} zoom={crewZoom} />
                  <div className="relative mt-3" style={{ minWidth: `${crewTimeline.width + 340}px` }}>
                    <div className="absolute inset-y-0 z-0 pointer-events-none" style={{ left: "320px", width: `${crewTimeline.width}px` }}>
                      <GanttBackdrop timeline={crewTimeline} />
                    </div>
                    <div className="relative z-10">
                      {crewGanttRows.map((row, idx) => (
                        <div key={row.crew.id} className={`py-0.5 ${idx % 2 === 1 ? "bg-slate-100/60" : ""}`}>
                          <CrewGanttRow crew={row.crew} items={row.items} timeline={crewTimeline} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {expandedView === "demand" && (
                <ResourceDemandChart
                  enlarged
                  items={demandFilteredItems}
                  timeline={demandTimeline}
                  zoom={demandZoom}
                  totalResources={resources.filter((r) => demandResourceTypeFilter.includes(r.resourceType) && demandHomeDivisionFilter.includes(r.homeDivision)).length}
                  onExportPdf={() => exportSectionPdf("resource-demand-graph", "Resource Demand Graph")}
                  onBarClick={setDemandDrilldown}
                  onPeriodClick={setDemandPeriodDrilldown}
                  getItemKeys={getDemandKeys}
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
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              New users create their own account using <strong>Sign up</strong> on the login screen. They start as <strong>viewer</strong>. Promote them to manager or admin below.
            </div>
            <div className="mt-5 rounded-xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100 text-slate-600"><tr><th className="p-3">Email</th><th className="p-3">Role</th><th className="p-3">Created</th><th className="p-3 text-right">Action</th></tr></thead>
                <tbody>
                  {appUsers.map((user) => (
                    <tr key={user.id} className="border-t border-slate-200">
                      <td className="p-3 font-semibold">{user.email}</td>
                      <td className="p-3">
                        <select
                          value={user.role}
                          onChange={(e) => updateUserRole(user.id, e.target.value)}
                          disabled={userRole !== "admin"}
                          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-emerald-600 disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          <option value="viewer">viewer</option>
                          <option value="manager">manager</option>
                          <option value="admin">admin</option>
                        </select>
                      </td>
                      <td className="p-3">{user.created_at ? formatDate(user.created_at) : ""}</td>
                      <td className="p-3 text-right"><button onClick={() => deleteAppUser(user.id, user.email)} disabled={userRole !== "admin"} className="rounded-lg border border-red-200 px-3 py-1.5 font-semibold text-red-700 hover:bg-red-50 disabled:opacity-40">Delete</button></td>
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
          const thereafter = allMonths.filter((m) => m > `${forecastYear}-12`).reduce((s, m) => s + getMonthValue(p.id, m).value, 0);
          return { project: p, row, spread, monthValues, yearTotal, thereafter };
        });

        const monthTotals = months.map((_, i) => projectRows.reduce((s, r) => s + r.monthValues[i].value, 0));
        const yearGrandTotal = monthTotals.reduce((s, v) => s + v, 0);
        const thereafterTotal = projectRows.reduce((s, r) => s + r.thereafter, 0);
        const contractValueTotal = projectRows.reduce((s, r) => s + (Number(r.row.contractValue) || 0), 0);
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
              {canWrite && <CmicRefreshContracts projects={projects} forecastData={forecastData} onApplied={() => loadSupabaseData()} />}
              {canWrite && <button onClick={recalculateAll} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800 shadow-sm">↻ Recalculate</button>}
              {canWrite && <label className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 shadow-sm cursor-pointer">
                Import CSV<input type="file" accept=".csv" onChange={importForecastCsv} className="hidden" />
              </label>}
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
                      // Sanity check: prior year + current year + thereafter
                      // should equal contract value (within rounding). If they
                      // don't, something has drifted — flag the contract input
                      // red so the user notices. Tolerance is $1 for rounding.
                      const computedTotal = priorYearTotal + yearTotal + thereafter;
                      const contractDelta = Math.abs((row.contractValue || 0) - computedTotal);
                      const contractMismatch = contractDelta > 1;
                      return (
                        <tr key={p.id} className={`border-t border-slate-100 ${rowBg} hover:bg-emerald-50 group`}>
                          <td className={`sticky left-0 z-10 p-3 group-hover:bg-emerald-50 ${rowBg}`}>
                            <p className="font-semibold text-slate-900">{p.projectNumber ? `${p.projectNumber} - ` : ""}{p.name}</p>
                          </td>
                          <td className="p-3">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold text-white ${divisionStyles[p.division] || "bg-slate-500"}`}>{p.division}</span>
                          </td>
                          <td className="p-3">
                            <input type="number"
                              className={`w-full rounded-lg border px-2 py-1 text-right text-sm outline-none focus:bg-white ${contractMismatch ? "border-red-400 bg-red-50 text-red-700 font-bold focus:border-red-500" : "border-slate-200 bg-transparent focus:border-emerald-500"}`}
                              defaultValue={row.contractValue || ""} placeholder="0"
                              title={contractMismatch ? `Contract: ${fmt(row.contractValue || 0)}\nPrior Year: ${fmt(priorYearTotal)}\nYear Total: ${fmt(yearTotal)}\nThereafter: ${fmt(thereafter)}\n— Computed Total: ${fmt(computedTotal)}\n— Difference: ${fmt(computedTotal - (row.contractValue || 0))}\n\nTry clicking ↻ Recalculate.` : `Contract: ${fmt(row.contractValue || 0)}\nPrior Year: ${fmt(priorYearTotal)}\nYear Total: ${fmt(yearTotal)}\nThereafter: ${fmt(thereafter)}\n— Total: ${fmt(computedTotal)}`}
                              onBlur={(e) => saveForecastRow(p.id, { contractValue: parseFloat(e.target.value) || 0 })} />
                          </td>
                          {/* Prior Year column */}
                          <td className="p-3 text-right text-sm bg-slate-100 text-slate-600 font-medium">{priorYearTotal !== 0 ? fmt(priorYearTotal) : <span className="text-slate-300">—</span>}</td>
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
                                  {mv.value !== 0 ? fmt(mv.value) : <span className="text-slate-300">—</span>}
                                </div>
                              ) : (
                                <div className="relative group/cell">
                                  <input type="number"
                                    className={`w-full rounded-lg border px-2 py-1 text-right text-xs outline-none focus:bg-white ${mv.isActual ? "border-emerald-300 bg-emerald-50 font-semibold text-emerald-800 focus:border-emerald-500" : mv.isRedistributed ? "border-blue-200 bg-blue-50 text-blue-700 focus:border-blue-400" : "border-transparent bg-transparent text-slate-700 hover:border-slate-200 focus:border-emerald-500"}`}
                                    defaultValue={mv.isActual || mv.isRedistributed ? mv.value.toFixed(0) : (mv.value !== 0 ? mv.value.toFixed(0) : "")}
                                    placeholder={mv.value !== 0 && !mv.isActual ? mv.value.toFixed(0) : ""}
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
                          <td className="p-3 text-right text-xs text-slate-500 bg-slate-50">{thereafter !== 0 ? fmt(thereafter) : ""}</td>
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
                    <td className="p-3" />
                    <td className="p-3 text-right">{fmt(contractValueTotal)}</td>
                    <td className="p-3 bg-slate-200" />
                    <td className="p-3" />
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

      {/* ── Conflict / PTO collision detail modal ── */}
      {conflictModal && (() => {
        const roleLabel = (f) => ({ projectManager: "PM", superintendent: "Super", fieldCoordinator: "Field Coord", fieldEngineer: "Field Eng", safety: "Safety" }[f] || f);
        const itemDesc = (it) => `${it.project?.projectNumber ? it.project.projectNumber + " · " : ""}${it.project?.name || "—"}`;
        const mobItemDesc = (it) => `${it.project?.projectNumber ? it.project.projectNumber + " · " : ""}${it.project?.name || "—"}`;
        const titles = {
          conflicts: ["Scheduling Conflicts", "Superintendents and Field Coordinators double-booked across overlapping assignments."],
          pto: ["Upcoming PTO (next 60 days)", "Approved PTO windows starting within the next 60 days."],
          mobsThisWeek: ["Mobilizations Starting This Week", "Mobs with a start date in the current week."],
          mobsNextWeek: ["Mobilizations Starting Next Week", "Mobs with a start date in the coming week."],
          unassigned: ["Unassigned Needs", "Open role slots across all mobilizations."],
        };
        const [title, subtitle] = titles[conflictModal] || ["", ""];
        const mobRows = conflictModal === "mobsThisWeek" ? mobWeekRows.thisWeek : conflictModal === "mobsNextWeek" ? mobWeekRows.nextWeek : [];
        return (
          <div className="fixed inset-0 z-[88] flex items-center justify-center bg-slate-950/60 p-4">
            <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="flex shrink-0 items-center justify-between border-b border-slate-200 p-5">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
                  <p className="text-sm text-slate-500">{subtitle}</p>
                </div>
                <button onClick={() => setConflictModal(null)} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold hover:bg-slate-50">Close</button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-5">
                {conflictModal === "pto" && (
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-slate-100 text-slate-600">
                      <tr><th className="p-3">Resource</th><th className="p-3">Type</th><th className="p-3">PTO ID</th><th className="p-3">PTO Window</th></tr>
                    </thead>
                    <tbody>
                      {ptoCollisionRows.map((row, i) => (
                        <tr key={i} className="border-t border-slate-200">
                          <td className="p-3 font-semibold text-slate-900">{row.resourceName}</td>
                          <td className="p-3">{row.resource?.resourceType || "—"}</td>
                          <td className="p-3">{row.pto.ptoId || <span className="text-slate-300">—</span>}</td>
                          <td className="p-3 whitespace-nowrap text-orange-700 font-semibold">{formatDate(row.pto.start)} – {formatDate(row.pto.end)}</td>
                        </tr>
                      ))}
                      {ptoCollisionRows.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-slate-400">No upcoming PTO in the next 60 days.</td></tr>}
                    </tbody>
                  </table>
                )}
                {conflictModal === "conflicts" && (
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-slate-100 text-slate-600">
                      <tr><th className="p-3">Resource</th><th className="p-3">Assignment A</th><th className="p-3">Dates A</th><th className="p-3">Assignment B</th><th className="p-3">Dates B</th></tr>
                    </thead>
                    <tbody>
                      {conflictRows.map((row, i) => (
                        <tr key={i} className="border-t border-slate-200">
                          <td className="p-3 font-semibold text-slate-900">{row.resourceName}</td>
                          <td className="p-3">{itemDesc(row.a)} <span className="text-slate-400">({roleLabel(row.roleA)})</span></td>
                          <td className="p-3 whitespace-nowrap">{formatDate(row.a.start)} – {formatDate(row.a.end)}</td>
                          <td className="p-3">{itemDesc(row.b)} <span className="text-slate-400">({roleLabel(row.roleB)})</span></td>
                          <td className="p-3 whitespace-nowrap text-red-700 font-semibold">{formatDate(row.b.start)} – {formatDate(row.b.end)}</td>
                        </tr>
                      ))}
                      {conflictRows.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-slate-400">No conflicts.</td></tr>}
                    </tbody>
                  </table>
                )}
                {(conflictModal === "mobsThisWeek" || conflictModal === "mobsNextWeek") && (
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-slate-100 text-slate-600">
                      <tr><th className="p-3">Project</th><th className="p-3">Division</th><th className="p-3">Start</th><th className="p-3">End</th><th className="p-3">Staffing</th></tr>
                    </thead>
                    <tbody>
                      {mobRows.map((it, i) => (
                        <tr key={i} className="border-t border-slate-200">
                          <td className="p-3 font-semibold text-slate-900">{mobItemDesc(it)}</td>
                          <td className="p-3">{it.project?.division || "—"}</td>
                          <td className="p-3 whitespace-nowrap font-semibold text-sky-700">{formatDate(it.start)}</td>
                          <td className="p-3 whitespace-nowrap">{formatDate(it.end)}</td>
                          <td className="p-3 text-slate-600">{it.label || "—"}</td>
                        </tr>
                      ))}
                      {mobRows.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-slate-400">No mobilizations in this window.</td></tr>}
                    </tbody>
                  </table>
                )}
                {conflictModal === "unassigned" && (
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-slate-100 text-slate-600">
                      <tr><th className="p-3">Project</th><th className="p-3">Unassigned Division</th><th className="p-3">Mob Start</th><th className="p-3">Mob End</th></tr>
                    </thead>
                    <tbody>
                      {unassignedNeedRows.map((row, i) => (
                        <tr key={i} className="border-t border-slate-200">
                          <td className="p-3 font-semibold text-slate-900">{row.project?.projectNumber ? row.project.projectNumber + " · " : ""}{row.project?.name || "—"}</td>
                          <td className="p-3"><span className="rounded-full bg-slate-200 px-2 py-1 text-xs font-bold text-slate-700">{row.division}</span></td>
                          <td className="p-3 whitespace-nowrap">{row.start ? formatDate(row.start) : <span className="text-slate-300">—</span>}</td>
                          <td className="p-3 whitespace-nowrap">{row.end ? formatDate(row.end) : <span className="text-slate-300">—</span>}</td>
                        </tr>
                      ))}
                      {unassignedNeedRows.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-slate-400">No unassigned needs.</td></tr>}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Save current view modal ── */}
      {showSaveViewModal && (
        <div className="fixed inset-0 z-[112] flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-slate-900">Save current view</h2>
            <p className="mt-1 text-sm text-slate-500">Captures the current filters, zoom, and sort on this dashboard so you can return to it later.</p>
            <input
              autoFocus
              value={newViewName}
              onChange={(e) => setNewViewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveCurrentView(); }}
              placeholder="View name (e.g. My Hardscape board)"
              className="mt-4 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => { setShowSaveViewModal(false); setNewViewName(""); }} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold hover:bg-slate-50">Cancel</button>
              <button onClick={saveCurrentView} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Forms */}
      {showProjectForm && <ProjectForm form={projectForm} setForm={setProjectForm} onSave={saveProject} onCancel={() => setShowProjectForm(false)} onDelete={() => deleteProject(editingProjectId)} editing={Boolean(editingProjectId)} certifications={certifications} projectTypes={projectTypes} pmProfiles={pmProfiles} canEditPMs={isAdmin} />}
      {showTaskForm && (
        <TaskForm
          form={taskForm}
          setForm={setTaskForm}
          tasks={projectTasks}
          editingTaskId={editingTaskId}
          onSave={saveTask}
          onCancel={() => { setShowTaskForm(false); setEditingTaskId(null); }}
          onDelete={(id) => { deleteTask(id); setShowTaskForm(false); setEditingTaskId(null); }}
        />
      )}
      {showTaskRequestForm && (
        <TaskCrewRequestForm
          form={taskRequestForm}
          setForm={setTaskRequestForm}
          tasks={projectTasks}
          crewTypeOptions={crewTypes}
          onSave={submitTaskRequest}
          onCancel={() => setShowTaskRequestForm(false)}
          busy={taskRequestBusy}
        />
      )}
      {showStaffRequestForm && (
        <StaffRequestForm
          form={staffRequestForm}
          setForm={setStaffRequestForm}
          roles={STAFF_ROLES}
          onSave={submitStaffRequest}
          onCancel={() => setShowStaffRequestForm(false)}
          busy={staffRequestBusy}
        />
      )}
      {showRequestsModal && (
        <RequestsModal
          requests={bannerRequests}
          activeRequest={activeRequest}
          availability={activeRequest && (activeRequest.start && activeRequest.end) ? computeAvailability(activeRequest.start, activeRequest.end) : null}
          requestedTypes={activeRequest && activeRequest.kind === "crew" ? (activeRequest.crewTypes || []) : []}
          laborManagement={activeRequest && activeRequest.kind === "crew" ? (activeRequest.laborManagement || "None") : "None"}
          onPick={(req) => setActiveRequest(req)}
          onDelete={(req) => (req.kind === "crew" ? deleteTaskRequest(req.id) : deleteStaffRequest(req.id))}
          onContinue={(selection) => buildAssignmentFromSelection(selection)}
          onClose={() => { setShowRequestsModal(false); setActiveRequest(null); }}
        />
      )}
      {showAssignmentForm && <AssignmentForm form={assignmentForm} setForm={setAssignmentForm} onSave={saveAssignment} onCancel={() => { setShowAssignmentForm(false); setFulfillingRequest(null); }} onDelete={async () => {
        if (!editingAssignmentId) return;
        const ok = await deleteAssignment(editingAssignmentId);
        if (ok) {
          setShowAssignmentForm(false);
          setEditingAssignmentId(null);
        }
      }} editing={Boolean(editingAssignmentId)} resources={resources} projects={projects} crews={activeCrews} tasks={assignmentTasks} />}
      {showResourceForm && <ResourceForm form={resourceForm} setForm={setResourceForm} certifications={certifications} onSave={saveResource} onCancel={() => setShowResourceForm(false)} onDelete={() => deleteResource(editingResourceId)} onExportResume={() => exportResourceResume(resourceForm)} resourceStats={editingResourceId ? getResourceStats(resourceForm) : null} editing={Boolean(editingResourceId)} />}

      {/* ── Drag-to-adjust confirmation dialog (Project Gantt) ── */}
      {pendingDragChange && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-slate-900">Save schedule change?</h2>
            <p className="mt-1 text-sm text-slate-500">
              {pendingDragChange.project?.projectNumber ? `${pendingDragChange.project.projectNumber} · ` : ""}
              {pendingDragChange.project?.name}
              {pendingDragChange.label ? ` · ${pendingDragChange.label}` : ""}
            </p>
            <div className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="flex justify-between">
                <span className="font-semibold text-slate-700">Start</span>
                <span>
                  <span className="text-slate-400 line-through">{formatDate(pendingDragChange.origStart)}</span>
                  {" → "}
                  <span className="font-bold text-emerald-700">{formatDate(pendingDragChange.newStart)}</span>
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-slate-700">End</span>
                <span>
                  <span className="text-slate-400 line-through">{formatDate(pendingDragChange.origEnd)}</span>
                  {" → "}
                  <span className="font-bold text-emerald-700">{formatDate(pendingDragChange.newEnd)}</span>
                </span>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={cancelPendingDragChange}
                disabled={savingDragChange}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={applyPendingDragChange}
                disabled={savingDragChange}
                className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:bg-slate-300"
              >
                {savingDragChange ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showCrewForm && <CrewForm form={crewForm} setForm={setCrewForm} certifications={certifications} crewTypes={crewTypes} onSave={saveCrew} onCancel={() => setShowCrewForm(false)} onDelete={() => deleteCrew(editingCrewId)} editing={Boolean(editingCrewId)} />}

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
