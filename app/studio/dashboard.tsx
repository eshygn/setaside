'use client';

// The AG Studio dashboard: SetAside's theme, data, three custom widgets, saved layouts and the
// custom "SetAside analyst" agent. Studio owns the report being edited; this shell owns saved
// layouts, page tabs and mode (the same split as the AG Studio boilerplate's dashboard).

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AgStudioAiModule, enableStudioDevValidations, type AgReportState, type AgStudioApi, type AgStudioMode } from 'ag-studio';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';
import type { Snapshot } from '@/lib/service';
import { api as serverApi } from '../ui/api';
import { applyLicense } from '../ui/review-grid';
import { buildAgent } from './agent';
import { buildStudioData } from './data';
import { builtInLayout, initialLayouts, loadLayouts, newId, saveLayouts, titlesFor, upsertLayout, type StoredLayouts } from './layouts';
import { setTaxContext } from './store';
import { setAsideStudioTheme } from './theme';
import { setAsideWidgets } from './widgets';
import type { SetAsideRegistry } from './widgets/types';

if (process.env.NODE_ENV !== 'production') enableStudioDevValidations();

type Props = { snap: Snapshot; licenseKey?: string; aiKeyConfigured: boolean; onScenario: () => void };

const noSub = () => () => {};

export function Dashboard(props: Props) {
  const inBrowser = useSyncExternalStore(noSub, () => true, () => false);
  return inBrowser ? <StudioDashboard {...props} /> : null;
}

