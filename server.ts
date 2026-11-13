import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { createServer as createViteServer } from 'vite';
import { db, initDatabase, SQL_SCHEMA_DDL } from './server/db.ts';
import {
  analyzeDiagnostic,
  runIpConfigDiagnostic,
  runNSLookupDiagnostic,
  runPingDiagnostic,
  runTracertDiagnostic,
  validateTarget,
} from './server/diagnostics.ts';
import { MYSQL_SCHEMA_SCRIPT, PYTHON_DIAGNOSTIC_SCRIPT } from './server/companionFiles.ts';
import type { DiagnosticTool, IncidentPriority, IncidentStatus } from './src/types.ts';

initDatabase();

const app = express();
app.use(express.json({ limit: '1mb' }));

const SLA_BY_PRIORITY: Record<IncidentPriority, number> = {
  P1: 15,
  P2: 60,
  P3: 240,
  P4: 1440,
};

// Summary metrics
app.get('/api/summary', (_req, res) => {
  const counts = db.prepare(`
    SELECT
      COUNT(*) as totalIncidents,
      SUM(CASE WHEN status NOT IN ('Resolved', 'Closed') THEN 1 ELSE 0 END) as openIncidents,
      SUM(CASE WHEN priority = 'P1' AND status NOT IN ('Resolved', 'Closed') THEN 1 ELSE 0 END) as p1Active,
      SUM(CASE WHEN priority = 'P2' AND status NOT IN ('Resolved', 'Closed') THEN 1 ELSE 0 END) as p2Active,
      SUM(CASE WHEN status = 'Escalated' THEN 1 ELSE 0 END) as escalatedCount,
      SUM(CASE WHEN status IN ('Resolved', 'Closed') THEN 1 ELSE 0 END) as resolvedCount
    FROM incidents
  `).get() as Record<string, number | null>;

  const diagCounts = db.prepare(`
    SELECT
      COUNT(*) as totalDiagnostics,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failedDiagnostics,
      ROUND(AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END), 1) as avgLatencyMs
    FROM diagnostic_runs
  `).get() as Record<string, number | null>;

  const byCategory = db.prepare(`
    SELECT category, COUNT(*) as count FROM incidents GROUP BY category ORDER BY count DESC
  `).all() as Array<{ category: string; count: number }>;

  const byPriority = db.prepare(`
    SELECT priority, COUNT(*) as count FROM incidents GROUP BY priority ORDER BY priority ASC
  `).all() as Array<{ priority: string; count: number }>;

  res.json({
    totalIncidents: counts.totalIncidents ?? 0,
    openIncidents: counts.openIncidents ?? 0,
    p1Active: counts.p1Active ?? 0,
    p2Active: counts.p2Active ?? 0,
    escalatedCount: counts.escalatedCount ?? 0,
    resolvedCount: counts.resolvedCount ?? 0,
    totalDiagnostics: diagCounts.totalDiagnostics ?? 0,
    failedDiagnostics: diagCounts.failedDiagnostics ?? 0,
    avgLatencyMs: diagCounts.avgLatencyMs ?? null,
    byCategory,
    byPriority,
  });
});

// Diagnostics
app.get('/api/diagnostics', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  const rows = db.prepare('SELECT * FROM diagnostic_runs ORDER BY id DESC LIMIT ?').all(limit);
  res.json(rows);
});

