import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Network,
  Search,
  TerminalSquare,
  NotebookPen,
  Clock3,
  PanelLeft,
  PanelRight,
  FileUp,
  FolderOpen,
  Download,
  Plus,
  Minus,
  Square,
  X,
  BookOpen,
  AlertCircle,
  Check,
  LoaderCircle,
  Ellipsis,
  Files,
  ChevronRight,
} from 'lucide-react';
import type { Artifact, Case, Job, Summary } from './types';
import type { PageProps, Selection } from './Pages';
import {
  Evidence,
  Entities,
  Findings,
  GraphPage,
  Guide,
  IntegrityPage,
  Notebook,
  Overview,
  Timeline,
} from './Pages';
import { Inspector } from './Inspector';
import { EvidenceDocument } from './Document';
import { FileExplorer, useFiles } from './FileExplorer';
import { ancestors, buildTree, type TreeNode } from './fileTree';
import {
  ContextMenu,
  Modal,
  Palette,
  PaneLayout,
  ResizeHandle,
  TabStart,
  type MenuItem,
  type MenuState,
  type PaletteItem,
  type PaneActions,
} from './Chrome';
import {
  activate,
  activeLeaf,
  activeTab,
  closeTab,
  cycleTab,
  identity,
  initialWorkspace,
  leaves,
  moveTab,
  openEntry,
  reopenTab,
  resizeSplit,
  restoreWorkspace,
  setTab,
  splitPane,
  VIEWS,
  viewEntry,
  type Entry,
  type OpenMode,
  type Tab,
  type ViewId,
  type Workspace,
} from './workspace';
import { bytes, useData } from './shared';