function StudioDashboard({ snap, licenseKey, onScenario }: Props) {
  applyLicense(licenseKey);
  const apiRef = useRef<AgStudioApi | null>(null);
  const snapRef = useRef(snap);
  const [store, setStore] = useState<StoredLayouts>(() => loadLayouts());
  const active = store.layouts.find((l) => l.id === store.activeId) ?? store.layouts[0];
  const [initialState] = useState<AgReportState>(() => active.state);
  const [state, setState] = useState<AgReportState>(active.state);
  const [mode, setMode] = useState<AgStudioMode>('view');
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [agentMode, setAgentMode] = useState<{ mode: string; detail: string; model: string } | null>(null);
  const [saved, setSaved] = useState(false);

  // Keep the widgets' tax context and the agent's view of the data current.
  useEffect(() => {
    snapRef.current = snap;
    setTaxContext({ preset: snap.preset, otherIncome: snap.settings.otherIncome, clock: snap.settings.clock, balance: snap.summary.balance, upliftBps: snap.settings.upliftBps });
  }, [snap]);

  const data = useMemo(() => buildStudioData(snap), [snap]);
  const widgets = useMemo(() => setAsideWidgets, []);
  const ai = useMemo(
    () =>
      buildAgent({
        snapshot: () => snapRef.current,
        onMode: (mode, detail, model) => setAgentMode({ mode, detail, model }),
        onWhatIf: async (upliftBps) => {
          await serverApi.settings({ upliftBps });
          onScenario();
        },
      }),
    [onScenario],
  );

  const persist = (next: StoredLayouts) => {
    setStore(next);
    saveLayouts(next);
  };
  const load = (layoutId: string, next = store) => {
    const layout = next.layouts.find((l) => l.id === layoutId);
    const studio = apiRef.current;
    if (!layout || !studio) return;
    studio.setState(layout.state);
    studio.clearHistory();
    persist({ ...next, activeId: layoutId });
  };
  const save = () => {
    const studio = apiRef.current;
    if (!studio) return;
    const current = studio.getState();
    persist(upsertLayout(store, { ...active, state: current, pageTitles: titlesFor(current, active.pageTitles), updatedAt: new Date().toISOString() }));
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };
  const saveAs = () => {
    const studio = apiRef.current;
    if (!studio) return;
    const name = window.prompt('Name this layout', `${active.name} (my version)`);
    if (!name) return;
    const current = studio.getState();
    persist(upsertLayout(store, { id: newId('layout'), name, pageTitles: titlesFor(current, active.pageTitles), state: current, updatedAt: new Date().toISOString() }));
  };
  const resetLayouts = () => {
    const next = initialLayouts();
    persist(next);
    apiRef.current?.setState(builtInLayout().state);
    apiRef.current?.clearHistory();
  };
  const selectPage = (pageId: string) => apiRef.current?.setState({ ...apiRef.current.getState(), selectedPageId: pageId });
  const addPage = () => {
    const studio = apiRef.current;
    if (!studio) return;
    const id = newId('page');
    const s = studio.getState();
    studio.setState({ ...s, pages: [...s.pages, { id }], selectedPageId: id });
    setMode('edit');
  };

  const aiOpen = state.panels?.ai?.collapsed === false;
  const toggleAi = () => {
    const studio = apiRef.current;
    if (!studio) return;
    const s = studio.getState();
    studio.setState({ ...s, panels: { ...s.panels, ai: { ...s.panels?.ai, collapsed: aiOpen } } });
  };

  const pageTitles = titlesFor(state, active.pageTitles);

  return (
    <div className="flex h-[calc(100vh-150px)] min-h-[640px] flex-col overflow-hidden rounded-2xl border border-sa-line bg-sa-paper">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-sa-line bg-sa-surface px-4 py-2">
        <label className="flex items-center gap-2 text-[12px] text-sa-muted">
          Layout
          <select value={store.activeId} onChange={(e) => load(e.target.value)} className="h-8 rounded-lg border border-sa-line bg-sa-paper px-2 text-[13px] font-medium text-sa-ink">
            {store.layouts.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <div className="mx-1 h-5 w-px bg-sa-line" />
        <div className="flex gap-1">
          {state.pages.map((p) => (
            <button
              key={p.id}
              onClick={() => selectPage(p.id)}
              className={`rounded-lg px-3 py-1.5 text-[13px] font-medium ${state.selectedPageId === p.id ? 'bg-sa-ink text-sa-paper' : 'text-sa-ink-2 hover:bg-sa-paper-2'}`}
            >
              {pageTitles[p.id]}
            </button>
          ))}
          <button onClick={addPage} className="rounded-lg px-2 py-1.5 text-[13px] text-sa-muted hover:bg-sa-paper-2" title="Add a page">
            +
          </button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {agentMode && (
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${agentMode.mode === 'live' ? 'bg-sa-mint text-sa-forest' : agentMode.mode === 'recorded' ? 'bg-sa-marigold-soft text-[#8a5a12]' : 'bg-sa-clay-soft text-sa-clay'}`} title={agentMode.detail}>
              Agent: {agentMode.mode === 'live' ? `Gemini ${agentMode.model.replace('gemini-', '')}` : agentMode.mode === 'recorded' ? 'recorded Gemini answer' : 'offline'}
            </span>
          )}
          <ToolButton onClick={toggleAi} active={aiOpen}>
            ✦ Ask SetAside
          </ToolButton>
          <ToolButton onClick={() => apiRef.current?.undo()} disabled={!history.canUndo} title="Undo">
            ↶
          </ToolButton>
          <ToolButton onClick={() => apiRef.current?.redo()} disabled={!history.canRedo} title="Redo">
            ↷
          </ToolButton>
          <ToolButton onClick={() => setMode(mode === 'edit' ? 'view' : 'edit')} active={mode === 'edit'}>
            {mode === 'edit' ? 'Done editing' : 'Edit layout'}
          </ToolButton>
          <ToolButton onClick={save}>{saved ? 'Saved ✓' : 'Save'}</ToolButton>
          <ToolButton onClick={saveAs}>Save as…</ToolButton>
          <ToolButton onClick={resetLayouts} title="Back to the built-in layout">
            Reset
          </ToolButton>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <AgStudioProvider licenseKey={licenseKey} modules={[AgStudioAiModule]}>
          <AgStudio<SetAsideRegistry>
            style={{ height: '100%', width: '100%' }}
            theme={setAsideStudioTheme}
            layout={{ widgetBorderEnabled: true }}
            data={data}
            widgets={widgets}
            ai={ai}
            initialState={initialState as AgReportState<SetAsideRegistry>}
            mode={mode}
            onApiReady={(e) => {
              apiRef.current = e.api as unknown as AgStudioApi;
            }}
            onStudioReady={(e) => setState(e.api.getState() as AgReportState)}
            onStateUpdated={(e) => {
              const { undo, redo } = e.api.getHistory();
              setState(e.state as AgReportState);
              setHistory({ canUndo: undo.length > 0, canRedo: redo.length > 0 });
            }}
          />
        </AgStudioProvider>
      </div>
    </div>
  );
}

function ToolButton(props: { onClick: () => void; disabled?: boolean; active?: boolean; title?: string; children: React.ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      className={`h-8 rounded-lg border px-3 text-[13px] font-medium transition disabled:opacity-35 ${props.active ? 'border-sa-forest bg-sa-forest text-sa-paper' : 'border-sa-line bg-sa-surface text-sa-ink-2 hover:border-sa-forest'}`}
    >
      {props.children}
    </button>
  );
}
