import { useCallback, useEffect, useRef, useState } from 'react';
import { Layers3, LayoutDashboard, Network, FileText, Fingerprint, Timer, ShieldAlert, NotebookPen, ShieldCheck, BookOpen, Search, Upload, FolderOpen, Download, Plus, Minus, Square, X, Command, ArrowRight, CheckCircle2, AlertCircle, LoaderCircle, ChevronDown } from 'lucide-react';
import type { Case, Job, Summary } from './types';
import type { PageProps, Selection } from './Pages';
import { Evidence, Entities, Findings, GraphPage, Guide, IntegrityPage, Notebook, Overview, Timeline } from './Pages';
import { Inspector } from './Inspector';
import { bytes, useData } from './shared';

const NAV = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, count: '' },
  { id: 'graph', label: 'Evidence graph', icon: Network, count: 'edges' },
  { id: 'evidence', label: 'Evidence vault', icon: FileText, count: 'artifacts' },
  { id: 'entities', label: 'Entity index', icon: Fingerprint, count: 'entities' },
  { id: 'timeline', label: 'Event timeline', icon: Timer, count: 'events' },
  { id: 'findings', label: 'Review findings', icon: ShieldAlert, count: 'findings' },
  { id: 'notebook', label: 'Analyst notebook', icon: NotebookPen, count: 'notes' },
  { id: 'integrity', label: 'Integrity & export', icon: ShieldCheck, count: '' },
];

