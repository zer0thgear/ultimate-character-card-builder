import { expect, test, type Page } from '@playwright/test';

// Adventure mode in Chat mode: the Scout lists the card's world, an adventure
// opens with the greeting, and a turn runs the Director, dice, the Narrator
// and the Cast, each a call of its own (answered here by role).

async function mockActors(page: Page) {
  const sent: { system: string; user: string }[] = [];
  await page.route('**/api/llm/chat', async (route) => {
    const body = route.request().postDataJSON() as { messages: { role: string; content: string }[] };
    const system = body.messages[0]?.content ?? '';
    const user = body.messages[1]?.content ?? '';
    sent.push({ system, user });
    let text = 'Something happens.';
    if (system.includes('character cards')) text = JSON.stringify({ settings: [{ name: 'Iron Gate', text: 'The fort gate.' }], personae: [{ name: 'Keeper', text: 'The gatekeeper.' }, { name: 'Grim', text: 'A grumpy guard.' }], rules: '- Keys open doors.' });
    else if (system.startsWith('You are the Director')) text = JSON.stringify({ scene: { location: 'Iron Gate', time: 'dusk', present: ['Rook', 'Keeper', 'Grim'], situation: 'A stranger at the gate.' }, roll: { reason: 'Sneaking past', dice: '1d20', dc: 1 }, narration: 'On success: they slip by.', actors: [{ name: 'Keeper', direction: 'suspicious' }, { name: 'Grim', direction: 'grumbles' }], notes: 'Keeper owes a debt.' });
    else if (system.startsWith('You are the Narrator')) text = 'You slip past the torchlight.';
    else if (system.includes('You are playing Keeper')) text = '"Who goes there?" Keeper squints.';
    else if (system.includes('You are playing Grim')) text = 'Grim spits. "Nobody, that\'s who."';
    await route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'text', text })}\n${JSON.stringify({ type: 'done', stopReason: 'stop', usage: { input: 100, output: 20 } })}\n` });
  });
  return sent;
}

test('an adventure: scan the card, open with the greeting, play a turn', async ({ page, request }) => {
  const connection = { id: 'c1', name: 'Mock', kind: 'openai', baseUrl: 'http://127.0.0.1:9/v1', apiKey: '', model: 'mock', params: { max_tokens: 200 } };
  await request.put('/api/settings/llm', { data: { state: { connections: [connection], chatConnectionId: 'c1', assistConnectionId: 'c1', chatSettings: { userName: 'Rook' } }, version: 0 } });
  const sent = await mockActors(page);

  await page.goto('/');
  await page.getByRole('button', { name: '+ New card' }).first().click();
  await page.getByPlaceholder('Character name').fill('Keeper');
  await page.getByRole('tab', { name: /^Greetings/ }).click();
  await page.getByLabel('First message').fill('The gate looms before you.');
  await page.getByRole('tab', { name: '💬 Chat' }).click();
  await page.getByRole('tab', { name: 'Adventure' }).click();

  await expect(page.getByText('This card has no world for adventures yet.')).toBeVisible();
  await page.getByRole('button', { name: '🔍 Scan the card' }).first().click();
  await expect(page.getByText(/The Scout listed 1 setting and 2 characters/)).toBeVisible();
  await expect(page.locator('input[value="Grim"]')).toBeVisible();
  await page.screenshot({ path: 'test-results/adventure-world.png' });
  await page.getByRole('button', { name: 'Close' }).last().click();

  await page.getByRole('button', { name: 'Start the adventure' }).click();
  await expect(page.getByText('The gate looms before you.')).toBeVisible();

  await page.getByPlaceholder(/What do you do, Rook/).fill('I sneak past the gate.');
  await page.getByPlaceholder(/What do you do, Rook/).press('Enter');
  await expect(page.getByText('Nobody, that\'s who.', { exact: false })).toBeVisible();
  await expect(page.getByText('You slip past the torchlight.')).toBeVisible();
  await expect(page.getByText(/Sneaking past: 1d20 → \d+ vs 1: success/)).toBeVisible();
  await expect(page.getByText(/Turn 1 · 4 calls · 400 in \/ 80 out/)).toBeVisible();
  await expect(page.getByText('📍 Iron Gate · dusk')).toBeVisible();
  await page.screenshot({ path: 'test-results/adventure-turn.png', fullPage: true });

  // The Director saw the world the Scout found; the Cast each got their sheet.
  const director = sent.find((s) => s.system.startsWith('You are the Director') && s.user.includes('I sneak past'));
  expect(director?.user).toContain('Grim: A grumpy guard.');
  expect(director?.user).toContain('- Keys open doors.');
  expect(sent.find((s) => s.system.includes('You are playing Grim'))?.user).toContain('<character name="Grim">\nA grumpy guard.');

  // Redo plays the turn again from the same action.
  const before = sent.length;
  await page.getByRole('button', { name: /Redo turn/ }).click();
  await expect.poll(() => sent.length).toBe(before + 4);
  await expect(page.getByText('I sneak past the gate.')).toHaveCount(1);
  await expect(page.getByText('You slip past the torchlight.')).toHaveCount(1);
});
