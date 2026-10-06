import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('complete investigation: graph, provenance, query, timeline, review, notes, export and restart', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-e2e-'));
  const source = path.join(folder, 'custom.log'), exported = path.join(folder, 'export.zip');
  fs.writeFileSync(source, '2026-10-06T09:00:00Z connect https://e2e.example/path 192.0.2.77\n');
  const launch = () => electron.launch({ args: [path.resolve('.'), ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], env: { ...process.env, ATLAS_TEST: '1', ATLAS_DATA_DIR: path.join(folder, 'workspace'), ATLAS_TEST_IMPORT: source, ATLAS_TEST_EXPORT: exported }, timeout: 60000 });
  let app = await launch();
  let page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const nav = (label: string) => page.locator('.sidebar nav').getByRole('button', { name: label, exact: false }).click();
  await expect(page.getByRole('heading', { name: 'The evidence, connected.' })).toBeVisible();
  await expect(page.locator('.metric-value').first()).toHaveText('11');
  fs.mkdirSync('docs/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/overview.png' });

  await nav('Evidence graph');
  await expect(page.getByText('Layout ready', { exact: true })).toBeVisible();
  const option = page.getByLabel('Select graph node').locator('option').filter({ hasText: /^cdn\.northstar\.example$/ });
  await page.getByLabel('Select graph node').selectOption(await option.getAttribute('value') as string);
  await expect(page.getByLabel('Evidence inspector')).toBeVisible();
  await expect(page.locator('.provenance-list')).toContainText('network.jsonl');
  await page.screenshot({ path: 'docs/screenshots/graph.png' });
  await page.locator('.provenance-list button').filter({ hasText: 'network.jsonl' }).first().click();
  await expect(page.locator('.source-line.highlighted')).toContainText('cdn.northstar.example');
  await page.getByLabel('Close inspector').click();

  await nav('Evidence vault');
  await page.getByRole('button', { name: 'name:decoded', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.locator('.file-cell').first().click();
  await expect(page.locator('.source-view')).toContainText('Invoke-WebRequest');
  await page.getByLabel('Close inspector').click();

  await nav('Event timeline');
  await page.getByLabel('Event type').selectOption('auth');
  await expect(page.locator('.event-card')).toHaveCount(13);
  await page.locator('.event-card').first().click();
  await expect(page.locator('.source-line.highlighted')).toContainText('authentication failed');
  await page.getByLabel('Close inspector').click();
  await page.screenshot({ path: 'docs/screenshots/timeline.png' });

  await nav('Review findings');
  await expect(page.getByRole('heading', { name: /Periodic network activity/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Reviewed', exact: true }).first().click();
  await page.getByLabel('Finding status').selectOption('reviewed');
  await expect(page.locator('.finding-card')).toHaveCount(1);

  await nav('Analyst notebook');
  await page.getByLabel('New analyst note').fill('E2E conclusion: infrastructure corroborated across independent files.');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(page.locator('.note-card')).toContainText('E2E conclusion');

  await nav('Integrity & export');
  await page.getByRole('button', { name: 'Verify integrity' }).click();
  await expect(page.getByRole('heading', { name: 'All source bytes and audit records verified.' })).toBeVisible();
  await page.locator('.export-card').getByRole('button', { name: 'Export bundle' }).click();
  await expect.poll(() => fs.existsSync(exported)).toBe(true);
  await page.getByRole('button', { name: 'Import evidence', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('1 added');
  await nav('Evidence vault');
  await expect(page.locator('tbody')).toContainText('custom.log');

  await page.getByRole('button', { name: 'New investigation' }).click();
  await page.getByLabel('Case name', { exact: true }).fill('E2E / EMPTY');
  await page.getByRole('button', { name: 'Create investigation' }).click();
  await expect(page.locator('.metric-value').first()).toHaveText('0');
  await page.getByLabel('Active case').selectOption({ label: 'NORTHSTAR / 017' });
  await page.keyboard.press('Control+k');
  await page.getByLabel('Search commands').fill('Entity index');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Entity index' })).toBeVisible();
  expect(errors).toEqual([]);

  await app.close();
  app = await launch(); page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'Entity index' })).toBeVisible();
  await expect(page.locator('tbody')).toContainText('e2e.example');
  await page.locator('.sidebar nav').getByRole('button', { name: 'Analyst notebook', exact: false }).click();
  await expect(page.locator('.notes-grid')).toContainText('E2E conclusion');
  await app.close();
});
