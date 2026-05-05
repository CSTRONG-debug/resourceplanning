import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import {
  mapProjectFromDb,
  mapResourceFromDb,
  mapCrewFromDb,
  mapAssignmentFromDb,
  mapCertificationFromDb,
} from "../db/mappers";

/**
 * Subscribes to real-time changes on all five core tables.
 * Any INSERT / UPDATE / DELETE from another browser tab or user
 * is reflected immediately in local React state without a page refresh.
 */
export function useSupabaseRealtime({
  setProjects,
  setResources,
  setCrews,
  setAssignments,
  setCertifications,
  savingAssignmentIdsRef,
}) {
  useEffect(() => {
    if (!supabase) return;

    // ── projects ────────────────────────────────────────────────────────────
    const projectsChannel = supabase
      .channel("realtime:projects")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "projects" }, ({ new: row }) => {
        setProjects((prev) => {
          if (prev.some((p) => p.id === row.id)) return prev;
          return [mapProjectFromDb(row), ...prev];
        });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "projects" }, ({ new: row }) => {
        setProjects((prev) => prev.map((p) => (p.id === row.id ? mapProjectFromDb(row) : p)));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "projects" }, ({ old: row }) => {
        setProjects((prev) => prev.filter((p) => p.id !== row.id));
      })
      .subscribe();

    // ── resources ───────────────────────────────────────────────────────────
    const resourcesChannel = supabase
      .channel("realtime:resources")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "resources" }, ({ new: row }) => {
        setResources((prev) => {
          if (prev.some((r) => r.id === row.id)) return prev;
          return [mapResourceFromDb(row), ...prev];
        });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "resources" }, ({ new: row }) => {
        setResources((prev) => prev.map((r) => (r.id === row.id ? mapResourceFromDb(row) : r)));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "resources" }, ({ old: row }) => {
        setResources((prev) => prev.filter((r) => r.id !== row.id));
      })
      .subscribe();

    // ── crews ────────────────────────────────────────────────────────────────
    const crewsChannel = supabase
      .channel("realtime:crews")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "crews" }, ({ new: row }) => {
        setCrews((prev) => {
          if (prev.some((c) => c.id === row.id)) return prev;
          return [mapCrewFromDb(row), ...prev];
        });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "crews" }, ({ new: row }) => {
        setCrews((prev) => prev.map((c) => (c.id === row.id ? mapCrewFromDb(row) : c)));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "crews" }, ({ old: row }) => {
        setCrews((prev) => prev.filter((c) => c.id !== row.id));
      })
      .subscribe();

    // ── assignments ──────────────────────────────────────────────────────────
    // Note: mobilization changes are handled via their parent assignment re-fetch
    const assignmentsChannel = supabase
      .channel("realtime:assignments")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "assignments" }, async ({ new: row }) => {
        // Fetch mobilizations for this new assignment
        const { data: mobs } = await supabase
          .from("mobilizations")
          .select("*")
          .eq("assignment_id", row.id);
        setAssignments((prev) => {
          if (prev.some((a) => a.id === row.id)) return prev;
          return [mapAssignmentFromDb(row, mobs || []), ...prev];
        });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "assignments" }, async ({ new: row }) => {
         if (savingAssignmentIdsRef?.current?.has(row.id)) return;
        const { data: mobs } = await supabase
          .from("mobilizations")
          .select("*")
          .eq("assignment_id", row.id);
        setAssignments((prev) =>
          prev.map((a) => (a.id === row.id ? mapAssignmentFromDb(row, mobs || []) : a))
        );
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "assignments" }, ({ old: row }) => {
        setAssignments((prev) => prev.filter((a) => a.id !== row.id));
      })
      .subscribe();

    // ── mobilizations ────────────────────────────────────────────────────────
    // When mobilizations change, re-fetch the parent assignment to stay in sync
    const mobilizationsChannel = supabase
      .channel("realtime:mobilizations")
      .on("postgres_changes", { event: "*", schema: "public", table: "mobilizations" }, async ({ new: row, old: oldRow }) => {
        const assignmentId = row?.assignment_id || oldRow?.assignment_id;
        if (!assignmentId) return;
        if (savingAssignmentIdsRef?.current?.has(assignmentId)) return;
        const { data: assignmentRow } = await supabase
          .from("assignments")
          .select("*")
          .eq("id", assignmentId)
          .single();
        if (!assignmentRow) return;
        const { data: mobs } = await supabase
          .from("mobilizations")
          .select("*")
          .eq("assignment_id", assignmentId);
        setAssignments((prev) =>
          prev.map((a) => (a.id === assignmentId ? mapAssignmentFromDb(assignmentRow, mobs || []) : a))
        );
      })
      .subscribe();

    // ── certifications ───────────────────────────────────────────────────────
    const certificationsChannel = supabase
      .channel("realtime:certifications")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "certifications" }, ({ new: row }) => {
        setCertifications((prev) => {
          const name = mapCertificationFromDb(row);
          return prev.includes(name) ? prev : [...prev, name];
        });
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "certifications" }, ({ old: row }) => {
        setCertifications((prev) => prev.filter((c) => c !== (row.name || "")));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(projectsChannel);
      supabase.removeChannel(resourcesChannel);
      supabase.removeChannel(crewsChannel);
      supabase.removeChannel(assignmentsChannel);
      supabase.removeChannel(mobilizationsChannel);
      supabase.removeChannel(certificationsChannel);
    };
  }, [setProjects, setResources, setCrews, setAssignments, setCertifications]);
}
