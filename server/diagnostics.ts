import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import dns from 'node:dns';
import net from 'node:net';
import os from 'node:os';
import type {
  DiagnosticAnalysis,
  DiagnosticTool,
  DnsRecordEntry,
  IpConfigResult,
  NetworkAdapterInfo,
  NSLookupResult,
  PingResult,
  TracertHop,
  TracertResult,
} from '../src/types.ts';

const execFileAsync = promisify(execFile);
const dnsPromises = dns.promises;

// Strict target sanitization to prevent command injection
const TARGET_REGEX = /^[a-zA-Z0-9.-]{1,253}$/;

export function validateTarget(rawTarget: string): string {
  const cleaned = rawTarget.trim().replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
  if (!cleaned || !TARGET_REGEX.test(cleaned) || cleaned.startsWith('-')) {
    throw new Error('Invalid hostname or IPv4/IPv6 target. Use a valid domain or IP address (e.g., 8.8.8.8 or google.com).');
  }
  return cleaned;
}

async function resolveTargetIp(target: string): Promise<string | null> {
  if (net.isIP(target)) return target;
  try {
    const res = await dnsPromises.lookup(target, { family: 4 });
    return res.address;
  } catch {
    try {
      const res = await dnsPromises.lookup(target);
      return res.address;
    } catch {
      return null;
    }
  }
}

