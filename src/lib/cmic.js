// src/lib/cmic.js
//
// Client-side helpers for the CMiC integration.
// Calls the Supabase Edge Function (`cmic-proxy`) which holds CMiC creds
// server-side. This file knows nothing about CMiC credentials — only about
// the proxy endpoint and how to map CMiC field names to your app's schema.

import { supabase } from "./supabase";

// ── Field mapping (EDIT ME) ────────────────────────────────────────────────
//
// This map tells us which CMiC field on a JC Job corresponds to each field
// on your local project record. These are placeholders based on the most
// common CMiC field names — verify against one real job from your tenant
// and adjust before going live.
//
// To check: temporarily call `await fetchCmicJobs()` in the console, look at
// the raw items, and confirm that each CMiC_FIELDS value below holds the data
// you actually use.
export const CMIC_FIELDS = {
  projectNumber: "JobCode",       // commonly JobCode; sometimes JobBidCode
  name:          "JobName",
  client:        "JobBillCustCode", // may be JobCustCode or a related Name field
  division:      "JobBillDeptCode", // GGC may use a custom field — confirm
  status:        "JobStatusCode",   // single letter code: A/I/O/C/etc
  projectType:   "JobTypeCode",     // may not exist; can be left null
  contractValue: "JobBillAmt",      // contract / billing amount
};

// Map CMiC's single-letter JobStatusCode to your app's status strings.
// Update these to whatever your app uses for status (you have "Complete"
// in your code, plus presumably "Active" / "In Progress" / etc).
const STATUS_MAP = {
  A: "Active",
  I: "In Progress",
  O: "Open",
  C: "Complete",
  H: "On Hold",
};

// ── Edge Function caller ──────────────────────────────────────────────────

async function callProxy(path) {
  // supabase.functions.invoke handles auth headers & URL construction.
  // Path is the part after the function name, e.g. "/jobs?status=active".
  const { data, error } = await supabase.functions.invoke(
    "cmic-proxy" + path,
    { method: "GET" }
  );
  if (error) throw new Error(error.message || "CMiC proxy call failed");
  if (data?.error) throw new Error(data.error);
  return data;
}

// ── Public API ─────────────────────────────────────────────────────────────

// Quick health check — useful for the settings page.
export async function checkCmicConnection() {
  return callProxy("/health");
}

// Pull the active CMiC jobs. Returns BOTH the raw CMiC items and the mapped
// local-shape projects, so the UI can show a meaningful diff.
export async function fetchCmicJobs({ status = "active" } = {}) {
  const data = await callProxy(`/jobs?status=${encodeURIComponent(status)}`);
  const items = data.items || [];
  const mapped = items.map(mapCmicJobToProject);
  return { raw: items, mapped, count: data.count };
}

// Refresh just the contract values for the projects that originated from
// CMiC. Returns an array of { projectNumber, currentValue, cmicValue, changed }.
export async function fetchContractValueUpdates(localProjects) {
  const updates = [];
  for (const p of localProjects) {
    if (!p.projectNumber) continue;
    try {
      const job = await callProxy(`/jobs/${encodeURIComponent(p.projectNumber)}`);
      const cmicValue = pickField(job, CMIC_FIELDS.contractValue);
      const currentValue = p.contractValue ?? null;
      const changed = Number(cmicValue) !== Number(currentValue);
      updates.push({
        projectId: p.id,
        projectNumber: p.projectNumber,
        name: p.name,
        currentValue,
        cmicValue,
        changed,
        error: null,
      });
    } catch (err) {
      updates.push({
        projectId: p.id,
        projectNumber: p.projectNumber,
        name: p.name,
        currentValue: p.contractValue ?? null,
        cmicValue: null,
        changed: false,
        error: err.message,
      });
    }
  }
  return updates;
}

// ── Mapping ───────────────────────────────────────────────────────────────

// CMiC sometimes nests fields or returns single-item containers. Be defensive.
function pickField(job, fieldName) {
  if (!job || !fieldName) return null;
  // Single-item GET responses come back as { items: [job] } sometimes.
  if (job.items && Array.isArray(job.items) && job.items[0]) {
    return job.items[0][fieldName] ?? null;
  }
  return job[fieldName] ?? null;
}

function mapStatus(cmicStatus) {
  return STATUS_MAP[cmicStatus] || cmicStatus || "Active";
}

// Convert a CMiC job object to your local project shape. Keep CMiC's raw
// JobCode in projectNumber so the contract-refresh button can find it later.
export function mapCmicJobToProject(job) {
  return {
    projectNumber: pickField(job, CMIC_FIELDS.projectNumber),
    name:          pickField(job, CMIC_FIELDS.name),
    client:        pickField(job, CMIC_FIELDS.client) || "",
    division:      pickField(job, CMIC_FIELDS.division) || "",
    status:        mapStatus(pickField(job, CMIC_FIELDS.status)),
    projectType:   pickField(job, CMIC_FIELDS.projectType) || "",
    contractValue: pickField(job, CMIC_FIELDS.contractValue),
    includeInForecast: false,
    // Mark provenance so we can tell CMiC-imported projects apart later.
    _source: "cmic",
  };
}

// Compute a diff between CMiC jobs and existing local projects, matched by
// projectNumber. Returns three buckets: toCreate, toUpdate, unchanged.
export function diffCmicAgainstLocal(cmicMapped, localProjects) {
  const localByNumber = new Map(
    localProjects.filter((p) => p.projectNumber).map((p) => [String(p.projectNumber), p])
  );

  const toCreate = [];
  const toUpdate = [];
  const unchanged = [];

  for (const incoming of cmicMapped) {
    if (!incoming.projectNumber) continue;
    const existing = localByNumber.get(String(incoming.projectNumber));
    if (!existing) {
      toCreate.push(incoming);
      continue;
    }
    const changes = {};
    for (const key of ["name", "client", "division", "status", "projectType"]) {
      const a = existing[key];
      const b = incoming[key];
      // Loose comparison so "" vs null doesn't trigger a noisy update.
      if ((a ?? "") !== (b ?? "")) changes[key] = { from: a, to: b };
    }
    if (Object.keys(changes).length === 0) unchanged.push({ existing, incoming });
    else toUpdate.push({ existing, incoming, changes });
  }

  return { toCreate, toUpdate, unchanged };
}
