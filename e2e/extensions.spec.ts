import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// Extension packs: install the example pack by pasting it, see its prompt
// in Settings → Assistant and its choices in the lorebook wizard, check the
// assistant sends its prompt, then uninstall it and see it all go.

test('an extension pack installs, changes prompts and wizard choices, and uninstalls cleanly', async ({ page, request }) => {
  const connection = { id: 'c1', name: 'Mock', kind: 'openai', baseUrl: 'http://127.0.0.1:9/v1', apiKey: '', model: 'mock', params: { max_tokens: 200 } };
  await request.put('/api/settings/llm', { data: { state: { connections: [connection], chatConnectionId: 'c1', assistConnectionId: 'c1' }, version: 0 } });
  const systems: string[] = [];
  await page.route('**/api/llm/chat', async (route) => {
    const body = route.request().postDataJSON() as { messages: { role: string; content: string }[] };
    systems.push(body.messages[0]?.content ?? '');
    await route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'text', text: 'Rain.' })}\n${JSON.stringify({ type: 'done', stopReason: 'stop' })}\n` });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Extensions' }).click();
  await expect(dialog.getByText('No extension packs installed.')).toBeVisible();
  await dialog.getByRole('button', { name: '📋 Paste a pack' }).click();
  await dialog.getByLabel('Pack JSON').fill(readFileSync('docs/extensions/noir.uccb.json', 'utf8'));
  await dialog.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(dialog.getByText('🧩 Noir')).toBeVisible();
  await expect(dialog.getByText(/Adds: 1 assistant prompt, 4 lorebook wizard focus chips/)).toBeVisible();

  // Its prompt stands in for the built-in one, marked as the pack's.
  await dialog.getByRole('tab', { name: 'Assistant' }).click();
  await dialog.getByText('✨ Field tools').click();
  await expect(dialog.getByText('🧩 Noir').first()).toBeVisible();
  await expect(dialog.getByLabel('✨ Field tools: System prompt')).toHaveValue(/hard-boiled noir/);
  await page.keyboard.press('Escape');

  // The lorebook wizard offers its choices.
  await page.getByRole('button', { name: '+ New card' }).first().click();
  await page.getByPlaceholder('Character name').fill('Sam');
  await page.getByRole('tab', { name: /^Lorebook/ }).click();
  await page.getByRole('button', { name: /🧙 Wizard/ }).click();
  await expect(page.getByRole('button', { name: 'Informants' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'A whole city (about 45)' })).toBeAttached();
  await page.keyboard.press('Escape');

  // And the assistant sends its prompt.
  await page.getByRole('tab', { name: /^Character/ }).click();
  await page.getByRole('button', { name: 'Writing assistant' }).first().click();
  await page.getByRole('button', { name: 'Polish' }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect.poll(() => systems.some((s) => s.includes('hard-boiled noir'))).toBe(true);
  await page.keyboard.press('Escape');

  // Uninstalling takes it all away.
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await dialog.getByRole('tab', { name: 'Extensions' }).click();
  await dialog.getByRole('button', { name: 'Uninstall' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Uninstall' }).last().click();
  await expect(dialog.getByText('No extension packs installed.')).toBeVisible();
  await dialog.getByRole('tab', { name: 'Assistant' }).click();
  await dialog.getByText('✨ Field tools').click();
  await expect(dialog.getByLabel('✨ Field tools: System prompt')).not.toHaveValue(/noir/);
  expect((await (await request.get('/api/packs')).json()).length).toBe(0);
});