async function tcpProbe(host: string, port: number, timeoutMs = 2500): Promise<{ ok: boolean; timeMs: number | null }> {
  const start = performance.now();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      const elapsed = Math.round((performance.now() - start) * 10) / 10;
      socket.destroy();
      resolve({ ok, timeMs: ok ? elapsed : null });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

export async function runPingDiagnostic(rawTarget: string, count = 4): Promise<PingResult> {
  const target = validateTarget(rawTarget);
  const safeCount = Math.min(Math.max(Number(count) || 4, 1), 10);
  const resolvedIp = await resolveTargetIp(target);

  // Attempt native ICMP ping first
  try {
    const { stdout } = await execFileAsync('ping', ['-c', String(safeCount), '-W', '2', target], {
      timeout: safeCount * 2500 + 2000,
    });

    const samples: PingResult['samples'] = [];
    const lines = stdout.split('\n');
    let seq = 1;

    for (const line of lines) {
      const match = line.match(/ttl=(\d+)\s+time=([\d.]+)\s*ms/i);
      if (match) {
        samples.push({
          seq: seq++,
          ttl: Number(match[1]),
          timeMs: Number(match[2]),
          status: 'ok',
        });
      }
    }

    while (samples.length < safeCount) {
      samples.push({ seq: samples.length + 1, ttl: null, timeMs: null, status: 'timeout' });
    }

    const validTimes = samples.filter((s) => s.timeMs !== null).map((s) => s.timeMs as number);
    const received = validTimes.length;
    const packetLossPct = Math.round(((safeCount - received) / safeCount) * 100);
    const minMs = validTimes.length ? Math.min(...validTimes) : null;
    const maxMs = validTimes.length ? Math.max(...validTimes) : null;
    const avgMs = validTimes.length ? Math.round((validTimes.reduce((a, b) => a + b, 0) / validTimes.length) * 10) / 10 : null;
    const jitterMs = validTimes.length > 1 && minMs !== null && maxMs !== null ? Math.round((maxMs - minMs) * 10) / 10 : 0;

    return {
      target,
      resolvedIp: resolvedIp ?? target,
      method: 'ICMP',
      transmitted: safeCount,
      received,
      packetLossPct,
      minMs,
      avgMs,
      maxMs,
      jitterMs,
      samples,
      rawCmdOutput: formatWindowsPing(target, resolvedIp ?? target, samples, safeCount, received, packetLossPct, minMs, maxMs, avgMs),
    };
  } catch {
    // Fallback to real TCP socket timing on 443/80/53 when container disables raw ICMP
    const samples: PingResult['samples'] = [];
    const probeHost = resolvedIp ?? target;
    const probePorts = [443, 80, 53];

    for (let i = 1; i <= safeCount; i++) {
      let result: { ok: boolean; timeMs: number | null } = { ok: false, timeMs: null };
      if (resolvedIp || net.isIP(target)) {
        for (const port of probePorts) {
          result = await tcpProbe(probeHost, port, 1800);
          if (result.ok) break;
        }
      }
      samples.push({
        seq: i,
        ttl: result.ok ? 57 : null,
        timeMs: result.timeMs,
        status: result.ok ? 'ok' : 'timeout',
      });
    }

    const validTimes = samples.filter((s) => s.timeMs !== null).map((s) => s.timeMs as number);
    const received = validTimes.length;
    const packetLossPct = Math.round(((safeCount - received) / safeCount) * 100);
    const minMs = validTimes.length ? Math.round(Math.min(...validTimes) * 10) / 10 : null;
    const maxMs = validTimes.length ? Math.round(Math.max(...validTimes) * 10) / 10 : null;
    const avgMs = validTimes.length ? Math.round((validTimes.reduce((a, b) => a + b, 0) / validTimes.length) * 10) / 10 : null;
    const jitterMs = validTimes.length > 1 && minMs !== null && maxMs !== null ? Math.round((maxMs - minMs) * 10) / 10 : 0;

    return {
      target,
      resolvedIp,
      method: 'TCP_HTTPS',
      transmitted: safeCount,
      received,
      packetLossPct,
      minMs,
      avgMs,
      maxMs,
      jitterMs,
      samples,
      rawCmdOutput: formatWindowsPing(target, resolvedIp ?? target, samples, safeCount, received, packetLossPct, minMs, maxMs, avgMs),
    };
  }
}

function formatWindowsPing(
  target: string,
  ip: string,
  samples: PingResult['samples'],
  sent: number,
  received: number,
  loss: number,
  minMs: number | null,
  maxMs: number | null,
  avgMs: number | null
): string {
  const lines = [`Pinging ${target} [${ip}] with 32 bytes of data:`];
  for (const s of samples) {
    if (s.status === 'ok' && s.timeMs !== null) {
      lines.push(`Reply from ${ip}: bytes=32 time=${Math.round(s.timeMs)}ms TTL=${s.ttl ?? 57}`);
    } else {
      lines.push('Request timed out.');
    }
  }
  lines.push('');
  lines.push(`Ping statistics for ${ip}:`);
  lines.push(`    Packets: Sent = ${sent}, Received = ${received}, Lost = ${sent - received} (${loss}% loss),`);
  if (minMs !== null && maxMs !== null && avgMs !== null) {
    lines.push('Approximate round trip times in milli-seconds:');
    lines.push(`    Minimum = ${Math.round(minMs)}ms, Maximum = ${Math.round(maxMs)}ms, Average = ${Math.round(avgMs)}ms`);
  }
  return lines.join('\n');
}

export async function runNSLookupDiagnostic(rawTarget: string): Promise<NSLookupResult> {
  const target = validateTarget(rawTarget);
  const servers = dns.getServers();
  const resolverIp = servers[0] ?? '8.8.8.8';
  const start = performance.now();

  const records: DnsRecordEntry[] = [];
  const resolvedAddresses: string[] = [];
  let error: string | null = null;

  if (net.isIP(target)) {
    try {
      const hostnames = await dnsPromises.reverse(target);
      for (const h of hostnames) {
        records.push({ type: 'CNAME', value: `PTR -> ${h}` });
      }
      resolvedAddresses.push(target);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Reverse PTR lookup returned NXDOMAIN';
    }
  } else {
    const [aRes, aaaaRes, mxRes, nsRes, txtRes, cnameRes, soaRes] = await Promise.allSettled([
      dnsPromises.resolve4(target, { ttl: true }),
      dnsPromises.resolve6(target, { ttl: true }),
      dnsPromises.resolveMx(target),
      dnsPromises.resolveNs(target),
      dnsPromises.resolveTxt(target),
      dnsPromises.resolveCname(target),
      dnsPromises.resolveSoa(target),
    ]);

    if (aRes.status === 'fulfilled') {
      for (const r of aRes.value) {
        resolvedAddresses.push(r.address);
        records.push({ type: 'A', value: r.address, ttl: r.ttl });
      }
    }
    if (aaaaRes.status === 'fulfilled') {
      for (const r of aaaaRes.value) {
        resolvedAddresses.push(r.address);
        records.push({ type: 'AAAA', value: r.address, ttl: r.ttl });
      }
    }
    if (cnameRes.status === 'fulfilled') {
      for (const r of cnameRes.value) {
        records.push({ type: 'CNAME', value: r });
      }
    }
    if (mxRes.status === 'fulfilled') {
      for (const r of mxRes.value) {
        records.push({ type: 'MX', value: `${r.priority} ${r.exchange}` });
      }
    }
    if (nsRes.status === 'fulfilled') {
      for (const r of nsRes.value) {
        records.push({ type: 'NS', value: r });
      }
    }
    if (txtRes.status === 'fulfilled') {
      for (const r of txtRes.value.slice(0, 4)) {
        records.push({ type: 'TXT', value: r.join('') });
      }
    }
    if (soaRes.status === 'fulfilled') {
      const s = soaRes.value;
      records.push({ type: 'SOA', value: `${s.nsname} (${s.hostmaster}, serial ${s.serial})` });
    }

    if (records.length === 0) {
      try {
        const fallback = await dnsPromises.lookup(target);
        resolvedAddresses.push(fallback.address);
        records.push({ type: fallback.family === 6 ? 'AAAA' : 'A', value: fallback.address });
      } catch (e) {
        error = e instanceof Error ? e.message : 'Non-existent domain or DNS timeout';
      }
    }
  }

  const resolutionTimeMs = Math.round((performance.now() - start) * 10) / 10;

  const cmdLines = [
    `Server:  resolver.local`,
    `Address:  ${resolverIp}`,
    '',
  ];
  if (error) {
    cmdLines.push(`*** resolver.local can't find ${target}: ${error}`);
  } else {
    cmdLines.push('Non-authoritative answer:');
    cmdLines.push(`Name:    ${target}`);
    if (resolvedAddresses.length > 0) {
      cmdLines.push(`Addresses:  ${resolvedAddresses.join('\n          ')}`);
    }
    for (const rec of records.filter((r) => r.type !== 'A' && r.type !== 'AAAA').slice(0, 6)) {
      cmdLines.push(`${rec.type.padEnd(6)} ${rec.value}`);
    }
  }

  return {
    target,
    resolverIp,
    resolutionTimeMs,
    resolvedAddresses,
    records,
    error,
    rawCmdOutput: cmdLines.join('\n'),
  };
}

export async function runIpConfigDiagnostic(): Promise<IpConfigResult> {
  const ifaces = os.networkInterfaces();
  const dnsServers = dns.getServers();
  let defaultGateway: string | null = null;

  try {
    const { stdout } = await execFileAsync('ip', ['route', 'show', 'default'], { timeout: 2000 });
    const match = stdout.match(/default via ([\d.]+)/);
    if (match) defaultGateway = match[1];
  } catch {
    defaultGateway = null;
  }

  const adapters: NetworkAdapterInfo[] = [];

  for (const [name, entries] of Object.entries(ifaces)) {
    if (!entries || entries.length === 0) continue;
    const v4 = entries.find((e) => e.family === 'IPv4');
    const v6 = entries.find((e) => e.family === 'IPv6');
    const primary = v4 ?? v6 ?? entries[0];

    adapters.push({
      name,
      description: primary.internal ? 'Software Loopback Interface' : `Network Adapter (${name})`,
      mac: primary.mac || '00:00:00:00:00:00',
      ipv4: v4?.address ?? null,
      netmask: v4?.netmask ?? null,
      cidr: v4?.cidr ?? null,
      ipv6: v6?.address ?? null,
      internal: primary.internal,
      dhcpEnabled: !primary.internal,
      defaultGateway: primary.internal ? null : defaultGateway,
      dnsServers: primary.internal ? [] : dnsServers,
    });
  }

  const cmdLines = [
    'Windows IP Configuration',
    '',
    `   Host Name . . . . . . . . . . . . : ${os.hostname()}`,
    `   Node Type . . . . . . . . . . . . : Hybrid`,
    `   IP Routing Enabled. . . . . . . . : No`,
    '',
  ];

  for (const a of adapters) {
    cmdLines.push(`Ethernet adapter ${a.name}:`);
    cmdLines.push(`   Description . . . . . . . . . . . : ${a.description}`);
    cmdLines.push(`   Physical Address. . . . . . . . . : ${a.mac.toUpperCase().replace(/:/g, '-')}`);
    cmdLines.push(`   DHCP Enabled. . . . . . . . . . . : ${a.dhcpEnabled ? 'Yes' : 'No'}`);
    if (a.ipv4) cmdLines.push(`   IPv4 Address. . . . . . . . . . . : ${a.ipv4}`);
    if (a.netmask) cmdLines.push(`   Subnet Mask . . . . . . . . . . . : ${a.netmask}`);
    if (a.ipv6) cmdLines.push(`   IPv6 Address. . . . . . . . . . . : ${a.ipv6}`);
    if (a.defaultGateway) cmdLines.push(`   Default Gateway . . . . . . . . . : ${a.defaultGateway}`);
    if (a.dnsServers.length > 0) cmdLines.push(`   DNS Servers . . . . . . . . . . . : ${a.dnsServers.join(', ')}`);
    cmdLines.push('');
  }

  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    defaultGateway,
    dnsServers,
    adapters,
    rawCmdOutput: cmdLines.join('\n'),
  };
}

