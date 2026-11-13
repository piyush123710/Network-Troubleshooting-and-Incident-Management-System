import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, Check, Copy, Play, PlusCircle, Terminal } from 'lucide-react';
import type {
  DiagnosticAnalysis,
  DiagnosticRunRecord,
  DiagnosticTool,
  IpConfigResult,
  NSLookupResult,
  PingResult,
  TracertResult,
} from '../types';
import type { IncidentDraft } from './CreateIncidentModal';
import { DiagnosticStatusLabel, PriorityLabel } from './StatusText';

interface DiagnosticsViewProps {
  initialTarget?: string | null;
  autoRunTrigger?: number;
  history: DiagnosticRunRecord[];
  onDiagnosticSaved: () => void;
  onCreateIncidentFromRun: (draft: Partial<IncidentDraft>) => void;
}

interface StructuredBundle {
  ping?: PingResult;
  nslookup?: NSLookupResult;
  tracert?: TracertResult;
  ipconfig?: IpConfigResult;
  analysis?: DiagnosticAnalysis;
}

const TOOL_OPTIONS: Array<{ id: DiagnosticTool; label: string; cmdHint: string }> = [
  { id: 'full_suite', label: 'Full Suite', cmdHint: 'nslookup + ping + tracert + ipconfig' },
  { id: 'ping', label: 'Ping', cmdHint: 'ping -n 4 <target>' },
  { id: 'tracert', label: 'Tracert', cmdHint: 'tracert -d <target>' },
  { id: 'nslookup', label: 'NSLookup', cmdHint: 'nslookup <target>' },
  { id: 'ipconfig', label: 'IPConfig', cmdHint: 'ipconfig /all' },
];

const TARGET_PRESETS = [
  { label: '8.8.8.8 (Google DNS)', value: '8.8.8.8' },
  { label: '1.1.1.1 (Cloudflare)', value: '1.1.1.1' },
  { label: 'google.com', value: 'google.com' },
  { label: 'github.com', value: 'github.com' },
  { label: 'invalid-host.corp (DNS Fault Demo)', value: 'nonexistent.internal.invalid' },
];

