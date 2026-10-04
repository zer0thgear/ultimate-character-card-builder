import { expect, test } from '@playwright/test';

// Writing mode: a story started from the greeting, continued by a chat
// connection with the proofreading pass on, a part written again and
// stepped back to, and the Cast in the prompt.

test('writing a story with a chat connection and proofreading', async ({ page, request }) => {
  const connection = { id: 'cc', name: 'Chatty', kind: 'openai', baseUrl: 'http://127.0.0.1:9/v1', apiKey: '', model: 'm', params: { max_tokens: 200 } };
  await request.put('/api/settings/llm', { data: { state: { connections: [connection], chatConnectionId: 'cc', assistConnectionId: 'cc' }, version: 0 } });

  const sent: { messages: { role: string; content: string }[] }[] = [];
  await page.route('**/api/llm/chat', async (route) => {
    const body = route.request().postDataJSON();
    sent.push(body);
    const system: string = body.messages[0].content;
    // The writer repeats the story's last words and adds a note; the
    // proofreader hands back a clean part.
    if (system.startsWith('You read a story and list')) {
      const cast = JSON.stringify({ cast: [{ name: 'Oren', aliases: ['the kid'], description: 'A dockhand who rows out to the lighthouse.' }, { name: 'Keeper', description: 'Already in.' }] });
      return route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'text', text: cast })}\n${JSON.stringify({ type: 'done', stopReason: 'stop' })}\n` });
    }
    const text = system.startsWith('You proofread') ? `The lamp went out (take ${sent.length}).` : `The lighthouse stood dark. <continuation>The lamp went out.</continuation>`;
    await route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'text', text })}\n${JSON.stringify({ type: 'done', stopReason: 'stop' })}\n` });
  });

  await page.goto('/');
  await page.getByRole('button', { name: '+ New card' }).first().click();
  await page.getByPlaceholder('Character name').fill('Keeper');
  await page.getByRole('textbox', { name: 'Description' }).fill('{{char}} keeps the lighthouse.');
  await page.getByRole('tab', { name: /^Greetings/ }).click();
  await page.getByLabel('First message').fill('{{char}} watched the sea. The lighthouse stood dark.');

  await page.getByRole('tablist', { name: 'Mode' }).getByRole('tab', { name: '💬 Chat' }).click();
  await page.getByRole('tab', { name: 'Story' }).click();
  await page.getByRole('button', { name: 'Start a story…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start' }).click();

  const doc = page.getByRole('textbox', { name: 'The story' });
  await expect(doc).toHaveValue('Keeper watched the sea. The lighthouse stood dark.');

  await page.getByText('Proofread each part').click();
  await page.getByRole('button', { name: '✍ Continue' }).click();
  await expect(doc).toHaveValue('Keeper watched the sea. The lighthouse stood dark. The lamp went out (take 2).');
  expect(sent).toHaveLength(2);
  expect(sent[0].messages[0].content).toContain('## Cast\nKeeper: Keeper keeps the lighthouse.');
  expect(sent[0].messages[1].content).toContain('<story>\nKeeper watched the sea. The lighthouse stood dark.\n</story>');
  expect(sent[1].messages[1].content).toContain('<continuation>\nThe lamp went out.\n</continuation>');

  // Again: a second version, then back to the first.
  await page.getByRole('button', { name: 'Write the latest part again' }).click();
  await expect(doc).toHaveValue(/take 4\)\.$/);
  expect(sent[2].messages[1].content).toContain('The lighthouse stood dark.\n</story>');
  await page.getByRole('button', { name: 'Previous version' }).click();
  await expect(doc).toHaveValue(/take 2\)\.$/);

  // Undo takes the part away; the story's saved.
  await page.getByRole('button', { name: /^Undo the last change to the story/ }).click();
  await expect(doc).toHaveValue(/take 4\)\.$/);
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'The story' })).toHaveValue(/take 4\)\.$/);

  // Scanning the story suggests Oren (Keeper's in the Cast already); added, he's in the Cast.
  await page.getByRole('button', { name: '🔍 Scan the story' }).click();
  await expect(page.getByText('A dockhand who rows out to the lighthouse.')).toBeVisible();
  await expect(page.getByText('Already in.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('button', { name: /▸ Oren/ })).toBeVisible();
});

test('a text-completion connection gets one raw prompt and writes on', async ({ page, request }) => {
  const connection = { id: 'tc', name: 'Local', kind: 'openai', baseUrl: 'http://127.0.0.1:9/v1', apiKey: '', model: 'local', params: { max_tokens: 50 }, textCompletion: true, instructId: 'builtin-chatml', contextId: 'builtin-default' };
  await request.put('/api/settings/llm', { data: { state: { connections: [connection], chatConnectionId: 'tc', assistConnectionId: 'tc' }, version: 0 } });
  const sent: { prompt?: string }[] = [];
  await page.route('**/api/llm/chat', async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'text', text: ' and the gulls cried.' })}\n${JSON.stringify({ type: 'done', stopReason: 'stop' })}\n` });
  });

  await page.goto('/');
  await page.getByRole('button', { name: '+ New card' }).first().click();
  await page.getByPlaceholder('Character name').fill('Wren');
  await page.getByRole('tablist', { name: 'Mode' }).getByRole('tab', { name: '💬 Chat' }).click();
  await page.getByRole('tab', { name: 'Story' }).click();
  await page.getByRole('button', { name: 'Start a story…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start' }).click();

  const doc = page.getByRole('textbox', { name: 'The story' });
  await doc.fill('The tide came in');
  await page.getByLabel('Memory').fill('A quiet tale by the sea.');
  await page.getByPlaceholder(/Steer the next part/).fill('a ship appears');
  await doc.press('Control+Enter');
  await expect(doc).toHaveValue('The tide came in and the gulls cried.');
  expect(sent[0].prompt).toBe('A quiet tale by the sea.\n***\n[ Next: a ship appears ]\nThe tide came in');
  // The steer is for one part only.
  await expect(page.getByPlaceholder(/Steer the next part/)).toHaveValue('');
});
