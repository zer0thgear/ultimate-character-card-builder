import { expect, test } from '@playwright/test';

// 📖 Lorebooks, the bank: a card's lorebook is offered to it on import (as
// SillyTavern asks), a book can be on in every chat (global) or be a chat's
// own, and the test chat scans them all with the card's, the bank copy of
// the card's own lorebook skipped.

const entry = (keys: string[], content: string) => ({ keys, content, extensions: {}, enabled: true, insertion_order: 100, use_regex: false });

test("lorebooks from the bank go into the chat beside the card's", async ({ page, request }) => {
  const connection = { id: 'cc', name: 'Chat', kind: 'openai', baseUrl: 'http://127.0.0.1:9/v1', apiKey: '', model: 'm', params: { max_tokens: 50 } };
  await request.put('/api/settings/llm', { data: { state: { connections: [connection], chatConnectionId: 'cc', assistConnectionId: 'cc' }, version: 0 } });
  await request.post('/api/lorebooks', { data: { id: 'ship', book: { name: 'Ship lore', extensions: {}, entries: [entry(['ship'], 'The ship leaks.')] }, createdAt: 1 } });

  const sent: { messages: { content: string }[] }[] = [];
  await page.route('**/api/llm/chat', async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'text', text: `Reply ${sent.length}.` })}\n${JSON.stringify({ type: 'done', stopReason: 'stop' })}\n` });
  });
  const prompt = (i: number) => sent[i].messages.map((m) => m.content).join('\n');

  await page.goto('/');
  // A world lorebook, imported into the bank and switched on for every chat.
  await page.getByRole('button', { name: '📖 Lorebooks' }).click();
  const dialog = page.getByRole('dialog');
  const world = { spec: 'lorebook_v3', data: { name: 'World', extensions: {}, entries: [entry(['north'], 'The north is cold.')] } };
  const [bankChooser] = await Promise.all([page.waitForEvent('filechooser'), dialog.getByRole('button', { name: 'Import…' }).click()]);
  await bankChooser.setFiles({ name: 'world.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(world)) });
  const row = dialog.locator('div.rounded-md').filter({ hasText: 'World' }).filter({ has: page.getByRole('button', { name: 'Global' }) });
  await row.getByRole('button', { name: 'Global' }).click();
  await expect(row.getByRole('button', { name: '🌐 Global' })).toBeVisible();
  await page.keyboard.press('Escape');

  // A card with a lorebook: importing it offers the lorebook to the bank.
  const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Keeper', description: 'Keeps the inn.', first_mes: 'Welcome.', character_book: { extensions: {}, entries: [entry(['cellar'], 'The cellar hides a door.')] } } };
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Import a card…' }).click()]);
  await chooser.setFiles({ name: 'keeper.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(card)) });
  await expect(page.getByText('Keeper has a lorebook. Add it to your Lorebooks?')).toBeVisible();
  await page.getByRole('button', { name: 'Add it' }).click();
  await expect(page.getByText(`Added "Keeper's Lorebook" to Lorebooks.`)).toBeVisible();
  const books = await (await request.get('/api/lorebooks')).json();
  expect(books.map((b: { book: { name: string } }) => b.book.name)).toEqual(['Ship lore', 'World', "Keeper's Lorebook"]);

  // The chat scans the card's lorebook and the global one; the card's own
  // copy in the bank isn't read twice, even switched on globally.
  await page.getByRole('button', { name: 'Close this card (back to the home screen)' }).click();
  await page.getByRole('button', { name: '📖 Lorebooks' }).click();
  const copyRow = dialog.locator('div.rounded-md').filter({ hasText: "Keeper's Lorebook" }).filter({ has: page.getByRole('button', { name: 'Global' }) });
  await copyRow.getByRole('button', { name: 'Global' }).click();
  await expect(copyRow.getByRole('button', { name: '🌐 Global' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Keeper/ }).first().click();
  await page.getByRole('tab', { name: '💬 Test chat' }).click();
  await page.getByRole('button', { name: 'Start a chat' }).click();
  const box = page.locator('[data-chat-input]');
  await box.fill('Is the cellar door facing north?');
  await box.press('Enter');
  await expect(page.getByText('Reply 1.')).toBeVisible();
  expect(prompt(0)).toContain('The cellar hides a door.');
  expect(prompt(0)).toContain('The north is cold.');
  expect(prompt(0).split('The cellar hides a door.').length).toBe(2);

  // A chat's own lorebook, picked in Chat settings.
  await page.getByTitle('Chat settings: connection, persona, preset').first().click();
  await page.getByTestId('chat-lorebooks').getByLabel("This chat's").selectOption({ label: 'Ship lore (1)' });
  await box.fill('Can the ship sail?');
  await box.press('Enter');
  await expect(page.getByText('Reply 2.')).toBeVisible();
  expect(prompt(1)).toContain('The ship leaks.');
});
