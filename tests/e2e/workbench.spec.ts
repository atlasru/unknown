import {
  test,
  expect,
  _electron as electron,
  type Page,
  type ElectronApplication,
} from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

function harness(prefix: string, imported?: string) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const exported = path.join(folder, 'export.zip');
  const launch = async () => {
    const app = await electron.launch({
      executablePath: process.env.ATLAS_EXECUTABLE || undefined,
      args: [
        ...(process.env.ATLAS_EXECUTABLE ? [] : [path.resolve('.')]),
        ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      ],
      env: {
        ...process.env,
        ATLAS_TEST: '1',
        ATLAS_DATA_DIR: path.join(folder, 'workspace'),
        ATLAS_TEST_IMPORT: imported || path.join(folder, 'custom.log'),
        ATLAS_TEST_EXPORT: exported,
      },
      timeout: 60000,
    });
    if (process.env.ATLAS_EXECUTABLE) {
      const actual = await app.evaluate(({ app }) => ({
        packaged: app.isPackaged,
        version: app.getVersion(),
      }));
      expect(actual).toEqual({ packaged: true, version: '1.1.0' });
      const asar = path.join(path.dirname(process.env.ATLAS_EXECUTABLE), 'resources', 'app.asar');
      const asarSha256 = createHash('sha256').update(fs.readFileSync(asar)).digest('hex');
      const metadataPath = 'docs/screenshots/production.json';
      fs.mkdirSync('docs/screenshots', { recursive: true });
      let previous: any = {};
      if (fs.existsSync(metadataPath)) previous = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      if (previous.asarSha256 !== asarSha256) previous = { screenshots: {} };
      fs.writeFileSync(
        metadataPath,
        JSON.stringify(
          {
            ...previous,
            version: actual.version,
            packaged: actual.packaged,
            platform: process.platform,
            executable: path.basename(process.env.ATLAS_EXECUTABLE),
            asarSha256,
            captureMethod: 'Playwright Electron against the packaged executable and frozen engine',
            nominalWindow: { width: 1480, height: 960 },
          },
          null,
          2,
        ) + '\n',
      );
    }
    return app;
  };
  return { folder, exported, launch };
}
const body = (page: Page) => page.locator('.active-leaf .tab-content:not([hidden])');
async function command(page: Page, name: string) {
  await page.keyboard.press('Control+p');
  await page.getByLabel('Search commands').fill(name);
  await page.keyboard.press('Enter');
}
async function openFile(page: Page, name: string, keep = false) {
  await page.keyboard.press('Control+o');
  await page.getByLabel('Search files').fill(name);
  await page.keyboard.press(keep ? 'Control+Enter' : 'Enter');
}
async function api<T = any>(
  page: Page,
  resource: string,
  method: 'GET' | 'POST' = 'GET',
  data?: unknown,
): Promise<T> {
  return page.evaluate(
    async ({ resource, method, data }) => window.atlas.api(resource, method, data),
    { resource, method, data },
  ) as Promise<T>;
}
async function watchAlerts(page: Page) {
  await page.evaluate(() => {
    const messages: string[] = [];
    (globalThis as any).__atlasAlerts = messages;
    const observer = new MutationObserver(() => {
      for (const alert of document.querySelectorAll('[role=alert]')) {
        const message = alert.textContent || '';
        if (message && !messages.includes(message)) messages.push(message);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  });
}
async function expectNoAlerts(page: Page) {
  expect(await page.evaluate(() => (globalThis as any).__atlasAlerts || [])).toEqual([]);
}
async function shot(page: Page, name: string) {
  const folder = process.env.ATLAS_EXECUTABLE ? 'docs/screenshots' : 'test-results/ui';
  fs.mkdirSync(folder, { recursive: true });
  const png = await page.screenshot({ path: `${folder}/${name}.png` });
  if (process.env.ATLAS_EXECUTABLE) {
    const metadataPath = 'docs/screenshots/production.json';
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const viewport = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      devicePixelRatio,
    }));
    const health = await api<{ version: string }>(page, '/health');
    metadata.screenshots[name] = {
      file: name + '.png',
      ...viewport,
      sha256: createHash('sha256').update(png).digest('hex'),
      engineVersion: health.version,
      capturedAt: new Date().toISOString(),
    };
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
  }
}
function verifyBundle(exported: string) {
  const result = execFileSync(
    process.env.ATLAS_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
    ['scripts/verify_bundle.py', exported],
    { encoding: 'utf8' },
  );
  expect(JSON.parse(result).ok).toBe(true);
}

