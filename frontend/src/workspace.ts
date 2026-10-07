/** Renderer-only workspace state. Evidence and the engine never depend on it. */
export const VIEWS = [
  ['overview', 'Overview'],
  ['graph', 'Evidence graph'],
  ['evidence', 'Evidence vault'],
  ['entities', 'Entity index'],
  ['timeline', 'Event timeline'],
  ['findings', 'Review findings'],
  ['notebook', 'Analyst notebook'],
  ['integrity', 'Integrity & export'],
  ['guide', 'Workbench guide'],
  ['start', 'New tab'],
] as const;
export type ViewId = (typeof VIEWS)[number][0];
export type Entry =
  | { kind: 'view'; view: ViewId; title: string }
  | { kind: 'artifact' | 'entity'; resourceId: string; title: string; line?: number };
export type Tab = Entry & {
  id: string;
  pinned: boolean;
  preview: boolean;
  state: Record<string, unknown>;
};
export type Leaf = { type: 'leaf'; id: string; tabs: Tab[]; active: string };
export type Branch = {
  type: 'split';
  id: string;
  axis: 'row' | 'column';
  ratio: number;
  first: Layout;
  second: Layout;
};
export type Layout = Leaf | Branch;
export type Workspace = {
  version: 2;
  root: Layout;
  activePane: string;
  leftVisible: boolean;
  rightVisible: boolean;
  leftWidth: number;
  rightWidth: number;
  leftTab: 'files' | 'search';
  rightTab: 'properties' | 'links' | 'outline' | 'notes';
  expanded: string[];
  closed: { pane: string; tab: Tab }[];
};
export type OpenMode = 'preview' | 'tab' | 'split-right' | 'split-down' | 'split-left' | 'split-up';
const uid = () => globalThis.crypto.randomUUID();
export const viewEntry = (view: ViewId): Entry => ({
  kind: 'view',
  view,
  title: VIEWS.find((v) => v[0] === view)?.[1] || 'Overview',
});
export const identity = (entry: Entry) =>
  entry.kind === 'view' ? 'view:' + entry.view : entry.kind + ':' + entry.resourceId;
