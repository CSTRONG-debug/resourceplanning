// ─── From DB → App State ─────────────────────────────────────────────────────

export function mapProjectFromDb(p) {
  return {
    id: p.id,
    projectNumber: p.project_number || "",
    name: p.name || "",
    client: p.client || "",
    address: p.address || "",
    division: p.division || "Hardscape",
    specificRequirements: p.specific_requirements || [],
    status: p.status || "Scheduled",
    includeInForecast: p.include_in_forecast || false,
  };
}

export function mapResourceFromDb(r) {
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

export function mapCrewFromDb(c) {
  return {
    id: c.id,
    crewName: c.crew_name || "",
    foremanName: c.foreman_name || "",
    specialty: c.specialty || [],
    totalMembers: c.total_members || 0,
  };
}

export function mapAssignmentFromDb(a, mobilizations = []) {
  const mobRows = mobilizations.filter((m) => m.assignment_id === a.id);

  const mobs = mobRows.map((m, i) => {
    // Only apply legacy assignment-level fields to the FIRST mobilization
    // as a one-time migration. Subsequent mobs start clean if they have no data.
    const isFirst = i === 0;
    return {
      id: m.id,
      start: m.start_date || "",
      durationWeeks: m.duration_weeks || "",
      end: m.end_date || "",
      superintendent: m.superintendent || (isFirst ? a.superintendent || "" : ""),
      fieldCoordinator: m.field_coordinator || (isFirst ? a.field_coordinator || "" : ""),
      crewIds: (m.crew_ids && m.crew_ids.length > 0)
        ? m.crew_ids
        : (isFirst ? [a.crew1_id, a.crew2_id, a.crew3_id, a.crew4_id].filter(Boolean) : []),
      crewMenCounts: m.crew_men_counts || {},
      crewOnly: m.crew_only || false,
      unassignedNeeds: Array.isArray(m.unassigned_needs) ? m.unassigned_needs.filter(Boolean) : [],
    };
  });

  return {
    id: a.id,
    projectId: a.project_id || "",
    projectManager: a.project_manager || "",
    fieldEngineer: a.field_engineer || "",
    safety: a.safety || "",
    // keep legacy fields for backward compat with Gantt label helpers
    superintendent: mobs[0]?.superintendent || a.superintendent || "",
    fieldCoordinator: mobs[0]?.fieldCoordinator || a.field_coordinator || "",
    crew1Id: mobs[0]?.crewIds?.[0] || a.crew1_id || "",
    crew2Id: mobs[0]?.crewIds?.[1] || a.crew2_id || "",
    crew3Id: mobs[0]?.crewIds?.[2] || a.crew3_id || "",
    crew4Id: mobs[0]?.crewIds?.[3] || a.crew4_id || "",
    mobilizations: mobs,
  };
}

export function mapCertificationFromDb(c) {
  return c.name || "";
}

// ─── App State → DB ──────────────────────────────────────────────────────────

export function projectToDb(project) {
  return {
    project_number: project.projectNumber,
    name: project.name,
    client: project.client,
    address: project.address,
    division: project.division,
    specific_requirements: project.specificRequirements || [],
    status: project.status,
    include_in_forecast: project.includeInForecast || false,
  };
}

export function resourceToDb(resource) {
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

export function crewToDb(crew) {
  return {
    crew_name: crew.crewName,
    foreman_name: crew.foremanName,
    specialty: crew.specialty || [],
    total_members: crew.totalMembers || 0,
  };
}

export function assignmentToDb(assignment) {
  // Store global fields; per-mob fields go into mobilizations table
  const firstMob = assignment.mobilizations?.[0];
  return {
    project_id: assignment.projectId,
    project_manager: assignment.projectManager,
    field_engineer: assignment.fieldEngineer,
    safety: assignment.safety,
    // keep legacy columns populated from first mob for backward compat
    superintendent: firstMob?.superintendent || "",
    field_coordinator: firstMob?.fieldCoordinator || "",
    crew1_id: firstMob?.crewIds?.[0] || null,
    crew2_id: firstMob?.crewIds?.[1] || null,
    crew3_id: firstMob?.crewIds?.[2] || null,
    crew4_id: firstMob?.crewIds?.[3] || null,
  };
}

export function mobilizationToDb(mob, assignmentId) {
  return {
    assignment_id: assignmentId,
    start_date: mob.start || null,
    duration_weeks: mob.durationWeeks === "" ? null : Number(mob.durationWeeks),
    end_date: mob.end || null,
    superintendent: mob.superintendent || null,
    field_coordinator: mob.fieldCoordinator || null,
    crew_ids: mob.crewIds || [],
    crew_men_counts: mob.crewMenCounts || {},
    crew_only: mob.crewOnly || false,
  };
}