test('complete 1.0 investigation: graph, provenance, queries, timeline, reviews, notes, native import, export, restart', async () => {
  const h = harness('atlas-investigation-');
  fs.writeFileSync(
    path.join(h.folder, 'custom.log'),
    '2026-10-06T09:00:00Z connect https://e2e.example/path 192.0.2.77\n',
  );
  let app = await h.launch();
  try {
    let page = await app.firstWindow();
    await watchAlerts(page);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await expect(body(page).getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    await expect(body(page).locator('.metric-value').first()).toHaveText('11');
    await shot(page, 'overview');
    await command(page, 'Evidence graph');
    await expect(body(page).getByText('Layout ready', { exact: true })).toBeVisible();
    await body(page).getByRole('button', { name: 'Event replay', exact: true }).click();
    await expect(body(page).getByLabel('Replay timestamp')).toBeVisible();
    await body(page).getByLabel('Play replay').click();
    await expect(body(page).getByLabel('Pause replay')).toBeVisible();
    await body(page).getByLabel('Pause replay').click();
    await body(page).getByRole('button', { name: 'Event replay', exact: true }).click();
    const picker = body(page).getByLabel('Select graph node');
    const option = picker.locator('option').filter({ hasText: /^cdn\.northstar\.example$/ });
    const domain = (await option.getAttribute('value')) as string;
    await picker.selectOption(domain);
    await expect(page.getByLabel('Evidence inspector')).toBeVisible();
    await expect(page.getByLabel('Evidence inspector').locator('.provenance-list')).toContainText(
      'network.jsonl',
    );
    await body(page).getByLabel('Trace a connection').click();
    await body(page).getByLabel('Path source').selectOption(domain);
    const ip = picker.locator('option').filter({ hasText: /^203\.0\.113\.42$/ });
    await body(page)
      .getByLabel('Path target')
      .selectOption((await ip.getAttribute('value')) as string);
    await body(page).getByRole('button', { name: 'Trace', exact: true }).click();
    await expect(body(page).locator('.route-result')).toContainText('1 observed hops');
    await shot(page, 'graph');
    await page
      .getByLabel('Evidence inspector')
      .locator('.provenance-list button')
      .filter({ hasText: 'network.jsonl' })
      .first()
      .click();
    await expect(body(page).locator('.source-line.highlighted')).toContainText(
      'cdn.northstar.example',
    );
    await body(page).getByLabel('Hex view').click();
    await expect(body(page).locator('.hex-view')).toContainText('00000000');
    await body(page).getByLabel('Source view', { exact: true }).click();
    await page.getByRole('tab', { name: 'Observations', exact: true }).click();
    await page.getByLabel('Evidence note').fill('Source-level E2E observation.');
    await page.getByRole('button', { name: 'Add observation' }).click();
    await expect(page.locator('.attached-notes')).toContainText('Source-level E2E observation.');
    await page.getByLabel('Toggle right sidebar').click();
    await command(page, 'Evidence vault');
    await body(page).getByRole('button', { name: 'name:decoded', exact: true }).click();
    await expect(body(page).locator('tbody tr')).toHaveCount(2);
    await body(page).locator('.file-cell').first().click();
    await expect(body(page).locator('.source-view')).toContainText('Invoke-WebRequest');
    await command(page, 'Evidence vault');
    await expect(body(page).getByRole('textbox')).toHaveValue('name:decoded');
    await page.keyboard.press('Control+Backslash');
    await expect(page.locator('.workspace-leaf')).toHaveCount(2);
    await expect(body(page).getByRole('textbox')).toHaveValue('name:decoded');
    await page.keyboard.press('Control+w');
    await expect(page.locator('.workspace-leaf')).toHaveCount(1);
    await expect(body(page).getByRole('textbox')).toHaveValue('name:decoded');
    await command(page, 'Event timeline');
    await body(page).getByLabel('Event type').selectOption('auth');
    await expect(body(page).locator('.event-card')).toHaveCount(13);
    await shot(page, 'timeline');
    await body(page).locator('.event-card').first().click();
    await expect(body(page).locator('.source-line.highlighted')).toContainText(
      'authentication failed',
    );
    await command(page, 'Event timeline');
    await expect(body(page).getByLabel('Event type')).toHaveValue('auth');
    await command(page, 'Review findings');
    await expect(
      body(page)
        .getByRole('heading', { name: /Periodic network activity/ })
        .first(),
    ).toBeVisible();
    await body(page).getByRole('button', { name: 'Reviewed', exact: true }).first().click();
    await body(page).getByLabel('Finding status').selectOption('reviewed');
    await expect(body(page).locator('.finding-card')).toHaveCount(1);
    await body(page).getByRole('button', { name: 'Dismiss', exact: true }).click();
    await body(page).getByLabel('Finding status').selectOption('dismissed');
    await expect(body(page).locator('.finding-card')).toHaveCount(1);
    await body(page).getByRole('button', { name: 'Reopen', exact: true }).click();
    await command(page, 'Analyst notebook');
    await body(page)
      .getByLabel('New analyst note')
      .fill('E2E conclusion: corroborated across independent files.');
    await body(page).getByLabel('Note tag').selectOption('conclusion');
    await body(page).getByRole('button', { name: 'Add note', exact: true }).click();
    await expect(body(page).locator('.notes-grid')).toContainText('E2E conclusion');
    await command(page, 'Integrity & export');
    await body(page).getByRole('button', { name: 'Verify integrity' }).click();
    await expect(
      body(page).getByRole('heading', { name: 'All source bytes and audit records verified.' }),
    ).toBeVisible();
    await body(page).getByRole('button', { name: 'Export bundle', exact: true }).click();
    await expect.poll(() => fs.existsSync(h.exported)).toBe(true);
    verifyBundle(h.exported);
    await page.getByRole('button', { name: 'Import evidence', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('1 added');
    await command(page, 'Evidence vault');
    await body(page).getByRole('textbox').fill('name:custom');
    await expect(body(page).locator('tbody')).toContainText('custom.log');
    await page.getByRole('button', { name: 'New investigation', exact: true }).click();
    await page.getByLabel('Case name', { exact: true }).fill('E2E / EMPTY');
    await page.getByRole('button', { name: 'Create investigation', exact: true }).click();
    await expect(body(page).locator('.metric-value').first()).toHaveText('0');
    await page.getByLabel('Active case').selectOption({ label: 'NORTHSTAR / 017' });
    await command(page, 'Entity index');
    await body(page).getByRole('textbox').fill('e2e.example');
    await expect(body(page).locator('tbody')).toContainText('e2e.example');
    expect(errors).toEqual([]);
    await expectNoAlerts(page);
    await app.close();
    app = await h.launch();
    page = await app.firstWindow();
    await expect(
      body(page).getByRole('heading', { name: 'Entity index', exact: true }),
    ).toBeVisible();
    await body(page).getByRole('textbox').fill('e2e.example');
    await expect(body(page).locator('tbody')).toContainText('e2e.example');
    await command(page, 'Analyst notebook');
    await expect(body(page).locator('.notes-grid')).toContainText('E2E conclusion');
    await expect(body(page).locator('.notes-grid')).toContainText('Source-level E2E observation.');
  } finally {
    await app.close().catch(() => {});
  }
});

test('keyboard workspace: preview, pin, tabs, splits, resize, context menus, file tree and per-case persistence', async () => {
  const h = harness('atlas-workspace-');
  let app = await h.launch();
  try {
    let page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await expect(body(page).getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    await page.evaluate(() =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'з', code: 'KeyP', ctrlKey: true, bubbles: true }),
      ),
    );
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    await page.keyboard.press('Escape');
    await openFile(page, 'analyst-brief.md');
    await expect(body(page).locator('.markdown-reading')).toContainText('NORTHSTAR / CASE 017');
    await expect(page.locator('.workspace-tab.preview')).toHaveCount(1);
    await openFile(page, 'network.jsonl');
    await expect(page.locator('.workspace-tab.preview')).toHaveCount(1);
    await expect(page.getByRole('tab', { name: 'analyst-brief.md', exact: true })).toHaveCount(0);
    await command(page, 'Pin / unpin');
    await expect(page.locator('.tab-pin')).toHaveCount(1);
    await openFile(page, 'analyst-brief.md', true);
    await expect(page.locator('.workspace-tab')).toHaveCount(3);
    await expect(page.locator('.workspace-tab.preview')).toHaveCount(0);
    await shot(page, 'markdown');
    await page.keyboard.press('Control+Tab');
    await expect(body(page).getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    await page.keyboard.press('Control+Shift+Tab');
    await expect(body(page).locator('.markdown-reading')).toBeVisible();
    await page.keyboard.press('Control+t');
    await page.keyboard.press('Control+t');
    await expect(page.getByRole('tab', { name: 'New tab', exact: true })).toHaveCount(2);
    await page.keyboard.press('Control+w');
    await page.keyboard.press('Control+Shift+t');
    await expect(page.getByRole('tab', { name: 'New tab', exact: true })).toHaveCount(2);
    await page.keyboard.press('Control+w');
    await page.keyboard.press('Control+w');
    await page.keyboard.press('Control+Backslash');
    await expect(page.locator('.workspace-leaf')).toHaveCount(2);
    await command(page, 'Evidence graph');
    await expect(body(page).getByText('Layout ready', { exact: true })).toBeVisible();
    const splitter = page.getByRole('separator', { name: 'Resize split right', exact: true });
    await splitter.focus();
    const before = await page.locator('.workspace-leaf').first().boundingBox();
    await page.keyboard.press('ArrowRight');
    const after = await page.locator('.workspace-leaf').first().boundingBox();
    expect(after!.width).toBeGreaterThan(before!.width);
    await page.keyboard.press('Control+Shift+Backslash');
    await expect(page.locator('.workspace-leaf')).toHaveCount(3);
    await expect(
      page.getByRole('separator', { name: 'Resize split down', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Control+w');
    await expect(page.locator('.workspace-leaf')).toHaveCount(2);
    await page.keyboard.press('Control+Shift+r');
    await expect(page.getByLabel('Evidence inspector')).toBeVisible();
    await page.getByRole('tab', { name: 'Outline', exact: true }).click();
    await page.keyboard.press('Control+Alt+ArrowLeft');
    await page.getByRole('tab', { name: 'analyst-brief.md', exact: true }).first().click();
    await expect(page.getByLabel('Evidence inspector').locator('.outline-item')).toHaveCount(1);
    await expect(
      page.locator('.workspace-leaf').last().getByText('Layout ready', { exact: true }),
    ).toBeVisible();
    await shot(page, 'split-workspace');
    const selected = page.locator('.active-leaf .workspace-tab.active');
    await selected.focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menu', { name: 'Tab context menu' })).toBeVisible();
    await shot(page, 'context-menu');
    await page.getByRole('menuitem', { name: 'Reveal in file explorer' }).click();
    await expect(page.getByRole('tree', { name: 'Evidence file tree' })).toBeFocused();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menu', { name: 'File context menu' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Copy source path', exact: true }).click();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toContain(
      'analyst-brief.md',
    );
    await page.getByRole('separator', { name: 'Resize left sidebar' }).focus();
    await page.keyboard.press('ArrowRight');
    const width = await page
      .locator('.sidebar-container')
      .first()
      .evaluate((el) => el.getBoundingClientRect().width);
    await page.keyboard.press('Control+p');
    await page.getByLabel('Search commands').fill('split');
    await expect(
      page
        .getByRole('dialog', { name: 'Command palette' })
        .getByRole('option')
        .filter({ hasText: 'Workspace: Split' }),
    ).toHaveCount(2);
    await page.keyboard.press('ArrowDown');
    await expect(
      page.getByRole('dialog', { name: 'Command palette' }).getByRole('option').nth(1),
    ).toHaveAttribute('aria-selected', 'true');
    await shot(page, 'command-palette');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+Shift+f');
    await page.getByLabel('Search all evidence').fill('name:decoded');
    await expect(page.locator('.search-result-count')).toHaveText('2 matching files');
    await page.locator('.search-results button').first().click();
    await expect(body(page).locator('.source-view')).toContainText('Invoke-WebRequest');
    await page.keyboard.press('Control+Shift+e');
    const caseId = await page.getByLabel('Active case').inputValue();
    const persisted = await page.evaluate(
      (id) => localStorage.getItem('atlas-workspace-v2:' + id),
      caseId,
    );
    expect(JSON.parse(persisted!).root.type).toBe('split');
    await page.getByRole('button', { name: 'New investigation', exact: true }).click();
    await page.getByLabel('Case name', { exact: true }).fill('Isolated layout');
    await page.getByRole('button', { name: 'Create investigation', exact: true }).click();
    await expect(page.locator('.workspace-leaf')).toHaveCount(1);
    await page.getByLabel('Active case').selectOption(caseId);
    await expect(page.locator('.workspace-leaf')).toHaveCount(2);
    await page.getByLabel('Toggle left sidebar').click();
    await expect(page.getByLabel('Left sidebar', { exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
    await app.close();
    app = await h.launch();
    page = await app.firstWindow();
    await expect(page.locator('.workspace-leaf')).toHaveCount(2);
    await expect(page.getByLabel('Left sidebar', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Evidence inspector')).toBeVisible();
    await page.getByLabel('Toggle left sidebar').click();
    await expect(page.locator('.sidebar-container').first()).toHaveCSS('width', width + 'px');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800));
    await expect(page.locator('.statusbar')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await app.close().catch(() => {});
  }
});

test('Obsidian vault import: nested Markdown, wikilinks, aliases, relative links, GFM, original hashes, duplicate import, versions and export', async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-obsidian-'));
  fs.mkdirSync(path.join(vault, 'Notes'));
  fs.mkdirSync(path.join(vault, 'Archive'));
  fs.mkdirSync(path.join(vault, 'Media'));
  fs.mkdirSync(path.join(vault, '.obsidian'));
  const alpha =
    '---\naliases: [Исследование]\ntags: [atlas, evidence]\n---\n# Исследование\n\nA preserved Obsidian note with **strong text**.\n\n[[Beta|Related note]] · [[Beta#Related|Jump to heading]] · [Archived](../Archive/Beta.md)\n\n- [x] Source preserved\n- [ ] Review complete\n\n| Source | Result |\n| --- | --- |\n| Vault | imported |\n\n```text\n[[Not a link]]\n```\n\n![Attachment](../Media/chart.png)\n\n<script>globalThis.__atlasInjection=true</script>\n![Remote](https://remote.example/pixel.png)\n';
  fs.writeFileSync(path.join(vault, 'Notes', 'Alpha.md'), alpha);
  fs.writeFileSync(
    path.join(vault, 'Notes', 'Beta.md'),
    '# Related\n\nBack to [[Alpha]].\n2026-10-07T08:00:00Z connect https://vault.example 192.0.2.4\n',
  );
  fs.writeFileSync(
    path.join(vault, 'Archive', 'Beta.md'),
    '# Archived\n\nA distinct note with the same name.\n',
  );
  fs.writeFileSync(path.join(vault, '.obsidian', 'workspace.json'), '{}');
  fs.writeFileSync(
    path.join(vault, 'Media', 'chart.png'),
    Buffer.from('89504e470d0a1a0a00000000', 'hex'),
  );
  const h = harness('atlas-vault-', vault);
  let app = await h.launch();
  try {
    let page = await app.firstWindow();
    await watchAlerts(page);
    const requests: string[] = [];
    page.on('request', (r) => {
      if (/^https?:/.test(r.url())) requests.push(r.url());
    });
    await expect(body(page).getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New investigation', exact: true }).click();
    await page.getByLabel('Case name', { exact: true }).fill('Obsidian vault');
    await page.getByRole('button', { name: 'Create investigation', exact: true }).click();
    await page
      .locator('.sidebar-tabs')
      .getByRole('button', { name: 'Import folder', exact: true })
      .click();
    await expect(page.getByRole('status')).toContainText('5 added');
    const caseId = await page.getByLabel('Active case').inputValue();
    let files = await api(page, `/cases/${caseId}/artifacts`);
    expect(files.total).toBe(5);
    const imported = files.items.find((f: any) => f.name === 'Alpha.md');
    expect(imported.sha256).toBe(createHash('sha256').update(alpha).digest('hex'));
    expect((await api(page, `/cases/${caseId}/artifacts/${imported.id}`)).text).toBe(alpha);
    await openFile(page, 'Alpha.md', true);
    await expect(
      body(page).locator('.markdown-reading h1').filter({ hasText: 'Исследование' }),
    ).toBeVisible();
    await expect(body(page).locator('.markdown-reading table')).toContainText('Vault');
    await expect(body(page).locator('.markdown-reading input[type=checkbox]:checked')).toHaveCount(
      1,
    );
    await expect(body(page).getByRole('button', { name: 'Not a link', exact: true })).toHaveCount(
      0,
    );
    expect(await page.evaluate(() => !!(globalThis as any).__atlasInjection)).toBe(false);
    expect(requests).toEqual([]);
    await shot(page, 'obsidian-vault');
    await body(page).getByRole('button', { name: 'Jump to heading', exact: true }).click();
    await expect(body(page).locator('.source-line.highlighted')).toContainText('# Related');
    await body(page).getByLabel('Reading view', { exact: true }).click();
    await openFile(page, 'Alpha.md');
    await body(page).getByRole('button', { name: 'Related note', exact: true }).click();
    await expect(body(page).locator('.markdown-reading')).toContainText('Back to');
    await body(page).getByRole('button', { name: 'Alpha', exact: true }).click();
    await body(page).getByRole('button', { name: 'Archived', exact: true }).click();
    await expect(body(page).locator('.markdown-reading')).toContainText('A distinct note');
    await openFile(page, 'Alpha.md');
    await body(page).getByLabel('Show source properties').click();
    await expect(page.getByLabel('Evidence inspector')).toContainText(imported.sha256);
    await page.getByRole('tab', { name: 'Outline', exact: true }).click();
    await page.locator('.outline-item').click();
    await expect(body(page).locator('.source-line.highlighted')).toContainText('# Исследование');
    await body(page).getByLabel('Reading view', { exact: true }).click();
    await body(page).getByRole('button', { name: 'Attachment', exact: true }).click();
    await expect(body(page).locator('.source-description')).toContainText('binary');
    await page
      .locator('.sidebar-tabs')
      .getByRole('button', { name: 'Import folder', exact: true })
      .click();
    await expect(page.getByRole('status')).toContainText('0 added, 5 unchanged');
    fs.appendFileSync(
      path.join(vault, 'Notes', 'Alpha.md'),
      '\n## New observation\nPreserved as a new version.\n',
    );
    await page
      .locator('.sidebar-tabs')
      .getByRole('button', { name: 'Import folder', exact: true })
      .click();
    await expect(page.getByRole('status')).toContainText('1 added, 4 unchanged');
    files = await api(page, `/cases/${caseId}/artifacts`);
    expect(files.total).toBe(6);
    const versions = files.items.filter((f: any) => f.name === 'Alpha.md');
    expect(versions).toHaveLength(2);
    expect(versions.map((f: any) => f.sha256)).toContain(imported.sha256);
    await openFile(page, 'Alpha.md');
    await body(page).getByLabel('Show source properties').click();
    await page.getByRole('tab', { name: 'Properties', exact: true }).click();
    await expect(page.locator('.version-row')).toHaveCount(2);
    await page.getByRole('button', { name: 'Export evidence bundle', exact: true }).click();
    await expect.poll(() => fs.existsSync(h.exported)).toBe(true);
    verifyBundle(h.exported);
    const integrity = await api(page, `/cases/${caseId}/verify`, 'POST');
    expect(integrity.ok).toBe(true);
    await expectNoAlerts(page);
    const before = await api(page, `/cases/${caseId}/summary`);
    await app.close();
    app = await h.launch();
    page = await app.firstWindow();
    await expect(page.getByLabel('Active case')).toHaveValue(caseId);
    const after = await api(page, `/cases/${caseId}/summary`);
    expect(after.counts).toEqual(before.counts);
    expect((await api(page, `/cases/${caseId}/verify`, 'POST')).ok).toBe(true);
  } finally {
    await app.close().catch(() => {});
  }
});

test('desktop drag and drop reorders tabs, moves pinned documents and splits at the requested edge', async () => {
  const h = harness('atlas-drag-');
  const app = await h.launch();
  try {
    const page = await app.firstWindow();
    await expect(body(page).getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    await openFile(page, 'analyst-brief.md', true);
    await openFile(page, 'network.jsonl', true);
    await command(page, 'Pin / unpin');
    await page
      .getByRole('tab', { name: 'network.jsonl', exact: true })
      .dragTo(page.getByRole('tab', { name: 'analyst-brief.md', exact: true }));
    await expect(page.locator('.workspace-tab').nth(1)).toHaveAttribute(
      'aria-label',
      'network.jsonl',
    );
    await page.keyboard.press('Control+Backslash');
    await expect(page.locator('.workspace-leaf')).toHaveCount(2);
    await command(page, 'Evidence graph');
    const source = page
      .locator('.workspace-leaf')
      .first()
      .getByRole('tab', { name: 'network.jsonl', exact: true });
    const target = page
      .locator('.workspace-leaf')
      .last()
      .getByRole('tab', { name: 'Evidence graph', exact: true });
    await source.dragTo(target);
    await expect(
      page
        .locator('.workspace-leaf')
        .first()
        .getByRole('tab', { name: 'network.jsonl', exact: true }),
    ).toHaveCount(0);
    await expect(
      page
        .locator('.workspace-leaf')
        .last()
        .getByRole('tab', { name: 'network.jsonl', exact: true }),
    ).toHaveCount(2);
    // Two tabs of the same source are valid after duplicating a split. Close the duplicate, retain the moved original.
    await page
      .locator('.workspace-leaf')
      .last()
      .getByRole('tab', { name: 'network.jsonl', exact: true })
      .first()
      .getByRole('button', { name: 'Close tab network.jsonl' })
      .click();
    await expect(
      page
        .locator('.workspace-leaf')
        .last()
        .getByRole('tab', { name: 'network.jsonl', exact: true }),
    ).toHaveCount(1);
    const moved = page
      .locator('.workspace-leaf')
      .last()
      .getByRole('tab', { name: 'network.jsonl', exact: true });
    await expect(moved.locator('.tab-pin')).toHaveCount(1);
    const first = page.locator('.workspace-leaf').first(),
      box = await first.boundingBox();
    await moved.dragTo(first, { targetPosition: { x: 5, y: Math.floor(box!.height / 2) } });
    await expect(page.locator('.workspace-leaf')).toHaveCount(3);
    await expect(
      page
        .locator('.workspace-leaf')
        .first()
        .getByRole('tab', { name: 'network.jsonl', exact: true }),
    ).toBeVisible();
    const treeFile = page.getByRole('treeitem').filter({ hasText: 'authentication.log' });
    const bottom = page.locator('.workspace-leaf').last();
    const rect = await bottom.boundingBox();
    await treeFile.dragTo(bottom, {
      targetPosition: { x: Math.floor(rect!.width / 2), y: rect!.height - 5 },
    });
    await expect(page.locator('.workspace-leaf')).toHaveCount(4);
    await expect(
      page
        .locator('.workspace-leaf')
        .last()
        .getByRole('tab', { name: 'authentication.log', exact: true }),
    ).toBeVisible();
    await expect(body(page).locator('.source-view')).toContainText('authentication failed');
  } finally {
    await app.close().catch(() => {});
  }
});

test('large file explorer pages beyond 500 artifacts; keyboard tree, source paging and full-source find stay usable', async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-many-files-'));
  fs.mkdirSync(path.join(vault, 'Notes'));
  for (let i = 0; i < 600; i++)
    fs.writeFileSync(
      path.join(vault, 'Notes', `Note-${String(i).padStart(4, '0')}.md`),
      `# Note ${i}\nAn imported vault note.\n`,
    );
  fs.writeFileSync(
    path.join(vault, 'long.log'),
    Array.from({ length: 620 }, (_, i) =>
      i === 474 ? 'UNIQUE-LINE-475 evidence marker' : `Source row ${i + 1}`,
    ).join('\n'),
  );
  const h = harness('atlas-many-', vault),
    app = await h.launch();
  try {
    const page = await app.firstWindow();
    await expect(body(page).getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New investigation', exact: true }).click();
    await page.getByLabel('Case name', { exact: true }).fill('Large vault');
    await page.getByRole('button', { name: 'Create investigation', exact: true }).click();
    await page.getByRole('button', { name: 'Import folder', exact: true }).first().click();
    await expect(page.getByRole('status')).toContainText('601 added');
    await openFile(page, 'Note-0599.md', true);
    await expect(body(page).locator('.markdown-reading')).toContainText('Note 599');
    await page.keyboard.press('Control+Shift+e');
    const tree = page.getByRole('tree', { name: 'Evidence file tree' });
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('End');
    await expect(tree.getByRole('treeitem').filter({ hasText: 'Note-0599.md' })).toBeVisible();
    expect(await tree.locator('[role=treeitem]').count()).toBeLessThan(60);
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(body(page).locator('.markdown-reading')).toContainText('Note 0');
    await openFile(page, 'long.log', true);
    await expect(body(page).locator('.source-line')).toHaveCount(200);
    await body(page).getByLabel('Jump to source line').fill('475');
    await expect(body(page).locator('.source-line.highlighted')).toContainText('UNIQUE-LINE-475');
    await page.keyboard.press('Control+f');
    await page.getByLabel('Find text in source').fill('UNIQUE-LINE');
    await page.keyboard.press('Enter');
    await expect(body(page).locator('.source-line.highlighted')).toContainText('UNIQUE-LINE-475');
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Find text in source')).toHaveCount(0);
    await body(page).getByLabel('Previous source lines').click();
    await expect(body(page).locator('.source-line').first()).toContainText('Source row 201');
  } finally {
    await app.close().catch(() => {});
  }
});

test('legacy 1.0 preferences migrate while the existing investigation, hashes, notes and review records remain intact', async () => {
  const h = harness('atlas-upgrade-');
  let app = await h.launch();
  try {
    let page = await app.firstWindow();
    await expect(body(page).getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    const caseId = await page.getByLabel('Active case').inputValue();
    await api(page, `/cases/${caseId}/notes`, 'POST', {
      node_id: '',
      body: 'Existing Atlas 1.0 analyst conclusion.',
      tag: 'conclusion',
    });
    const findings = await api(page, `/cases/${caseId}/findings`);
    await api(page, `/cases/${caseId}/findings/${findings[0].id}`, 'POST', { status: 'reviewed' });
    const snapshot = {
      files: await api(page, `/cases/${caseId}/artifacts`),
      notes: await api(page, `/cases/${caseId}/notes`),
      findings: await api(page, `/cases/${caseId}/findings`),
      history: await api(page, `/cases/${caseId}/history`),
      summary: await api(page, `/cases/${caseId}/summary`),
    };
    await page.evaluate((id) => {
      localStorage.removeItem('atlas-workspace-v2:' + id);
      localStorage.setItem('atlas-view', 'timeline');
      localStorage.setItem('atlas-case', id);
    }, caseId);
    await app.close();
    app = await h.launch();
    page = await app.firstWindow();
    await expect(
      body(page).getByRole('heading', { name: 'Event timeline', exact: true }),
    ).toBeVisible();
    expect(await api(page, `/cases/${caseId}/artifacts`)).toEqual(snapshot.files);
    expect(await api(page, `/cases/${caseId}/notes`)).toEqual(snapshot.notes);
    expect(await api(page, `/cases/${caseId}/findings`)).toEqual(snapshot.findings);
    expect(await api(page, `/cases/${caseId}/history`)).toEqual(snapshot.history);
    expect((await api(page, `/cases/${caseId}/summary`)).counts).toEqual(snapshot.summary.counts);
    expect((await api(page, `/cases/${caseId}/verify`, 'POST')).ok).toBe(true);
    await command(page, 'Workbench guide');
    await expect(body(page).getByRole('heading', { name: 'Work with the keyboard' })).toBeVisible();
    await page.evaluate(
      (id) => localStorage.setItem('atlas-workspace-v2:' + id, '{damaged layout'),
      caseId,
    );
    await app.close();
    app = await h.launch();
    page = await app.firstWindow();
    await expect(
      body(page).getByRole('heading', { name: 'Workbench guide', exact: true }),
    ).toBeVisible();
    expect((await api(page, `/cases/${caseId}/verify`, 'POST')).ok).toBe(true);
  } finally {
    await app.close().catch(() => {});
  }
});
