import { useEffect, useState, type FormEvent } from 'react';
import { Check, Copy, Download, Play } from 'lucide-react';

const PRESET_QUERIES = [
  {
    label: 'Active P1 & P2 Incidents',
    sql: "SELECT incident_code, priority, status, category, affected_host, assignee, sla_target_minutes FROM incidents WHERE status NOT IN ('Resolved', 'Closed') ORDER BY priority ASC",
  },
  {
    label: 'Incident Resolution Audit',
    sql: 'SELECT i.incident_code, l.action_type, l.author, l.command_used, l.notes, l.created_at FROM resolution_logs l JOIN incidents i ON i.id = l.incident_id ORDER BY l.id DESC LIMIT 20',
  },
  {
    label: 'Diagnostic Latency & Failures',
    sql: 'SELECT id, tool, target, status, latency_ms, packet_loss, recommended_priority, created_at FROM diagnostic_runs ORDER BY id DESC LIMIT 20',
  },
];

export function SqlSchemaView() {
  const [sql, setSql] = useState(PRESET_QUERIES[0].sql);
  const [queryResult, setQueryResult] = useState<{
    columns: string[];
    rows: Array<Record<string, unknown>>;
    rowCount: number;
    elapsedMs: number;
  } | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const [companionTab, setCompanionTab] = useState<'mysql' | 'python' | 'sqlite'>('mysql');
  const [companion, setCompanion] = useState<{
    pythonScript: string;
    mysqlSchema: string;
    sqliteSchema: string;
  } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  async function executeSql(statement: string) {
    setRunning(true);
    setQueryError(null);
    try {
      const res = await fetch('/api/sql/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: statement }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Query failed');
      setQueryResult(data);
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : 'Unable to execute query');
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    executeSql(PRESET_QUERIES[0].sql);
    fetch('/api/companion')
      .then((r) => r.json())
      .then((d) => setCompanion(d))
      .catch(() => {});
  }, []);

  function handleRunSubmit(e: FormEvent) {
    e.preventDefault();
    executeSql(sql);
  }

  const activeCode =
    companionTab === 'mysql'
      ? companion?.mysqlSchema ?? ''
      : companionTab === 'python'
        ? companion?.pythonScript ?? ''
        : companion?.sqliteSchema ?? '';

  function handleCopyCode() {
    navigator.clipboard.writeText(activeCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1800);
  }

  function handleDownloadFile() {
    const filename =
      companionTab === 'mysql'
        ? 'schema_mysql.sql'
        : companionTab === 'python'
          ? 'nettrace_cli.py'
          : 'schema_sqlite.sql';
    const blob = new Blob([activeCode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Live SQL Query Explorer */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Relational Database Inspector</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Execute read-only SELECT queries against live incident, resolution log, and diagnostic tables
            </p>
          </div>
          <a
            href="/api/export/incidents.csv"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Incidents CSV</span>
          </a>
        </div>

        <div className="flex flex-wrap gap-2">
          {PRESET_QUERIES.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                setSql(preset.sql);
                executeSql(preset.sql);
              }}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleRunSubmit} className="space-y-3">
          <textarea
            rows={3}
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            aria-label="SQL SELECT query"
            className="w-full p-3 text-xs font-mono bg-slate-950 text-slate-100 border border-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/30"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {queryResult ? `${queryResult.rowCount} row(s) returned in ${queryResult.elapsedMs} ms` : 'Ready'}
            </span>
            <button
              type="submit"
              disabled={running}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{running ? 'Executing...' : 'Run Query'}</span>
            </button>
          </div>
        </form>

        {queryError && (
          <div className="px-3 py-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg font-mono">
            {queryError}
          </div>
        )}

        {queryResult && (
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            {queryResult.rows.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">Query returned 0 rows.</div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-mono text-slate-600">
                    {queryResult.columns.map((col) => (
                      <th key={col} className="py-2 px-3 whitespace-nowrap">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs font-mono tabular-nums">
                  {queryResult.rows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-slate-50">
                      {queryResult.columns.map((col) => (
                        <td key={col} className="py-2 px-3 text-slate-800 max-w-xs truncate">
                          {row[col] === null || row[col] === undefined ? 'NULL' : String(row[col])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

      {/* Companion Python CLI + MySQL Schema Reference */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setCompanionTab('mysql')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                companionTab === 'mysql' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              MySQL 8.0 Schema
            </button>
            <button
              type="button"
              onClick={() => setCompanionTab('python')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                companionTab === 'python' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Python CMD Automation
            </button>
            <button
              type="button"
              onClick={() => setCompanionTab('sqlite')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                companionTab === 'sqlite' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Active SQLite DDL
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyCode}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadFile}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download File</span>
            </button>
          </div>
        </div>

        <pre className="p-5 bg-slate-950 text-slate-200 text-xs font-mono leading-relaxed overflow-x-auto max-h-[460px] overflow-y-auto">
          {activeCode}
        </pre>
      </section>
    </div>
  );
}
