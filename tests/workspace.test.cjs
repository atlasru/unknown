const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
async function load(name) {
  const source = stripTypeScriptTypes(
    fs.readFileSync(path.resolve('frontend/src/' + name + '.ts'), 'utf8'),
  );
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}
let w, tree;
test.before(async () => {
  [w, tree] = await Promise.all([load('workspace'), load('fileTree')]);
});
const file = (id, name, source = '/vault/' + name, extra = {}) => ({
  id: id.repeat(32),
  name,
  path: source,
  imported: '2026-10-07T10:00:00Z',
  parent_id: null,
  extension: name.split('.').at(-1),
  size: 30,
  sha256: 'a'.repeat(64),
  relation: 'original',
  mentions: 0,
  findings: 0,
  metadata: {},
  ...extra,
});
const entry = (id) => ({ kind: 'artifact', resourceId: id.repeat(32), title: id + '.md' });
test('single click replaces only the temporary preview; committed and pinned tabs survive', () => {
  let s = w.initialWorkspace();
  s = w.openEntry(s, entry('a'), 'preview');
  const preview = w.activeTab(s).id;
  s = w.openEntry(s, entry('b'), 'preview');
  assert.equal(w.activeLeaf(s).tabs.length, 2);
  assert.ok(!w.activeLeaf(s).tabs.some((t) => t.id === preview));
  s = w.openEntry(s, entry('b'), 'tab');
  assert.equal(w.activeTab(s).preview, false);
  s = w.openEntry(s, entry('c'), 'preview');
  assert.equal(w.activeLeaf(s).tabs.length, 3);
  s = w.setTab(s, s.activePane, w.activeTab(s).id, { pinned: true });
  s = w.openEntry(s, entry('d'), 'preview');
  assert.equal(w.activeLeaf(s).tabs.length, 4);
  assert.equal(w.activeLeaf(s).tabs.find((t) => t.resourceId === 'c'.repeat(32)).pinned, true);
  s = w.openEntry(s, entry('b'), 'preview');
  assert.equal(w.activeLeaf(s).tabs.length, 4);
  assert.equal(w.activeTab(s).preview, false);
});
test('new blank tabs are distinct; cycling and reopen preserve resource, state and pins', () => {
  let s = w.initialWorkspace();
  s = w.openEntry(s, w.viewEntry('start'));
  s = w.openEntry(s, w.viewEntry('start'));
  assert.equal(w.activeLeaf(s).tabs.length, 3);
  s = w.openEntry(s, entry('a'));
  const tab = w.activeTab(s);
  s = w.setTab(s, s.activePane, tab.id, { pinned: true, state: { mode: 'hex' } });
  assert.equal(w.closeTab(s, s.activePane, tab.id), s);
  s = w.closeTab(s, s.activePane, tab.id, true);
  assert.equal(s.closed.length, 1);
  s = w.reopenTab(s);
  assert.equal(w.activeTab(s).resourceId, tab.resourceId);
  assert.equal(w.activeTab(s).state.mode, 'hex');
  assert.equal(w.activeTab(s).pinned, true);
  assert.notEqual(w.activeTab(s).id, tab.id);
  const original = w.activeTab(s).id;
  s = w.cycleTab(s, 1);
  s = w.cycleTab(s, -1);
  assert.equal(w.activeTab(s).id, original);
});
test('nested panes split in either direction, retain tab state and prune without losing siblings', () => {
  let s = w.openEntry(w.initialWorkspace(), entry('a'));
  const original = s.activePane;
  s = w.setTab(s, original, w.activeTab(s).id, { state: { mode: 'source' } });
  s = w.splitPane(s, original, 'row');
  const right = s.activePane;
  assert.equal(w.leaves(s.root).length, 2);
  assert.equal(w.activeTab(s).state.mode, 'source');
  s = w.splitPane(s, right, 'column');
  const bottom = s.activePane;
  assert.equal(w.leaves(s.root).length, 3);
  assert.equal(s.root.second.axis, 'column');
  s = w.closeTab(s, bottom, w.activeTab(s).id);
  assert.equal(w.leaves(s.root).length, 2);
  assert.equal(s.activePane, original);
  s = w.openEntry(s, entry('b'), 'split-left', right);
  assert.equal(s.root.second.first.id, s.activePane);
  s = w.openEntry(s, entry('c'), 'split-up');
  assert.equal(w.leaves(s.root).length, 4);
  assert.equal(w.leaves(s.root)[1].id, s.activePane);
});
test('moving and reordering a pinned tab does not create a duplicate or empty orphan pane', () => {
  let s = w.openEntry(w.initialWorkspace(), entry('a'));
  const first = s.activePane,
    a = w.activeTab(s).id;
  s = w.openEntry(s, entry('b'));
  const b = w.activeTab(s).id;
  s = w.setTab(s, first, a, { pinned: true });
  s = w.moveTab(s, first, b, first, a);
  assert.deepEqual(
    w.activeLeaf(s).tabs.map((t) => t.title),
    ['Overview', 'b.md', 'a.md'],
  );
  s = w.splitPane(s, first, 'row', false);
  const next = s.activePane;
  s = w.moveTab(s, first, a, next);
  assert.equal(w.activeTab(s).pinned, true);
  assert.equal(
    w
      .leaves(s.root)
      .flatMap((l) => l.tabs)
      .filter((t) => t.id === a).length,
    1,
  );
  s = w.moveTab(s, next, a, first);
  assert.equal(w.leaves(s.root).length, 1);
  assert.equal(s.activePane, first);
});
test('closing the last tab leaves a usable empty workspace and reopening restores it', () => {
  let s = w.initialWorkspace();
  s = w.closeTab(s, s.activePane, w.activeTab(s).id);
  assert.equal(w.leaves(s.root).length, 1);
  assert.equal(w.activeLeaf(s).tabs.length, 0);
  s = w.reopenTab(s);
  assert.equal(w.activeTab(s).view, 'overview');
});
test('workspace persistence validates corrupted layouts, migrates the legacy view and clamps sizes', () => {
  let s = w.openEntry(w.initialWorkspace('timeline'), entry('a'), 'split-right');
  s = {
    ...s,
    rightVisible: true,
    rightTab: 'outline',
    leftWidth: 900,
    rightWidth: 10,
    expanded: ['folder:/vault', 1],
    leftTab: 'search',
  };
  const restored = w.restoreWorkspace(JSON.stringify(s));
  assert.equal(w.leaves(restored.root).length, 2);
  assert.equal(restored.activePane, s.activePane);
  assert.equal(restored.leftWidth, 500);
  assert.equal(restored.rightWidth, 230);
  assert.deepEqual(restored.expanded, ['folder:/vault']);
  assert.equal(restored.rightTab, 'outline');
  assert.equal(w.activeTab(w.restoreWorkspace('{broken', 'timeline')).view, 'timeline');
  assert.equal(w.activeTab(w.restoreWorkspace(null, 'not-a-view')).view, 'overview');
  const corrupt = structuredClone(s);
  corrupt.root.second.tabs[0].resourceId = '../unsafe';
  assert.equal(w.leaves(w.restoreWorkspace(JSON.stringify(corrupt)).root).length, 1);
  const duplicate = structuredClone(s);
  duplicate.root.second.id = duplicate.root.first.id;
  assert.equal(w.leaves(w.restoreWorkspace(JSON.stringify(duplicate)).root).length, 1);
  s = w.resizeSplit(s, s.root.id, 99);
  assert.equal(s.root.ratio, 0.85);
  s = w.resizeSplit(s, s.root.id, -5);
  assert.equal(s.root.ratio, 0.15);
});
test('fuzzy navigation supports word-boundary matches, Cyrillic and no-match queries', () => {
  assert.ok(
    w.fuzzyScore('event timeline', 'Event timeline') > w.fuzzyScore('et', 'Event timeline'),
  );
  assert.ok(w.fuzzyScore('et', 'Event timeline') >= 0);
  assert.ok(w.fuzzyScore('иссл', 'Исследование') > 0);
  assert.equal(w.fuzzyScore('xyz', 'Overview'), -1);
  assert.equal(w.fuzzyScore('', 'anything'), 1);
});
test('file explorer preserves Windows folders, source versions and nested derived evidence', () => {
  const a = file('a', 'Alpha.md', 'C:\\vault\\Notes\\Alpha.md'),
    b = file('b', 'Beta.md', 'C:\\vault\\Beta.md');
  const old = file('c', 'Alpha.md', a.path, { imported: '2026-10-06T09:00:00Z' }),
    zip = file('d', 'Bundle.zip', 'C:\\vault\\Bundle.zip');
  const member = file('e', 'nested/payload.ps1', 'Bundle.zip!/nested/payload.ps1', {
      parent_id: zip.id,
      relation: 'archive_member',
    }),
    decoded = file('f', 'decoded-1.ps1', 'payload.ps1!decoded', {
      parent_id: member.id,
      relation: 'decoded',
    });
  const built = tree.buildTree([a, b, old, zip, member, decoded]);
  assert.deepEqual(
    built.map((n) => n.name),
    ['Notes', 'Beta.md', 'Bundle.zip'],
  );
  assert.deepEqual(
    built[0].children.map((n) => n.name),
    ['Alpha.md', 'Alpha.md (version 1)'],
  );
  assert.equal(tree.ancestors(built, decoded.id).length, 3);
  const flat = tree.flattenTree(built, new Set(), 'payload');
  assert.ok(flat.some((n) => n.node.id === member.id));
  assert.ok(!flat.some((n) => n.node.id === b.id));
  assert.equal(tree.flattenTree(built, new Set()).length, 3);
});
test('Obsidian links resolve aliases, relative paths and latest versions without remote lookups', () => {
  const a = file('a', 'Alpha.md', '/vault/Notes/Alpha.md'),
    b = file('b', 'Beta.md', '/vault/Notes/Beta.md'),
    c = file('c', 'Beta.md', '/vault/Archive/Beta.md');
  const old = file('d', 'Beta.md', b.path, { imported: '2026-10-06T10:00:00Z' }),
    media = file('e', 'chart.png', '/vault/Media/chart.png');
  const files = [a, b, c, old, media];
  assert.equal(tree.resolveNote(files, a, 'Beta#Heading|Friendly')[0].file.id, b.id);
  assert.equal(tree.resolveNote(files, a, '../Archive/Beta.md')[0].file.id, c.id);
  assert.equal(tree.resolveNote(files, a, '../Media/chart.png')[0].file.id, media.id);
  assert.equal(tree.resolveNote(files, a, '#Heading')[0].file.id, a.id);
  assert.equal(tree.resolveNote(files, media, 'Beta').length, 2);
  assert.deepEqual(tree.resolveNote(files, a, 'https://remote.example/a'), []);
  assert.deepEqual(tree.resolveNote(files, a, '//remote.example/a'), []);
  assert.deepEqual(tree.resolveNote(files, a, 'Missing'), []);
  const member = file('f', 'Inside.md', '/vault/Bundle.zip!/Inside.md', {
    parent_id: a.id,
    relation: 'archive_member',
  });
  assert.equal(tree.resolveNote([...files, member], a, 'Inside')[0].file.id, member.id);
});
test('the shipped 1.0 engine and sandbox preload remain byte-for-byte unchanged in this UI release', () => {
  const { createHash } = require('node:crypto');
  const baseline = JSON.parse(fs.readFileSync('tests/fixtures/engine-1.0.0.json', 'utf8'));
  for (const [filename, expected] of Object.entries(baseline.sha256))
    assert.equal(
      createHash('sha256').update(fs.readFileSync(filename)).digest('hex'),
      expected,
      filename,
    );
});
test('Markdown outline keeps original line numbers, excludes YAML and mixed fenced code; wikilinks skip code nodes', async () => {
  const md = await load('markdown');
  const text =
    '---\naliases: [Example]\n---\n# Intro\n````text\n```\n# Not a heading\n````\n## Real heading ##\n';
  assert.equal(md.markdownParts(text).offset, 3);
  assert.deepEqual(md.outline(text), [
    { line: 4, level: 1, title: 'Intro' },
    { line: 9, level: 2, title: 'Real heading' },
  ]);
  const ast = {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [{ type: 'text', value: 'Read [[Notes/Beta#Heading|Friendly]] and [[Alpha]].' }],
      },
      { type: 'code', value: '[[Ignored]]' },
      { type: 'inlineCode', value: '[[Ignored]]' },
    ],
  };
  md.remarkWikiLinks()(ast);
  const links = ast.children[0].children.filter((n) => n.type === 'link');
  assert.equal(links.length, 2);
  assert.equal(links[0].children[0].value, 'Friendly');
  assert.equal(decodeURIComponent(links[0].url.slice(11)), 'Notes/Beta#Heading|Friendly');
  assert.equal(ast.children[1].value, '[[Ignored]]');
});
