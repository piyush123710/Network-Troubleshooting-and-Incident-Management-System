import { useState, type FormEvent } from 'react';
import { Check, Copy, Plus, Search } from 'lucide-react';
import type { IncidentCategory, RunbookRecord } from '../types';

interface RunbooksViewProps {
  runbooks: RunbookRecord[];
  onRefresh: () => void;
}

export function RunbooksView({ runbooks, onRefresh }: RunbooksViewProps) {
  const [selectedId, setSelectedId] = useState<number | null>(runbooks[0]?.id ?? null);
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<IncidentCategory>('DNS');
  const [severityScope, setSeverityScope] = useState('P1 / P2');
  const [symptoms, setSymptoms] = useState('');
  const [cmdCommands, setCmdCommands] = useState('');
  const [stepsMarkdown, setStepsMarkdown] = useState('');
  const [escalationCriteria, setEscalationCriteria] = useState('');
  const [saving, setSaving] = useState(false);

  const filtered = runbooks.filter((rb) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      rb.title.toLowerCase().includes(q) ||
      rb.category.toLowerCase().includes(q) ||
      rb.symptoms.toLowerCase().includes(q)
    );
  });

  const active = filtered.find((r) => r.id === selectedId) ?? filtered[0] ?? null;

  function handleCopyCmd(rb: RunbookRecord) {
    navigator.clipboard.writeText(rb.cmd_commands);
    setCopiedId(rb.id);
    setTimeout(() => setCopiedId(null), 1800);
  }

  async function handleCreateRunbook(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !stepsMarkdown.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/runbooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          category,
          severity_scope: severityScope,
          symptoms,
          cmd_commands: cmdCommands,
          steps_markdown: stepsMarkdown,
          escalation_criteria: escalationCriteria,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setShowNewForm(false);
        setTitle('');
        setSymptoms('');
        setCmdCommands('');
        setStepsMarkdown('');
        setEscalationCriteria('');
        setSelectedId(created.id);
        onRefresh();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search runbooks by symptom, command, or protocol..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
          />
        </div>

        <button
          type="button"
          onClick={() => setShowNewForm(!showNewForm)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{showNewForm ? 'Cancel New SOP' : 'Document New SOP'}</span>
        </button>
      </div>

      {showNewForm && (
        <form onSubmit={handleCreateRunbook} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900">Document Troubleshooting Procedure</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="SOP Title (e.g. VLAN Trunk Mismatch)"
              className="sm:col-span-1 px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as IncidentCategory)}
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="DNS">DNS</option>
              <option value="DHCP">DHCP</option>
              <option value="Routing">Routing</option>
              <option value="Switching">Switching</option>
              <option value="Latency">Latency</option>
              <option value="Connectivity">Connectivity</option>
            </select>
            <input
              type="text"
              value={severityScope}
              onChange={(e) => setSeverityScope(e.target.value)}
              placeholder="Severity Scope (e.g. P1 / P2)"
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <input
            type="text"
            value={symptoms}
            onChange={(e) => setSymptoms(e.target.value)}
            placeholder="Observed Symptoms..."
            className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <textarea
              rows={4}
              value={cmdCommands}
              onChange={(e) => setCmdCommands(e.target.value)}
              placeholder="Windows CMD commands (one per line)..."
              className="px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
            />
            <textarea
              rows={4}
              required
              value={stepsMarkdown}
              onChange={(e) => setStepsMarkdown(e.target.value)}
              placeholder="Step-by-step troubleshooting instructions..."
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <input
            type="text"
            value={escalationCriteria}
            onChange={(e) => setEscalationCriteria(e.target.value)}
            placeholder="Escalation criteria & Tier 2/3 handoff checklist..."
            className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800"
            >
              {saving ? 'Saving SOP...' : 'Save Runbook'}
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Runbook Directory */}
        <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
          {filtered.map((rb) => (
            <button
              key={rb.id}
              type="button"
              onClick={() => setSelectedId(rb.id)}
              className={`w-full text-left p-4 transition-colors ${
                active?.id === rb.id ? 'bg-blue-50/70' : 'hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="font-medium text-blue-700">{rb.category}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{rb.severity_scope}</span>
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">{rb.title}</div>
              <div className="mt-1 text-xs text-slate-500 line-clamp-2">{rb.symptoms}</div>
            </button>
          ))}
        </aside>

        {/* Runbook Detail Reader */}
        <section className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          {active ? (
            <>
              <div className="pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="font-medium text-blue-700">{active.category}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">Severity {active.severity_scope}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">Updated {active.updated_at}</span>
                </div>
                <h2 className="mt-1.5 text-lg font-semibold text-slate-900">{active.title}</h2>
              </div>

              <div>
                <h3 className="text-xs font-semibold text-slate-900">Observed Symptoms</h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{active.symptoms}</p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-slate-900">Windows CMD Diagnostic Sequence</h3>
                  <button
                    type="button"
                    onClick={() => handleCopyCmd(active)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
                  >
                    {copiedId === active.id ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedId === active.id ? 'Copied' : 'Copy Commands'}</span>
                  </button>
                </div>
                <pre className="p-4 bg-slate-950 text-slate-100 text-xs font-mono rounded-lg overflow-x-auto leading-relaxed">
                  {active.cmd_commands}
                </pre>
              </div>

              <div>
                <h3 className="text-xs font-semibold text-slate-900">Standard Troubleshooting Procedure</h3>
                <div className="mt-2 space-y-2 text-sm text-slate-700 whitespace-pre-line leading-relaxed">
                  {active.steps_markdown}
                </div>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                <h3 className="text-xs font-semibold text-slate-900">Escalation Criteria &amp; Handoff</h3>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed">{active.escalation_criteria}</p>
              </div>
            </>
          ) : (
            <div className="py-12 text-center text-sm text-slate-500">
              Select a troubleshooting runbook to inspect commands and escalation steps.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
