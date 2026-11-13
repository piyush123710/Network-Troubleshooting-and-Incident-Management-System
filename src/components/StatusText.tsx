import type { DiagnosticStatus, IncidentPriority, IncidentStatus } from '../types';
import { AlertTriangle, CheckCircle2, Clock, ShieldAlert, XCircle } from 'lucide-react';

export function PriorityLabel({ priority }: { priority: IncidentPriority }) {
  const styles: Record<IncidentPriority, string> = {
    P1: 'text-red-700 font-semibold',
    P2: 'text-amber-700 font-semibold',
    P3: 'text-blue-700 font-medium',
    P4: 'text-slate-600 font-medium',
  };
  const labels: Record<IncidentPriority, string> = {
    P1: 'P1 Critical',
    P2: 'P2 High',
    P3: 'P3 Medium',
    P4: 'P4 Low',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-xs tabular-nums whitespace-nowrap shrink-0 ${styles[priority]}`}>
      {priority === 'P1' && <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />}
      {priority === 'P2' && <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />}
      <span>{labels[priority]}</span>
    </span>
  );
}

export function IncidentStatusLabel({ status }: { status: IncidentStatus }) {
  const map: Record<IncidentStatus, { cls: string; icon: typeof Clock }> = {
    Open: { cls: 'text-red-700', icon: AlertTriangle },
    Investigating: { cls: 'text-amber-700', icon: Clock },
    Escalated: { cls: 'text-blue-700', icon: ShieldAlert },
    Resolved: { cls: 'text-emerald-700', icon: CheckCircle2 },
    Closed: { cls: 'text-slate-500', icon: CheckCircle2 },
  };
  const cfg = map[status] ?? map.Open;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${cfg.cls}`}>
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      <span>{status}</span>
    </span>
  );
}

export function DiagnosticStatusLabel({ status }: { status: DiagnosticStatus }) {
  if (status === 'healthy') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap shrink-0">
        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Healthy</span>
      </span>
    );
  }
  if (status === 'degraded') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap shrink-0">
        <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Degraded</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap shrink-0">
      <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
      <span>Failed</span>
    </span>
  );
}