export function DiagnosticsView({
  initialTarget,
  autoRunTrigger,
  history,
  onDiagnosticSaved,
  onCreateIncidentFromRun,
}: DiagnosticsViewProps) {
  const [tool, setTool] = useState<DiagnosticTool>('full_suite');
  const [target, setTarget] = useState(initialTarget || '8.8.8.8');
  const [pingCount, setPingCount] = useState(4);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<DiagnosticRunRecord | null>(null);
  const [structured, setStructured] = useState<StructuredBundle | null>(null);
  const [copied, setCopied] = useState(false);

  async function executeDiagnostic(selectedTool: DiagnosticTool, selectedTarget: string) {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/diagnostics/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: selectedTool,
          target: selectedTool === 'ipconfig' ? 'localhost' : selectedTarget.trim(),
          count: pingCount,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Diagnostic execution failed.');
      }
      setActiveRun(data.run);
      setStructured(data.structured);
      onDiagnosticSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to run diagnostic.');
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    if (initialTarget && autoRunTrigger && autoRunTrigger > 0) {
      setTarget(initialTarget);
      setTool('full_suite');
      executeDiagnostic('full_suite', initialTarget);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunTrigger]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (tool !== 'ipconfig' && !target.trim()) {
      setError('Enter a target hostname or IPv4/IPv6 address.');
      return;
    }
    executeDiagnostic(tool, target);
  }

  function handleLoadHistoryRun(run: DiagnosticRunRecord) {
    setActiveRun(run);
    try {
      setStructured(JSON.parse(run.structured_json));
    } catch {
      setStructured(null);
    }
  }

  function handleCopyOutput() {
    if (!activeRun) return;
    navigator.clipboard.writeText(activeRun.raw_output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function handleEscalateToIncident() {
    if (!activeRun) return;
    const analysis = structured?.analysis;
    onCreateIncidentFromRun({
      title: `${activeRun.tool.toUpperCase()} fault on ${activeRun.target}`,
      affected_host: activeRun.target,
      priority: activeRun.recommended_priority,
      category: analysis?.recommendedCategory ?? 'Connectivity',
      description: `${activeRun.summary}\n\nProbable Cause: ${activeRun.probable_cause}`,
      diagnostic_run_id: activeRun.id,
      initial_command: `${activeRun.tool} ${activeRun.target}`,
      initial_note: `Automated diagnostic #${activeRun.id} (${activeRun.status}): ${activeRun.summary}`,
    });
  }

  return (
    <div className="space-y-6">
      {/* Control Panel */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Network Diagnostic Runner
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Live server-side Ping, Tracert, IPConfig, and NSLookup telemetry with automated root-cause classification
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {TOOL_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setTool(opt.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  tool === opt.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1">
              <label htmlFor="diag-target" className="block text-xs font-medium text-slate-700 mb-1">
                Target Hostname or IP Address
              </label>
              <input
                id="diag-target"
                type="text"
                disabled={tool === 'ipconfig'}
                value={tool === 'ipconfig' ? 'Local Network Interfaces (localhost)' : target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="e.g., 8.8.8.8 or api.github.com"
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg disabled:bg-slate-50 disabled:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>

            {tool === 'ping' && (
              <div className="w-full md:w-32">
                <label htmlFor="ping-count" className="block text-xs font-medium text-slate-700 mb-1">
                  Packet Count
                </label>
                <select
                  id="ping-count"
                  value={pingCount}
                  onChange={(e) => setPingCount(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                >
                  <option value={4}>4 packets</option>
                  <option value={6}>6 packets</option>
                  <option value={8}>8 packets</option>
                </select>
              </div>
            )}

            <div className="flex items-end">
              <button
                type="submit"
                disabled={running}
                className="w-full md:w-auto inline-flex items-center justify-center gap-2 px-5 py-2 text-sm font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
              >
                <Play className="w-4 h-4" />
                <span>{running ? 'Running Probe...' : 'Run Diagnostic'}</span>
              </button>
            </div>
          </div>

          {tool !== 'ipconfig' && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>Quick targets:</span>
              {TARGET_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setTarget(preset.value)}
                  className="px-2 py-1 text-xs font-mono text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors whitespace-nowrap shrink-0"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </form>
      </section>

      {/* Active Diagnostic Result */}
      {activeRun && structured && (
        <div className="space-y-6">
          {/* Diagnosis & Escalation Action Bar */}
          <section className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
              <div className="space-y-2 max-w-3xl">
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  <DiagnosticStatusLabel status={activeRun.status} />
                  <span aria-hidden="true">·</span>
                  <PriorityLabel priority={activeRun.recommended_priority} />
                  <span aria-hidden="true">·</span>
                  <span className="font-mono uppercase">{activeRun.tool}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-slate-700">{activeRun.target}</span>
                  {activeRun.latency_ms !== null && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{activeRun.latency_ms} ms</span>
                    </>
                  )}
                  {activeRun.packet_loss !== null && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{activeRun.packet_loss}% loss</span>
                    </>
                  )}
                </div>

                <h3 className="text-base font-semibold text-slate-900">
                  {activeRun.summary}
                </h3>
                <p className="text-sm text-slate-600">
                  <span className="font-medium text-slate-800">Root-Cause Assessment:</span> {activeRun.probable_cause}
                </p>

                {structured.analysis?.suggestedSteps && structured.analysis.suggestedSteps.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-slate-600 list-disc list-inside">
                    {structured.analysis.suggestedSteps.map((step, idx) => (
                      <li key={idx}>{step}</li>
                    ))}
                  </ul>
                )}
              </div>

              <button
                type="button"
                onClick={handleEscalateToIncident}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-900 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              >
                <PlusCircle className="w-4 h-4 text-blue-700" />
                <span>Create Incident from Result</span>
              </button>
            </div>
          </section>

          {/* Structured Views + Windows CMD Console */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="space-y-6">
              {structured.ping && (
                <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-900">Ping Telemetry ({structured.ping.method})</h4>
                    <span className="text-xs font-mono text-slate-500 tabular-nums">
                      Min {structured.ping.minMs ?? '—'} ms · Avg {structured.ping.avgMs ?? '—'} ms · Max {structured.ping.maxMs ?? '—'} ms
                    </span>
                  </div>
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                        <th className="py-2 px-4">Seq</th>
                        <th className="py-2 px-4">Target IP</th>
                        <th className="py-2 px-4">TTL</th>
                        <th className="py-2 px-4 text-right">RTT</th>
                        <th className="py-2 px-4 text-right">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs font-mono tabular-nums">
                      {structured.ping.samples.map((s) => (
                        <tr key={s.seq}>
                          <td className="py-2 px-4 text-slate-500">#{s.seq}</td>
                          <td className="py-2 px-4 text-slate-800">{structured.ping?.resolvedIp ?? structured.ping?.target}</td>
                          <td className="py-2 px-4 text-slate-600">{s.ttl ?? '—'}</td>
                          <td className="py-2 px-4 text-right text-slate-900">{s.timeMs !== null ? `${s.timeMs} ms` : '—'}</td>
                          <td className={`py-2 px-4 text-right font-sans font-medium ${s.status === 'ok' ? 'text-emerald-700' : 'text-red-700'}`}>
                            {s.status === 'ok' ? 'Reply' : 'Timeout'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {structured.nslookup && (
                <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-900">DNS Records (NSLookup)</h4>
                    <span className="text-xs font-mono text-slate-500 tabular-nums">
                      Resolver {structured.nslookup.resolverIp} · {structured.nslookup.resolutionTimeMs} ms
                    </span>
                  </div>
                  {structured.nslookup.records.length === 0 ? (
                    <div className="p-4 text-xs text-red-700 font-mono">
                      {structured.nslookup.error || 'No DNS records returned (NXDOMAIN / SERVFAIL).'}
                    </div>
                  ) : (
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                          <th className="py-2 px-4">Type</th>
                          <th className="py-2 px-4">Record Value</th>
                          <th className="py-2 px-4 text-right">TTL</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs font-mono">
                        {structured.nslookup.records.map((rec, i) => (
                          <tr key={i}>
                            <td className="py-2 px-4 font-semibold text-blue-700 whitespace-nowrap">{rec.type}</td>
                            <td className="py-2 px-4 text-slate-800 break-all">{rec.value}</td>
                            <td className="py-2 px-4 text-right text-slate-500 tabular-nums">{rec.ttl ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
              )}

              {structured.tracert && (
                <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-900">Route Path Hops (Tracert)</h4>
                    <span className="text-xs font-mono text-slate-500">
                      {structured.tracert.reachedDestination ? 'Destination reached' : 'Path incomplete'}
                    </span>
                  </div>
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                        <th className="py-2 px-3">Hop</th>
                        <th className="py-2 px-3">Address / Host</th>
                        <th className="py-2 px-3 text-right">RTT 1</th>
                        <th className="py-2 px-3 text-right">RTT 2</th>
                        <th className="py-2 px-3 text-right">RTT 3</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs font-mono tabular-nums">
                      {structured.tracert.hops.map((hop) => (
                        <tr key={hop.hop} className={hop.status !== 'ok' ? 'bg-amber-50/50' : ''}>
                          <td className="py-2 px-3 text-slate-500">{hop.hop}</td>
                          <td className="py-2 px-3 text-slate-900">
                            <div>{hop.ip}</div>
                            {hop.note && <div className="text-[11px] font-sans text-slate-500">{hop.note}</div>}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-700">{hop.rtt1Ms !== null ? `${hop.rtt1Ms}ms` : '*'}</td>
                          <td className="py-2 px-3 text-right text-slate-700">{hop.rtt2Ms !== null ? `${hop.rtt2Ms}ms` : '*'}</td>
                          <td className="py-2 px-3 text-right text-slate-700">{hop.rtt3Ms !== null ? `${hop.rtt3Ms}ms` : '*'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {structured.ipconfig && (
                <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-900">Interface IP Configuration</h4>
                    <span className="text-xs font-mono text-slate-500">
                      GW: {structured.ipconfig.defaultGateway ?? 'None'}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                          <th className="py-2 px-4">Adapter</th>
                          <th className="py-2 px-4">IPv4 / CIDR</th>
                          <th className="py-2 px-4">MAC Address</th>
                          <th className="py-2 px-4">DHCP</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs font-mono">
                        {structured.ipconfig.adapters.map((a) => (
                          <tr key={a.name}>
                            <td className="py-2 px-4 font-medium text-slate-900">{a.name}</td>
                            <td className="py-2 px-4 text-slate-700">{a.cidr ?? a.ipv4 ?? '—'}</td>
                            <td className="py-2 px-4 text-slate-500">{a.mac}</td>
                            <td className="py-2 px-4 font-sans text-slate-600">{a.dhcpEnabled ? 'Yes' : 'No'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>

            {/* Raw Windows CMD Output Terminal */}
            <section className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
                  <Terminal className="w-4 h-4 text-slate-400" />
                  <span>Windows CMD Diagnostic Transcript</span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyOutput}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white bg-slate-900 border border-slate-700 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy Output'}</span>
                </button>
              </div>
              <pre className="p-4 text-xs font-mono text-slate-200 leading-relaxed overflow-x-auto whitespace-pre-wrap flex-1 max-h-[520px] overflow-y-auto">
                {activeRun.raw_output}
              </pre>
            </section>
          </div>
        </div>
      )}

      {/* Diagnostic Run History Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">Saved Diagnostic Runs</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Select any historical run to inspect its structured telemetry and CMD transcript
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-4">Run #</th>
                <th className="py-2.5 px-4">Tool</th>
                <th className="py-2.5 px-4">Target</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4 text-right">Latency</th>
                <th className="py-2.5 px-4">Summary</th>
                <th className="py-2.5 px-4 text-right">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {history.map((run) => (
                <tr
                  key={run.id}
                  onClick={() => handleLoadHistoryRun(run)}
                  className={`cursor-pointer transition-colors ${
                    activeRun?.id === run.id ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                  }`}
                >
                  <td className="py-2.5 px-4 font-mono text-xs text-slate-500 tabular-nums">#{run.id}</td>
                  <td className="py-2.5 px-4 font-mono text-xs uppercase text-slate-700">{run.tool}</td>
                  <td className="py-2.5 px-4 font-mono text-xs text-slate-900">{run.target}</td>
                  <td className="py-2.5 px-4">
                    <DiagnosticStatusLabel status={run.status} />
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-700 tabular-nums">
                    {run.latency_ms !== null ? `${run.latency_ms} ms` : '—'}
                  </td>
                  <td className="py-2.5 px-4 text-xs text-slate-600 max-w-md truncate">{run.summary}</td>
                  <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                    {run.created_at}
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