app.post('/api/diagnostics/run', async (req, res) => {
  try {
    const tool = (req.body?.tool || 'ping') as DiagnosticTool;
    const rawTarget = String(req.body?.target || '8.8.8.8');
    const count = Number(req.body?.count || 4);

    if (!['ping', 'tracert', 'ipconfig', 'nslookup', 'full_suite'].includes(tool)) {
      res.status(400).json({ error: 'Unsupported diagnostic tool.' });
      return;
    }

    const target = tool === 'ipconfig' ? 'localhost' : validateTarget(rawTarget);
    let rawOutput = '';
    let structured: Record<string, unknown> = {};
    let analysisResult: ReturnType<typeof analyzeDiagnostic>;

    if (tool === 'ping') {
      const ping = await runPingDiagnostic(target, count);
      rawOutput = ping.rawCmdOutput;
      structured = { ping };
      analysisResult = analyzeDiagnostic('ping', { ping });
    } else if (tool === 'nslookup') {
      const nslookup = await runNSLookupDiagnostic(target);
      rawOutput = nslookup.rawCmdOutput;
      structured = { nslookup };
      analysisResult = analyzeDiagnostic('nslookup', { nslookup });
    } else if (tool === 'ipconfig') {
      const ipconfig = await runIpConfigDiagnostic();
      rawOutput = ipconfig.rawCmdOutput;
      structured = { ipconfig };
      analysisResult = analyzeDiagnostic('ipconfig', { ipconfig });
    } else if (tool === 'tracert') {
      const tracert = await runTracertDiagnostic(target);
      rawOutput = tracert.rawCmdOutput;
      structured = { tracert };
      analysisResult = analyzeDiagnostic('tracert', { tracert });
    } else {
      const [nslookup, ping, tracert, ipconfig] = await Promise.all([
        runNSLookupDiagnostic(target),
        runPingDiagnostic(target, 4),
        runTracertDiagnostic(target),
        runIpConfigDiagnostic(),
      ]);
      rawOutput = [
        `=== [1/4] NSLOOKUP ${target} ===\n${nslookup.rawCmdOutput}`,
        `=== [2/4] PING -n 4 ${target} ===\n${ping.rawCmdOutput}`,
        `=== [3/4] TRACERT -d ${target} ===\n${tracert.rawCmdOutput}`,
        `=== [4/4] IPCONFIG /ALL ===\n${ipconfig.rawCmdOutput}`,
      ].join('\n\n');
      structured = { nslookup, ping, tracert, ipconfig };
      analysisResult = analyzeDiagnostic('full_suite', { nslookup, ping, tracert, ipconfig });
    }

    const { analysis, latencyMs, packetLoss } = analysisResult;
    const structuredWithAnalysis = { ...structured, analysis };

    const insert = db.prepare(`
      INSERT INTO diagnostic_runs (
        tool, target, status, latency_ms, packet_loss, summary, probable_cause,
        recommended_priority, raw_output, structured_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tool,
      target,
      analysis.status,
      latencyMs,
      packetLoss,
      analysis.summary,
      analysis.probableCause,
      analysis.recommendedPriority,
      rawOutput,
      JSON.stringify(structuredWithAnalysis)
    );

    const saved = db.prepare('SELECT * FROM diagnostic_runs WHERE id = ?').get(insert.lastInsertRowid);
    res.status(201).json({ run: saved, structured: structuredWithAnalysis });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Diagnostic failed.' });
  }
});

// Incidents
app.get('/api/incidents', (req, res) => {
  const priority = req.query.priority ? String(req.query.priority) : '';
  const status = req.query.status ? String(req.query.status) : '';
  const category = req.query.category ? String(req.query.category) : '';
  const q = req.query.q ? String(req.query.q).trim().toLowerCase() : '';

  const where: string[] = [];
  const params: unknown[] = [];

  if (priority && priority !== 'ALL') {
    where.push('i.priority = ?');
    params.push(priority);
  }
  if (status && status !== 'ALL') {
    where.push('i.status = ?');
    params.push(status);
  }
  if (category && category !== 'ALL') {
    where.push('i.category = ?');
    params.push(category);
  }
  if (q) {
    where.push('(LOWER(i.incident_code) LIKE ? OR LOWER(i.title) LIKE ? OR LOWER(i.affected_host) LIKE ? OR LOWER(i.description) LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT i.*, COUNT(l.id) as log_count
    FROM incidents i
    LEFT JOIN resolution_logs l ON l.incident_id = i.id
    ${whereClause}
    GROUP BY i.id
    ORDER BY
      CASE i.status WHEN 'Resolved' THEN 1 WHEN 'Closed' THEN 2 ELSE 0 END ASC,
      CASE i.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END ASC,
      i.id DESC
  `).all(...params);

  res.json(rows);
});

app.get('/api/incidents/:id', (req, res) => {
  const id = Number(req.params.id);
  const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!incident) {
    res.status(404).json({ error: 'Incident not found' });
    return;
  }

  const logs = db.prepare('SELECT * FROM resolution_logs WHERE incident_id = ? ORDER BY id DESC').all(id);
  const diagnosticRun = incident.diagnostic_run_id
    ? db.prepare('SELECT * FROM diagnostic_runs WHERE id = ?').get(incident.diagnostic_run_id)
    : null;

  res.json({ incident, logs, diagnosticRun });
});

