import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'nettrace.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const SQL_SCHEMA_DDL = `
-- Relational Schema (SQLite runtime / MySQL 8.0 compatible structure)
CREATE TABLE IF NOT EXISTS diagnostic_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool TEXT NOT NULL,
  target TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms REAL,
  packet_loss REAL,
  summary TEXT NOT NULL,
  probable_cause TEXT NOT NULL,
  recommended_priority TEXT NOT NULL DEFAULT 'P3',
  raw_output TEXT NOT NULL,
  structured_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL CHECK(priority IN ('P1', 'P2', 'P3', 'P4')),
  status TEXT NOT NULL CHECK(status IN ('Open', 'Investigating', 'Escalated', 'Resolved', 'Closed')),
  category TEXT NOT NULL CHECK(category IN ('DNS', 'DHCP', 'Routing', 'Switching', 'Latency', 'Connectivity')),
  affected_host TEXT NOT NULL,
  assignee TEXT NOT NULL,
  sla_target_minutes INTEGER NOT NULL DEFAULT 60,
  escalation_tier TEXT,
  escalated_to TEXT,
  escalation_ticket TEXT,
  escalation_notes TEXT,
  root_cause TEXT,
  diagnostic_run_id INTEGER REFERENCES diagnostic_runs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS resolution_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK(action_type IN ('Diagnostic', 'Triage', 'Workaround', 'Escalation', 'Root Cause', 'Resolution')),
  command_used TEXT,
  notes TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runbooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  severity_scope TEXT NOT NULL,
  symptoms TEXT NOT NULL,
  cmd_commands TEXT NOT NULL,
  steps_markdown TEXT NOT NULL,
  escalation_criteria TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_incidents_priority_status ON incidents(priority, status);
