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

// SillyTavern's layout: the numbers under the portrait (message number,
// how long the reply took, tokens, tokens a second), Edit beside the name
// and the rest behind ⋯; at phone width nothing runs off the side.
test('numbers under the portrait, buttons behind ⋯, no sideways scroll on a phone', async ({ page, request }) => {
  const connection = { id: 'c', name: 'Local', kind: 'openai', baseUrl: 'http://127.0.0.1:9/v1', apiKey: '', model: 'a-rather-long-model-name-for-the-header', params: { max_tokens: 50 } };
  await request.put('/api/settings/llm', { data: { state: { connections: [connection], chatConnectionId: 'c', assistConnectionId: 'c' }, version: 0 } });
  await page.route('**/api/llm/chat', async (route) => {
    await new Promise((r) => setTimeout(r, 300));
    await route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'text', text: 'The lantern flickers.' })}\n${JSON.stringify({ type: 'done', stopReason: 'stop', usage: { output: 42 } })}\n` });
  });

  await page.goto('/');
  await page.getByRole('button', { name: '+ New card' }).first().click();
  await page.getByPlaceholder('Character name').fill('Keeper');
  await page.getByRole('tab', { name: /^Greetings/ }).click();
  await page.getByLabel('First message').fill('It had been a couple of weeks since the lantern was lit. '.repeat(12));
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '+ Add' }).first().click();
  await page.getByRole('tab', { name: '💬 Test chat' }).click();
  await page.getByRole('button', { name: 'Start a chat' }).click();
  const box = page.locator('[data-chat-input]');
  await box.fill('Hello there.');
  await box.press('Enter');
  await expect(page.getByText('The lantern flickers.')).toBeVisible();

  const reply = page.locator('[data-msg]').filter({ hasText: 'The lantern flickers.' });
  // 42 tokens from the provider; the timer says when the first one came.
  await expect(reply.getByText(/^\d+\.\ds$/)).toHaveAttribute('title', /first token came after \d+\.\ds/);
  await expect(reply.getByText(/t\/s$/)).toBeVisible();
  await expect(reply.getByText('#2')).toBeVisible();
  await expect(reply.getByRole('button', { name: 'Copy', exact: true })).toHaveCount(0);
  // Its model says what wrote it: the connection and preset too.
  await expect(reply.getByText('a-rather-long-model-name-for-the-header')).toHaveAttribute('title', /Connection: Local\nPreset: none/);
  // SillyTavern's order: ⋯, then Edit.
  const order = await reply.locator('button[title="Edit"], button[aria-expanded]').evaluateAll((els) => els.map((e) => e.getAttribute('title')));
  expect(order).toEqual([expect.stringMatching(/^More:/), 'Edit']);
  await reply.hover();
  await reply.getByRole('button', { name: /^More:/ }).click();
  await expect(reply.getByRole('button', { name: 'Copy', exact: true })).toBeVisible();
  await reply.getByRole('button', { name: 'Fewer buttons' }).click();
  await expect(reply.getByRole('button', { name: 'Copy', exact: true })).toHaveCount(0);

  // The greeting's versions are under it now, as a reply's are.
  await expect(page.getByTitle('Next greeting')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('*')].filter((el) => {
      const s = getComputedStyle(el);
      return (s.overflowX === 'auto' || s.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1 && el.closest('[data-msg]') === null && el.querySelector('[data-msg]');
    }).length,
  );
  expect(overflow).toBe(0);
  await page.screenshot({ path: 'test-results/chat-phone.png' });
});
