export const divisions = ["Hardscape", "Commercial", "Industrial", "Tilt"];
export const statuses = ["Pending Award", "Scheduled", "Active", "On Hold", "Complete"];
export const resourceTypes = ["Project Manager", "General Superintendent", "Superintendent", "Field Coordinator", "Field Engineer", "Safety"];
export const defaultDashboardResourceTypes = resourceTypes.filter((type) => type !== "Project Manager");
export const zoomModes = ["Days", "Weeks", "Months", "Quarters", "Years"];

export const divisionStyles = {
  Hardscape: "bg-emerald-700",
  Commercial: "bg-blue-700",
  Industrial: "bg-orange-600",
  Tilt: "bg-purple-700",
};

export const pendingDivisionStyles = {
  Hardscape: "bg-emerald-300",
  Commercial: "bg-blue-300",
  Industrial: "bg-orange-300",
  Tilt: "bg-purple-300",
};

export const divisionSvgColors = {
  Hardscape: "#047857",
  Commercial: "#1d4ed8",
  Industrial: "#ea580c",
  Tilt: "#7e22ce",
};

export const pendingDivisionSvgColors = {
  Hardscape: "#6ee7b7",
  Commercial: "#93c5fd",
  Industrial: "#fdba74",
  Tilt: "#d8b4fe",
};

export const startingCertifications = [
  "OSHA 10", "OSHA 30", "First Aid / CPR", "Forklift",
  "Aerial Lift", "Rigging", "Confined Space",
];

export const blankProject = {
  projectNumber: "",
  name: "",
  client: "",
  address: "",
  division: "Hardscape",
  specificRequirements: [],
  status: "Scheduled",
  includeInForecast: false,
};

export const blankAssignment = {
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

export const blankResource = {
  name: "",
  resourceType: "Superintendent",
  phone: "",
  email: "",
  homeDivision: "Hardscape",
  certifications: [],
  pto: [],
  status: "Active",
};

export const blankCrew = {
  crewName: "",
  foremanName: "",
  specialty: [],
};
