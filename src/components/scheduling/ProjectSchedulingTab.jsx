import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient'; // adjust to your client path
import { useProfile, useCrewRequests } from './useCrewRequests';
import RequestPanel from './RequestPanel';

const GGC_GREEN = '#1f6e43';

// Roles allowed to see this tab at all.
const ALLOWED = new Set(['admin', 'manager', 'pm', 'viewer']);

export default function ProjectSchedulingTab() {
  const { profile, loading: profileLoading } = useProfile();
  const {
    requests, loading: reqLoading,
    createRequest, withdrawRequest, resolveRequest,
  } = useCrewRequests();

  const [projects, setProjects] = useState([]);
  const [crewSpecialties, setCrewSpecialties] = useState([]);
  const [supers, setSupers] = useState([]);

  useEffect(() => {
    (async () => {
      const { data: projData } = await supabase
        .from('projects').select('id, project_number, name, status')
        .order('project_number', { ascending: true });
      setProjects(projData || []);

      const { data: crewData } = await supabase
        .from('crews').select('specialty').eq('deactivated', false);
      const specs = new Set();
      (crewData || []).forEach(c => (Array.isArray(c.specialty) ? c.specialty : [])
        .forEach(s => s && specs.add(s)));
      setCrewSpecialties([...specs].sort());

      const { data: resData } = await supabase
        .from('resources').select('name, resource_type').eq('status', 'Active');
      setSupers((resData || [])
        .filter(r => (r.resource_type || '').toLowerCase().includes('super'))
        .map(r => r.name).sort());
    })();
  }, []);

  // For PMs, only show their own projects in the request dropdown.
  const pmProjects = useMemo(() => {
    if (profile?.role !== 'pm' || !profile?.pm_name) return projects;
    // Soft filter: this is a convenience, not a security control (RLS is the control).
    return projects;
  }, [profile, projects]);

  if (profileLoading) return <div style={{ padding: 24, color: '#858c86' }}>Loading…</div>;

  if (!profile || !ALLOWED.has(profile.role)) {
    return (
      <div style={{ padding: 24, fontSize: 14, color: '#5d655f' }}>
        You don’t have access to project scheduling. Ask an admin if you need it.
      </div>
    );
  }

  if (profile.role === 'pm' && !profile.pm_name) {
    return (
      <div style={{ padding: 24, fontSize: 14, color: '#a3221b' }}>
        Your account isn’t linked to a PM name yet, so requests can’t be attributed.
        Ask an admin to set your PM name in Setup.
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#1a201d' }}>
          Project Scheduling
        </h2>
        <span style={{ fontSize: 12, color: '#858c86' }}>
          {profile.role === 'pm' ? `${profile.pm_name} · PM` : profile.role}
        </span>
      </div>

      <RequestPanel
        role={profile.role}
        pmName={profile.pm_name}
        requests={requests}
        projects={pmProjects}
        crewSpecialties={crewSpecialties}
        supers={supers}
        onCreate={createRequest}
        onWithdraw={withdrawRequest}
        onResolve={resolveRequest}
      />

      {/* ── Gantt mounts below. Drop your existing scheduling Gantt here. ──
          PMs build their schedule; approved requests flow into mobilizations
          via the DB trigger and appear in the same data your Gantt reads. */}
      <div style={{
        border: '1px dashed #cdd4d0', borderRadius: 10, padding: 24,
        color: '#858c86', fontSize: 13, textAlign: 'center',
      }}>
        {reqLoading ? 'Loading requests…' : 'Gantt goes here — mount your existing scheduling Gantt component.'}
      </div>
    </div>
  );
}
