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
  };
}

export function mapAssignmentFromDb(a, mobilizations = []) {
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
  };
}

export function assignmentToDb(assignment) {
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

export function mobilizationToDb(mob, assignmentId) {
  return {
    assignment_id: assignmentId,
    start_date: mob.start || null,
    duration_weeks: mob.durationWeeks === "" ? null : Number(mob.durationWeeks),
    end_date: mob.end || null,
  };
}
