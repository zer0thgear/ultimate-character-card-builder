import { expect, test } from '@playwright/test';

// The home screen's helper: it answers through the assistant's connection,
// with the app's own guide and the chosen personality in its prompt.

test('ask the helper, in a personality', async ({ page, request }) => {
  const connection = { id: 'a', name: 'Helper', kind: 'openai', baseUrl: 'http://127.0.0.1:9/v1', apiKey: '', model: 'helper', params: { max_tokens: 50 } };
  await request.put('/api/settings/llm', { data: { state: { connections: [connection], assistConnectionId: 'a' }, version: 0 } });

  const sent: { messages: { role: string; content: string }[]; connection: { model: string } }[] = [];
  await page.route('**/api/llm/chat', async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'text', text: 'Ugh, fine. Use **{{char}}** for the name, dummy.' })}\n${JSON.stringify({ type: 'done', stopReason: 'stop' })}\n` });
  });

  await page.goto('/');
  await page.getByRole('button', { name: '🛎 Ask the helper' }).click();
  await page.getByLabel('Personality').selectOption('brat');
  await expect(page.getByText('What is it this time, dummy?')).toBeVisible();
  await page.getByRole('button', { name: 'Which macros can I use?' }).click();
  await expect(page.getByText('for the name, dummy.')).toBeVisible();
  await expect(page.locator('strong', { hasText: '{{char}}' })).toBeVisible();

  expect(sent[0].connection.model).toBe('helper');
  const [system, question] = sent[0].messages;
  expect(system.role).toBe('system');
  expect(system.content).toContain('smug, teasing brat');
  expect(system.content).toContain('{{roll:d20}}');
  expect(question).toEqual({ role: 'user', content: 'Which macros can I use?' });
  await page.screenshot({ path: process.env.HELPER_SHOT || 'test-results/helper.png' });

  // It's still there after a reload.
  await page.reload();
  await expect(page.getByText('for the name, dummy.')).toBeVisible();
});
