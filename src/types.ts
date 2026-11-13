export type DiagnosticTool = 'ping' | 'tracert' | 'ipconfig' | 'nslookup' | 'full_suite';

export type DiagnosticStatus = 'healthy' | 'degraded' | 'failed';

export type IncidentPriority = 'P1' | 'P2' | 'P3' | 'P4';

export type IncidentStatus = 'Open' | 'Investigating' | 'Escalated' | 'Resolved' | 'Closed';

export type IncidentCategory = 'DNS' | 'DHCP' | 'Routing' | 'Switching' | 'Latency' | 'Connectivity';

export type LogActionType = 'Diagnostic' | 'Triage' | 'Workaround' | 'Escalation' | 'Root Cause' | 'Resolution';

export interface PingResult {
  target: string;
  resolvedIp: string | null;
  method: 'ICMP' | 'TCP_HTTPS';
  transmitted: number;
  received: number;
  packetLossPct: number;
  minMs: number | null;
  avgMs: number | null;
  maxMs: number | null;
  jitterMs: number | null;
  samples: Array<{ seq: number; ttl: number | null; timeMs: number | null; status: 'ok' | 'timeout' }>;
  rawCmdOutput: string;
}

export interface TracertHop {
  hop: number;
  ip: string;
  hostname: string | null;
  rtt1Ms: number | null;
  rtt2Ms: number | null;
  rtt3Ms: number | null;
  status: 'ok' | 'timeout' | 'degraded';
  note?: string;
}

export interface TracertResult {
  target: string;
  resolvedIp: string | null;
  maxHops: number;
  reachedDestination: boolean;
  bottleneckHop: number | null;
  hops: TracertHop[];
  rawCmdOutput: string;
}

export interface NetworkAdapterInfo {
  name: string;
  description: string;
  mac: string;
  ipv4: string | null;
  netmask: string | null;
  cidr: string | null;
  ipv6: string | null;
  internal: boolean;
  dhcpEnabled: boolean;
  defaultGateway: string | null;
  dnsServers: string[];
}

export interface IpConfigResult {
  hostname: string;
  platform: string;
  defaultGateway: string | null;
  dnsServers: string[];
  adapters: NetworkAdapterInfo[];
  rawCmdOutput: string;
}

export interface DnsRecordEntry {
  type: 'A' | 'AAAA' | 'MX' | 'NS' | 'TXT' | 'CNAME' | 'SOA';
  value: string;
  ttl?: number;
}

export interface NSLookupResult {
  target: string;
  resolverIp: string;
  resolutionTimeMs: number;
  resolvedAddresses: string[];
  records: DnsRecordEntry[];
  error: string | null;
  rawCmdOutput: string;
}

export interface DiagnosticAnalysis {
  status: DiagnosticStatus;
  summary: string;
  probableCause: string;
  recommendedCategory: IncidentCategory;
  recommendedPriority: IncidentPriority;
  suggestedSteps: string[];
}

export interface DiagnosticRunRecord {
  id: number;
  tool: DiagnosticTool;
  target: string;
  status: DiagnosticStatus;
  latency_ms: number | null;
  packet_loss: number | null;
  summary: string;
  probable_cause: string;
  recommended_priority: IncidentPriority;
  raw_output: string;
  structured_json: string;
  created_at: string;
}

export interface IncidentRecord {
  id: number;
  incident_code: string;
  title: string;
  description: string;
  priority: IncidentPriority;
  status: IncidentStatus;
  category: IncidentCategory;
  affected_host: string;
  assignee: string;
  sla_target_minutes: number;
  escalation_tier: string | null;
  escalated_to: string | null;
  escalation_ticket: string | null;
  escalation_notes: string | null;
  root_cause: string | null;
  diagnostic_run_id: number | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  log_count?: number;
}

export interface ResolutionLogRecord {
  id: number;
  incident_id: number;
  author: string;
  action_type: LogActionType;
  command_used: string | null;
  notes: string;
  created_at: string;
}

export interface RunbookRecord {
  id: number;
  slug: string;
  title: string;
  category: IncidentCategory;
  severity_scope: string;
  symptoms: string;
  cmd_commands: string;
  steps_markdown: string;
  escalation_criteria: string;
  updated_at: string;
}

export interface DashboardSummary {
  totalIncidents: number;
  openIncidents: number;
  p1Active: number;
  p2Active: number;
  escalatedCount: number;
  resolvedCount: number;
  totalDiagnostics: number;
  failedDiagnostics: number;
  avgLatencyMs: number | null;
  byCategory: Array<{ category: string; count: number }>;
  byPriority: Array<{ priority: string; count: number }>;
}
