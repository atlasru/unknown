import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  FileText,
  LayoutGrid,
  Network,
  Fingerprint,
  ListFilter,
  NotebookPen,
  ShieldCheck,
  BookOpen,
  Search,
  Plus,
  X,
  Pin,
  Ellipsis,
  Columns2,
  Rows2,
} from 'lucide-react';
import {
  fuzzyScore,
  type Entry,
  type Layout,
  type Leaf,
  type Tab,
  type ViewId,
  type OpenMode,
  type Workspace,
} from './workspace';

export const VIEW_ICONS = {
  overview: LayoutGrid,
  graph: Network,
  evidence: ListFilter,
  entities: Fingerprint,
  timeline: ListFilter,
  findings: ShieldCheck,
  notebook: NotebookPen,
  integrity: ShieldCheck,
  guide: BookOpen,
  start: Plus,
};
export function EntryIcon({ entry, size = 15 }: { entry: Entry; size?: number }) {
  const Icon =
    entry.kind === 'view'
      ? VIEW_ICONS[entry.view]
      : entry.kind === 'entity'
        ? Fingerprint
        : FileText;
  return <Icon size={size} />;
}
export type MenuItem = {
  label: string;
  run: () => void;
  shortcut?: string;
  disabled?: boolean;
  divider?: boolean;
};
export type MenuState = {
  x: number;
  y: number;
  items: MenuItem[];
  label?: string;
  origin?: HTMLElement | null;
};