const newTab = (entry: Entry, preview = false): Tab => ({
  ...entry,
  id: uid(),
  pinned: false,
  preview,
  state: {},
});
export function leaves(layout: Layout): Leaf[] {
  return layout.type === 'leaf' ? [layout] : [...leaves(layout.first), ...leaves(layout.second)];
}
export function activeLeaf(workspace: Workspace): Leaf {
  return (
    leaves(workspace.root).find((l) => l.id === workspace.activePane) || leaves(workspace.root)[0]
  );
}
export function activeTab(workspace: Workspace): Tab | undefined {
  const leaf = activeLeaf(workspace);
  return leaf.tabs.find((t) => t.id === leaf.active);
}
export function initialWorkspace(legacy?: string): Workspace {
  const tab = newTab(
    viewEntry(VIEWS.some((v) => v[0] === legacy) ? (legacy as ViewId) : 'overview'),
  );
  const root: Leaf = { type: 'leaf', id: uid(), tabs: [tab], active: tab.id };
  return {
    version: 2,
    root,
    activePane: root.id,
    leftVisible: true,
    rightVisible: false,
    leftWidth: 248,
    rightWidth: 288,
    leftTab: 'files',
    rightTab: 'properties',
    expanded: [],
    closed: [],
  };
}
export function mapLayout(layout: Layout, visit: (node: Layout) => Layout): Layout {
  const children =
    layout.type === 'split'
      ? {
          ...layout,
          first: mapLayout(layout.first, visit),
          second: mapLayout(layout.second, visit),
        }
      : layout;
  return visit(children);
}
export function updateLeaf(
  workspace: Workspace,
  pane: string,
  visit: (leaf: Leaf) => Leaf,
): Workspace {
  return {
    ...workspace,
    root: mapLayout(workspace.root, (node) =>
      node.type === 'leaf' && node.id === pane ? visit(node) : node,
    ),
  };
}
export function activate(workspace: Workspace, pane: string, tab?: string): Workspace {
  if (!leaves(workspace.root).some((l) => l.id === pane)) return workspace;
  const result = { ...workspace, activePane: pane };
  return tab
    ? updateLeaf(result, pane, (leaf) =>
        leaf.tabs.some((t) => t.id === tab) ? { ...leaf, active: tab } : leaf,
      )
    : result;
}
export function openEntry(
  workspace: Workspace,
  entry: Entry,
  mode: OpenMode = 'tab',
  pane = workspace.activePane,
): Workspace {
  if (mode.startsWith('split')) {
    const split = splitPane(
      workspace,
      pane,
      mode === 'split-right' || mode === 'split-left' ? 'row' : 'column',
      false,
      mode === 'split-left' || mode === 'split-up',
    );
    return openEntry(split, entry, 'tab', split.activePane);
  }
  const target = leaves(workspace.root).find((l) => l.id === pane) || activeLeaf(workspace);
  const existing =
    entry.kind === 'view' && entry.view === 'start'
      ? undefined
      : target.tabs.find((t) => identity(t) === identity(entry));
  if (existing) {
    return updateLeaf({ ...workspace, activePane: target.id }, target.id, (leaf) => ({
      ...leaf,
      active: existing.id,
      tabs: leaf.tabs.map((t) =>
        t.id === existing.id
          ? {
              ...t,
              ...entry,
              state:
                entry.kind !== 'view' && entry.line
                  ? { ...t.state, navigation: (Number(t.state.navigation) || 0) + 1 }
                  : t.state,
              preview: mode === 'tab' ? false : t.preview,
            }
          : t,
      ),
    }));
  }
  const tab = newTab(entry, mode === 'preview');
  return updateLeaf({ ...workspace, activePane: target.id }, target.id, (leaf) => {
    const replace = mode === 'preview' ? leaf.tabs.findIndex((t) => t.preview && !t.pinned) : -1;
    const tabs = [...leaf.tabs];
    if (replace >= 0) tabs.splice(replace, 1, tab);
    else tabs.push(tab);
    return { ...leaf, tabs, active: tab.id };
  });
}
export function splitPane(
  workspace: Workspace,
  pane: string,
  axis: Branch['axis'],
  duplicate = true,
  before = false,
): Workspace {
  const source = leaves(workspace.root).find((l) => l.id === pane);
  if (!source) return workspace;
  const current = source.tabs.find((t) => t.id === source.active);
  const copied =
    duplicate && current
      ? { ...current, id: uid(), preview: false, state: { ...current.state } }
      : null;
  const next: Leaf = {
    type: 'leaf',
    id: uid(),
    tabs: copied ? [copied] : [],
    active: copied?.id || '',
  };
  return {
    ...workspace,
    activePane: next.id,
    root: mapLayout(workspace.root, (node) =>
      node.id === pane
        ? {
            type: 'split',
            id: uid(),
            axis,
            ratio: 0.5,
            first: before ? next : node,
            second: before ? node : next,
          }
        : node,
    ),
  };
}
function prune(layout: Layout): Layout | null {
  if (layout.type === 'leaf') return layout.tabs.length ? layout : null;
  const first = prune(layout.first),
    second = prune(layout.second);
  return first && second ? { ...layout, first, second } : first || second;
}
export function closeTab(
  workspace: Workspace,
  pane: string,
  tabId: string,
  force = false,
): Workspace {
  const source = leaves(workspace.root).find((l) => l.id === pane),
    tab = source?.tabs.find((t) => t.id === tabId);
  if (!source || !tab || (tab.pinned && !force)) return workspace;
  const changed = updateLeaf(workspace, pane, (leaf) => {
    const index = leaf.tabs.findIndex((t) => t.id === tabId),
      tabs = leaf.tabs.filter((t) => t.id !== tabId);
    return {
      ...leaf,
      tabs,
      active:
        leaf.active === tabId ? tabs[Math.min(index, tabs.length - 1)]?.id || '' : leaf.active,
    };
  });
  const root = prune(changed.root) || { ...source, tabs: [], active: '' };
  const remaining = leaves(root);
  return {
    ...changed,
    root,
    activePane: remaining.some((l) => l.id === workspace.activePane)
      ? workspace.activePane
      : remaining[0].id,
    closed: [...workspace.closed, { pane, tab }].slice(-30),
  };
}
export function reopenTab(workspace: Workspace): Workspace {
  const last = workspace.closed.at(-1);
  if (!last) return workspace;
  const pane = leaves(workspace.root).find((l) => l.id === last.pane)?.id || workspace.activePane;
  const tab = { ...last.tab, id: uid(), preview: false };
  return updateLeaf(
    { ...workspace, activePane: pane, closed: workspace.closed.slice(0, -1) },
    pane,
    (leaf) => ({ ...leaf, tabs: [...leaf.tabs, tab], active: tab.id }),
  );
}
export function setTab(
  workspace: Workspace,
  pane: string,
  tabId: string,
  changes: Partial<Tab>,
): Workspace {
  return updateLeaf(workspace, pane, (leaf) => ({
    ...leaf,
    tabs: leaf.tabs.map((t) => (t.id === tabId ? ({ ...t, ...changes } as Tab) : t)),
  }));
}
export function moveTab(
  workspace: Workspace,
  from: string,
  tabId: string,
  to: string,
  before?: string,
): Workspace {
  const source = leaves(workspace.root).find((l) => l.id === from),
    target = leaves(workspace.root).find((l) => l.id === to),
    tab = source?.tabs.find((t) => t.id === tabId);
  if (!source || !target || !tab || before === tabId) return workspace;
  let result = updateLeaf(workspace, from, (leaf) => {
    const tabs = leaf.tabs.filter((t) => t.id !== tabId);
    return { ...leaf, tabs, active: leaf.active === tabId ? tabs[0]?.id || '' : leaf.active };
  });
  result = updateLeaf(result, to, (leaf) => {
    const tabs = [...leaf.tabs],
      index = before ? tabs.findIndex((t) => t.id === before) : -1;
    tabs.splice(index < 0 ? tabs.length : index, 0, { ...tab, preview: false });
    return { ...leaf, tabs, active: tabId };
  });
  const root = from === to ? result.root : prune(result.root) || result.root;
  return { ...result, root, activePane: to };
}
export function resizeSplit(workspace: Workspace, split: string, ratio: number): Workspace {
  return {
    ...workspace,
    root: mapLayout(workspace.root, (node) =>
      node.type === 'split' && node.id === split
        ? { ...node, ratio: Math.max(0.15, Math.min(0.85, ratio)) }
        : node,
    ),
  };
}
export function cycleTab(workspace: Workspace, delta: number): Workspace {
  const pane = activeLeaf(workspace),
    index = pane.tabs.findIndex((t) => t.id === pane.active);
  return pane.tabs.length
    ? activate(
        workspace,
        pane.id,
        pane.tabs[(index + delta + pane.tabs.length) % pane.tabs.length].id,
      )
    : workspace;
}
/** Reject damaged/old UI layouts. Never touch the user's case database. */
export function restoreWorkspace(raw: string | null, legacy?: string): Workspace {
  try {
    if (!raw || raw.length > 2_000_000) return initialWorkspace(legacy);
    const value = JSON.parse(raw);
    let count = 0;
    const ids = new Set<string>();
    const valid = (node: Layout, depth = 0): boolean => {
      if (!node || typeof node.id !== 'string' || ids.has(node.id) || ++count > 500 || depth > 30)
        return false;
      ids.add(node.id);
      if (node.type === 'split')
        return (
          ['row', 'column'].includes(node.axis) &&
          Number.isFinite(node.ratio) &&
          node.ratio >= 0.15 &&
          node.ratio <= 0.85 &&
          valid(node.first, depth + 1) &&
          valid(node.second, depth + 1)
        );
      if (node.type !== 'leaf' || !Array.isArray(node.tabs) || node.tabs.length > 150) return false;
      for (const t of node.tabs) {
        if (
          typeof t.id !== 'string' ||
          ids.has(t.id) ||
          typeof t.title !== 'string' ||
          typeof t.pinned !== 'boolean' ||
          typeof t.preview !== 'boolean' ||
          !t.state ||
          typeof t.state !== 'object'
        )
          return false;
        ids.add(t.id);
        if (
          t.kind === 'view'
            ? !VIEWS.some((v) => v[0] === t.view)
            : !['artifact', 'entity'].includes(t.kind) || !/^[a-f0-9]{32}$/.test(t.resourceId)
        )
          return false;
      }
      return node.tabs.length === 0
        ? node.active === ''
        : node.tabs.some((t) => t.id === node.active);
    };
    if (
      value.version !== 2 ||
      !valid(value.root) ||
      !leaves(value.root).some((l) => l.id === value.activePane)
    )
      return initialWorkspace(legacy);
    return {
      ...initialWorkspace(),
      ...value,
      expanded: Array.isArray(value.expanded)
        ? value.expanded.filter((x: unknown) => typeof x === 'string').slice(0, 5000)
        : [],
      closed: [],
      leftWidth: Math.max(180, Math.min(500, Number(value.leftWidth) || 248)),
      rightWidth: Math.max(230, Math.min(500, Number(value.rightWidth) || 288)),
      leftVisible: value.leftVisible !== false,
      rightVisible: value.rightVisible === true,
      leftTab: value.leftTab === 'search' ? 'search' : 'files',
      rightTab: ['properties', 'links', 'outline', 'notes'].includes(value.rightTab)
        ? value.rightTab
        : 'properties',
    };
  } catch {
    return initialWorkspace(legacy);
  }
}
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLocaleLowerCase().trim(),
    s = text.toLocaleLowerCase();
  if (!q) return 1;
  const exact = s.indexOf(q);
  if (exact >= 0) return 1000 - exact - (s.length - q.length) / 100;
  let cursor = 0,
    score = 0;
  for (const c of q) {
    const at = s.indexOf(c, cursor);
    if (at < 0) return -1;
    score += at === 0 || /[\s/._-]/.test(s[at - 1]) ? 20 : 1;
    score -= at - cursor;
    cursor = at + 1;
  }
  return score;
}