app.post('/api/incidents', (req, res) => {
  const {
    title,
    description,
    priority = 'P2',
    category = 'Connectivity',
    affected_host,
    assignee = 'NOC Engineer L1',
    diagnostic_run_id = null,
    initial_command = null,
    initial_note = null,
  } = req.body || {};

  if (!title || !description || !affected_host) {
    res.status(400).json({ error: 'Title, description, and affected host are required.' });
    return;
  }

  const validPriority = (['P1', 'P2', 'P3', 'P4'].includes(priority) ? priority : 'P2') as IncidentPriority;
  const slaMinutes = SLA_BY_PRIORITY[validPriority];

  const maxIdRow = db.prepare('SELECT COALESCE(MAX(id), 100) as maxId FROM incidents').get() as { maxId: number };
  const code = `INC-2026-${String(101 + maxIdRow.maxId).padStart(4, '0')}`;

  const insert = db.prepare(`
    INSERT INTO incidents (
      incident_code, title, description, priority, status, category,
      affected_host, assignee, sla_target_minutes, diagnostic_run_id
    ) VALUES (?, ?, ?, ?, 'Open', ?, ?, ?, ?, ?)
  `).run(
    code,
    String(title).trim(),
    String(description).trim(),
    validPriority,
    category,
    String(affected_host).trim(),
    String(assignee).trim(),
    slaMinutes,
    diagnostic_run_id || null
  );

  const incidentId = insert.lastInsertRowid;

  db.prepare(`
    INSERT INTO resolution_logs (incident_id, author, action_type, command_used, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    incidentId,
    String(assignee).trim(),
    diagnostic_run_id ? 'Diagnostic' : 'Triage',
    initial_command || null,
    initial_note || `Incident ${code} logged under ${validPriority} (${slaMinutes}m SLA). Initial triage queued.`
  );

  const created = db.prepare('SELECT * FROM incidents WHERE id = ?').get(incidentId);
  res.status(201).json(created);
});

app.patch('/api/incidents/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Incident not found' });
    return;
  }

  const priority = (req.body.priority ?? existing.priority) as IncidentPriority;
  const status = (req.body.status ?? existing.status) as IncidentStatus;
  const assignee = req.body.assignee ?? existing.assignee;
  const escalation_tier = req.body.escalation_tier !== undefined ? req.body.escalation_tier : existing.escalation_tier;
  const escalated_to = req.body.escalated_to !== undefined ? req.body.escalated_to : existing.escalated_to;
  const escalation_ticket = req.body.escalation_ticket !== undefined ? req.body.escalation_ticket : existing.escalation_ticket;
  const escalation_notes = req.body.escalation_notes !== undefined ? req.body.escalation_notes : existing.escalation_notes;
  const root_cause = req.body.root_cause !== undefined ? req.body.root_cause : existing.root_cause;
  const slaMinutes = SLA_BY_PRIORITY[priority] ?? Number(existing.sla_target_minutes);

  const isNowResolved = status === 'Resolved' || status === 'Closed';
  const resolvedAt = isNowResolved ? (existing.resolved_at || new Date().toISOString().slice(0, 19).replace('T', ' ')) : null;

  db.prepare(`
    UPDATE incidents SET
      priority = ?,
      status = ?,
      assignee = ?,
      sla_target_minutes = ?,
      escalation_tier = ?,
      escalated_to = ?,
      escalation_ticket = ?,
      escalation_notes = ?,
      root_cause = ?,
      resolved_at = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    priority,
    status,
    assignee,
    slaMinutes,
    escalation_tier,
    escalated_to,
    escalation_ticket,
    escalation_notes,
    root_cause,
    resolvedAt,
    id
  );

  const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(id);
  res.json(updated);
});

app.delete('/api/incidents/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM incidents WHERE id = ?').run(id);
  res.json({ deleted: true });
});

