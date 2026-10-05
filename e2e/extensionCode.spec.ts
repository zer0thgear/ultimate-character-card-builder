import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// Extensions with code: the example extension's dock tab asks the LLM for
// names and names the card, its field button shows a field's stats, and a
// probe extension finds it can't reach your settings, the app's page or
// storage, or the card without permission.

async function paste(page: Page, json: string, choice: string) {
  await page.getByRole('button', { name: 'Settings' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Extensions' }).click();
  await dialog.getByRole('button', { name: '📋 Paste a pack' }).click();
  await dialog.getByLabel('Pack JSON').fill(json);
  await dialog.getByRole('button', { name: 'Install', exact: true }).click();
  await page.getByRole('button', { name: choice }).click();
  await page.keyboard.press('Escape');
}

const probe = {
  uccb: 1,
  id: 'probe',
  name: 'Probe',
  version: '1.0.0',
  contributes: {},
  ui: [{ id: 'p', slot: 'dockTab', label: 'Probe', entry: 'p.html' }],
  files: {
    'p.html': `<pre id="out">running</pre><script>
const out = [];
const tryIt = async (name, fn) => { try { await fn(); out.push(name + ': open'); } catch { out.push(name + ': blocked'); } };
(async () => {
  await tryIt('settings', async () => { const r = await fetch('/api/settings'); await r.json(); });
  await tryIt('parent', () => parent.document.title);
  await tryIt('storage', () => localStorage.length);
  await tryIt('card', () => uccb.card.get());
  document.getElementById('out').textContent = out.join('\\n');
})();
</script>`,
  },
};

test('an extension with code adds a dock tab and a field button, inside its sandbox', async ({ page, request }) => {
  const connection = { id: 'c1', name: 'Mock', kind: 'openai', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'sk-secret', model: 'mock', params: { max_tokens: 200 } };
  // Start with no packs (other specs share the data folder).
  for (const p of (await (await request.get('/api/packs')).json()) as { pack: { id: string } }[]) await request.delete(`/api/packs/${p.pack.id}`);
  await request.put('/api/settings/llm', { data: { state: { connections: [connection], chatConnectionId: 'c1', assistConnectionId: 'c1' }, version: 0 } });
  const sent: string[] = [];
  await page.route('**/api/llm/chat', async (route) => {
    const body = route.request().postDataJSON() as { messages: { content: string }[] };
    sent.push(body.messages.map((m) => m.content).join('\n'));
    await route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'text', text: '1. Aria\n2. Brann\n3. Cael' })}\n${JSON.stringify({ type: 'done', stopReason: 'stop' })}\n` });
  });

  await page.goto('/');
  await paste(page, readFileSync('docs/extensions/name-ideas.uccb.json', 'utf8'), 'Install with its code');
  await page.getByRole('button', { name: '+ New card' }).first().click();
  await page.getByLabel('Description').first().fill('A storm witch from the northern fjords.');

  // The dock tab: names from the LLM, one click names the card.
  await page.getByRole('tab', { name: '🏷 Names' }).click();
  const names = page.frameLocator('iframe[title="Name ideas: Names"]');
  await names.getByPlaceholder(/A vibe/).fill('Norse');
  await names.getByRole('button', { name: 'Suggest' }).click();
  await expect(names.getByText('Brann')).toBeVisible();
  expect(sent.at(-1)).toContain('A storm witch from the northern fjords.');
  expect(sent.at(-1)).toContain('Wanted style: Norse');
  await names.locator('li', { hasText: 'Brann' }).getByRole('button', { name: 'Use' }).click();
  await expect(page.getByPlaceholder('Character name')).toHaveValue('Brann');

  // The field button: a dialog with the field's stats.
  await page.getByTitle('Field stats (🧩 Name ideas)').first().click();
  const stats = page.frameLocator('iframe[title="Name ideas: Field stats"]');
  await expect(stats.getByText('Words')).toBeVisible();
  await expect(stats.locator('tr', { hasText: 'Words' })).toContainText('7');
  await page.keyboard.press('Escape');

  // A probe with no permissions can't reach anything.
  await paste(page, JSON.stringify(probe), 'Install with its code');
  await page.getByRole('tab', { name: '🧩 Probe' }).click();
  const out = page.frameLocator('iframe[title="Probe: Probe"]').locator('#out');
  await expect(out).toHaveText(['settings: blocked', 'parent: blocked', 'storage: blocked', 'card: blocked'].join('\n'));

  // Stopping its code takes its tab away.
  await page.getByRole('button', { name: 'Settings' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Extensions' }).click();
  await dialog.locator('li', { hasText: '🧩 Probe' }).getByRole('button', { name: 'Stop its code' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tab', { name: '🧩 Probe' })).toHaveCount(0);
});
