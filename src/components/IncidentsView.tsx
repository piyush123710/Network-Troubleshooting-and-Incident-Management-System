import { useEffect, useState, type FormEvent } from 'react';
import {
  Download,
  Play,
  Plus,
  Search,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import type {
  DiagnosticRunRecord,
  IncidentCategory,
  IncidentPriority,
  IncidentRecord,
  IncidentStatus,
  LogActionType,
  ResolutionLogRecord,
} from '../types';
import { IncidentStatusLabel, PriorityLabel } from './StatusText';

interface IncidentsViewProps {
  incidents: IncidentRecord[];
  selectedIncidentId: number | null;
  onSelectIncident: (id: number | null) => void;
  onRefresh: () => void;
  onOpenCreateModal: () => void;
}

const STATUS_TABS: Array<{ id: string; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'Open', label: 'Open' },
  { id: 'Investigating', label: 'Investigating' },
  { id: 'Escalated', label: 'Escalated' },
  { id: 'Resolved', label: 'Resolved' },
];

export function IncidentsView({
  incidents,
  selectedIncidentId,
  onSelectIncident,
  onRefresh,
  onOpenCreateModal,
}: IncidentsViewProps) {
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const [detail, setDetail] = useState<{
    incident: IncidentRecord;
    logs: ResolutionLogRecord[];
    diagnosticRun: DiagnosticRunRecord | null;
  } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Editable fields for selected incident
  const [editStatus, setEditStatus] = useState<IncidentStatus>('Open');
  const [editPriority, setEditPriority] = useState<IncidentPriority>('P2');
  const [editAssignee, setEditAssignee] = useState('');
  const [editRootCause, setEditRootCause] = useState('');
  const [escTier, setEscTier] = useState('');
  const [escTo, setEscTo] = useState('');
  const [escTicket, setEscTicket] = useState('');
  const [escNotes, setEscNotes] = useState('');
  const [savingPatch, setSavingPatch] = useState(false);

  // New resolution log form
  const [logAuthor, setLogAuthor] = useState('P. Nagbansi');
  const [logAction, setLogAction] = useState<LogActionType>('Triage');
  const [logCommand, setLogCommand] = useState('');
  const [logNotes, setLogNotes] = useState('');
  const [submittingLog, setSubmittingLog] = useState(false);
  const [probingHost, setProbingHost] = useState(false);

  async function loadIncidentDetail(id: number) {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/incidents/${id}`);
      if (!res.ok) {
        setDetail(null);
        return;
      }
      const data = await res.json();
      setDetail(data);
      const inc: IncidentRecord = data.incident;
      setEditStatus(inc.status);
      setEditPriority(inc.priority);
      setEditAssignee(inc.assignee);
      setEditRootCause(inc.root_cause ?? '');
      setEscTier(inc.escalation_tier ?? '');
      setEscTo(inc.escalated_to ?? '');
      setEscTicket(inc.escalation_ticket ?? '');
      setEscNotes(inc.escalation_notes ?? '');
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    if (selectedIncidentId) {
      loadIncidentDetail(selectedIncidentId);
    } else {
      setDetail(null);
    }
  }, [selectedIncidentId]);

  const filteredIncidents = incidents.filter((inc) => {
    if (statusFilter !== 'ALL' && inc.status !== statusFilter) return false;
    if (priorityFilter !== 'ALL' && inc.priority !== priorityFilter) return false;
    if (categoryFilter !== 'ALL' && inc.category !== categoryFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        inc.incident_code.toLowerCase().includes(q) ||
        inc.title.toLowerCase().includes(q) ||
        inc.affected_host.toLowerCase().includes(q) ||
        inc.assignee.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  async function handleSaveIncidentChanges() {
    if (!detail) return;
    setSavingPatch(true);
    try {
      await fetch(`/api/incidents/${detail.incident.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: editStatus,
          priority: editPriority,
          assignee: editAssignee,
          root_cause: editRootCause || null,
          escalation_tier: escTier || null,
          escalated_to: escTo || null,
          escalation_ticket: escTicket || null,
          escalation_notes: escNotes || null,
        }),
      });
      await loadIncidentDetail(detail.incident.id);
      onRefresh();
    } finally {
      setSavingPatch(false);
    }
  }

  async function handleAppendLog(e: FormEvent) {
    e.preventDefault();
    if (!detail || !logNotes.trim()) return;
    setSubmittingLog(true);
    try {
      const res = await fetch(`/api/incidents/${detail.incident.id}/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author: logAuthor.trim() || 'NOC Engineer',
          action_type: logAction,
          command_used: logCommand.trim() || null,
          notes: logNotes.trim(),
        }),
      });
      if (res.ok) {
        setLogCommand('');
        setLogNotes('');
        await loadIncidentDetail(detail.incident.id);
        onRefresh();
      }
    } finally {
      setSubmittingLog(false);
    }
  }

  async function handleRetestHost() {
    if (!detail) return;
    const host = detail.incident.affected_host.split('/')[0];
    setProbingHost(true);
    try {
      const res = await fetch('/api/diagnostics/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'ping', target: host, count: 4 }),
      });
      const data = await res.json();
      if (res.ok && data.run) {
        await fetch(`/api/incidents/${detail.incident.id}/logs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            author: 'Automated Probe',
            action_type: 'Diagnostic',
            command_used: `ping -n 4 ${host}`,
            notes: `${data.run.summary} (Latency: ${data.run.latency_ms ?? 'N/A'} ms, Loss: ${data.run.packet_loss ?? 'N/A'}%)`,
          }),
        });
        await loadIncidentDetail(detail.incident.id);
        onRefresh();
      }
    } finally {
      setProbingHost(false);
    }
  }

  async function handleDeleteIncident(id: number) {
    await fetch(`/api/incidents/${id}`, { method: 'DELETE' });
    onSelectIncident(null);
    onRefresh();
  }

  return (
    <div className="space-y-6">
      {/* Filter Toolbar */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/api/export/incidents.csv"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </a>
            <button
              type="button"
              onClick={onOpenCreateModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Incident</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by code, title, affected host, or assignee..."
              aria-label="Search incidents"
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          <select
            aria-label="Filter by priority"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
          >
            <option value="ALL">All Priorities</option>
            <option value="P1">P1 — Critical</option>
            <option value="P2">P2 — High</option>
            <option value="P3">P3 — Medium</option>
            <option value="P4">P4 — Low</option>
          </select>

          <select
            aria-label="Filter by category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as IncidentCategory | 'ALL')}
            className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
          >
            <option value="ALL">All Categories</option>
            <option value="DNS">DNS</option>
            <option value="DHCP">DHCP</option>
            <option value="Routing">Routing</option>
            <option value="Switching">Switching</option>
            <option value="Latency">Latency</option>
            <option value="Connectivity">Connectivity</option>
          </select>
        </div>
      </section>

      {/* Split Table + Detail Inspector */}
      <div className={`grid grid-cols-1 ${detail ? 'xl:grid-cols-12' : ''} gap-6 items-start`}>
        <section className={`${detail ? 'xl:col-span-6' : ''} bg-white border border-slate-200 rounded-xl overflow-hidden`}>
          {filteredIncidents.length === 0 ? (
            <div className="px-6 py-12 text-center space-y-3">
              <p className="text-sm font-medium text-slate-900">No matching incidents found</p>
              <p className="text-xs text-slate-500">
                Adjust active filters or log a new incident to track network issues and resolution logs.
              </p>
              <button
                type="button"
                onClick={onOpenCreateModal}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Log First Incident</span>
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-2.5 px-4">Code</th>
                    <th className="py-2.5 px-4">Priority</th>
                    <th className="py-2.5 px-4">Issue &amp; Host</th>
                    {!detail && <th className="py-2.5 px-4">Category</th>}
                    <th className="py-2.5 px-4">Status</th>
                    {!detail && <th className="py-2.5 px-4">Assignee</th>}
                    <th className="py-2.5 px-4 text-right">Logs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredIncidents.map((inc) => (
                    <tr
                      key={inc.id}
                      onClick={() => onSelectIncident(inc.id)}
                      className={`cursor-pointer transition-colors ${
                        selectedIncidentId === inc.id ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-3 px-4 font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                        {inc.incident_code}
                      </td>
                      <td className="py-3 px-4">
                        <PriorityLabel priority={inc.priority} />
                      </td>
                      <td className="py-3 px-4 max-w-xs">
                        <div className="font-medium text-slate-900 truncate">{inc.title}</div>
                        <div className="text-xs font-mono text-slate-500 truncate">{inc.affected_host}</div>
                      </td>
                      {!detail && (
                        <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                          {inc.category}
                        </td>
                      )}
                      <td className="py-3 px-4">
                        <IncidentStatusLabel status={inc.status} />
                      </td>
                      {!detail && (
                        <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                          {inc.assignee}
                        </td>
                      )}
                      <td className="py-3 px-4 text-right font-mono text-xs text-slate-600 tabular-nums">
                        {inc.log_count ?? 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Right Detail Inspector */}
        {selectedIncidentId && (
          <section className="xl:col-span-6 bg-white border border-slate-200 rounded-xl overflow-hidden">
            {loadingDetail && !detail ? (
              <div className="p-8 text-sm text-slate-500">Loading incident details...</div>
            ) : detail ? (
              <div className="divide-y divide-slate-200">
                {/* Header */}
                <div className="p-6 flex items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono font-semibold text-slate-900">{detail.incident.incident_code}</span>
                      <span aria-hidden="true">·</span>
                      <span>{detail.incident.category}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{detail.incident.affected_host}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">SLA {detail.incident.sla_target_minutes}m</span>
                    </div>
                    <h3 className="text-base font-semibold text-slate-900">{detail.incident.title}</h3>
                    <p className="text-sm text-slate-600 leading-relaxed">{detail.incident.description}</p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleDeleteIncident(detail.incident.id)}
                      className="p-2 text-slate-400 hover:text-red-700 rounded-lg transition-colors"
                      title="Delete incident"
                      aria-label="Delete incident"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectIncident(null)}
                      className="p-2 text-slate-400 hover:text-slate-700 rounded-lg transition-colors"
                      aria-label="Close inspector"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Triage, Status & Escalation Controls */}
                <div className="p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-slate-900">Triage &amp; Escalation Details</h4>
                    <button
                      type="button"
                      onClick={handleRetestHost}
                      disabled={probingHost}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <Play className="w-3.5 h-3.5 text-blue-700" />
                      <span>{probingHost ? 'Probing Host...' : 'Ping Target & Log'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Status</label>
                      <select
                        value={editStatus}
                        onChange={(e) => setEditStatus(e.target.value as IncidentStatus)}
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="Open">Open</option>
                        <option value="Investigating">Investigating</option>
                        <option value="Escalated">Escalated</option>
                        <option value="Resolved">Resolved</option>
                        <option value="Closed">Closed</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Priority</label>
                      <select
                        value={editPriority}
                        onChange={(e) => setEditPriority(e.target.value as IncidentPriority)}
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="P1">P1 (15m SLA)</option>
                        <option value="P2">P2 (60m SLA)</option>
                        <option value="P3">P3 (4h SLA)</option>
                        <option value="P4">P4 (24h SLA)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Assignee</label>
                      <input
                        type="text"
                        value={editAssignee}
                        onChange={(e) => setEditAssignee(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Escalation Tier</label>
                      <select
                        value={escTier}
                        onChange={(e) => setEscTier(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="">None (L1 Handling)</option>
                        <option value="Tier 2 Infrastructure">Tier 2 Infrastructure</option>
                        <option value="Tier 2 Network Engineering">Tier 2 Network Engineering</option>
                        <option value="Tier 3 ISP / Carrier NOC">Tier 3 ISP / Carrier NOC</option>
                        <option value="Security Operations">Security Operations</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Escalated To Team</label>
                      <input
                        type="text"
                        value={escTo}
                        onChange={(e) => setEscTo(e.target.value)}
                        placeholder="e.g., Core DNS Team"
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">External Ticket Ref</label>
                      <input
                        type="text"
                        value={escTicket}
                        onChange={(e) => setEscTicket(e.target.value)}
                        placeholder="e.g., ESC-4491"
                        className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Escalation Handoff Notes</label>
                      <textarea
                        rows={2}
                        value={escNotes}
                        onChange={(e) => setEscNotes(e.target.value)}
                        placeholder="Details required by Tier 2/3 or Carrier NOC..."
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Confirmed Root Cause</label>
                      <textarea
                        rows={2}
                        value={editRootCause}
                        onChange={(e) => setEditRootCause(e.target.value)}
                        placeholder="Document final root cause once isolated..."
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleSaveIncidentChanges}
                      disabled={savingPatch}
                      className="px-4 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
                    >
                      {savingPatch ? 'Saving...' : 'Save Triage & Escalation'}
                    </button>
                  </div>
                </div>

                {/* Attached Diagnostic Snapshot */}
                {detail.diagnosticRun && (
                  <div className="p-6 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-900">
                        Attached Diagnostic Output (#{detail.diagnosticRun.id} · {detail.diagnosticRun.tool.toUpperCase()})
                      </span>
                      <span className="font-mono text-slate-500">{detail.diagnosticRun.created_at}</span>
                    </div>
                    <pre className="p-3 bg-slate-950 text-slate-200 text-xs font-mono rounded-lg overflow-x-auto max-h-44 overflow-y-auto whitespace-pre-wrap">
                      {detail.diagnosticRun.raw_output}
                    </pre>
                  </div>
                )}

                {/* Resolution Logs Timeline + Append Form */}
                <div className="p-6 space-y-4">
                  <h4 className="text-xs font-semibold text-slate-900">
                    Resolution &amp; Troubleshooting Log ({detail.logs.length})
                  </h4>

                  <form onSubmit={handleAppendLog} className="space-y-2.5 bg-slate-50 border border-slate-200 rounded-lg p-3.5">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={logAuthor}
                        onChange={(e) => setLogAuthor(e.target.value)}
                        placeholder="Engineer name"
                        className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                      />
                      <select
                        value={logAction}
                        onChange={(e) => setLogAction(e.target.value as LogActionType)}
                        className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                      >
                        <option value="Diagnostic">Diagnostic</option>
                        <option value="Triage">Triage</option>
                        <option value="Workaround">Workaround</option>
                        <option value="Escalation">Escalation</option>
                        <option value="Root Cause">Root Cause</option>
                        <option value="Resolution">Resolution</option>
                      </select>
                      <input
                        type="text"
                        value={logCommand}
                        onChange={(e) => setLogCommand(e.target.value)}
                        placeholder="CMD used (e.g. ipconfig /flushdns)"
                        className="px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                      />
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={logNotes}
                        onChange={(e) => setLogNotes(e.target.value)}
                        placeholder="Append troubleshooting findings, workaround, or resolution steps..."
                        className="flex-1 px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                      />
                      <button
                        type="submit"
                        disabled={submittingLog || !logNotes.trim()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Add Log</span>
                      </button>
                    </div>
                  </form>

                  <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                    {detail.logs.map((log) => (
                      <div key={log.id} className="pb-3 border-b border-slate-100 last:border-0">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-800">{log.action_type}</span>
                            <span aria-hidden="true">·</span>
                            <span>{log.author}</span>
                          </div>
                          <span className="font-mono tabular-nums">{log.created_at}</span>
                        </div>
                        {log.command_used && (
                          <div className="mt-1 font-mono text-[11px] text-blue-800 bg-blue-50/70 px-2 py-1 rounded inline-block">
                            {log.command_used}
                          </div>
                        )}
                        <p className="mt-1 text-xs text-slate-700 leading-relaxed">{log.notes}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        )}
      </div>
    </div>
  );
}
