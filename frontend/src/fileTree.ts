import type { Artifact } from './types';
export type TreeNode = {
  id: string;
  name: string;
  path: string;
  folder: boolean;
  artifact?: Artifact;
  children: TreeNode[];
};
export const normalPath = (path: string) => path.replace(/\\/g, '/').replace(/\/+/g, '/');
export function buildTree(files: Artifact[]): TreeNode[] {
  const originals = files.filter((f) => !f.parent_id);
  const paths = originals.map((f) => normalPath(f.path).split('/').slice(0, -1));
  const common = [...(paths[0] || [])];
  for (const p of paths)
    while (common.length && common.some((part, i) => part !== p[i])) common.pop();
  const roots: TreeNode[] = [],
    byId = new Map<string, TreeNode>();
  const insert = (root: TreeNode[], parts: string[], artifact: Artifact, prefix: string) => {
    let branch = root,
      path = prefix;
    parts.filter(Boolean).forEach((part, i, all) => {
      path += '/' + part;
      if (i === all.length - 1) {
        const node = {
          id: artifact.id,
          name: part,
          path: artifact.path,
          folder: false,
          artifact,
          children: [],
        };
        branch.push(node);
        byId.set(artifact.id, node);
      } else {
        let folder = branch.find((n) => n.folder && n.name === part);
        if (!folder) {
          folder = { id: 'folder:' + path, name: part, path, folder: true, children: [] };
          branch.push(folder);
        }
        branch = folder.children;
      }
    });
  };
  const groups = new Map<string, Artifact[]>();
  for (const f of originals) {
    const group = groups.get(f.path) || [];
    group.push(f);
    groups.set(f.path, group);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => b.imported.localeCompare(a.imported));
    group.forEach((file, i) => {
      const parts = normalPath(file.path).split('/').slice(common.length);
      if (i) parts[parts.length - 1] += ` (version ${group.length - i})`;
      insert(roots, parts.length ? parts : [file.name], file, 'source');
    });
  }
  let pending = files.filter((f) => f.parent_id);
  for (let pass = 0; pending.length && pass < 10; pass++) {
    const next: Artifact[] = [];
    for (const file of pending) {
      const parent = byId.get(file.parent_id!);
      if (parent) insert(parent.children, normalPath(file.name).split('/'), file, parent.id);
      else next.push(file);
    }
    if (next.length === pending.length) break;
    pending = next;
  }
  for (const orphan of pending) insert(roots, [orphan.name], orphan, 'derived');
  const sort = (nodes: TreeNode[]) => {
    nodes.sort(
      (a, b) =>
        Number(b.folder) - Number(a.folder) ||
        a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
    for (const n of nodes) sort(n.children);
  };
  sort(roots);
  return roots;
}
export function flattenTree(
  nodes: TreeNode[],
  expanded: Set<string>,
  query = '',
  depth = 1,
): { node: TreeNode; depth: number }[] {
  const result: { node: TreeNode; depth: number }[] = [],
    q = query.trim().toLocaleLowerCase();
  const matches = (n: TreeNode): boolean =>
    n.name.toLocaleLowerCase().includes(q) ||
    n.path.toLocaleLowerCase().includes(q) ||
    n.children.some(matches);
  for (const node of nodes) {
    if (q && !matches(node)) continue;
    result.push({ node, depth });
    if (q || expanded.has(node.id))
      result.push(...flattenTree(node.children, expanded, query, depth + 1));
  }
  return result;
}
export function ancestors(nodes: TreeNode[], id: string, parents: string[] = []): string[] | null {
  for (const node of nodes) {
    if (node.id === id) return parents;
    const result = ancestors(node.children, id, [...parents, node.id]);
    if (result) return result;
  }
  return null;
}
/** Resolve imported Markdown links using preserved source paths, never the network. */
export function resolveNote(
  files: Artifact[],
  from: Pick<Artifact, 'id' | 'name' | 'path'>,
  target: string,
): { file: Artifact; line?: number }[] {
  const raw = target.split('|')[0].split('#')[0].trim();
  if (!raw) {
    const file = files.find((f) => f.id === from.id);
    return file ? [{ file }] : [];
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) || decoded.startsWith('//')) return [];
  const path = normalPath(decoded).replace(/^\.\//, '').replace(/\.md$/i, '');
  const directory = normalPath(from.path).split('/').slice(0, -1).join('/');
  const normalize = (p: string) => {
    const out: string[] = [];
    for (const part of p.split('/')) {
      if (part === '..') out.pop();
      else if (part !== '.') out.push(part);
    }
    return out.join('/').replace(/\.md$/i, '').toLocaleLowerCase();
  };
  const relative = normalize(directory + '/' + path),
    needle = normalize(path);
  const ranked = files
    .map((file) => {
      const full = normalize(normalPath(file.path)),
        basename = normalize(file.name);
      const score =
        full === relative ? 3 : full.endsWith('/' + needle) ? 2 : basename === needle ? 1 : 0;
      return { file, score };
    })
    .filter((f) => f.score)
    .sort((a, b) => b.score - a.score || b.file.imported.localeCompare(a.file.imported));
  if (!ranked.length) return [];
  const highest = ranked[0].score;
  const unique = new Map<string, Artifact>();
  for (const match of ranked.filter((m) => m.score === highest))
    if (!unique.has(match.file.path)) unique.set(match.file.path, match.file);
  return [...unique.values()].map((file) => ({ file }));
}
