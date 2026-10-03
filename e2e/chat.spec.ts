import { expect, test } from '@playwright/test';

// The test chat over a text-completion connection: the prompt goes out as
// one string in the instruct template, a hidden message is left out of it,
// and search finds a message.

test('text completion, hiding a message and searching the chat', async ({ page, request }) => {
  const connection = { id: 'tc', name: 'Local', kind: 'openai', baseUrl: 'http://127.0.0.1:9/v1', apiKey: '', model: 'local', params: { max_tokens: 50 }, textCompletion: true, instructId: 'builtin-chatml', contextId: 'builtin-default' };
  await request.put('/api/settings/llm', { data: { state: { connections: [connection], chatConnectionId: 'tc', assistConnectionId: 'tc' }, version: 0 } });

  const sent: { prompt?: string; messages: unknown[]; connection: { params: { stop?: string[] } } }[] = [];
  let reply = 0;
  await page.route('**/api/llm/chat', async (route) => {
    sent.push(route.request().postDataJSON());
    reply++;
    await route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'text', text: `Reply number ${reply} about the lantern.` })}\n${JSON.stringify({ type: 'done', stopReason: 'stop' })}\n` });
  });

  await page.goto('/');
  await page.getByRole('button', { name: '+ New card' }).first().click();
  await page.getByPlaceholder('Character name').fill('Keeper');
  await page.getByRole('tab', { name: /^Greetings/ }).click();
  await page.getByLabel('First message').fill('Welcome to the inn.');
  await page.getByRole('tab', { name: '💬 Test chat' }).click();
  await page.getByRole('button', { name: 'Start a chat' }).click();

  const box = page.locator('[data-chat-input]');
  await box.fill('Where is the secret cellar?');
  await box.press('Enter');
  await expect(page.getByText('Reply number 1 about the lantern.')).toBeVisible();
  expect(sent[0].prompt).toContain('<|im_start|>user\nWhere is the secret cellar?\n<|im_end|>\n<|im_start|>assistant\n');
  expect(sent[0].prompt).toContain('<|im_start|>assistant\nWelcome to the inn.');
  expect(sent[0].connection.params.stop).toContain('<|im_end|>');

  // Hide the question: the next prompt leaves it out.
  const question = page.locator('[data-msg]').filter({ hasText: 'Where is the secret cellar?' });
  await question.hover();
  await question.getByRole('button', { name: /Hide from the prompt/ }).click();
  await expect(question.getByRole('button', { name: '🙈 hidden' })).toBeVisible();
  await box.fill('And the key?');
  await box.press('Enter');
  await expect(page.getByText('Reply number 2 about the lantern.')).toBeVisible();
  expect(sent[1].prompt).not.toContain('secret cellar');
  expect(sent[1].prompt).toContain('And the key?');

  // Search: two replies hold "lantern", the newest is shown first.
  await page.getByTitle('Search this chat (Ctrl+F)').click();
  await page.getByRole('textbox', { name: 'Search this chat' }).fill('lantern');
  await expect(page.getByText('2 of 2')).toBeVisible();
  await expect(page.locator('mark', { hasText: 'lantern' })).toHaveCount(2);
  await page.getByRole('textbox', { name: 'Search this chat' }).press('Enter');
  await expect(page.getByText('1 of 2')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search this chat' }).fill('cellar');
  await expect(page.getByText('1 of 1')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search this chat' }).press('Escape');
  await expect(page.getByRole('textbox', { name: 'Search this chat' })).toBeHidden();
});

test('compare a reply from two connections and keep both as swipes', async ({ page, request }) => {
  const conn = (id: string, model: string) => ({ id, name: model, kind: 'openai', baseUrl: 'http://127.0.0.1:9/v1', apiKey: '', model, params: { max_tokens: 50 } });
  await request.put('/api/settings/llm', { data: { state: { connections: [conn('a', 'alpha'), conn('b', 'beta')], chatConnectionId: 'a', assistConnectionId: 'a' }, version: 0 } });
  await page.route('**/api/llm/chat', async (route) => {
    const model = route.request().postDataJSON().connection.model;
    await route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'text', text: `Written by ${model}.` })}\n${JSON.stringify({ type: 'done', stopReason: 'stop' })}\n` });
  });

  await page.goto('/');
  await page.getByRole('button', { name: '+ New card' }).first().click();
  await page.getByPlaceholder('Character name').fill('Twin');
  await page.getByRole('tab', { name: '💬 Test chat' }).click();
  await page.getByRole('button', { name: 'Start a chat' }).click();
  const box = page.locator('[data-chat-input]');
  await box.fill('Hello');
  await box.press('Enter');
  await expect(page.getByText('Written by alpha.')).toBeVisible();

  await page.getByRole('button', { name: '⚖ Compare' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Connection B')).toHaveValue('b');
  await dialog.getByRole('button', { name: 'Write both' }).click();
  await expect(dialog.getByTestId('compare-A')).toHaveText('Written by alpha.');
  await expect(dialog.getByTestId('compare-B')).toHaveText('Written by beta.');
  await dialog.getByRole('button', { name: 'Keep both' }).click();
  await expect(dialog).toBeHidden();
  // The last reply now has three versions, showing the last kept.
  await expect(page.getByText('3/3')).toBeVisible();
  await expect(page.locator('[data-msg]').last()).toContainText('Written by beta.');
});
