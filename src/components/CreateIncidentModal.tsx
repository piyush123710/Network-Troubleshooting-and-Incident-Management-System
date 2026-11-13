import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { IncidentCategory, IncidentPriority } from '../types';

export interface IncidentDraft {
  title: string;
  description: string;
  priority: IncidentPriority;
  category: IncidentCategory;
  affected_host: string;
  assignee: string;
  diagnostic_run_id?: number | null;
  initial_command?: string | null;
  initial_note?: string | null;
}

interface CreateIncidentModalProps {
  initialDraft?: Partial<IncidentDraft> | null;
  onClose: () => void;
  onCreated: (incidentId: number) => void;
}

export function CreateIncidentModal({ initialDraft, onClose, onCreated }: CreateIncidentModalProps) {
  const [title, setTitle] = useState(initialDraft?.title ?? '');
  const [affectedHost, setAffectedHost] = useState(initialDraft?.affected_host ?? '');
  const [priority, setPriority] = useState<IncidentPriority>(initialDraft?.priority ?? 'P2');
  const [category, setCategory] = useState<IncidentCategory>(initialDraft?.category ?? 'Connectivity');
  const [assignee, setAssignee] = useState(initialDraft?.assignee ?? 'P. Nagbansi (NOC L1)');
  const [description, setDescription] = useState(initialDraft?.description ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim() || !affectedHost.trim() || !description.trim()) {
      setError('Title, affected host/IP, and issue description are required.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          affected_host: affectedHost.trim(),
          priority,
          category,
          assignee: assignee.trim() || 'NOC Engineer L1',
          description: description.trim(),
          diagnostic_run_id: initialDraft?.diagnostic_run_id ?? null,
          initial_command: initialDraft?.initial_command ?? null,
          initial_note: initialDraft?.initial_note ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create incident.');
      }
      onCreated(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save incident.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="create-incident-title">
      <div className="w-full max-w-xl bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 id="create-incident-title" className="text-base font-semibold text-slate-900">
              Log Network Incident
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Assign priority SLA (P1 15m · P2 60m · P3 4h · P4 24h) and track resolution logs.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 rounded-lg transition-colors"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="px-3 py-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="inc-title" className="block text-xs font-medium text-slate-700 mb-1">
              Incident Title
            </label>
            <input
              id="inc-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Branch gateway packet loss impacting ERP"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="inc-host" className="block text-xs font-medium text-slate-700 mb-1">
                Affected Host / IP / Subnet
              </label>
              <input
                id="inc-host"
                type="text"
                value={affectedHost}
                onChange={(e) => setAffectedHost(e.target.value)}
                placeholder="e.g., erp-db.internal.corp or 172.16.40.12"
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>

            <div>
              <label htmlFor="inc-assignee" className="block text-xs font-medium text-slate-700 mb-1">
                Assigned Engineer
              </label>
              <input
                id="inc-assignee"
                type="text"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="inc-priority" className="block text-xs font-medium text-slate-700 mb-1">
                Priority Level
              </label>
              <select
                id="inc-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as IncidentPriority)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              >
                <option value="P1">P1 — Critical (Outage, 15m SLA)</option>
                <option value="P2">P2 — High (Degraded, 60m SLA)</option>
                <option value="P3">P3 — Medium (Intermittent, 4h SLA)</option>
                <option value="P4">P4 — Low (Advisory, 24h SLA)</option>
              </select>
            </div>

            <div>
              <label htmlFor="inc-category" className="block text-xs font-medium text-slate-700 mb-1">
                Problem Category
              </label>
              <select
                id="inc-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as IncidentCategory)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              >
                <option value="DNS">DNS Resolution</option>
                <option value="DHCP">DHCP / IPConfig</option>
                <option value="Routing">Routing &amp; Path</option>
                <option value="Switching">Switching &amp; VLAN</option>
                <option value="Latency">Latency &amp; Packet Loss</option>
                <option value="Connectivity">General Connectivity</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="inc-desc" className="block text-xs font-medium text-slate-700 mb-1">
              Issue Description &amp; Observed Symptoms
            </label>
            <textarea
              id="inc-desc"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Document user impact, Ping/Tracert/NSLookup observations, and affected segments..."
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
            >
              {submitting ? 'Saving...' : 'Create Incident'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