export function Modal({
  label,
  onClose,
  children,
  className = '',
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const input =
      ref.current?.querySelector<HTMLElement>('input,textarea') ||
      ref.current?.querySelector<HTMLElement>('button,[tabindex="0"]');
    input?.focus();
    return () => {
      if (
        previous?.isConnected &&
        (!previous.closest('.workspace-leaf') || previous.closest('.active-leaf'))
      )
        previous.focus();
      else document.querySelector<HTMLElement>('.active-leaf')?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={'modal ' + className}
        role="dialog"
        aria-label={label}
        aria-modal="true"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
          if (e.key === 'Tab') {
            const focusable = [
              ...ref.current!.querySelectorAll<HTMLElement>(
                'button:not([disabled]),input,textarea,select,[tabindex="0"]',
              ),
            ];
            const index = focusable.indexOf(document.activeElement as HTMLElement);
            if (e.shiftKey && index <= 0) {
              e.preventDefault();
              focusable.at(-1)?.focus();
            } else if (!e.shiftKey && index === focusable.length - 1) {
              e.preventDefault();
              focusable[0]?.focus();
            }
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null),
    [position, setPosition] = useState({ x: menu.x, y: menu.y });
  useEffect(() => {
    const box = ref.current!.getBoundingClientRect();
    setPosition({
      x: Math.max(6, Math.min(menu.x, innerWidth - box.width - 6)),
      y: Math.max(6, Math.min(menu.y, innerHeight - box.height - 6)),
    });
    ref.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      if (
        menu.origin?.isConnected &&
        (!menu.origin.closest('.workspace-leaf') || menu.origin.closest('.active-leaf'))
      )
        menu.origin.focus();
      else document.querySelector<HTMLElement>('.active-leaf')?.focus();
    };
  }, [menu, onClose]);
  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label={menu.label || 'Context menu'}
      style={{ left: position.x, top: position.y }}
      onKeyDown={(e) => {
        const buttons = [
            ...ref.current!.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
          ],
          index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          const next =
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? buttons.length - 1
                : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {menu.items.map((item, i) => (
        <div key={i}>
          {item.divider && <div className="menu-separator" />}
          <button
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        </div>
      ))}
    </div>
  );
}
export type PaletteItem = {
  id: string;
  label: string;
  detail?: string;
  shortcut?: string;
  entry?: Entry;
  run: (newTab: boolean) => void;
};
export function Palette({
  mode,
  items,
  onClose,
}: {
  mode: 'commands' | 'files';
  items: PaletteItem[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState(''),
    [index, setIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const matches = useMemo(
    () =>
      items
        .map((item, i) => ({
          item,
          score: fuzzyScore(query, item.label + ' ' + (item.detail || '')),
          order: i,
        }))
        .filter((x) => x.score >= 0)
        .sort((a, b) => b.score - a.score || a.order - b.order)
        .slice(0, 100)
        .map((x) => x.item),
    [items, query],
  );
  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    ref.current?.querySelector(`[data-result="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  const run = (item: PaletteItem | undefined, newTab = false) => {
    if (item) {
      onClose();
      item.run(newTab);
    }
  };
  return (
    <Modal
      label={mode === 'commands' ? 'Command palette' : 'Quick switcher'}
      onClose={onClose}
      className="palette-modal"
    >
      <div className="palette-input">
        <Search size={18} />
        <input
          aria-label={mode === 'commands' ? 'Search commands' : 'Search files'}
          placeholder={mode === 'commands' ? 'Type a command…' : 'Type a file name…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          role="combobox"
          aria-autocomplete="list"
          aria-controls="palette-results"
          aria-expanded="true"
          aria-activedescendant={matches[index] ? `palette-result-${index}` : undefined}
          onKeyDown={(e) => {
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
              e.preventDefault();
              setIndex((i) =>
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? matches.length - 1
                    : (i + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) %
                      Math.max(1, matches.length),
              );
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              run(matches[index], e.ctrlKey || e.metaKey);
            }
          }}
        />
        <button className="icon-button" aria-label="Close palette" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div
        ref={ref}
        className="palette-results"
        id="palette-results"
        role="listbox"
        aria-label="Results"
      >
        {matches.map((item, i) => (
          <button
            id={`palette-result-${i}`}
            data-result={i}
            role="option"
            aria-selected={i === index}
            className={i === index ? 'selected' : ''}
            key={item.id}
            onMouseMove={() => setIndex(i)}
            onClick={(e) => run(item, e.ctrlKey || e.metaKey)}
          >
            {item.entry && <EntryIcon entry={item.entry} />}
            <span>
              <strong>{item.label}</strong>
              {item.detail && <small>{item.detail}</small>}
            </span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        ))}
        {!matches.length && <p className="no-results">No matches.</p>}
      </div>
      <div className="palette-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> select
        </span>
        <span>
          <kbd>Enter</kbd> open
        </span>
        {mode === 'files' && (
          <span>
            <kbd>Ctrl ↵</kbd> new tab
          </span>
        )}
        <span>
          <kbd>Esc</kbd> close
        </span>
      </div>
    </Modal>
  );
}
export function ResizeHandle({
  label,
  axis = 'row',
  onDelta,
}: {
  label: string;
  axis?: 'row' | 'column';
  onDelta: (delta: number) => void;
}) {
  const start = useRef<number | null>(null);
  return (
    <div
      className={'resize-handle ' + axis}
      role="separator"
      aria-label={label}
      aria-orientation={axis === 'row' ? 'vertical' : 'horizontal'}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        start.current = axis === 'row' ? e.clientX : e.clientY;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (start.current === null) return;
        const position = axis === 'row' ? e.clientX : e.clientY;
        onDelta(position - start.current);
        start.current = position;
      }}
      onPointerUp={(e) => {
        start.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
      onKeyDown={(e) => {
        if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(e.key)) {
          e.preventDefault();
          onDelta(['ArrowLeft', 'ArrowUp'].includes(e.key) ? -12 : 12);
        }
      }}
    />
  );
}
export type PaneActions = {
  activate: (pane: string, tab?: string) => void;
  close: (pane: string, tab: string) => void;
  keep: (pane: string, tab: string) => void;
  context: (e: React.MouseEvent | React.KeyboardEvent, pane: string, tab?: Tab) => void;
  newTab: (pane: string) => void;
  move: (from: string, tab: string, to: string, before?: string) => void;
  splitDrop: (
    pane: string,
    axis: 'row' | 'column',
    from: string,
    tab: string,
    before: boolean,
  ) => void;
  resourceDrop: (pane: string, entry: Entry, mode?: OpenMode) => void;
  resize: (id: string, ratio: number) => void;
};
export function PaneLayout({
  node,
  workspace,
  actions,
  render,
}: {
  node: Layout;
  workspace: Workspace;
  actions: PaneActions;
  render: (tab: Tab, pane: string, active: boolean, visible: boolean) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  if (node.type === 'split')
    return (
      <div ref={ref} className={'workspace-split ' + node.axis} data-split-id={node.id}>
        <div style={{ flex: `${node.ratio} 1 0%` }}>
          <PaneLayout node={node.first} workspace={workspace} actions={actions} render={render} />
        </div>
        <ResizeHandle
          label={`Resize split ${node.axis === 'row' ? 'right' : 'down'}`}
          axis={node.axis}
          onDelta={(delta) => {
            const size = node.axis === 'row' ? ref.current!.clientWidth : ref.current!.clientHeight;
            if (size) actions.resize(node.id, node.ratio + delta / size);
          }}
        />
        <div style={{ flex: `${1 - node.ratio} 1 0%` }}>
          <PaneLayout node={node.second} workspace={workspace} actions={actions} render={render} />
        </div>
      </div>
    );
  return (
    <Pane node={node} active={workspace.activePane === node.id} actions={actions} render={render} />
  );
}
function Pane({
  node,
  active,
  actions,
  render,
}: {
  node: Leaf;
  active: boolean;
  actions: PaneActions;
  render: (tab: Tab, pane: string, active: boolean, visible: boolean) => React.ReactNode;
}) {
  const [zone, setZone] = useState('');
  const read = (e: React.DragEvent) => {
    try {
      const tab = e.dataTransfer.getData('application/x-atlas-tab');
      if (tab) return { tab: JSON.parse(tab) };
      const resource = e.dataTransfer.getData('application/x-atlas-resource');
      if (resource) return { resource: JSON.parse(resource) as Entry };
    } catch {}
    return {};
  };
  const drop = (e: React.DragEvent, before?: string) => {
    const value = read(e);
    if (!value.tab && !value.resource) return;
    e.preventDefault();
    e.stopPropagation();
    if (value.tab) {
      if (!before && ['left', 'right', 'top', 'bottom'].includes(zone))
        actions.splitDrop(
          node.id,
          ['left', 'right'].includes(zone) ? 'row' : 'column',
          value.tab.pane,
          value.tab.id,
          zone === 'left' || zone === 'top',
        );
      else actions.move(value.tab.pane, value.tab.id, node.id, before);
    } else if (value.resource)
      actions.resourceDrop(
        node.id,
        value.resource,
        !before && zone === 'left'
          ? 'split-left'
          : !before && zone === 'right'
            ? 'split-right'
            : !before && zone === 'top'
              ? 'split-up'
              : !before && zone === 'bottom'
                ? 'split-down'
                : 'tab',
      );
    setZone('');
  };
  return (
    <section
      className={'workspace-leaf ' + (active ? 'active-leaf' : '') + (zone ? ' drop-' + zone : '')}
      data-pane-id={node.id}
      aria-label="Tab group"
      tabIndex={-1}
      onMouseDownCapture={() => {
        if (!active) actions.activate(node.id);
      }}
      onFocusCapture={() => {
        if (!active) actions.activate(node.id);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.some((t) => t.startsWith('application/x-atlas-'))) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect(),
          x = (e.clientX - r.left) / r.width,
          y = (e.clientY - r.top) / r.height;
        setZone(
          y < 0.16 ? 'top' : y > 0.83 ? 'bottom' : x < 0.2 ? 'left' : x > 0.8 ? 'right' : 'center',
        );
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setZone('');
      }}
      onDrop={(e) => drop(e)}
    >
      <div className="tab-strip" role="tablist" aria-label="Open tabs">
        <div className="tabs-scroll">
          {node.tabs.map((tab) => (
            <div
              className={
                'workspace-tab ' +
                (node.active === tab.id ? 'active' : '') +
                (tab.preview ? ' preview' : '')
              }
              role="tab"
              aria-selected={node.active === tab.id}
              aria-label={tab.title}
              id={'tab-' + tab.id}
              aria-controls={'panel-' + tab.id}
              tabIndex={node.active === tab.id ? 0 : -1}
              key={tab.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  'application/x-atlas-tab',
                  JSON.stringify({ pane: node.id, id: tab.id }),
                );
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.some((t) => t.startsWith('application/x-atlas-'))) {
                  e.preventDefault();
                  e.stopPropagation();
                  setZone('');
                }
              }}
              onDrop={(e) => drop(e, tab.id)}
              onClick={() => actions.activate(node.id, tab.id)}
              onDoubleClick={() => actions.keep(node.id, tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  actions.close(node.id, tab.id);
                }
              }}
              onContextMenu={(e) => actions.context(e, node.id, tab)}
              onKeyDown={(e) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                  e.preventDefault();
                  const index = node.tabs.findIndex((t) => t.id === tab.id),
                    next =
                      e.key === 'Home'
                        ? node.tabs[0]
                        : e.key === 'End'
                          ? node.tabs.at(-1)
                          : node.tabs[
                              (index + (e.key === 'ArrowRight' ? 1 : -1) + node.tabs.length) %
                                node.tabs.length
                            ];
                  if (next) {
                    actions.activate(node.id, next.id);
                    document.getElementById('tab-' + next.id)?.focus();
                  }
                }
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  actions.activate(node.id, tab.id);
                }
                if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                  e.preventDefault();
                  actions.context(e, node.id, tab);
                }
              }}
              title={tab.title}
            >
              <EntryIcon entry={tab} />
              <span>{tab.title}</span>
              {tab.pinned && <Pin size={12} className="tab-pin" />}
              <button
                aria-label={`Close tab ${tab.title}`}
                tabIndex={node.active === tab.id ? 0 : -1}
                onClick={(e) => {
                  e.stopPropagation();
                  actions.close(node.id, tab.id);
                }}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
        <button
          className="icon-button new-tab"
          aria-label="New tab"
          title="New tab (Ctrl+T)"
          onClick={() => actions.newTab(node.id)}
        >
          <Plus size={17} />
        </button>
        <div className="tab-drag-space" />
        <button
          className="icon-button pane-menu"
          aria-label="Tab group options"
          onClick={(e) => actions.context(e, node.id)}
        >
          <Ellipsis size={18} />
        </button>
      </div>
      <div className="pane-bodies">
        {node.tabs.map((tab) => (
          <div
            key={tab.id}
            role="tabpanel"
            id={'panel-' + tab.id}
            aria-labelledby={'tab-' + tab.id}
            className={
              'tab-content ' + (tab.kind === 'view' && tab.view === 'graph' ? 'graph-content' : '')
            }
            hidden={node.active !== tab.id}
          >
            {render(tab, node.id, active && node.active === tab.id, node.active === tab.id)}
          </div>
        ))}
        {!node.tabs.length && (
          <div className="empty-pane">
            <h2>New tab</h2>
            <p>Open a file or a workspace view.</p>
            <button onClick={() => actions.newTab(node.id)}>
              <Search size={16} />
              Open <kbd>Ctrl O</kbd>
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
export function TabStart({
  onOpen,
  onQuick,
}: {
  onOpen: (view: ViewId) => void;
  onQuick: () => void;
}) {
  return (
    <div className="new-tab-page">
      <div className="new-tab-mark">A</div>
      <h1>New tab</h1>
      <button className="start-open" onClick={onQuick}>
        <Search size={18} />
        <span>Open a file</span>
        <kbd>Ctrl O</kbd>
      </button>
      <div className="start-views">
        {(
          [
            'overview',
            'graph',
            'evidence',
            'entities',
            'timeline',
            'findings',
            'notebook',
            'integrity',
            'guide',
          ] as ViewId[]
        ).map((view) => (
          <button key={view} onClick={() => onOpen(view)}>
            <EntryIcon entry={{ kind: 'view', view, title: '' }} />
            <span>
              {
                {
                  overview: 'Overview',
                  graph: 'Evidence graph',
                  evidence: 'Evidence vault',
                  entities: 'Entity index',
                  timeline: 'Event timeline',
                  findings: 'Review findings',
                  notebook: 'Analyst notebook',
                  integrity: 'Integrity & export',
                  guide: 'Workbench guide',
                  start: 'New tab',
                }[view]
              }
            </span>
            <ChevronRight size={14} />
          </button>
        ))}
      </div>
      <p className="new-tab-hint">
        Commands <kbd>Ctrl P</kbd> · Split right <kbd>Ctrl \\</kbd> · Split down{' '}
        <kbd>Ctrl Shift \\</kbd>
      </p>
    </div>
  );
}
export const SPLIT_ICONS = { row: Columns2, column: Rows2 };
