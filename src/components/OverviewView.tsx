import { useState, type FormEvent } from 'react';
import { ArrowRight, Terminal } from 'lucide-react';
import type { DashboardSummary, DiagnosticRunRecord, IncidentRecord } from '../types';
import { DiagnosticStatusLabel, IncidentStatusLabel, PriorityLabel } from './StatusText';

interface OverviewViewProps {
  summary: DashboardSummary | null;
  incidents: IncidentRecord[];
  recentDiagnostics: DiagnosticRunRecord[];
  onQuickDiagnose: (target: string) => void;
  onSelectIncident: (incidentId: number) => void;
  onNavigate: (tab: 'diagnostics' | 'incidents' | 'runbooks' | 'sql') => void;
}

export function OverviewView({
  summary,
  incidents,
  recentDiagnostics,
  onQuickDiagnose,
  onSelectIncident,
  onNavigate,
}: OverviewViewProps) {
  const [quickTarget, setQuickTarget] = useState('8.8.8.8');

  const activeIncidents = incidents
    .filter((i) => i.status !== 'Resolved' && i.status !== 'Closed')
    .slice(0, 6);

  const maxCategoryCount = Math.max(...(summary?.byCategory.map((c) => c.count) ?? [1]), 1);

  function handleQuickSubmit(e: FormEvent) {
    e.preventDefault();
    if (!quickTarget.trim()) return;
    onQuickDiagnose(quickTarget.trim());
  }

  return (
    <div className="space-y-6">
      {/* Quick Diagnostic Launch */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="max-w-xl">
            <h2 className="text-base font-semibold text-slate-900">
              Rapid Network Triage
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Execute live Ping, Tracert, IPConfig, and NSLookup probes to isolate DNS, DHCP, or routing faults and convert failures directly into prioritized incidents.
            </p>
          </div>

          <form onSubmit={handleQuickSubmit} className="flex items-center gap-2 w-full lg:w-auto">
            <div className="relative flex-1 lg:w-72">
              <Terminal className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={quickTarget}
                onChange={(e) => setQuickTarget(e.target.value)}
                placeholder="Hostname or IP (e.g. google.com)"
                aria-label="Target host or IP for rapid diagnostic"
                className="w-full pl-9 pr-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0"
            >
              <span>Run Full Suite</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </section>

      {/* 4-column KPI strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Active Incidents</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-3xl font-semibold text-slate-900 font-mono tabular-nums">
              {summary?.openIncidents ?? 0}
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              {summary?.totalIncidents ?? 0} total logged
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">P1 / P2 Priority Queue</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-3xl font-semibold text-red-700 font-mono tabular-nums">
              {(summary?.p1Active ?? 0) + (summary?.p2Active ?? 0)}
            </span>
            <span className="text-xs text-slate-600 font-mono tabular-nums">
              {summary?.p1Active ?? 0} P1 · {summary?.p2Active ?? 0} P2
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Escalated &amp; Resolved</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-3xl font-semibold text-slate-900 font-mono tabular-nums">
              {summary?.escalatedCount ?? 0}
            </span>
            <span className="text-xs text-emerald-700 font-medium tabular-nums">
              {summary?.resolvedCount ?? 0} resolved
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Avg Diagnostic Latency</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-3xl font-semibold text-slate-900 font-mono tabular-nums">
              {summary?.avgLatencyMs !== null && summary?.avgLatencyMs !== undefined ? `${summary.avgLatencyMs} ms` : '—'}
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              {summary?.totalDiagnostics ?? 0} runs · {summary?.failedDiagnostics ?? 0} failed
            </span>
          </div>
        </div>
      </section>

      {/* Main Split: Priority Incident Table + Fault Category Breakdown */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="xl:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Active Priority Queue</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Sorted by severity (P1 first) and open state
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('incidents')}
              className="text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap shrink-0"
            >
              View All Incidents
            </button>
          </div>

          {activeIncidents.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-slate-500">
              No active incidents in the queue. Run a diagnostic probe or log a new incident to begin tracking.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-2.5 px-4">ID</th>
                    <th className="py-2.5 px-4">Priority</th>
                    <th className="py-2.5 px-4">Incident &amp; Target Host</th>
                    <th className="py-2.5 px-4">Category</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">SLA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {activeIncidents.map((inc) => (
                    <tr
                      key={inc.id}
                      onClick={() => onSelectIncident(inc.id)}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                        {inc.incident_code}
                      </td>
                      <td className="py-3 px-4">
                        <PriorityLabel priority={inc.priority} />
                      </td>
                      <td className="py-3 px-4 max-w-xs">
                        <div className="font-medium text-slate-900 truncate">{inc.title}</div>
                        <div className="text-xs text-slate-500 font-mono truncate">{inc.affected_host}</div>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                        {inc.category}
                      </td>
                      <td className="py-3 px-4">
                        <IncidentStatusLabel status={inc.status} />
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                        {inc.sla_target_minutes}m
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Incidents by Domain</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Root-cause distribution across network layers
            </p>

            <div className="mt-5 space-y-4">
              {(summary?.byCategory ?? []).map((item) => {
                const widthPct = Math.round((item.count / maxCategoryCount) * 100);
                return (
                  <div key={item.category}>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="font-medium text-slate-700">{item.category}</span>
                      <span className="font-mono text-slate-600 tabular-nums">{item.count}</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-700 rounded-full"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Standard SOPs available</span>
            <button
              type="button"
              onClick={() => onNavigate('runbooks')}
              className="font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap shrink-0"
            >
              Open Runbooks
            </button>
          </div>
        </section>
      </div>

      {/* Recent Diagnostic Runs */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Recent Diagnostic History</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Persisted Ping, Tracert, IPConfig, and NSLookup telemetry logs
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('diagnostics')}
            className="text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap shrink-0"
          >
            Open Diagnostic Runner
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-4">Tool</th>
                <th className="py-2.5 px-4">Target</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4 text-right">Latency</th>
                <th className="py-2.5 px-4 text-right">Loss</th>
                <th className="py-2.5 px-4">Diagnostic Finding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {recentDiagnostics.slice(0, 5).map((run) => (
                <tr key={run.id} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-4 font-mono text-xs font-medium text-slate-700 uppercase whitespace-nowrap">
                    {run.tool}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-xs text-slate-900 whitespace-nowrap">
                    {run.target}
                  </td>
                  <td className="py-2.5 px-4">
                    <DiagnosticStatusLabel status={run.status} />
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                    {run.latency_ms !== null ? `${run.latency_ms} ms` : '—'}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                    {run.packet_loss !== null ? `${run.packet_loss}%` : '—'}
                  </td>
                  <td className="py-2.5 px-4 text-xs text-slate-600 max-w-md truncate">
                    {run.summary}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