export function App() {
  const [cases, setCases] = useState<Case[]>([]),
    [caseId, setCaseId] = useState(''),
    [revision, setRevision] = useState(0),
    [job, setJob] = useState<Job | null>(null);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null),
    [engineStopped, setEngineStopped] = useState(false),
    [dragging, setDragging] = useState(false),
    [exporting, setExporting] = useState(false);
  const [createOpen, setCreateOpen] = useState(false),
    [name, setName] = useState(''),
    [description, setDescription] = useState(''),
    [creating, setCreating] = useState(false);
  const completed = useRef(new Set<string>()),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    dragCount = useRef(0);
  const onError = useCallback((message: string) => {
    setToast({ message, error: true });
    clearTimeout(toastTimer.current);
  }, []);
  const notify = useCallback((message: string) => {
    setToast({ message, error: false });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);
  const update = useCallback(() => setRevision((r) => r + 1), []);
  useEffect(() => {
    window.atlas
      .api<Case[]>('/cases')
      .then((items) => {
        setCases(items);
        const saved = localStorage.getItem('atlas-case');
        setCaseId(items.find((c) => c.id === saved)?.id || items[0]?.id || '');
      })
      .catch((e) => onError(e.message));
    window.atlas
      .api<Job[]>('/jobs')
      .then((items) => {
        for (const item of items) if (item.status !== 'running') completed.current.add(item.id);
      })
      .catch(() => {});
    return window.atlas.onEngineStopped(() => setEngineStopped(true));
  }, [onError]);
  useEffect(() => {
    if (caseId) localStorage.setItem('atlas-case', caseId);
  }, [caseId]);
  useEffect(() => {
    let live = true;
    const timer = setInterval(async () => {
      try {
        const items = await window.atlas.api<Job[]>('/jobs');
        if (!live) return;
        setJob(items.find((j) => j.status === 'running') || items.at(-1) || null);
        for (const item of items.filter((j) => j.status !== 'running'))
          if (!completed.current.has(item.id)) {
            completed.current.add(item.id);
            update();
            if (item.status === 'failed') onError('Import failed: ' + item.errors.join('; '));
            else
              notify(
                `${item.status === 'cancelled' ? 'Import cancelled' : 'Import complete'}: ${item.imported} added, ${item.duplicates} unchanged, ${item.skipped} skipped.`,
              );
          }
      } catch {}
    }, 750);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [notify, onError, update]);
  async function importFiles(folder = false) {
    if (!caseId) return;
    try {
      const next = await window.atlas.importFiles(caseId, folder);
      if (next) setJob(next);
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function exportCase() {
    if (!caseId || exporting) return;
    setExporting(true);
    try {
      const result = await window.atlas.exportCase(caseId);
      if (result) notify('Evidence bundle exported: ' + result.path);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  async function createCase(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const created = await window.atlas.api<Case>('/cases', 'POST', { name, description });
      setCases(await window.atlas.api<Case[]>('/cases'));
      setCaseId(created.id);
      setCreateOpen(false);
      setName('');
      setDescription('');
      update();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }
  const current = cases.find((c) => c.id === caseId),
    running = job?.status === 'running';
  return (
    <div
      className="app"
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          dragCount.current++;
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          dragCount.current--;
          if (dragCount.current <= 0) {
            setDragging(false);
            dragCount.current = 0;
          }
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={async (e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(false);
        dragCount.current = 0;
        if (caseId && e.dataTransfer.files.length) {
          try {
            const next = await window.atlas.importDropped(caseId, Array.from(e.dataTransfer.files));
            if (next) setJob(next);
          } catch (error) {
            onError((error as Error).message);
          }
        }
      }}
    >
      {current ? (
        <CaseWorkspace
          key={caseId}
          current={current}
          cases={cases}
          revision={revision}
          update={update}
          onSwitch={setCaseId}
          onCreate={() => setCreateOpen(true)}
          onImport={importFiles}
          onExport={exportCase}
          onError={onError}
          notify={notify}
          engineStopped={engineStopped}
          job={job}
          exporting={exporting}
        />
      ) : (
        <div className="opening-workspace">
          <LoaderCircle className="spin" size={20} />
          <span>Opening Atlas…</span>
        </div>
      )}
      {toast && (
        <div
          className={'toast ' + (toast.error ? 'error' : '')}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <AlertCircle size={16} /> : <Check size={16} />}
          <span>{toast.message}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast(null)}>
            <X size={15} />
          </button>
        </div>
      )}
      {dragging && (
        <div className="drop-overlay">
          <FileUp size={32} />
          <h2>Import sources</h2>
          <p>Files, folders and Obsidian vaults</p>
        </div>
      )}
      {createOpen && (
        <Modal label="New investigation" onClose={() => setCreateOpen(false)}>
          <form className="create-case" onSubmit={createCase}>
            <div className="modal-heading">
              <h2>New investigation</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Close new case"
                onClick={() => setCreateOpen(false)}
              >
                <X size={17} />
              </button>
            </div>
            <p>Keep sources, observations and history together.</p>
            <label>
              Name
              <input
                autoFocus
                required
                aria-label="Case name"
                placeholder="Investigation name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
              />
            </label>
            <label>
              Briefing
              <textarea
                aria-label="Case briefing"
                placeholder="Optional briefing"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={5000}
              />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
              <button className="primary" type="submit" disabled={creating || !name.trim()}>
                {creating ? 'Creating…' : 'Create investigation'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

type CaseWorkspaceProps = {
  current: Case;
  cases: Case[];
  revision: number;
  update: () => void;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onImport: (folder?: boolean) => void;
  onExport: () => void;
  onError: (s: string) => void;
  notify: (s: string) => void;
  engineStopped: boolean;
  job: Job | null;
  exporting: boolean;
};
function CaseWorkspace(props: CaseWorkspaceProps) {
  const { current, revision, onError, notify } = props;
  const [workspace, setWorkspace] = useState(() =>
      restoreWorkspace(
        localStorage.getItem('atlas-workspace-v2:' + current.id),
        localStorage.getItem('atlas-case') === current.id
          ? localStorage.getItem('atlas-view') || undefined
          : undefined,
      ),
    ),
    [palette, setPalette] = useState<'commands' | 'files' | null>(null),
    [menu, setMenu] = useState<MenuState | null>(null),
    [importDetails, setImportDetails] = useState(false);
  const stateRef = useRef(workspace);
  stateRef.current = workspace;
  const closeMenu = useCallback(() => setMenu(null), []);
  const { files, loading } = useFiles(current.id, revision, onError),
    { data: summary } = useData<Summary>(`/cases/${current.id}/summary`, revision, onError);
  const counts = summary?.counts || {},
    pane = activeLeaf(workspace),
    tab = activeTab(workspace),
    running = props.job?.status === 'running';
  const selection: Selection | null =
    tab && tab.kind !== 'view'
      ? { id: tab.resourceId, kind: tab.kind, line: tab.line }
      : (tab?.state.selection as Selection) || null;
  const patch = (values: Partial<Workspace>) => setWorkspace((s) => ({ ...s, ...values }));
  useEffect(() => {
    try {
      localStorage.setItem('atlas-workspace-v2:' + current.id, JSON.stringify(workspace));
      const selected = activeTab(workspace);
      if (selected?.kind === 'view') localStorage.setItem('atlas-view', selected.view);
    } catch {
      onError('Workspace layout could not be saved. Evidence remains preserved.');
    }
  }, [workspace, current.id, onError]);
  const focusPane = (id?: string) =>
    setTimeout(
      () =>
        document
          .querySelector<HTMLElement>(`[data-pane-id="${id || stateRef.current.activePane}"]`)
          ?.focus(),
      0,
    );
  function open(entry: Entry, mode: OpenMode = 'tab', target = stateRef.current.activePane) {
    setWorkspace((s) => openEntry(s, entry, mode, target));
  }
  function navigate(view: ViewId, newTab = false, target?: string) {
    setWorkspace((s) => {
      if (!newTab && !target) {
        const match = leaves(s.root)
          .flatMap((l) => l.tabs.map((t) => ({ leaf: l, tab: t })))
          .find((x) => x.tab.kind === 'view' && x.tab.view === view);
        if (match) return activate(s, match.leaf.id, match.tab.id);
      }
      return openEntry(s, viewEntry(view), 'tab', target || s.activePane);
    });
  }
  function source(artifact: Artifact, mode: OpenMode = 'preview', target?: string) {
    open({ kind: 'artifact', resourceId: artifact.id, title: artifact.name }, mode, target);
  }
  function select(value: Selection | null, target = stateRef.current.activePane, newTab = false) {
    if (!value) return;
    const file = files.find((f) => f.id === value.id);
    open(
      {
        kind: value.kind,
        resourceId: value.id,
        title: file?.name || 'Indicator',
        line: value.line,
      },
      newTab ? 'tab' : 'preview',
      target,
    );
  }
  function reveal(id: string) {
    const path = ancestors(buildTree(files), id) || [];
    setWorkspace((s) => ({
      ...s,
      leftVisible: true,
      leftTab: 'files',
      expanded: [...new Set([...s.expanded, ...path])],
    }));
    setTimeout(
      () => document.querySelector<HTMLElement>('[aria-label="Evidence file tree"]')?.focus(),
      0,
    );
  }
  function split(axis: 'row' | 'column', target = stateRef.current.activePane) {
    const next = splitPane(stateRef.current, target, axis);
    setWorkspace(next);
    focusPane(next.activePane);
  }
  function showMenu(
    e: React.MouseEvent | React.KeyboardEvent,
    items: MenuItem[],
    label = 'Context menu',
  ) {
    e.preventDefault();
    e.stopPropagation();
    const origin = (e.currentTarget.closest('[tabindex]') || e.currentTarget) as HTMLElement,
      rect = e.currentTarget.getBoundingClientRect();
    setMenu({
      x: 'clientX' in e ? e.clientX : rect.left + 12,
      y: 'clientY' in e ? e.clientY : rect.bottom,
      items,
      label,
      origin,
    });
  }
  function close(paneId: string, tabId: string) {
    setWorkspace((s) => closeTab(s, paneId, tabId, true));
  }
  function tabMenu(e: React.MouseEvent | React.KeyboardEvent, paneId: string, chosen?: Tab) {
    const leaf = leaves(stateRef.current.root).find((l) => l.id === paneId)!,
      target = chosen || leaf.tabs.find((t) => t.id === leaf.active);
    showMenu(
      e,
      [
        {
          label: 'New tab',
          shortcut: 'Ctrl T',
          run: () => open(viewEntry('start'), 'tab', paneId),
        },
        {
          label: 'Split right',
          shortcut: 'Ctrl \\',
          run: () => split('row', paneId),
          divider: true,
        },
        { label: 'Split down', shortcut: 'Ctrl Shift \\', run: () => split('column', paneId) },
        {
          label: target?.pinned ? 'Unpin tab' : 'Pin tab',
          disabled: !target,
          run: () =>
            target &&
            setWorkspace((s) =>
              setTab(s, paneId, target.id, { pinned: !target.pinned, preview: false }),
            ),
          divider: true,
        },
        {
          label: 'Keep tab open',
          disabled: !target || !target.preview,
          run: () =>
            target && setWorkspace((s) => setTab(s, paneId, target.id, { preview: false })),
        },
        {
          label: 'Move to next pane',
          disabled: !target || leaves(stateRef.current.root).length < 2,
          run: () => {
            if (!target) return;
            setWorkspace((s) => {
              const all = leaves(s.root),
                index = all.findIndex((l) => l.id === paneId);
              return moveTab(s, paneId, target.id, all[(index + 1) % all.length].id);
            });
          },
        },
        {
          label: 'Reveal in file explorer',
          disabled: target?.kind !== 'artifact',
          run: () => {
            if (target?.kind === 'artifact') reveal(target.resourceId);
          },
        },
        {
          label: 'Close tab',
          shortcut: 'Ctrl W',
          disabled: !target,
          run: () => target && close(paneId, target.id),
          divider: true,
        },
        {
          label: 'Close other tabs',
          disabled: !target,
          run: () =>
            setWorkspace((s) =>
              leaf.tabs
                .filter((t) => t.id !== target?.id)
                .reduce((next, t) => closeTab(next, paneId, t.id), s),
            ),
        },
        {
          label: 'Close tabs to the right',
          disabled: !target,
          run: () =>
            setWorkspace((s) =>
              leaf.tabs
                .slice(leaf.tabs.findIndex((t) => t.id === target?.id) + 1)
                .reduce((next, t) => closeTab(next, paneId, t.id), s),
            ),
        },
        {
          label: 'Reopen closed tab',
          shortcut: 'Ctrl Shift T',
          disabled: !workspace.closed.length,
          run: () => setWorkspace(reopenTab),
        },
      ],
      'Tab context menu',
    );
  }
  function fileMenu(e: React.MouseEvent | React.KeyboardEvent, node: TreeNode) {
    const file = node.artifact;
    if (!file) {
      showMenu(
        e,
        [
          {
            label: workspace.expanded.includes(node.id) ? 'Collapse folder' : 'Expand folder',
            run: () =>
              patch({
                expanded: workspace.expanded.includes(node.id)
                  ? workspace.expanded.filter((x) => x !== node.id)
                  : [...workspace.expanded, node.id],
              }),
          },
          {
            label: 'Copy folder path',
            run: () => window.atlas.copy(node.path).catch((error) => onError(error.message)),
          },
        ],
        'Folder context menu',
      );
      return;
    }
    showMenu(
      e,
      [
        { label: 'Open', run: () => source(file) },
        { label: 'Open in new tab', run: () => source(file, 'tab') },
        { label: 'Open to the right', run: () => source(file, 'split-right') },
        { label: 'Open below', run: () => source(file, 'split-down') },
        {
          label: 'Show properties',
          run: () => {
            source(file);
            patch({ rightVisible: true, rightTab: 'properties' });
          },
          divider: true,
        },
        {
          label: 'Copy source path',
          run: () =>
            window.atlas
              .copy(file.path)
              .then(() => notify('Source path copied.'))
              .catch((error) => onError(error.message)),
        },
        {
          label: 'Copy SHA-256',
          run: () =>
            window.atlas
              .copy(file.sha256)
              .then(() => notify('SHA-256 copied.'))
              .catch((error) => onError(error.message)),
        },
      ],
      'File context menu',
    );
  }
  const actions: PaneActions = {
    activate: (id, tabId) => setWorkspace((s) => activate(s, id, tabId)),
    close,
    keep: (id, tabId) => setWorkspace((s) => setTab(s, id, tabId, { preview: false })),
    context: tabMenu,
    newTab: (id) => open(viewEntry('start'), 'tab', id),
    move: (from, id, to, before) => setWorkspace((s) => moveTab(s, from, id, to, before)),
    splitDrop: (id, axis, from, tabId, before) =>
      setWorkspace((s) => {
        const split = splitPane(s, id, axis, false, before);
        return moveTab(split, from, tabId, split.activePane);
      }),
    resourceDrop: (id, entry, mode) => open(entry, mode || 'tab', id),
    resize: (id, ratio) => setWorkspace((s) => resizeSplit(s, id, ratio)),
  };
  const commands: PaletteItem[] = [
    ...VIEWS.filter((v) => v[0] !== 'start').map(([view, label]) => ({
      id: view,
      label,
      entry: viewEntry(view),
      run: (newTab: boolean) => navigate(view, newTab),
    })),
    {
      id: 'quick',
      label: 'Open file: Quick switcher',
      shortcut: 'Ctrl O',
      run: () => setPalette('files'),
    },
    {
      id: 'newtab',
      label: 'Workspace: New tab',
      shortcut: 'Ctrl T',
      run: () => open(viewEntry('start')),
    },
    {
      id: 'splitright',
      label: 'Workspace: Split right',
      shortcut: 'Ctrl \\',
      run: () => split('row'),
    },
    {
      id: 'splitdown',
      label: 'Workspace: Split down',
      shortcut: 'Ctrl Shift \\',
      run: () => split('column'),
    },
    {
      id: 'left',
      label: 'Workspace: Toggle left sidebar',
      shortcut: 'Ctrl Shift L',
      run: () => setWorkspace((s) => ({ ...s, leftVisible: !s.leftVisible })),
    },
    {
      id: 'right',
      label: 'Workspace: Toggle right sidebar',
      shortcut: 'Ctrl Shift R',
      run: () => setWorkspace((s) => ({ ...s, rightVisible: !s.rightVisible })),
    },
    {
      id: 'explorer',
      label: 'Files: Focus file explorer',
      shortcut: 'Ctrl Shift E',
      run: () => {
        patch({ leftVisible: true, leftTab: 'files' });
        setTimeout(
          () => document.querySelector<HTMLElement>('[aria-label="Evidence file tree"]')?.focus(),
          0,
        );
      },
    },
    {
      id: 'search',
      label: 'Search: Search all evidence',
      shortcut: 'Ctrl Shift F',
      run: () => patch({ leftVisible: true, leftTab: 'search' }),
    },
    {
      id: 'import',
      label: 'Import evidence files',
      shortcut: 'Ctrl Shift I',
      run: () => props.onImport(),
    },
    {
      id: 'folder',
      label: 'Import evidence folder / Obsidian vault',
      shortcut: 'Ctrl Alt I',
      run: () => props.onImport(true),
    },
    { id: 'export', label: 'Export evidence bundle', run: props.onExport },
    { id: 'create', label: 'Create a new investigation', run: props.onCreate },
    {
      id: 'close',
      label: 'Workspace: Close active tab',
      shortcut: 'Ctrl W',
      run: () => {
        const s = stateRef.current;
        close(s.activePane, activeLeaf(s).active);
      },
    },
    {
      id: 'reopen',
      label: 'Workspace: Reopen closed tab',
      shortcut: 'Ctrl Shift T',
      run: () => setWorkspace(reopenTab),
    },
    {
      id: 'pin',
      label: 'Workspace: Pin / unpin active tab',
      run: () => {
        const s = stateRef.current,
          t = activeTab(s);
        if (t) setWorkspace(setTab(s, s.activePane, t.id, { pinned: !t.pinned, preview: false }));
      },
    },
    { id: 'reset', label: 'Workspace: Reset layout', run: () => setWorkspace(initialWorkspace()) },
    {
      id: 'nextpane',
      label: 'Workspace: Focus next pane',
      shortcut: 'Ctrl Alt →',
      run: () => focusNext(1),
    },
  ];
  const quickItems: PaletteItem[] = useMemo(
    () =>
      files.map((file) => ({
        id: file.id,
        label: file.name,
        detail: file.path.replace(/\\/g, '/').split('/').slice(-3).join('/'),
        entry: { kind: 'artifact', resourceId: file.id, title: file.name },
        run: (newTab: boolean) => source(file, newTab ? 'tab' : 'preview'),
      })),
    [files],
  );
  function focusNext(delta: number) {
    setWorkspace((s) => {
      const all = leaves(s.root),
        index = all.findIndex((l) => l.id === s.activePane),
        next = all[(index + delta + all.length) % all.length];
      focusPane(next.id);
      return activate(s, next.id);
    });
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey,
        k = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
      if (e.target instanceof Element && e.target.closest('[role=dialog]') && !palette) return;
      if (mod && (k === 'p' || k === 'k')) {
        e.preventDefault();
        setMenu(null);
        setPalette((p) => (p === 'commands' ? null : 'commands'));
        return;
      }
      if (mod && k === 'o') {
        e.preventDefault();
        setPalette((p) => (p === 'files' ? null : 'files'));
        return;
      }
      if (palette || menu) return;
      if (mod && k === 't') {
        e.preventDefault();
        e.shiftKey ? setWorkspace(reopenTab) : open(viewEntry('start'));
        return;
      }
      if (mod && k === 'w') {
        e.preventDefault();
        const s = stateRef.current;
        close(s.activePane, activeLeaf(s).active);
        return;
      }
      if (mod && k === 'tab') {
        e.preventDefault();
        setWorkspace((s) => cycleTab(s, e.shiftKey ? -1 : 1));
        return;
      }
      if (mod && /^[1-9]$/.test(k)) {
        e.preventDefault();
        setWorkspace((s) => {
          const leaf = activeLeaf(s),
            t = k === '9' ? leaf.tabs.at(-1) : leaf.tabs[Number(k) - 1];
          return t ? activate(s, leaf.id, t.id) : s;
        });
        return;
      }
      if (mod && e.code === 'Backslash') {
        e.preventDefault();
        split(e.shiftKey ? 'column' : 'row');
        return;
      }
      if (mod && e.shiftKey && k === 'l') {
        e.preventDefault();
        setWorkspace((s) => ({ ...s, leftVisible: !s.leftVisible }));
      }
      if (mod && e.shiftKey && k === 'r') {
        e.preventDefault();
        setWorkspace((s) => ({ ...s, rightVisible: !s.rightVisible }));
      }
      if (mod && e.shiftKey && k === 'e') {
        e.preventDefault();
        patch({ leftVisible: true, leftTab: 'files' });
        setTimeout(
          () => document.querySelector<HTMLElement>('[aria-label="Evidence file tree"]')?.focus(),
          0,
        );
      }
      if (mod && e.shiftKey && k === 'f') {
        e.preventDefault();
        patch({ leftVisible: true, leftTab: 'search' });
        setTimeout(
          () =>
            document.querySelector<HTMLInputElement>('[aria-label="Search all evidence"]')?.focus(),
          0,
        );
      }
      if (mod && k === 'i' && (e.shiftKey || e.altKey)) {
        e.preventDefault();
        if (!running) props.onImport(e.altKey);
      }
      if (mod && e.altKey && ['arrowright', 'arrowdown', 'arrowleft', 'arrowup'].includes(k)) {
        e.preventDefault();
        focusNext(['arrowleft', 'arrowup'].includes(k) ? -1 : 1);
      }
      if (e.key === 'Escape') setImportDetails(false);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [palette, menu, running, props.onImport]);
  function renderTab(t: Tab, paneId: string, isActive: boolean) {
    const pageProps: PageProps = {
      caseId: current.id,
      revision,
      onError,
      notify,
      onSelect: (value) => select(value, paneId),
      navigate: (view) => navigate(view as ViewId, false, paneId),
      onImport: props.onImport,
      state: t.state,
      onField: (field, value) =>
        setWorkspace((s) => {
          const latest = leaves(s.root)
            .find((l) => l.id === paneId)
            ?.tabs.find((v) => v.id === t.id);
          return latest
            ? setTab(s, paneId, t.id, { state: { ...latest.state, [field]: value } })
            : s;
        }),
    };
    if (t.kind !== 'view')
      return (
        <EvidenceDocument
          tab={t}
          caseId={current.id}
          revision={revision}
          files={files}
          active={isActive}
          onOpen={(value, newTab) => select(value, paneId, newTab)}
          onError={onError}
          notify={notify}
          onTitle={(title) =>
            setWorkspace((s) => {
              const currentTab = leaves(s.root)
                .find((l) => l.id === paneId)
                ?.tabs.find((v) => v.id === t.id);
              return currentTab && currentTab.title !== title
                ? setTab(s, paneId, t.id, { title })
                : s;
            })
          }
          onState={(state) => setWorkspace((s) => setTab(s, paneId, t.id, { state }))}
          onInspect={() => patch({ rightVisible: true, rightTab: 'properties' })}
        />
      );
    if (t.view === 'start')
      return (
        <TabStart
          onOpen={(view) => navigate(view, false, paneId)}
          onQuick={() => setPalette('files')}
        />
      );
    if (t.view === 'overview') return <Overview {...pageProps} />;
    if (t.view === 'graph')
      return (
        <GraphPage
          {...pageProps}
          selection={(t.state.selection as Selection) || null}
          onSelect={(value) =>
            setWorkspace((s) => ({
              ...setTab(s, paneId, t.id, { state: { ...t.state, selection: value } }),
              rightVisible: value ? true : s.rightVisible,
              rightTab: value?.kind === 'entity' ? 'links' : s.rightTab,
            }))
          }
        />
      );
    if (t.view === 'evidence') return <Evidence {...pageProps} />;
    if (t.view === 'entities') return <Entities {...pageProps} />;
    if (t.view === 'timeline') return <Timeline {...pageProps} />;
    if (t.view === 'findings') return <Findings {...pageProps} onUpdate={props.update} />;
    if (t.view === 'notebook') return <Notebook {...pageProps} onUpdate={props.update} />;
    if (t.view === 'integrity') return <IntegrityPage {...pageProps} onExport={props.onExport} />;
    return <Guide />;
  }
  return (
    <>
      <header className="titlebar">
        <div className="app-mark" title="Atlas 1.1.0">
          A
        </div>
        <button
          className="icon-button"
          aria-label="Toggle left sidebar"
          title="Toggle left sidebar (Ctrl+Shift+L)"
          aria-pressed={workspace.leftVisible}
          onClick={() => patch({ leftVisible: !workspace.leftVisible })}
        >
          <PanelLeft size={17} />
        </button>
        <span className="window-title">{current.name} — Atlas</span>
        <button
          className="icon-button"
          aria-label="Toggle right sidebar"
          title="Toggle right sidebar (Ctrl+Shift+R)"
          aria-pressed={workspace.rightVisible}
          onClick={() => patch({ rightVisible: !workspace.rightVisible })}
        >
          <PanelRight size={17} />
        </button>
        <div className="window-controls">
          <button aria-label="Minimize window" onClick={() => window.atlas.window('minimize')}>
            <Minus size={15} />
          </button>
          <button aria-label="Maximize window" onClick={() => window.atlas.window('maximize')}>
            <Square size={11} />
          </button>
          <button aria-label="Close window" onClick={() => window.atlas.window('close')}>
            <X size={17} />
          </button>
        </div>
      </header>
      {props.engineStopped && (
        <div className="engine-banner">
          <AlertCircle size={15} />
          Analysis engine stopped. Restart Atlas to continue.
        </div>
      )}
      <div className="workspace-shell">
        <aside className="ribbon" aria-label="Ribbon">
          <button
            title="Open file (Ctrl+O)"
            aria-label="Open quick switcher"
            onClick={() => setPalette('files')}
          >
            <Files size={19} />
          </button>
          <button
            title="Search (Ctrl+Shift+F)"
            aria-label="Search evidence"
            onClick={() => patch({ leftVisible: true, leftTab: 'search' })}
          >
            <Search size={19} />
          </button>
          <button
            title="Evidence graph"
            aria-label="Open evidence graph"
            onClick={() => navigate('graph')}
          >
            <Network size={19} />
          </button>
          <button
            title="Event timeline"
            aria-label="Open event timeline"
            onClick={() => navigate('timeline')}
          >
            <Clock3 size={19} />
          </button>
          <button
            title="Analyst notebook"
            aria-label="Open analyst notebook"
            onClick={() => navigate('notebook')}
          >
            <NotebookPen size={19} />
          </button>
          <button
            title="Command palette (Ctrl+P)"
            aria-label="Open command palette"
            onClick={() => setPalette('commands')}
          >
            <TerminalSquare size={19} />
          </button>
          <span />
          <button
            title="Import evidence files"
            aria-label="Import evidence"
            disabled={running}
            onClick={() => props.onImport()}
          >
            <FileUp size={18} />
          </button>
          <button
            title="Export evidence bundle"
            aria-label="Export evidence bundle"
            disabled={props.exporting}
            onClick={props.onExport}
          >
            <Download size={18} />
          </button>
          <button
            title="Workbench guide"
            aria-label="Open workbench guide"
            onClick={() => navigate('guide')}
          >
            <BookOpen size={18} />
          </button>
        </aside>
        {workspace.leftVisible && (
          <>
            <div className="sidebar-container" style={{ width: workspace.leftWidth }}>
              <FileExplorer
                workspace={workspace}
                current={current}
                cases={props.cases}
                files={files}
                loading={loading}
                running={running}
                revision={revision}
                selected={selection?.kind === 'artifact' ? selection.id : ''}
                onPatch={patch}
                onOpen={source}
                onView={(view) => navigate(view)}
                onImport={props.onImport}
                onSwitch={props.onSwitch}
                onCreate={props.onCreate}
                onError={onError}
                onContext={fileMenu}
              />
            </div>
            <ResizeHandle
              label="Resize left sidebar"
              onDelta={(delta) =>
                setWorkspace((s) => ({
                  ...s,
                  leftWidth: Math.max(180, Math.min(500, s.leftWidth + delta)),
                }))
              }
            />
          </>
        )}
        <main className="workspace-center">
          <PaneLayout
            node={workspace.root}
            workspace={workspace}
            actions={actions}
            render={renderTab}
          />
        </main>
        {workspace.rightVisible && (
          <>
            <ResizeHandle
              label="Resize right sidebar"
              onDelta={(delta) =>
                setWorkspace((s) => ({
                  ...s,
                  rightWidth: Math.max(230, Math.min(500, s.rightWidth - delta)),
                }))
              }
            />
            <div className="sidebar-container right" style={{ width: workspace.rightWidth }}>
              <Inspector
                selection={selection}
                caseId={current.id}
                revision={revision}
                tab={workspace.rightTab}
                onTab={(rightTab) => patch({ rightTab })}
                onOpen={(value) => select(value)}
                onError={onError}
                notify={notify}
                onUpdate={props.update}
              />
            </div>
          </>
        )}
      </div>
      <footer className="statusbar">
        <button
          className={running ? 'import-running' : ''}
          aria-label="Import status"
          onClick={() => setImportDetails((s) => !s)}
        >
          {running ? (
            <>
              <LoaderCircle size={12} className="spin" />
              Importing {props.job!.current}
            </>
          ) : props.job && props.job.skipped > 0 ? (
            <>{props.job.skipped} import skips</>
          ) : props.engineStopped ? (
            'Engine unavailable'
          ) : (
            'Local workspace'
          )}
        </button>
        <span />
        {selection?.kind === 'artifact' && (
          <button onClick={() => patch({ rightVisible: true, rightTab: 'properties' })}>
            Source properties
          </button>
        )}
        <span>{counts.artifacts || 0} files</span>
        <span>{counts.entities || 0} entities</span>
        <span>{counts.events || 0} events</span>
        <span>UTC</span>
        <span className="app-version">1.1.0</span>
      </footer>
      {importDetails && (
        <div className="import-popover">
          <div>
            <strong>{running ? 'Importing sources' : 'Latest import'}</strong>
            <button
              className="icon-button"
              aria-label="Close import details"
              onClick={() => setImportDetails(false)}
            >
              <X size={14} />
            </button>
          </div>
          {props.job ? (
            <>
              <p>{props.job.current || props.job.status}</p>
              <p>
                {props.job.imported} added · {props.job.duplicates} unchanged · {props.job.skipped}{' '}
                skipped · {bytes(props.job.bytes)}
              </p>
              {running && (
                <button
                  onClick={() =>
                    window.atlas
                      .api(`/jobs/${props.job!.id}/cancel`, 'POST')
                      .catch((e) => onError(e.message))
                  }
                >
                  Cancel import
                </button>
              )}
              {props.job.errors.length > 0 && <pre>{props.job.errors.join('\n')}</pre>}
            </>
          ) : (
            <p>Import files, a folder or an Obsidian vault from the file explorer.</p>
          )}
        </div>
      )}
      {palette && (
        <Palette
          key={palette}
          mode={palette}
          items={palette === 'commands' ? commands : quickItems}
          onClose={() => setPalette(null)}
        />
      )}
      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
    </>
  );
}
