import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  BookOpen,
  Database,
  LayoutDashboard,
  Menu,
  Plus,
  X,
} from 'lucide-react';
import type { DashboardSummary, DiagnosticRunRecord, IncidentRecord, RunbookRecord } from './types';
import { OverviewView } from './components/OverviewView';
import { DiagnosticsView } from './components/DiagnosticsView';
import { IncidentsView } from './components/IncidentsView';
import { RunbooksView } from './components/RunbooksView';
import { SqlSchemaView } from './components/SqlSchemaView';
import { CreateIncidentModal, type IncidentDraft } from './components/CreateIncidentModal';

type NavTab = 'overview' | 'diagnostics' | 'incidents' | 'runbooks' | 'sql';

const NAV_ITEMS: Array<{ id: NavTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'diagnostics', label: 'Diagnostics', icon: Activity },
  { id: 'incidents', label: 'Incidents', icon: AlertOctagon },
  { id: 'runbooks', label: 'Runbooks', icon: BookOpen },
  { id: 'sql', label: 'SQL & Scripts', icon: Database },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticRunRecord[]>([]);
  const [runbooks, setRunbooks] = useState<RunbookRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedIncidentId, setSelectedIncidentId] = useState<number | null>(null);
  const [createModalDraft, setCreateModalDraft] = useState<Partial<IncidentDraft> | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [quickTarget, setQuickTarget] = useState<string | null>(null);
  const [autoRunTrigger, setAutoRunTrigger] = useState(0);

  const fetchAllData = useCallback(async () => {
    try {
      const [sumRes, incRes, diagRes, rbRes] = await Promise.all([
        fetch('/api/summary'),
        fetch('/api/incidents'),
        fetch('/api/diagnostics?limit=25'),
        fetch('/api/runbooks'),
      ]);
      if (sumRes.ok) setSummary(await sumRes.json());
      if (incRes.ok) setIncidents(await incRes.json());
      if (diagRes.ok) setDiagnostics(await diagRes.json());
      if (rbRes.ok) setRunbooks(await rbRes.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  function handleQuickDiagnose(target: string) {
    setQuickTarget(target);
    setAutoRunTrigger((n) => n + 1);
    setActiveTab('diagnostics');
  }

  function handleSelectIncidentFromOverview(id: number) {
    setSelectedIncidentId(id);
    setActiveTab('incidents');
  }

  function handleOpenCreateModal(draft: Partial<IncidentDraft> | null = null) {
    setCreateModalDraft(draft);
    setShowCreateModal(true);
  }

  function handleIncidentCreated(newId: number) {
    setShowCreateModal(false);
    setCreateModalDraft(null);
    setSelectedIncidentId(newId);
    setActiveTab('incidents');
    fetchAllData();
  }

  const activeNavLabel = NAV_ITEMS.find((n) => n.id === activeTab)?.label ?? 'Overview';

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-60 shrink-0 bg-white border-r border-slate-200">
        <div className="h-16 px-6 flex items-center border-b border-slate-200">
          <span className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            NetTrace
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-1" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-blue-50 text-blue-800'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-700' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 text-xs text-slate-500 space-y-1">
          <div className="font-medium text-slate-700">Diagnostic Stack</div>
          <div>Ping · Tracert · IPConfig · NSLookup</div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div className="fixed inset-0 bg-slate-900/40" onClick={() => setMobileMenuOpen(false)} />
          <aside className="relative w-64 max-w-full bg-white border-r border-slate-200 flex flex-col z-50">
            <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200">
              <span className="text-lg font-bold tracking-tight text-slate-900">NetTrace</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 text-slate-500 hover:text-slate-900"
                aria-label="Close navigation menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="p-3 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg ${
                      isActive ? 'bg-blue-50 text-blue-800' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Viewport */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-8 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-lg"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-slate-500">Operations</span>
              <span className="text-slate-300">/</span>
              <h1 className="font-semibold text-slate-900 truncate">{activeNavLabel}</h1>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleOpenCreateModal(null)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Log Incident</span>
          </button>
        </header>

        <main className="flex-1 p-4 sm:p-8 max-w-[1440px] w-full mx-auto">
          {loading ? (
            <div className="space-y-4">
              <div className="h-24 bg-white border border-slate-200 rounded-xl" />
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="h-28 bg-white border border-slate-200 rounded-xl" />
                <div className="h-28 bg-white border border-slate-200 rounded-xl" />
                <div className="h-28 bg-white border border-slate-200 rounded-xl" />
                <div className="h-28 bg-white border border-slate-200 rounded-xl" />
              </div>
            </div>
          ) : (
            <>
              {activeTab === 'overview' && (
                <OverviewView
                  summary={summary}
                  incidents={incidents}
                  recentDiagnostics={diagnostics}
                  onQuickDiagnose={handleQuickDiagnose}
                  onSelectIncident={handleSelectIncidentFromOverview}
                  onNavigate={(tab) => setActiveTab(tab)}
                />
              )}

              {activeTab === 'diagnostics' && (
                <DiagnosticsView
                  initialTarget={quickTarget}
                  autoRunTrigger={autoRunTrigger}
                  history={diagnostics}
                  onDiagnosticSaved={fetchAllData}
                  onCreateIncidentFromRun={(draft) => handleOpenCreateModal(draft)}
                />
              )}

              {activeTab === 'incidents' && (
                <IncidentsView
                  incidents={incidents}
                  selectedIncidentId={selectedIncidentId}
                  onSelectIncident={setSelectedIncidentId}
                  onRefresh={fetchAllData}
                  onOpenCreateModal={() => handleOpenCreateModal(null)}
                />
              )}

              {activeTab === 'runbooks' && (
                <RunbooksView runbooks={runbooks} onRefresh={fetchAllData} />
              )}

              {activeTab === 'sql' && <SqlSchemaView />}
            </>
          )}
        </main>
      </div>

      {showCreateModal && (
        <CreateIncidentModal
          initialDraft={createModalDraft}
          onClose={() => {
            setShowCreateModal(false);
            setCreateModalDraft(null);
          }}
          onCreated={handleIncidentCreated}
        />
      )}
    </div>
  );
}