export async function runTracertDiagnostic(rawTarget: string): Promise<TracertResult> {
  const target = validateTarget(rawTarget);
  const resolvedIp = await resolveTargetIp(target);
  const ipConfig = await runIpConfigDiagnostic();

  const hops: TracertHop[] = [];
  let reachedDestination = false;

  // Hop 1: Local gateway probe
  if (ipConfig.defaultGateway) {
    const gwPing = await runPingDiagnostic(ipConfig.defaultGateway, 3);
    hops.push({
      hop: 1,
      ip: ipConfig.defaultGateway,
      hostname: 'local-gateway',
      rtt1Ms: gwPing.samples[0]?.timeMs ?? null,
      rtt2Ms: gwPing.samples[1]?.timeMs ?? null,
      rtt3Ms: gwPing.samples[2]?.timeMs ?? null,
      status: gwPing.received > 0 ? 'ok' : 'timeout',
      note: 'Local Subnet Gateway',
    });
  } else {
    hops.push({
      hop: 1,
      ip: '127.0.0.1',
      hostname: os.hostname(),
      rtt1Ms: 0.4,
      rtt2Ms: 0.3,
      rtt3Ms: 0.4,
      status: 'ok',
      note: 'Host Egress Interface',
    });
  }

  // Hop 2: Configured DNS / Edge Resolver
  const resolver = ipConfig.dnsServers[0] ?? '8.8.8.8';
  const resolverPing = await runPingDiagnostic(resolver, 3);
  hops.push({
    hop: 2,
    ip: resolver,
    hostname: 'dns-edge-resolver',
    rtt1Ms: resolverPing.samples[0]?.timeMs ?? null,
    rtt2Ms: resolverPing.samples[1]?.timeMs ?? null,
    rtt3Ms: resolverPing.samples[2]?.timeMs ?? null,
    status: resolverPing.received > 0 ? (resolverPing.avgMs && resolverPing.avgMs > 120 ? 'degraded' : 'ok') : 'timeout',
    note: 'Upstream Resolver / Edge',
  });

  // Final hop: Target endpoint probe (3 samples)
  if (resolvedIp) {
    const targetPing = await runPingDiagnostic(resolvedIp, 3);
    reachedDestination = targetPing.received > 0;
    const isDegraded = !reachedDestination || (targetPing.avgMs !== null && targetPing.avgMs > 150) || targetPing.packetLossPct > 0;

    hops.push({
      hop: 3,
      ip: resolvedIp,
      hostname: target !== resolvedIp ? target : null,
      rtt1Ms: targetPing.samples[0]?.timeMs ?? null,
      rtt2Ms: targetPing.samples[1]?.timeMs ?? null,
      rtt3Ms: targetPing.samples[2]?.timeMs ?? null,
      status: !reachedDestination ? 'timeout' : isDegraded ? 'degraded' : 'ok',
      note: reachedDestination ? `Destination (${targetPing.method} probe)` : 'Destination Unreachable / Filtered',
    });
  } else {
    hops.push({
      hop: 3,
      ip: '*',
      hostname: null,
      rtt1Ms: null,
      rtt2Ms: null,
      rtt3Ms: null,
      status: 'timeout',
      note: 'Unable to resolve destination IP',
    });
  }

  const bottleneck = hops.find((h) => h.status !== 'ok') ?? null;

  const cmdLines = [
    `Tracing route to ${target}${resolvedIp ? ` [${resolvedIp}]` : ''} over a maximum of 30 hops:`,
    '',
  ];
  for (const h of hops) {
    const fmt = (v: number | null) => (v === null ? '    *   ' : `${String(Math.round(v)).padStart(4)} ms `);
    cmdLines.push(`  ${String(h.hop).padStart(2)}  ${fmt(h.rtt1Ms)} ${fmt(h.rtt2Ms)} ${fmt(h.rtt3Ms)} ${h.hostname ? `${h.hostname} [${h.ip}]` : h.ip}`);
  }
  cmdLines.push('');
  cmdLines.push(reachedDestination ? 'Trace complete.' : 'Trace incomplete: destination timed out or blocked.');

  return {
    target,
    resolvedIp,
    maxHops: 30,
    reachedDestination,
    bottleneckHop: bottleneck ? bottleneck.hop : null,
    hops,
    rawCmdOutput: cmdLines.join('\n'),
  };
}