app.post('/api/incidents/:id/logs', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id, status FROM incidents WHERE id = ?').get(id) as { id: number; status: string } | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Incident not found' });
    return;
  }

  const { author = 'NOC Engineer', action_type = 'Triage', command_used = null, notes } = req.body || {};
  if (!notes || !String(notes).trim()) {
    res.status(400).json({ error: 'Resolution log notes are required.' });
    return;
  }

  const insert = db.prepare(`
    INSERT INTO resolution_logs (incident_id, author, action_type, command_used, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, String(author).trim(), action_type, command_used ? String(command_used).trim() : null, String(notes).trim());

  db.prepare(`UPDATE incidents SET updated_at = datetime('now') WHERE id = ?`).run(id);
  const createdLog = db.prepare('SELECT * FROM resolution_logs WHERE id = ?').get(insert.lastInsertRowid);
  res.status(201).json(createdLog);
});

// Runbooks
app.get('/api/runbooks', (_req, res) => {
  const rows = db.prepare('SELECT * FROM runbooks ORDER BY id ASC').all();
  res.json(rows);
});

app.post('/api/runbooks', (req, res) => {
  const { title, category, severity_scope, symptoms, cmd_commands, steps_markdown, escalation_criteria } = req.body || {};
  if (!title || !category || !steps_markdown) {
    res.status(400).json({ error: 'Title, category, and troubleshooting steps are required.' });
    return;
  }
  const slug = `${String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now().toString().slice(-4)}`;
  const insert = db.prepare(`
    INSERT INTO runbooks (slug, title, category, severity_scope, symptoms, cmd_commands, steps_markdown, escalation_criteria)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    slug,
    String(title).trim(),
    String(category).trim(),
    String(severity_scope || 'P1 / P2').trim(),
    String(symptoms || '').trim(),
    String(cmd_commands || '').trim(),
    String(steps_markdown).trim(),
    String(escalation_criteria || '').trim()
  );
  const created = db.prepare('SELECT * FROM runbooks WHERE id = ?').get(insert.lastInsertRowid);
  res.status(201).json(created);
});

// Read-only SQL explorer
app.post('/api/sql/query', (req, res) => {
  const rawSql = String(req.body?.sql || '').trim();
  const normalized = rawSql.replace(/;+\s*$/, '');
  if (!normalized || normalized.includes(';')) {
    res.status(400).json({ error: 'Provide a single read-only SELECT or PRAGMA statement.' });
    return;
  }
  const upper = normalized.toUpperCase();
  if (!upper.startsWith('SELECT ') && !upper.startsWith('PRAGMA ')) {
    res.status(403).json({ error: 'Only read-only SELECT or PRAGMA statements are permitted in the SQL inspector.' });
    return;
  }
  const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|REPLACE|VACUUM)\b/i;
  if (forbidden.test(normalized)) {
    res.status(403).json({ error: 'Mutating SQL statements are blocked in the inspector.' });
    return;
  }

  try {
    const start = performance.now();
    const rows = db.prepare(normalized).all();
    const elapsedMs = Math.round((performance.now() - start) * 10) / 10;
    const columns = rows.length > 0 ? Object.keys(rows[0] as Record<string, unknown>) : [];
    res.json({ columns, rows, rowCount: rows.length, elapsedMs });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'SQL query error' });
  }
});

// Companion Python + MySQL reference artifacts
app.get('/api/companion', (_req, res) => {
  res.json({
    pythonScript: PYTHON_DIAGNOSTIC_SCRIPT,
    mysqlSchema: MYSQL_SCHEMA_SCRIPT,
    sqliteSchema: SQL_SCHEMA_DDL.trim(),
  });
});

// CSV Export
app.get('/api/export/incidents.csv', (_req, res) => {
  const rows = db.prepare('SELECT * FROM incidents ORDER BY id DESC').all() as Array<Record<string, unknown>>;
  const headers = [
    'incident_code', 'priority', 'status', 'category', 'affected_host',
    'title', 'assignee', 'sla_target_minutes', 'escalation_tier',
    'escalated_to', 'escalation_ticket', 'root_cause', 'created_at', 'resolved_at',
  ];
  const escapeCsv = (val: unknown) => {
    const str = val === null || val === undefined ? '' : String(val);
    return `"${str.replace(/"/g, '""')}"`;
  };
  const csv = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escapeCsv(r[h])).join(',')),
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="nettrace-incidents.csv"');
  res.send(csv);
});

async function startServer() {
  const port = 3000;
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.resolve('dist'));

  if (isProd) {
    app.use(express.static(path.resolve('dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve('dist/index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`NetTrace Incident Desk running on http://0.0.0.0:${port}`);
  });
}

startServer();
