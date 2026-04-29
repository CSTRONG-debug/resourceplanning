import React from "react";
import {
  divisionStyles, pendingDivisionStyles,
  divisionSvgColors, pendingDivisionSvgColors, divisions,
} from "../../constants";
import {
  toDate, addDays, formatDate, formatTick,
  timelinePercent, timelineSpanPercent,
  rangesOverlap, getPeriodEnd,
  getAssignmentPeopleLabel, getCrewDisplayName, getAssignmentCrewIds,
} from "../../utils";

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
  const isUnassigned = !item.assignment?.superintendent;
  const colorClass = isUnassigned || project.status === "Pending Award"
    ? pendingDivisionStyles[project.division] || "bg-slate-300"
    : divisionStyles[project.division] || "bg-slate-700";
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
    `${project.division} • ${project.status}`,
    `${formatDate(item.start)} - ${formatDate(item.end)}`,
    label ? `Assignment: ${label}` : "Unassigned",
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
          <GanttSegmentBar key={item.id} item={item} timeline={timeline} label={getAssignmentPeopleLabel(item.assignment, crews)} />
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

export function ResourceDemandChart({ items, timeline, zoom, totalResources, onExportPdf, onBarClick, enlarged = false }) {
  const periods = timeline.ticks.map((tick) => {
    const periodStart = tick;
    const periodEnd = getPeriodEnd(tick, zoom);
    const buckets = {};
    divisions.forEach((d) => { buckets[d] = { current: 0, pending: 0 }; });

    items.forEach((item) => {
      const itemStart = toDate(item.start);
      const itemEnd = toDate(item.end);
      if (!itemStart || !itemEnd || !rangesOverlap(itemStart, addDays(itemEnd, 1), periodStart, periodEnd)) return;
      if (item.project.status === "Pending Award") buckets[item.project.division].pending += 1;
      else if (item.project.status !== "Complete") buckets[item.project.division].current += 1;
    });

    const segments = [];
    divisions.forEach((d) => {
      if (buckets[d].current > 0) segments.push({ division: d, type: "Current", value: buckets[d].current, color: divisionSvgColors[d] });
      if (buckets[d].pending > 0) segments.push({ division: d, type: "Pending", value: buckets[d].pending, color: pendingDivisionSvgColors[d] });
    });

    const count = divisions.reduce((sum, d) => sum + buckets[d].current + buckets[d].pending, 0);
    return { label: formatTick(tick, zoom), tick, segments, count };
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
                    <rect key={`${segment.division}-${segment.type}`} x={x} y={rectY} width={barWidth} height={segmentHeight} rx="5" fill={segment.color} onClick={() => onBarClick?.({ period, segment })} style={{ cursor: "pointer" }}>
                      <title>{segment.division} {segment.type}: {segment.value}</title>
                    </rect>
                  );
                })}
                <text x={x + barWidth / 2} y={height - 36} textAnchor="middle" fontSize="10" fill="#475569">{period.label}</text>
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