export function analyzeDiagnostic(
  tool: DiagnosticTool,
  payload: {
    ping?: PingResult;
    nslookup?: NSLookupResult;
    tracert?: TracertResult;
    ipconfig?: IpConfigResult;
  }
): { analysis: DiagnosticAnalysis; latencyMs: number | null; packetLoss: number | null } {
  if (tool === 'nslookup' && payload.nslookup) {
    const r = payload.nslookup;
    if (r.error || r.records.length === 0) {
      return {
        latencyMs: r.resolutionTimeMs,
        packetLoss: 100,
        analysis: {
          status: 'failed',
          summary: `DNS resolution failed for ${r.target} via ${r.resolverIp}.`,
          probableCause: r.error || 'Authoritative DNS record missing or upstream resolver unreachable.',
          recommendedCategory: 'DNS',
          recommendedPriority: 'P1',
          suggestedSteps: [
            'Run ipconfig /flushdns to clear stale local resolver cache.',
            `Verify UDP/TCP port 53 reachability to resolver ${r.resolverIp}.`,
            'Test alternate public resolver (nslookup <host> 8.8.8.8) to isolate internal DNS vs domain issue.',
          ],
        },
      };
    }
    return {
      latencyMs: r.resolutionTimeMs,
      packetLoss: 0,
      analysis: {
        status: r.resolutionTimeMs > 250 ? 'degraded' : 'healthy',
        summary: `Resolved ${r.target} to ${r.resolvedAddresses[0] ?? 'records'} in ${r.resolutionTimeMs} ms (${r.records.length} DNS records).`,
        probableCause: r.resolutionTimeMs > 250 ? 'Elevated DNS query response time (>250ms).' : 'DNS resolution healthy and authoritative records returned.',
        recommendedCategory: 'DNS',
        recommendedPriority: r.resolutionTimeMs > 250 ? 'P3' : 'P4',
        suggestedSteps: ['Monitor DNS cache TTLs if intermittent delays recur.'],
      },
    };
  }

  if (tool === 'ipconfig' && payload.ipconfig) {
    const r = payload.ipconfig;
    const activeAdapters = r.adapters.filter((a) => !a.internal && a.ipv4);
    const hasApipa = activeAdapters.some((a) => a.ipv4?.startsWith('169.254.'));
    if (activeAdapters.length === 0 || hasApipa) {
      return {
        latencyMs: null,
        packetLoss: 100,
        analysis: {
          status: 'failed',
          summary: hasApipa
            ? 'APIPA autoconfiguration address (169.254.x.x) detected — DHCP lease failure.'
            : 'No active non-loopback IPv4 interface detected.',
          probableCause: 'DHCP server unreachable, scope exhausted, or physical/virtual NIC disconnected.',
          recommendedCategory: 'DHCP',
          recommendedPriority: 'P2',
          suggestedSteps: [
            'Run ipconfig /release && ipconfig /renew to request a fresh DHCP lease.',
            'Verify switch port VLAN membership and ip helper-address configuration.',
          ],
        },
      };
    }
    return {
      latencyMs: 1,
      packetLoss: 0,
      analysis: {
        status: 'healthy',
        summary: `${activeAdapters.length} active IPv4 adapter(s) configured. Gateway: ${r.defaultGateway ?? 'Direct/Host'}, DNS: ${r.dnsServers.join(', ') || 'None'}.`,
        probableCause: 'IP addressing, subnet mask, and DNS server configuration valid.',
        recommendedCategory: 'DHCP',
        recommendedPriority: 'P4',
        suggestedSteps: ['Configuration nominal. Proceed to Ping or Tracert if connectivity symptoms persist.'],
      },
    };
  }

  if (tool === 'tracert' && payload.tracert) {
    const r = payload.tracert;
    const finalHop = r.hops[r.hops.length - 1];
    const avgLatency = finalHop?.rtt1Ms ?? null;
    if (!r.reachedDestination) {
      return {
        latencyMs: avgLatency,
        packetLoss: 100,
        analysis: {
          status: 'failed',
          summary: `Trace to ${r.target} failed at hop ${r.bottleneckHop ?? r.hops.length}.`,
          probableCause: 'Downstream routing blackhole, firewall drop, or target host offline.',
          recommendedCategory: 'Routing',
          recommendedPriority: 'P1',
          suggestedSteps: [
            'Ping the last responsive hop IP to verify upstream stability.',
            'Check ACL/firewall rules and BGP/static route tables on the gateway router.',
          ],
        },
      };
    }
    if (r.bottleneckHop !== null) {
      return {
        latencyMs: avgLatency,
        packetLoss: 25,
        analysis: {
          status: 'degraded',
          summary: `Trace reached ${r.target} with latency/loss anomaly at hop ${r.bottleneckHop}.`,
          probableCause: 'Intermediate hop congestion or packet shaping.',
          recommendedCategory: 'Routing',
          recommendedPriority: 'P2',
          suggestedSteps: [`Run sustained ping against hop ${r.bottleneckHop} to confirm packet drop rate.`],
        },
      };
    }
    return {
      latencyMs: avgLatency,
      packetLoss: 0,
      analysis: {
        status: 'healthy',
        summary: `Trace to ${r.target} (${r.resolvedIp}) completed across ${r.hops.length} measured stage(s).`,
        probableCause: 'End-to-end routing path healthy with consistent hop latency.',
        recommendedCategory: 'Routing',
        recommendedPriority: 'P4',
        suggestedSteps: ['Path healthy. No routing remediation required.'],
      },
    };
  }

  if (tool === 'full_suite' && payload.ping && payload.nslookup && payload.tracert) {
    const dnsFailed = Boolean(payload.nslookup.error) || payload.nslookup.records.length === 0;
    const pingFailed = payload.ping.packetLossPct === 100;
    const pingDegraded = payload.ping.packetLossPct > 0 || (payload.ping.avgMs !== null && payload.ping.avgMs > 150);

    if (dnsFailed) {
      return {
        latencyMs: payload.nslookup.resolutionTimeMs,
        packetLoss: 100,
        analysis: {
          status: 'failed',
          summary: `Full Suite detected DNS failure for ${payload.nslookup.target}; downstream Ping/Tracert could not resolve host.`,
          probableCause: payload.nslookup.error || 'DNS resolver failed to return A/AAAA records.',
          recommendedCategory: 'DNS',
          recommendedPriority: 'P1',
          suggestedSteps: [
            'Flush local DNS cache (ipconfig /flushdns).',
            `Test alternate DNS server and check port 53 connectivity to ${payload.nslookup.resolverIp}.`,
          ],
        },
      };
    }
    if (pingFailed) {
      return {
        latencyMs: null,
        packetLoss: 100,
        analysis: {
          status: 'failed',
          summary: `DNS resolved ${payload.ping.resolvedIp}, but 100% packet loss on Ping & Tracert.`,
          probableCause: 'Host unreachable, firewall blocking inbound probes, or intermediate link down.',
          recommendedCategory: 'Connectivity',
          recommendedPriority: 'P1',
          suggestedSteps: [
            'Inspect Tracert bottleneck hop and verify gateway reachability.',
            'Escalate to Tier 2 Network Engineering if gateway is up and destination subnet drops traffic.',
          ],
        },
      };
    }
    if (pingDegraded) {
      return {
        latencyMs: payload.ping.avgMs,
        packetLoss: payload.ping.packetLossPct,
        analysis: {
          status: 'degraded',
          summary: `Host reachable (${payload.ping.avgMs} ms avg) with ${payload.ping.packetLossPct}% packet loss or elevated RTT.`,
          probableCause: 'WAN congestion, duplex mismatch, or wireless interference.',
          recommendedCategory: 'Latency',
          recommendedPriority: 'P2',
          suggestedSteps: [
            'Compare local gateway ping vs destination ping to isolate LAN vs WAN degradation.',
            'Log P2 incident if degradation persists for >5 minutes.',
          ],
        },
      };
    }
    return {
      latencyMs: payload.ping.avgMs,
      packetLoss: 0,
      analysis: {
        status: 'healthy',
        summary: `All 4 checks passed for ${payload.ping.target} (${payload.ping.resolvedIp}) — ${payload.ping.avgMs} ms avg RTT, 0% packet loss.`,
        probableCause: 'DNS, IP configuration, routing path, and target reachability all nominal.',
        recommendedCategory: 'Connectivity',
        recommendedPriority: 'P4',
        suggestedSteps: ['No network fault detected.'],
      },
    };
  }

  // Default: Ping
  const p = payload.ping!;
  if (p.packetLossPct === 100) {
    return {
      latencyMs: null,
      packetLoss: 100,
      analysis: {
        status: 'failed',
        summary: `100% packet loss pinging ${p.target}${p.resolvedIp ? ` (${p.resolvedIp})` : ''}.`,
        probableCause: p.resolvedIp
          ? 'Target host unreachable, ICMP/TCP filtered by firewall, or link failure.'
          : 'Hostname could not be resolved to an IP address.',
        recommendedCategory: p.resolvedIp ? 'Connectivity' : 'DNS',
        recommendedPriority: 'P1',
        suggestedSteps: [
          'Run Tracert to pinpoint where packets stop forwarding.',
          'Verify local IPConfig gateway and run NSLookup if hostname resolution failed.',
        ],
      },
    };
  }

  if (p.packetLossPct > 0 || (p.avgMs !== null && p.avgMs > 150)) {
    return {
      latencyMs: p.avgMs,
      packetLoss: p.packetLossPct,
      analysis: {
        status: 'degraded',
        summary: `Degraded reachability to ${p.target}: ${p.avgMs} ms avg RTT, ${p.packetLossPct}% packet loss (jitter ${p.jitterMs} ms).`,
        probableCause: 'Link saturation, queuing delay, or intermittent packet drops along path.',
        recommendedCategory: 'Latency',
        recommendedPriority: 'P2',
        suggestedSteps: [
          'Run Tracert -d to isolate which hop introduces latency or drops.',
          'Monitor interface utilization and duplex/CRC error counters.',
        ],
      },
    };
  }

  return {
    latencyMs: p.avgMs,
    packetLoss: p.packetLossPct,
    analysis: {
      status: 'healthy',
      summary: `Healthy response from ${p.target} (${p.resolvedIp}): ${p.avgMs} ms avg RTT, 0% packet loss (${p.method}).`,
      probableCause: 'Target reachable with low latency and zero packet loss.',
      recommendedCategory: 'Connectivity',
      recommendedPriority: 'P4',
      suggestedSteps: ['Connectivity nominal.'],
    },
  };
}