export function App() {
  const [cases, setCases] = useState<Case[]>([]), [caseId, setCaseId] = useState(''), [view, setView] = useState(localStorage.getItem('atlas-view') || 'overview');
  const [revision, setRevision] = useState(0), [selection, setSelection] = useState<Selection | null>(null), [job, setJob] = useState<Job | null>(null);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null), [engineStopped, setEngineStopped] = useState(false), [dragging, setDragging] = useState(false), [exporting, setExporting] = useState(false);
  const [createOpen, setCreateOpen] = useState(false), [name, setName] = useState(''), [description, setDescription] = useState(''), [creating, setCreating] = useState(false);
  const [palette, setPalette] = useState(false), [commandQuery, setCommandQuery] = useState('');
  const completedJobs = useRef(new Set<string>()), toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), dragCount = useRef(0);
  const onError = useCallback((message: string) => { setToast({ message, error: true }); clearTimeout(toastTimer.current); }, []);
  const notify = useCallback((message: string) => { setToast({ message, error: false }); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 6000); }, []);
  const update = useCallback(() => setRevision(r => r + 1), []);
  const summary = useData<Summary>(caseId ? `/cases/${caseId}/summary` : '/health', revision, onError).data;
  const counts = summary && 'counts' in summary ? summary.counts : {};

  useEffect(() => {
    window.atlas.api<Case[]>('/cases').then(items => { setCases(items); const saved = localStorage.getItem('atlas-case'); setCaseId(items.find(c => c.id === saved)?.id || items[0]?.id || ''); }).catch(e => onError(e.message));
    return window.atlas.onEngineStopped(() => setEngineStopped(true));
  }, [onError]);
  useEffect(() => { if (caseId) localStorage.setItem('atlas-case', caseId); setSelection(null); }, [caseId]);
  useEffect(() => { localStorage.setItem('atlas-view', view); }, [view]);
  useEffect(() => {
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const jobs = await window.atlas.api<Job[]>('/jobs');
        if (!alive) return;
        const running = jobs.find(j => j.status === 'running');
        setJob(running || jobs.at(-1) || null);
        for (const done of jobs.filter(j => j.status !== 'running')) {
          if (!completedJobs.current.has(done.id)) { completedJobs.current.add(done.id); update(); if (done.status === 'failed') onError(`Import failed: ${done.errors.join('; ')}`); else notify(`${done.status === 'cancelled' ? 'Import cancelled' : 'Import complete'}: ${done.imported} added, ${done.duplicates} unchanged, ${done.skipped} skipped.`); }
        }
      } catch { /* Engine-stop event gives a persistent banner. */ }
    }, 1000);
    return () => { alive = false; clearInterval(timer); };
  }, [notify, onError, update]);
  async function importFiles(folder = false) { if (!caseId) return; try { const newJob = await window.atlas.importFiles(caseId, folder); if (newJob) setJob(newJob); } catch (e) { onError((e as Error).message); } }
  async function exportCase() { if (!caseId || exporting) return; setExporting(true); try { const result = await window.atlas.exportCase(caseId); if (result) notify('Evidence bundle exported: ' + result.path); } catch (e) { onError((e as Error).message); } finally { setExporting(false); } }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const editable = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPalette(p => !p); setCommandQuery(''); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); importFiles(event.shiftKey); }
      if ((event.ctrlKey || event.metaKey) && /^[1-8]$/.test(event.key) && !editable) { event.preventDefault(); setView(NAV[Number(event.key) - 1].id); }
      if (event.key === 'Escape') { setPalette(false); setCreateOpen(false); setSelection(null); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [caseId]);
  async function createCase(event: React.FormEvent) { event.preventDefault(); if (!name.trim()) return; setCreating(true); try { const created = await window.atlas.api<Case>('/cases', 'POST', { name, description }); setCases(await window.atlas.api<Case[]>('/cases')); setCaseId(created.id); setView('overview'); setCreateOpen(false); setName(''); setDescription(''); update(); } catch (e) { onError((e as Error).message); } finally { setCreating(false); } }
  function navigate(id: string) { setView(id); }
  const current = cases.find(c => c.id === caseId), props: PageProps = { caseId, revision, onError, onSelect: setSelection, navigate, notify };
  const running = job?.status === 'running';
  const commands = [
    ...NAV.map(n => ({ label: n.label, icon: n.icon, shortcut: `Ctrl+${NAV.indexOf(n) + 1}`, run: () => navigate(n.id) })),
    { label: 'Import evidence files', icon: Upload, shortcut: 'Ctrl+O', run: () => importFiles() },
    { label: 'Import evidence folder', icon: FolderOpen, shortcut: 'Ctrl+Shift+O', run: () => importFiles(true) },
    { label: 'Export evidence bundle', icon: Download, shortcut: '', run: exportCase },
    { label: 'Create a new case', icon: Plus, shortcut: '', run: () => setCreateOpen(true) },
    { label: 'Workbench guide', icon: BookOpen, shortcut: '', run: () => navigate('guide') },
  ].filter(c => c.label.toLowerCase().includes(commandQuery.toLowerCase()));
  return <div className={`app ${selection ? 'with-inspector' : ''}`} onDragEnter={event => { event.preventDefault(); if (event.dataTransfer.types.includes('Files')) { dragCount.current++; setDragging(true); } }} onDragLeave={event => { event.preventDefault(); dragCount.current--; if (dragCount.current <= 0) { setDragging(false); dragCount.current = 0; } }} onDragOver={event => event.preventDefault()} onDrop={async event => { event.preventDefault(); setDragging(false); dragCount.current = 0; if (caseId && event.dataTransfer.files.length) { try { const imported = await window.atlas.importDropped(caseId, Array.from(event.dataTransfer.files)); if (imported) setJob(imported); } catch (e) { onError((e as Error).message); } } }}>
    <div className="titlebar"><div className="titlebar-brand"><Layers3 size={17} /><strong>ATLAS</strong><span>EVIDENCE WORKBENCH</span></div><span className="titlebar-center">{current?.name || 'Local investigation'}</span><div className="window-controls"><button aria-label="Minimize window" onClick={() => window.atlas.window('minimize')}><Minus size={15} /></button><button aria-label="Maximize window" onClick={() => window.atlas.window('maximize')}><Square size={11} /></button><button aria-label="Close window" onClick={() => window.atlas.window('close')}><X size={17} /></button></div></div>
    <aside className="sidebar"><div className="workspace-label">WORKSPACE <span>01</span></div><div className="case-selector"><span className="case-symbol"><Layers3 size={18} /></span><select aria-label="Active case" value={caseId} onChange={e => setCaseId(e.target.value)}>{cases.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><ChevronDown size={13} /></div><button className="new-case" onClick={() => setCreateOpen(true)}><Plus size={14} /> New investigation</button><div className="nav-label">INVESTIGATE</div><nav>{NAV.map(n => <button key={n.id} className={view === n.id ? 'active' : ''} onClick={() => navigate(n.id)} title={`Ctrl+${NAV.indexOf(n) + 1}`}><n.icon size={17} /><span>{n.label}</span>{n.count && <small>{counts[n.count] || 0}</small>}</button>)}</nav><div className="sidebar-bottom"><button onClick={() => navigate('guide')} className={view === 'guide' ? 'active' : ''}><BookOpen size={16} /> Workbench guide</button><div className="offline-card"><span className="live-dot" /><div><strong>Offline by design</strong><span>Your evidence stays here.</span></div><ShieldCheck size={15} /></div><div className="version">ATLAS 1.0.0 <span>LOCAL ENGINE</span></div></div></aside>
    <div className="workspace"><header className="toolbar"><div className="breadcrumbs"><span>Workspace</span><span>/</span><strong>{NAV.find(n => n.id === view)?.label || 'Workbench guide'}</strong></div><div className="toolbar-actions"><button className="command-trigger" aria-label="Open command palette" onClick={() => { setPalette(true); setCommandQuery(''); }}><Search size={15} /><span>Commands</span><kbd>Ctrl K</kbd></button><button className="export-trigger" disabled={exporting || !caseId} title="Export evidence bundle" aria-label="Export evidence bundle" onClick={exportCase}>{exporting ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}</button><button className="folder-trigger" disabled={running || !caseId} title="Import folder" aria-label="Import folder" onClick={() => importFiles(true)}><FolderOpen size={16} /></button><button className="primary" disabled={running || !caseId} onClick={() => importFiles()}><Upload size={15} /> Import evidence</button></div></header>
      {engineStopped && <div className="engine-banner"><AlertCircle size={17} />Analysis engine stopped. Restart Atlas to continue. Preserved evidence remains on disk.</div>}
      <main className={view === 'graph' ? 'main-graph' : ''} key={caseId + view}>{!caseId ? <div className="loading"><LoaderCircle className="spin" /> Opening workspace…</div> : view === 'overview' ? <Overview {...props} /> : view === 'graph' ? <GraphPage {...props} selection={selection} /> : view === 'evidence' ? <Evidence {...props} /> : view === 'entities' ? <Entities {...props} /> : view === 'timeline' ? <Timeline {...props} /> : view === 'findings' ? <Findings {...props} onUpdate={update} /> : view === 'notebook' ? <Notebook {...props} onUpdate={update} /> : view === 'integrity' ? <IntegrityPage {...props} onExport={exportCase} /> : <Guide />}</main>
    </div>
    {selection && caseId && <Inspector selection={selection} caseId={caseId} revision={revision} onClose={() => setSelection(null)} onSelect={setSelection} onError={onError} notify={notify} onUpdate={update} />}
    <footer className="statusbar"><div><span className={`live-dot ${engineStopped ? 'danger' : ''}`} />{engineStopped ? 'Engine unavailable' : 'Engine ready'}<span className="status-divider" />{counts.artifacts || 0} files · {counts.entities || 0} entities</div><span>SQLite FTS5 <span className="status-divider" /> Source bytes preserved <span className="status-divider" /> UTC</span></footer>
    {running && <div className="import-progress"><div><LoaderCircle size={18} className="spin" /><strong>Analyzing evidence</strong><button aria-label="Cancel import" onClick={() => window.atlas.api(`/jobs/${job!.id}/cancel`, 'POST').catch(e => onError(e.message))}>Cancel</button></div><p>{job!.current}</p><div className="progress-indeterminate" /><span>{job!.imported} added · {job!.duplicates} unchanged · {job!.skipped} skipped · {bytes(job!.bytes)}</span></div>}
    {!running && job && job.skipped > 0 && <button className="import-skips" onClick={() => onError(job.errors.join('\n'))}>{job.skipped} import skips — inspect details</button>}
    {toast && <div className={`toast ${toast.error ? 'error' : 'success'}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}<span>{toast.message}</span><button aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={15} /></button></div>}
    {dragging && <div className="drop-overlay"><Upload size={42} /><h2>Drop source evidence</h2><p>Files and folders · preserved before analysis</p></div>}
    {createOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setCreateOpen(false); }}><form className="modal create-modal" onSubmit={createCase}><div className="modal-heading"><div className="section-label">NEW INVESTIGATION</div><button type="button" aria-label="Close new case" onClick={() => setCreateOpen(false)}><X size={17} /></button></div><h2>Give the case a name.</h2><p>Separate evidence, notes and history in a local workspace.</p><label>Case name<input autoFocus required aria-label="Case name" placeholder="e.g. NORTHSTAR / 018" value={name} onChange={e => setName(e.target.value)} maxLength={120} /></label><label>Briefing <span className="muted">optional</span><textarea aria-label="Case briefing" placeholder="What are you investigating?" value={description} onChange={e => setDescription(e.target.value)} maxLength={5000} /></label><button className="primary" type="submit" disabled={creating || !name.trim()}><Plus size={16} /> {creating ? 'Creating…' : 'Create investigation'}</button></form></div>}
    {palette && <div className="modal-backdrop palette-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setPalette(false); }}><div className="command-palette" role="dialog" aria-label="Command palette"><div className="palette-input"><Command size={20} /><input autoFocus aria-label="Search commands" placeholder="Where do you want to go?" value={commandQuery} onChange={e => setCommandQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && commands.length) { setPalette(false); commands[0].run(); } }} /><kbd>Esc</kbd></div><div className="palette-commands">{commands.map(c => <button key={c.label} onClick={() => { setPalette(false); c.run(); }}><c.icon size={17} /><span>{c.label}</span>{c.shortcut && <kbd>{c.shortcut}</kbd>}<ArrowRight size={14} /></button>)}{!commands.length && <p>No matching commands.</p>}</div><div className="palette-footer">Enter to run first result · Click any command</div></div></div>}
  </div>;
}
