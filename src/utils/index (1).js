// ─── Date Helpers ────────────────────────────────────────────────────────────

export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const date = new Date(value);
    date.setHours(12, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day, 12, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  date.setHours(12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function addDays(date, days) {
  const result = toDate(date) || new Date(date);
  result.setDate(result.getDate() + days);
  result.setHours(12, 0, 0, 0);
  return result;
}

export function addBusinessDaysInclusive(startDate, businessDays) {
  const start = startDate instanceof Date ? new Date(startDate) : new Date(startDate);
  const daysToAdd = Math.max(1, Math.ceil(Number(businessDays) || 0));
  if (Number.isNaN(start.getTime())) return null;
  const result = new Date(start);
  let counted = 0;
  let safety = 0;
  while (counted < daysToAdd && safety < 1000) {
    const day = result.getDay();
    if (day !== 0 && day !== 6) counted += 1;
    if (counted >= daysToAdd) break;
    result.setDate(result.getDate() + 1);
    safety += 1;
  }
  return safety >= 1000 ? null : result;
}

export function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

export function startOfWeek(date) {
  const result = new Date(date);
  const day = result.getDay();
  result.setDate(result.getDate() - day);
  return result;
}

export function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function startOfQuarter(date) {
  const quarterMonth = Math.floor(date.getMonth() / 3) * 3;
  return new Date(date.getFullYear(), quarterMonth, 1);
}

export function startOfYear(date) {
  return new Date(date.getFullYear(), 0, 1);
}

export function daysBetween(start, end) {
  const startDate = start instanceof Date ? start : new Date(start);
  const endDate = end instanceof Date ? end : new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
  return Math.max(1, Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1);
}

export function formatDate(date) {
  if (!date) return "Not set";
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return "Not set";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatTick(date, zoom) {
  if (zoom === "Days") return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (zoom === "Weeks") return `Week of ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  if (zoom === "Months") return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  if (zoom === "Quarters") return `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`;
  return String(date.getFullYear());
}

// ─── General Helpers ─────────────────────────────────────────────────────────

export function toggleListValue(list, value) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function findProject(projects, projectId) {
  return projects.find((project) => project.id === projectId);
}

export function getCrewDisplayName(crew) {
  if (!crew) return "";
  return [crew.crewName, crew.foremanName].filter(Boolean).join(" - ");
}

export function getAssignmentCrewIds(assignment) {
  return [assignment.crew1Id, assignment.crew2Id, assignment.crew3Id, assignment.crew4Id].filter(Boolean);
}

export function getAssignmentCrewDisplayNames(assignment, crews) {
  return getAssignmentCrewIds(assignment)
    .map((id) => getCrewDisplayName(crews.find((crew) => crew.id === id)))
    .filter(Boolean);
}

export function getAssignmentPeopleLabel(assignment, crews = []) {
  return [assignment.superintendent, ...getAssignmentCrewDisplayNames(assignment, crews)]
    .filter(Boolean)
    .join(" • ");
}

export function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

export function getPeriodEnd(start, zoom) {
  if (zoom === "Days") return addDays(start, 1);
  if (zoom === "Weeks") return addDays(start, 7);
  if (zoom === "Months") return addMonths(start, 1);
  if (zoom === "Quarters") return addMonths(start, 3);
  return addMonths(start, 12);
}

export function countRequiredResources(assignment) {
  return [
    assignment.projectManager, assignment.superintendent,
    assignment.fieldCoordinator, assignment.fieldEngineer,
    assignment.safety, assignment.crew1Id, assignment.crew2Id,
    assignment.crew3Id, assignment.crew4Id,
  ].filter(Boolean).length;
}

// ─── Timeline / Gantt Builders ───────────────────────────────────────────────

export function getTimelineUnitWidth(zoom) {
  if (zoom === "Days") return 72;
  if (zoom === "Weeks") return 118;
  if (zoom === "Months") return 138;
  if (zoom === "Quarters") return 170;
  return 190;
}

export function getTimelineWindow(zoom, items = []) {
  const today = new Date();
  const currentWeekStart = startOfWeek(today);

  const datedItems = (items || [])
    .map((item) => ({ start: toDate(item.start), end: toDate(item.end) }))
    .filter((item) => item.start && item.end);

  const latestItemEnd = datedItems.length
    ? new Date(Math.max(...datedItems.map((item) => item.end.getTime())))
    : currentWeekStart;

  let defaultEnd;
  if (zoom === "Days") defaultEnd = addDays(currentWeekStart, 15);
  else if (zoom === "Weeks") defaultEnd = addDays(currentWeekStart, 6 * 7);
  else if (zoom === "Months") defaultEnd = addMonths(currentWeekStart, 6);
  else if (zoom === "Quarters") defaultEnd = addMonths(currentWeekStart, 8 * 3);
  else defaultEnd = addMonths(currentWeekStart, 4 * 12);

  const rawStart = currentWeekStart;
  const start =
    zoom === "Days" ? startOfWeek(rawStart)
    : zoom === "Weeks" ? startOfWeek(rawStart)
    : zoom === "Months" ? startOfMonth(rawStart)
    : zoom === "Quarters" ? startOfQuarter(rawStart)
    : startOfYear(rawStart);

  let end = latestItemEnd > defaultEnd ? latestItemEnd : defaultEnd;
  if (zoom === "Days") end = addDays(end, 3);
  else if (zoom === "Weeks") end = addDays(startOfWeek(end), 7);
  else if (zoom === "Months") end = addMonths(startOfMonth(end), 1);
  else if (zoom === "Quarters") end = addMonths(startOfQuarter(end), 3);
  else end = addMonths(startOfYear(end), 12);

  return { start, end, today };
}

export function buildTimeline(items, zoom) {
  const window = getTimelineWindow(zoom, items);
  const min = window.start;
  const max = window.end;
  const ticks = [];
  let cursor = new Date(min);

  while (cursor <= max && ticks.length < 5000) {
    ticks.push(new Date(cursor));
    if (zoom === "Days") cursor = addDays(cursor, 1);
    else if (zoom === "Weeks") cursor = addDays(cursor, 7);
    else if (zoom === "Months") cursor = addMonths(cursor, 1);
    else if (zoom === "Quarters") cursor = addMonths(cursor, 3);
    else cursor = addMonths(cursor, 12);
  }

  const width = Math.max(1160, ticks.length * getTimelineUnitWidth(zoom));
  return { minDate: min, maxDate: max, currentDate: window.today, totalDays: daysBetween(min, max), ticks, width };
}

export function buildSinglePeriodTimeline(periodStart, zoom) {
  const start = periodStart instanceof Date ? new Date(periodStart) : toDate(periodStart);
  if (!start) return buildTimeline([], zoom);

  const end = getPeriodEnd(start, zoom);
  const ticks = [];
  let cursor = new Date(start);

  while (cursor <= end && ticks.length < 500) {
    ticks.push(new Date(cursor));
    if (zoom === "Days") cursor = addDays(cursor, 1);
    else if (zoom === "Weeks") cursor = addDays(cursor, 7);
    else if (zoom === "Months") cursor = addMonths(cursor, 1);
    else if (zoom === "Quarters") cursor = addMonths(cursor, 3);
    else cursor = addMonths(cursor, 12);
  }

  const width = Math.max(1160, Math.max(1, ticks.length) * getTimelineUnitWidth(zoom));
  return { minDate: start, maxDate: end, currentDate: new Date(), totalDays: daysBetween(start, end), ticks, width };
}

export function itemOverlapsTimeline(startValue, endValue, timeline) {
  const start = toDate(startValue);
  const end = toDate(endValue);
  if (!start || !end) return false;
  return rangesOverlap(start, addDays(end, 1), timeline.minDate, addDays(timeline.maxDate, 1));
}

export function timelinePercent(dateValue, timeline) {
  const date = dateValue instanceof Date ? dateValue : toDate(dateValue);
  if (!date) return 0;
  const startMs = timeline.minDate.getTime();
  const endMs = timeline.maxDate.getTime();
  const dateMs = date.getTime();
  if (endMs === startMs) return 0;
  return ((dateMs - startMs) / (endMs - startMs)) * 100;
}

export function timelineSpanPercent(startValue, endValue, timeline) {
  const start = toDate(startValue);
  const end = toDate(endValue);
  if (!start || !end) return { left: 0, width: 0 };
  const endExclusive = addDays(end, 1);
  const rawLeft = timelinePercent(start, timeline);
  const rawRight = timelinePercent(endExclusive, timeline);
  const left = Math.max(0, Math.min(100, rawLeft));
  const right = Math.max(0, Math.min(100, rawRight));
  return { left, width: Math.max(0.05, right - left) };
}

export function buildGanttItems(projects, assignments) {
  return assignments.flatMap((assignment) => {
    const project = findProject(projects, assignment.projectId);
    if (!project) return [];
    return (assignment.mobilizations || [])
      .filter((mob) => mob.start && mob.end)
      .map((mob, index) => ({
        id: `${assignment.id}-${mob.id}`,
        assignmentId: assignment.id,
        mobilizationId: mob.id,
        mobilizationNumber: index + 1,
        project,
        // Merge per-mob roles into a synthetic assignment object for label helpers
        assignment: {
          ...assignment,
          superintendent: mob.superintendent || assignment.superintendent || "",
          fieldCoordinator: mob.fieldCoordinator || assignment.fieldCoordinator || "",
          // expose crewIds so getAssignmentCrewIds works
          crew1Id: mob.crewIds?.[0] || assignment.crew1Id || "",
          crew2Id: mob.crewIds?.[1] || assignment.crew2Id || "",
          crew3Id: mob.crewIds?.[2] || assignment.crew3Id || "",
          crew4Id: mob.crewIds?.[3] || assignment.crew4Id || "",
          _crewIds: mob.crewIds || [],
        },
        start: mob.start,
        end: mob.end,
      }));
  });
}

// ─── CSV Utilities ────────────────────────────────────────────────────────────

export function downloadTextFile(filename, content, mimeType = "text/csv;charset=utf-8;") {
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

export function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

export function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function parseCsv(text) {
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
    if (char === quote && inQuotes && next === quote) { cell += quote; i += 1; }
    else if (char === quote) { inQuotes = !inQuotes; }
    else if (char === comma && !inQuotes) { row.push(cell); cell = ""; }
    else if ((char === lineFeed || char === carriageReturn) && !inQuotes) {
      if (char === carriageReturn && next === lineFeed) i += 1;
      row.push(cell);
      if (row.some((value) => String(value).trim() !== "")) rows.push(row);
      row = []; cell = "";
    } else { cell += char; }
  }

  row.push(cell);
  if (row.some((value) => String(value).trim() !== "")) rows.push(row);
  return rows;
}

export function csvToObjects(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((row) => {
    const item = {};
    headers.forEach((header, index) => { item[header] = row[index] || ""; });
    return item;
  });
}

export function splitList(value) {
  return String(value || "").split(/[;,]/).map((item) => item.trim()).filter(Boolean);
}

export function readCsvFile(event, onRows) {
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
