import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FileText,
  FolderOpen,
  FileUp,
  ChevronsDownUp,
  Search,
  Files,
  Ellipsis,
  Plus,
  Archive,
  Code2,
} from 'lucide-react';
import type { Artifact, Case } from './types';
import { ancestors, buildTree, flattenTree, type TreeNode } from './fileTree';
import { EntryIcon } from './Chrome';
import { viewEntry, VIEWS, type OpenMode, type ViewId, type Workspace } from './workspace';
import { bytes, readAPI, useData } from './shared';

export function useFiles(caseId: string, revision: number, onError: (s: string) => void) {
  const [value, setValue] = useState<{ caseId: string; files: Artifact[] } | null>(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    const abort = new AbortController();
    setLoading(true);
    (async () => {
      const files: Artifact[] = [];
      let total = 1;
      for (let offset = 0; offset < total; offset += 500) {
        const batch = await readAPI<{ items: Artifact[]; total: number }>(
          `/cases/${caseId}/artifacts?limit=500&offset=${offset}`,
          abort.signal,
        );
        if (!live) return;
        total = batch.total;
        files.push(...batch.items);
        if (!batch.items.length) break;
      }
      if (live) setValue({ caseId, files });
    })()
      .catch((e) => {
        if (live) onError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      abort.abort();
    };
  }, [caseId, revision, onError]);
  return { files: value?.caseId === caseId ? value.files : [], loading };
}
export type ExplorerProps = {
  workspace: Workspace;
  current: Case;
  cases: Case[];
  files: Artifact[];
  loading: boolean;
  running: boolean;
  revision: number;
  selected: string;
  onPatch: (patch: Partial<Workspace>) => void;
  onOpen: (artifact: Artifact, mode: OpenMode) => void;
  onView: (view: ViewId) => void;
  onImport: (folder?: boolean) => void;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onError: (s: string) => void;
  onContext: (event: React.MouseEvent | React.KeyboardEvent, node: TreeNode) => void;
};
export function FileExplorer(props: ExplorerProps) {
  const [filter, setFilter] = useState(''),
    [showFilter, setShowFilter] = useState(false),
    [viewsOpen, setViewsOpen] = useState(false),
    [cursor, setCursor] = useState(0),
    [scroll, setScroll] = useState(0),
    [height, setHeight] = useState(600);
  const tree = useMemo(() => buildTree(props.files), [props.files]);
  const expanded = useMemo(() => new Set(props.workspace.expanded), [props.workspace.expanded]);
  const visible = useMemo(() => flattenTree(tree, expanded, filter), [tree, expanded, filter]);
  const ref = useRef<HTMLDivElement>(null),
    filterRef = useRef<HTMLInputElement>(null);
  const toggle = (id: string) => {
    const next = new Set(expanded);
    next.has(id) ? next.delete(id) : next.add(id);
    props.onPatch({ expanded: [...next] });
  };
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const resize = new ResizeObserver((entries) => setHeight(entries[0].contentRect.height));
    resize.observe(host);
    return () => resize.disconnect();
  }, [props.workspace.leftTab]);
  useEffect(() => {
    setCursor((i) => Math.min(i, Math.max(0, visible.length - 1)));
  }, [visible.length]);
  useEffect(() => {
    if (showFilter) filterRef.current?.focus();
  }, [showFilter]);
  const setFocus = (index: number) => {
    const at = Math.max(0, Math.min(visible.length - 1, index));
    setCursor(at);
    const top = at * 27,
      host = ref.current;
    if (host) {
      if (top < host.scrollTop) host.scrollTop = top;
      else if (top + 27 > host.scrollTop + host.clientHeight)
        host.scrollTop = top + 27 - host.clientHeight;
    }
  };
  useEffect(() => {
    if (!props.selected) return;
    const index = visible.findIndex((x) => x.node.id === props.selected);
    if (index >= 0) setFocus(index);
  }, [props.selected]);
  const start = Math.max(0, Math.floor(scroll / 27) - 10),
    end = Math.min(visible.length, Math.ceil((scroll + height) / 27) + 10);
  return (
    <aside className="left-sidebar" aria-label="Left sidebar">
      <div className="sidebar-tabs" role="tablist" aria-label="Sidebar views">
        <button
          role="tab"
          aria-selected={props.workspace.leftTab === 'files'}
          title="Files"
          aria-label="Files sidebar"
          onClick={() => props.onPatch({ leftTab: 'files' })}
        >
          <Files size={18} />
        </button>
        <button
          role="tab"
          aria-selected={props.workspace.leftTab === 'search'}
          title="Search (Ctrl+Shift+F)"
          aria-label="Search sidebar"
          onClick={() => props.onPatch({ leftTab: 'search' })}
        >
          <Search size={18} />
        </button>
        <span />
        <button
          className="icon-button"
          aria-label="Import evidence files"
          disabled={props.running}
          title="Import evidence files (Ctrl+Shift+I)"
          onClick={() => props.onImport()}
        >
          <FileUp size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="Import folder"
          disabled={props.running}
          title="Import folder (Ctrl+Alt+I)"
          onClick={() => props.onImport(true)}
        >
          <FolderOpen size={16} />
        </button>
      </div>
      {props.workspace.leftTab === 'files' ? (
        <>
          <div className="explorer-toolbar">
            <strong>Files</strong>
            <span />
            <button
              aria-label="Filter files"
              title="Filter files"
              onClick={() => setShowFilter((s) => !s)}
            >
              <Search size={14} />
            </button>
            <button
              aria-label="Collapse all folders"
              title="Collapse all folders"
              onClick={() => props.onPatch({ expanded: [] })}
            >
              <ChevronsDownUp size={15} />
            </button>
          </div>
          {showFilter && (
            <div className="explorer-filter">
              <input
                ref={filterRef}
                aria-label="Filter file tree"
                placeholder="Filter files…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
          )}
          <div className="virtual-documents">
            <button className="tree-view" onClick={() => props.onView('overview')}>
              <EntryIcon entry={viewEntry('overview')} />
              <span>Overview</span>
            </button>
            <button
              className="tree-view"
              onClick={() => setViewsOpen((s) => !s)}
              aria-expanded={viewsOpen}
            >
              {viewsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span>Atlas views</span>
            </button>
            {viewsOpen && (
              <nav aria-label="Atlas views">
                {VIEWS.filter((v) => v[0] !== 'overview' && v[0] !== 'start').map(
                  ([view, label]) => (
                    <button
                      className="tree-view indented"
                      key={view}
                      onClick={() => props.onView(view)}
                    >
                      <EntryIcon entry={viewEntry(view)} />
                      <span>{label}</span>
                    </button>
                  ),
                )}
              </nav>
            )}
          </div>
          <div
            ref={ref}
            className="file-tree"
            role="tree"
            aria-label="Evidence file tree"
            tabIndex={0}
            aria-activedescendant={visible[cursor] ? `tree-row-${cursor}` : undefined}
            onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
            onKeyDown={(e) => {
              const row = visible[cursor];
              if (!row) return;
              if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(e.key)) {
                e.preventDefault();
                setFocus(
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? visible.length - 1
                      : cursor +
                        (e.key === 'ArrowDown'
                          ? 1
                          : e.key === 'ArrowUp'
                            ? -1
                            : e.key === 'PageDown'
                              ? 12
                              : -12),
                );
              }
              if (e.key === 'ArrowRight') {
                e.preventDefault();
                if (row.node.children.length && !expanded.has(row.node.id)) toggle(row.node.id);
                else if (row.node.children.length) setFocus(cursor + 1);
              }
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                if (expanded.has(row.node.id)) toggle(row.node.id);
                else {
                  const parents = ancestors(tree, row.node.id);
                  const index = visible.findIndex((x) => x.node.id === parents?.at(-1));
                  if (index >= 0) setFocus(index);
                }
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                if (row.node.artifact)
                  props.onOpen(row.node.artifact, e.ctrlKey || e.metaKey ? 'tab' : 'preview');
                else toggle(row.node.id);
              }
              if (e.key === ' ') {
                e.preventDefault();
                if (row.node.children.length) toggle(row.node.id);
              }
              if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                e.preventDefault();
                props.onContext(e, row.node);
              }
            }}
          >
            <div className="tree-spacer" style={{ height: visible.length * 27 }}>
              {visible.slice(start, end).map(({ node, depth }, i) => {
                const index = i + start,
                  expandable = node.folder || node.children.length > 0;
                return (
                  <div
                    role="treeitem"
                    id={`tree-row-${index}`}
                    aria-level={depth}
                    aria-expanded={expandable ? expanded.has(node.id) : undefined}
                    aria-selected={props.selected === node.id}
                    className={
                      'tree-row ' +
                      (props.selected === node.id ? 'selected ' : '') +
                      (cursor === index ? 'focused' : '')
                    }
                    style={{ top: index * 27, paddingLeft: (depth - 1) * 16 + 9 }}
                    key={node.id}
                    title={node.path}
                    draggable={!!node.artifact}
                    onDragStart={(e) => {
                      if (node.artifact) {
                        e.dataTransfer.setData(
                          'application/x-atlas-resource',
                          JSON.stringify({
                            kind: 'artifact',
                            resourceId: node.artifact.id,
                            title: node.artifact.name,
                          }),
                        );
                        e.dataTransfer.effectAllowed = 'copyMove';
                      }
                    }}
                    onClick={(e) => {
                      setCursor(index);
                      ref.current?.focus();
                      if (node.artifact)
                        props.onOpen(
                          node.artifact,
                          e.ctrlKey || e.metaKey ? 'tab' : e.altKey ? 'split-right' : 'preview',
                        );
                      else toggle(node.id);
                    }}
                    onDoubleClick={() => {
                      if (node.artifact) props.onOpen(node.artifact, 'tab');
                    }}
                    onAuxClick={(e) => {
                      if (e.button === 1 && node.artifact) {
                        e.preventDefault();
                        props.onOpen(node.artifact, 'tab');
                      }
                    }}
                    onContextMenu={(e) => {
                      setCursor(index);
                      props.onContext(e, node);
                    }}
                  >
                    {expandable ? (
                      <button
                        className="tree-chevron"
                        tabIndex={-1}
                        aria-label={`Toggle ${node.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(node.id);
                        }}
                      >
                        {expanded.has(node.id) ? (
                          <ChevronDown size={13} />
                        ) : (
                          <ChevronRight size={13} />
                        )}
                      </button>
                    ) : (
                      <span className="tree-chevron" />
                    )}
                    {node.folder ? (
                      <Folder size={14} />
                    ) : node.artifact?.extension === 'zip' ? (
                      <Archive size={14} />
                    ) : node.artifact?.relation === 'decoded' ? (
                      <Code2 size={14} />
                    ) : (
                      <FileText size={14} />
                    )}
                    <span>{node.name}</span>
                  </div>
                );
              })}
            </div>
            {!visible.length && (
              <p className="sidebar-empty">
                {props.loading
                  ? 'Loading files…'
                  : filter
                    ? 'No matching files.'
                    : 'Import files or an Obsidian vault to begin.'}
              </p>
            )}
          </div>
        </>
      ) : (
        <SidebarSearch
          caseId={props.current.id}
          revision={props.revision}
          onError={props.onError}
          onOpen={props.onOpen}
        />
      )}
      <div className="vault-switcher">
        <FolderOpen size={16} />
        <select
          aria-label="Active case"
          value={props.current.id}
          onChange={(e) => props.onSwitch(e.target.value)}
        >
          {props.cases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button aria-label="New investigation" title="New investigation" onClick={props.onCreate}>
          <Plus size={16} />
        </button>
      </div>
    </aside>
  );
}
function SidebarSearch({
  caseId,
  revision,
  onError,
  onOpen,
}: {
  caseId: string;
  revision: number;
  onError: (s: string) => void;
  onOpen: ExplorerProps['onOpen'];
}) {
  const [query, setQuery] = useState(''),
    [debounced, setDebounced] = useState(''),
    [page, setPage] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 180);
    return () => clearTimeout(timer);
  }, [query]);
  const { data, loading } = useData<{ items: Artifact[]; total: number }>(
    `/cases/${caseId}/artifacts?q=${encodeURIComponent(debounced)}&limit=50&offset=${page * 50}`,
    revision,
    onError,
  );
  return (
    <div className="sidebar-search">
      <div className="sidebar-search-input">
        <Search size={15} />
        <input
          autoFocus
          aria-label="Search all evidence"
          placeholder="Search all evidence…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
      </div>
      <div className="search-help">
        Content and filters: <code>ext:md</code> <code>has:ip</code> <code>name:decoded</code>
      </div>
      <div className="search-result-count">
        {loading ? 'Searching…' : `${data?.total || 0} matching files`}
      </div>
      <div className="search-results">
        {data?.items.map((file) => (
          <button key={file.id} onClick={(e) => onOpen(file, e.ctrlKey ? 'tab' : 'preview')}>
            <FileText size={15} />
            <span>
              <strong>{file.name}</strong>
              <small>
                {file.path.replace(/\\/g, '/').split('/').slice(-2).join('/')} · {bytes(file.size)}
              </small>
            </span>
          </button>
        ))}
      </div>
      <div className="sidebar-search-pager">
        <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <span>{page + 1}</span>
        <button
          disabled={!data || (page + 1) * 50 >= data.total}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