CREATE INDEX IF NOT EXISTS idx_resolution_logs_incident ON resolution_logs(incident_id);
CREATE INDEX IF NOT EXISTS idx_diagnostic_runs_created ON diagnostic_runs(created_at DESC);
`;

export function initDatabase() {
  db.exec(SQL_SCHEMA_DDL);

  const incidentCount = (db.prepare('SELECT COUNT(*) as cnt FROM incidents').get() as { cnt: number }).cnt;
  if (incidentCount === 0) {
    seedInitialData();
  }
}

function seedInitialData() {
  const insertRun = db.prepare(`
    INSERT INTO diagnostic_runs (tool, target, status, latency_ms, packet_loss, summary, probable_cause, recommended_priority, raw_output, structured_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const run1 = insertRun.run(
    'nslookup',
    'erp-db.internal.corp',
    'failed',
    42.0,
    100,
    'DNS lookup timed out on primary resolver 10.20.0.10; NXDOMAIN / SERVFAIL returned for erp-db.internal.corp.',
    'Primary internal DNS forwarder failed to answer authoritative zone queries or stale cache record missing.',
    'P1',
    `Server:  dc01-dns.internal.corp\nAddress:  10.20.0.10\n\n*** dc01-dns.internal.corp can't find erp-db.internal.corp: Server failed`,
    JSON.stringify({
      target: 'erp-db.internal.corp',
      resolverIp: '10.20.0.10',
      resolutionTimeMs: 42,
      resolvedAddresses: [],
      records: [],
      error: 'SERVFAIL: Internal forwarder unreachable'
    }),
    '2026-11-13 08:15:00'
  );

  const run2 = insertRun.run(
    'tracert',
    '172.16.40.12',
    'degraded',
    184.5,
    25,
    'Packet loss and RTT spike detected at hop 4 (10.20.12.254 - core-sw-02.branch) jumping from 3 ms to 184 ms.',
    'Uplink congestion or duplex mismatch on branch distribution switch core-sw-02.',
    'P2',
    `Tracing route to 172.16.40.12 over a maximum of 30 hops:\n\n  1     1 ms     1 ms     1 ms  10.20.1.1\n  2     3 ms     2 ms     3 ms  10.20.0.2\n  3     4 ms     5 ms     4 ms  10.20.12.1\n  4   182 ms   189 ms   181 ms  10.20.12.254\n  5   185 ms     *      184 ms  172.16.40.12`,
    JSON.stringify({
      target: '172.16.40.12',
      resolvedIp: '172.16.40.12',
      maxHops: 30,
      reachedDestination: true,
      bottleneckHop: 4,
      hops: [
        { hop: 1, ip: '10.20.1.1', hostname: 'gw-floor1.corp', rtt1Ms: 1, rtt2Ms: 1, rtt3Ms: 1, status: 'ok' },
        { hop: 2, ip: '10.20.0.2', hostname: 'dist-rtr-01.corp', rtt1Ms: 3, rtt2Ms: 2, rtt3Ms: 3, status: 'ok' },
        { hop: 3, ip: '10.20.12.1', hostname: 'wan-edge-01.corp', rtt1Ms: 4, rtt2Ms: 5, rtt3Ms: 4, status: 'ok' },
        { hop: 4, ip: '10.20.12.254', hostname: 'core-sw-02.branch', rtt1Ms: 182, rtt2Ms: 189, rtt3Ms: 181, status: 'degraded', note: 'RTT spike +178ms' },
        { hop: 5, ip: '172.16.40.12', hostname: 'filesrv-02.branch', rtt1Ms: 185, rtt2Ms: null, rtt3Ms: 184, status: 'degraded' }
      ]
    }),
    '2026-11-13 09:05:00'
  );

  const run3 = insertRun.run(
    'ipconfig',
    'workstation-vlan14',
    'failed',
    null,
    100,
    'Workstation assigned APIPA address 169.254.88.14 with blank Default Gateway; DHCP lease renewal failed.',
    'DHCP scope exhaustion on VLAN 14 or missing ip helper-address on SVI interface.',
    'P2',
    `Ethernet adapter Ethernet0:\n   Connection-specific DNS Suffix  . : \n   Autoconfiguration IPv4 Address. . : 169.254.88.14\n   Subnet Mask . . . . . . . . . . . : 255.255.0.0\n   Default Gateway . . . . . . . . . : `,
    JSON.stringify({
      hostname: 'WS-FIN-104',
      platform: 'Windows 11 Pro',
      defaultGateway: null,
      dnsServers: ['10.20.0.10'],
      adapters: []
    }),
    '2026-11-12 16:40:00'
  );

  const insertIncident = db.prepare(`
    INSERT INTO incidents (
      incident_code, title, description, priority, status, category, affected_host,
      assignee, sla_target_minutes, escalation_tier, escalated_to, escalation_ticket,
      escalation_notes, root_cause, diagnostic_run_id, created_at, updated_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const inc1 = insertIncident.run(
    'INC-2026-0101',
    'Internal DNS SERVFAIL blocking ERP database resolution',
    'Finance and warehouse terminals unable to resolve erp-db.internal.corp. Ping to direct IP 10.20.4.55 succeeds in 2ms, confirming Layer 3 reachability while DNS zone lookup fails.',
    'P1',
    'Escalated',
    'DNS',
    'erp-db.internal.corp',
    'A. Sharma (NOC L2)',
    15,
    'Tier 2 Infrastructure',
    'Core Identity & DNS Team',
    'ESC-4491',
    'Escalated after confirming dc01-dns (10.20.0.10) returns SERVFAIL while secondary resolver 10.20.0.11 resolves normally.',
    'Primary DNS service zone transfer stalled on dc01-dns.',
    run1.lastInsertRowid,
    '2026-11-13 08:18:00',
    '2026-11-13 08:32:00',
    null
  );

  const inc2 = insertIncident.run(
    'INC-2026-0102',
    'Branch 02 WAN uplink latency spike and 25% packet loss',
    'Users at Branch 02 report intermittent RDP disconnects and slow SMB file shares. Tracert shows jump from 4ms to 184ms at hop 4 (10.20.12.254).',
    'P2',
    'Investigating',
    'Routing',
    '172.16.40.12',
    'R. Verma (NetOps L1)',
    60,
    'Tier 2 Network Engineering',
    'WAN Operations',
    null,
    'Monitoring interface error counters on core-sw-02 Gi1/0/24.',
    null,
    run2.lastInsertRowid,
    '2026-11-13 09:10:00',
    '2026-11-13 09:24:00',
    null
  );

  const inc3 = insertIncident.run(
    'INC-2026-0103',
    'VLAN 14 workstations receiving APIPA 169.254.x.x addresses',
    'Eight newly booted workstations on Floor 3 failed to obtain DHCP leases after switch maintenance. IPConfig showed autoconfiguration IP 169.254.88.14 and no default gateway.',
    'P2',
    'Resolved',
    'DHCP',
    '10.20.14.0/24',
    'P. Nagbansi (NOC L1)',
    60,
    null,
    null,
    null,
    null,
    'Missing ip helper-address 10.20.0.10 on VLAN 14 SVI after router config reload.',
    run3.lastInsertRowid,
    '2026-11-12 16:45:00',
    '2026-11-12 17:20:00',
    '2026-11-12 17:20:00'
  );

  const inc4 = insertIncident.run(
    'INC-2026-0104',
    'Elevated jitter on public SIP trunk gateway',
    'Intermittent voice clipping reported by support queue. Continuous ping to sip.carrier-edge.net shows occasional 95ms spikes vs 14ms baseline.',
    'P3',
    'Open',
    'Latency',
    '1.1.1.1',
    'M. Nair (NOC L1)',
    240,
    null,
    null,
    null,
    null,
    null,
    null,
    '2026-11-13 07:30:00',
    '2026-11-13 07:30:00',
    null
  );

  const insertLog = db.prepare(`
    INSERT INTO resolution_logs (incident_id, author, action_type, command_used, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insertLog.run(inc1.lastInsertRowid, 'P. Nagbansi', 'Diagnostic', 'nslookup erp-db.internal.corp 10.20.0.10', 'Confirmed SERVFAIL from primary DNS 10.20.0.10; direct ping to 10.20.4.55 passed with 2ms avg RTT.', '2026-11-13 08:20:00');
  insertLog.run(inc1.lastInsertRowid, 'A. Sharma', 'Workaround', 'ipconfig /flushdns', 'Configured affected finance hosts to point secondary DNS to 10.20.0.11 and flushed local DNS cache.', '2026-11-13 08:26:00');
  insertLog.run(inc1.lastInsertRowid, 'A. Sharma', 'Escalation', 'nslookup -type=SOA internal.corp', 'Escalated to Tier 2 Core Identity & DNS Team (Ticket ESC-4491) to restart DNS Server service and force zone replication.', '2026-11-13 08:32:00');

  insertLog.run(inc2.lastInsertRowid, 'R. Verma', 'Diagnostic', 'tracert -d 172.16.40.12', 'Isolated latency jump to hop 4 (10.20.12.254). Hops 1-3 steady under 5ms.', '2026-11-13 09:12:00');
  insertLog.run(inc2.lastInsertRowid, 'R. Verma', 'Triage', 'ping -n 20 10.20.12.254', 'Observed 25% packet loss and 184ms average RTT to branch core switch management IP.', '2026-11-13 09:24:00');

  insertLog.run(inc3.lastInsertRowid, 'P. Nagbansi', 'Diagnostic', 'ipconfig /all', 'Verified workstation pulled 169.254.88.14 APIPA with empty gateway and DHCP enabled = Yes.', '2026-11-12 16:48:00');
  insertLog.run(inc3.lastInsertRowid, 'P. Nagbansi', 'Root Cause', 'ipconfig /release && ipconfig /renew', 'DHCP Discover packets not reaching 10.20.0.10 across L3 boundary; SVI VLAN 14 lacked ip helper-address.', '2026-11-12 17:08:00');
  insertLog.run(inc3.lastInsertRowid, 'P. Nagbansi', 'Resolution', 'ping 10.20.14.1 && nslookup dc01.internal.corp', 'Restored ip helper-address 10.20.0.10 on VLAN 14 SVI. Ran ipconfig /renew on affected endpoints; all received valid 10.20.14.x leases.', '2026-11-12 17:20:00');

  const insertRunbook = db.prepare(`
    INSERT INTO runbooks (slug, title, category, severity_scope, symptoms, cmd_commands, steps_markdown, escalation_criteria, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertRunbook.run(
    'dns-resolution-failure',
    'DNS Resolution Failure & Cache Poisoning Triage',
    'DNS',
    'P1 / P2',
    'Hostnames fail to resolve (ERR_NAME_NOT_RESOLVED or SERVFAIL) while direct IP pings succeed.',
    `ipconfig /all\nipconfig /flushdns\nnslookup <hostname>\nnslookup <hostname> 8.8.8.8`,
    `1. Verify configured DNS servers with ipconfig /all.\n2. Test direct IP reachability using ping <target-ip> to isolate Layer 3 vs Name Resolution.\n3. Run nslookup against both internal primary DNS and an external resolver (8.8.8.8 / 1.1.1.1).\n4. Clear stale client cache using ipconfig /flushdns and re-test.\n5. Inspect SOA and NS records to confirm zone transfer health.`,
    'Escalate to Tier 2 Infrastructure if internal DNS server returns SERVFAIL or refuses TCP/UDP port 53 queries for >10 minutes.',
    '2026-11-10 10:00:00'
  );

  insertRunbook.run(
    'dhcp-apipa-exhaustion',
    'DHCP Lease Failure & APIPA (169.254.x.x) Recovery',
    'DHCP',
    'P2',
    'Endpoints receive 169.254.x.x address, blank Default Gateway, and no external or inter-VLAN connectivity.',
    `ipconfig /all\nipconfig /release\nipconfig /renew\nping <default-gateway>`,
    `1. Inspect ipconfig /all to check if DHCP Enabled = Yes and whether IPv4 starts with 169.254.\n2. Verify physical link / VLAN port assignment on access switch.\n3. Execute ipconfig /release followed by ipconfig /renew to observe DORA handshake timeout.\n4. Confirm DHCP scope utilization has available addresses and SVI has ip helper-address configured.`,
    'Escalate to Tier 2 Network Engineering if DHCP relay (ip helper-address) fails across VLANs or scope pool is 100% exhausted.',
    '2026-11-10 10:00:00'
  );

  insertRunbook.run(
    'routing-hop-bottleneck',
    'Routing Loop, Packet Loss & High Latency Path Diagnosis',
    'Routing',
    'P1 / P2 / P3',
    'Severe latency spikes (>150ms), intermittent packet drops, or timeouts beyond gateway hop.',
    `ping -n 10 <default-gateway>\ntracert -d <destination>\nping -n 20 <bottleneck-hop-ip>`,
    `1. Ping local default gateway first to rule out local LAN/Wi-Fi interference.\n2. Run tracert -d <destination> to inspect hop-by-hop RTT without reverse-DNS delay.\n3. Identify the first hop where RTT spikes or asterisks (*) persist through downstream hops.\n4. Run sustained ping against the suspected hop IP to measure packet loss percentage and jitter.\n5. Check for asymmetric routing or ISP peering congestion if bottleneck occurs outside AS boundary.`,
    'Escalate to Tier 2 NetEng for internal core hops or open a Carrier NOC ticket (Tier 3 ISP) with full tracert output attached.',
    '2026-11-10 10:00:00'
  );

  insertRunbook.run(
    'p1-p2-escalation-protocol',
    'P1 / P2 Incident Prioritization & Escalation Handoff',
    'Connectivity',
    'P1 / P2',
    'Multi-user outage, core service down, or unresolved degradation approaching SLA threshold.',
    `ping -n 4 <target>\ntracert -d <target>\nnslookup <target>\nipconfig /all`,
    `1. Classify P1 (Critical: Full site/core outage, 15m SLA) vs P2 (High: Degraded service or single VLAN impact, 60m SLA).\n2. Capture all four baseline outputs (Ping, Tracert, IPConfig, NSLookup) before escalating.\n3. Document probable root cause, affected subnet/hosts, and temporary workaround in Resolution Logs.\n4. Record Escalation Tier, Target Team, and External Ticket Reference on the incident record.`,
    'Mandatory escalation at 50% SLA elapsed if root cause is outside Tier 1 control (ISP circuit, firewall ACL, core switch hardware).',
    '2026-11-10 10:00:00'
  );
}
