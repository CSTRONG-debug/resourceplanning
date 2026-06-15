import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient'; // adjust path to your existing client

/**
 * Loads the current user's profile (role + pm_name) once.
 * Roles: 'admin' | 'manager' | 'pm' | 'viewer'
 */
export function useProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (active) { setProfile(null); setLoading(false); } return; }
      const { data } = await supabase
        .from('profiles')
        .select('id, email, role, pm_name')
        .eq('id', user.id)
        .single();
      if (active) { setProfile(data || null); setLoading(false); }
    })();
    return () => { active = false; };
  }, []);

  return { profile, loading };
}

/**
 * Crew request feed. RLS handles scoping:
 *  - PM sees only their own rows
 *  - admin/manager/viewer see all
 */
export function useCrewRequests() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('crew_requests')
      .select(`
        id, project_id, requested_by, requested_by_name, request_type,
        crew_specialty, superintendent, men_count, start_date, duration_weeks,
        notes, status, resolved_at, mobilization_id, created_at,
        projects ( id, project_number, name )
      `)
      .order('created_at', { ascending: false });
    if (error) setError(error.message);
    else { setRequests(data || []); setError(null); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live updates so an approval shows instantly across roles
  useEffect(() => {
    const channel = supabase
      .channel('crew_requests_feed')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'crew_requests' },
        () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const createRequest = useCallback(async (payload, pmName) => {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('crew_requests').insert({
      ...payload,
      requested_by: user.id,
      requested_by_name: pmName,
      status: 'pending',
    });
    if (error) throw error;
    await load();
  }, [load]);

  const updateRequest = useCallback(async (id, patch) => {
    const { error } = await supabase.from('crew_requests').update(patch).eq('id', id);
    if (error) throw error;
    await load();
  }, [load]);

  const withdrawRequest = useCallback(async (id) => {
    const { error } = await supabase.from('crew_requests').delete().eq('id', id);
    if (error) throw error;
    await load();
  }, [load]);

  const resolveRequest = useCallback(async (id, status) => {
    // Trigger fulfills the schedule on status='approved'
    const { error } = await supabase
      .from('crew_requests').update({ status }).eq('id', id);
    if (error) throw error;
    await load();
  }, [load]);

  return {
    requests, loading, error,
    createRequest, updateRequest, withdrawRequest, resolveRequest, reload: load,
  };
}
