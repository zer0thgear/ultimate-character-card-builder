import { expect, test, type Page } from '@playwright/test';

// The lorebook wizard: the Planner plans from a pitch, the Writer writes
// each entry, a message changes the draft (and the changed entries are
// rewritten), a hand edit sticks, and saving puts the entries in the card.

async function mockWizard(page: Page) {
  const sent: { system: string; user: string }[] = [];
  await page.route('**/api/llm/chat', async (route) => {
    const body = route.request().postDataJSON() as { messages: { role: string; content: string }[] };
    const system = body.messages[0]?.content ?? '';
    const user = body.messages[1]?.content ?? '';
    sent.push({ system, user });
    let text = '';
    if (system.startsWith('You are the planner') && user.includes('Review the lorebook')) {
      text = JSON.stringify({ message: 'Solid, but Ashford is thin and the Duke repeats the card.', changes: [{ op: 'edit', entry: 'Ashford', rewrite: 'Add the river.' }, { op: 'remove', entry: 'Duke Varr' }, { op: 'add', name: 'Night Market', keys: ['market'], brief: 'Where the guild trades.' }] });
    } else if (system.startsWith('You are the planner') && user.includes('The creator says: Add the Duke')) {
      text = JSON.stringify({ message: 'Added the Duke, and the Guild gets grimmer.', changes: [{ op: 'add', name: 'Duke Varr', category: 'person', keys: ['Duke', 'Varr'], brief: 'The ruler.' }, { op: 'edit', entry: 'Thieves Guild', rewrite: 'Make it grimmer.' }, { op: 'remove', entry: 'Old Mill' }] });
    } else if (system.startsWith('You are the planner')) {
      text = '```json\n' + JSON.stringify({ message: 'Three entries. Who rules the town?', entries: [{ name: 'Ashford', category: 'place', keys: ['Ashford'], always: true, brief: 'The mill town.' }, { name: 'Thieves Guild', category: 'faction', keys: ['Guild', 'thieves'], brief: 'Rogues under the town.' }, { name: 'Old Mill', category: 'place', keys: ['mill'], brief: 'Burned.' }] }) + '\n```';
    } else if (system.startsWith('You write lorebook entries')) {
      const name = user.match(/Write the entry "([^"]+)"/)?.[1];
      text = user.includes('Make it grimmer.') ? `${name}, grim and bloody.` : user.includes('Add the river.') ? `${name}, on the river.` : `${name}: written.`;
    }
    await route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'text', text })}\n${JSON.stringify({ type: 'done', stopReason: 'stop' })}\n` });
  });
  return sent;
}

test('the lorebook wizard plans, writes, revises and saves a lorebook', async ({ page, request }) => {
  const connection = { id: 'c1', name: 'Mock', kind: 'openai', baseUrl: 'http://127.0.0.1:9/v1', apiKey: '', model: 'mock', params: { max_tokens: 200 } };
  await request.put('/api/settings/llm', { data: { state: { connections: [connection], chatConnectionId: 'c1', assistConnectionId: 'c1' }, version: 0 } });
  const sent = await mockWizard(page);

  await page.goto('/');
  await page.getByRole('button', { name: '+ New card' }).first().click();
  await page.getByPlaceholder('Character name').fill('Mira');
  await page.getByRole('tab', { name: /^Lorebook/ }).click();
  await page.getByRole('button', { name: /🧙 Wizard/ }).click();

  await page.getByPlaceholder(/sunken archipelago/).fill('A grim mill town with a thieves guild');
  await page.getByRole('button', { name: 'Factions' }).click();
  await page.getByRole('button', { name: 'Plan the lorebook' }).click();
  await expect(page.getByText('Three entries. Who rules the town?')).toBeVisible();
  await expect(page.getByText('3 entries · 0 written')).toBeVisible();
  const plan = sent.find((s) => s.system.startsWith('You are the planner'));
  expect(plan?.user).toContain('The creator\'s pitch: A grim mill town with a thieves guild');
  expect(plan?.user).toContain('Focus on: Factions');

  await page.getByRole('button', { name: '✍ Write all 3' }).click();
  await expect(page.getByText('3 entries · 3 written')).toBeVisible();
  await expect(page.getByText('Old Mill: written.')).toBeVisible();
  // The Writer sees what's already written.
  expect(sent.filter((s) => s.system.startsWith('You write lorebook entries')).at(-1)?.user).toContain('<entry name="Ashford">\nAshford: written.\n</entry>');

  await page.getByPlaceholder(/Answer its questions/).fill('Add the Duke, make the guild grimmer, drop the mill');
  await page.getByPlaceholder(/Answer its questions/).press('Enter');
  await expect(page.getByText('Added the Duke, and the Guild gets grimmer.')).toBeVisible();
  await expect(page.getByText('+ Duke Varr')).toBeVisible();
  await expect(page.getByText('✎ Thieves Guild: to rewrite')).toBeVisible();
  // Written straight away: the Guild rewritten from its text, the Duke new.
  await expect(page.getByText('Thieves Guild, grim and bloody.')).toBeVisible();
  await expect(page.getByText('Duke Varr: written.')).toBeVisible();
  await expect(page.getByText('3 entries · 3 written')).toBeVisible();
  expect(sent.find((s) => s.user.includes('Make it grimmer.'))?.user).toContain('<current_text>\nThieves Guild: written.\n</current_text>');

  // A hand edit.
  await page.getByRole('button', { name: /Ashford/ }).first().click();
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Ashford, by hand.');
  await page.screenshot({ path: 'test-results/lore-wizard.png' });

  await page.getByRole('button', { name: /Save 3 to the card's lorebook/ }).click();
  await expect(page.getByText(/Added 3 lorebook entries/)).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(page.getByRole('button', { name: '🧙 Wizard (3 in the draft)' })).toBeVisible();
  await expect(page.getByText('Entries (3)')).toBeVisible();
  await expect(page.getByText('always')).toBeVisible();
  await page.getByRole('button', { name: /Thieves Guild/ }).click();
  await expect(page.getByText('Thieves Guild, grim and bloody.')).toBeVisible();

  // Saving the same draft again changes nothing.
  await page.getByRole('button', { name: /🧙 Wizard/ }).click();
  await page.getByRole('button', { name: /Save 3 to the card's lorebook/ }).click();
  await expect(page.getByText('Nothing to save: the lorebook already matches the draft.')).toBeVisible();

  // A session on the card's lorebook: the Planner reviews it, you write what it proposes, and saving puts it back.
  await page.getByRole('button', { name: 'Start over' }).click();
  await page.getByRole('button', { name: 'Start over' }).last().click();
  await page.getByRole('button', { name: /📖 The card's lorebook \(3\)/ }).click();
  await page.getByRole('button', { name: 'Review the lorebook' }).click();
  await expect(page.getByText('Solid, but Ashford is thin and the Duke repeats the card.')).toBeVisible();
  await expect(page.getByText('✎ Ashford: to rewrite')).toBeVisible();
  await expect(page.getByText('3 entries · 2 written')).toBeVisible();
  expect(sent.find((s) => s.user.includes('Review the lorebook'))?.user).toContain('Ashford, by hand.');
  await page.getByRole('button', { name: '✍ Write 2 more' }).click();
  await expect(page.getByText('Ashford, on the river.')).toBeVisible();
  await expect(page.getByText('Night Market: written.')).toBeVisible();
  await page.getByRole('button', { name: /Save 3 to the card's lorebook/ }).click();
  await page.getByRole('button', { name: 'Remove from the card' }).click();
  await expect(page.getByText(/Added 1, updated 1, removed 1 lorebook entries/)).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(page.getByText('Entries (3)')).toBeVisible();
  await expect(page.getByText('Duke Varr')).toHaveCount(0);
  await expect(page.getByText('Night Market')).toBeVisible();
});
