import { expect, test } from '@playwright/test';

// Chat display: both portraits start on the left (as SillyTavern), each can
// move to the right, and Flat drops the bubbles.

test('portrait sides and Flat chat style', async ({ page, request }) => {
  const connection = { id: 'c', name: 'Local', kind: 'openai', baseUrl: 'http://127.0.0.1:9/v1', apiKey: '', model: 'local', params: { max_tokens: 50 } };
  await request.put('/api/settings/llm', { data: { state: { connections: [connection], chatConnectionId: 'c', assistConnectionId: 'c' }, version: 0 } });
  await page.route('**/api/llm/chat', (route) => route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'text', text: 'The lantern flickers.' })}\n${JSON.stringify({ type: 'done', stopReason: 'stop' })}\n` }));

  await page.goto('/');
  await page.getByRole('button', { name: '+ New card' }).first().click();
  await page.getByPlaceholder('Character name').fill('Keeper');
  await page.getByRole('tab', { name: '💬 Test chat' }).click();
  await page.getByRole('button', { name: 'Start a chat' }).click();
  const box = page.locator('[data-chat-input]');
  await box.fill('Hello there.');
  await box.press('Enter');
  await expect(page.getByText('The lantern flickers.')).toBeVisible();

  const row = (text: string) => page.locator('[data-msg]').filter({ hasText: text }).locator('div.group').first();
  const mine = row('Hello there.');
  const theirs = row('The lantern flickers.');
  await expect(mine).not.toHaveClass(/flex-row-reverse/);
  await expect(theirs).not.toHaveClass(/flex-row-reverse/);
  await page.screenshot({ path: 'test-results/chat-bubbles-left.png' });

  // Chat settings: you on the right, Flat.
  await page.getByTitle(/Chat settings/).first().click();
  await page.getByLabel('Your portrait side').selectOption('right');
  await page.getByLabel('Chat style').selectOption('flat');
  await expect(mine).toHaveClass(/flex-row-reverse/);
  await expect(theirs).not.toHaveClass(/flex-row-reverse/);
  await expect(theirs).toHaveClass(/border-b/);
  await page.getByTitle(/Chat settings/).first().click();
  await page.screenshot({ path: 'test-results/chat-flat-user-right.png' });
});
