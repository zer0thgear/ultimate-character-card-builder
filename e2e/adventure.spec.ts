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
    else if (system.startsWith('You are the Director') && user.includes('I hail the stranger')) text = JSON.stringify({ narration: 'A hooded woman steps out.', actors: [{ name: 'Mira', direction: 'sizes them up' }], new_cast: [{ name: 'Mira', text: 'A hooded smuggler with a scar.' }] });
    else if (system.startsWith('You are the Director')) text = JSON.stringify({ scene: { location: 'Iron Gate', time: 'dusk', present: ['Rook', 'Keeper', 'Grim'], situation: 'A stranger at the gate.' }, roll: { reason: 'Sneaking past', dice: '1d20', dc: 1 }, beats: [{ narrate: 'On success: they slip by.' }, { actor: 'Keeper', direction: 'suspicious' }, { narrate: 'A torch gutters.' }, { actor: 'Grim', direction: 'answers Keeper' }], notes: 'Keeper owes a debt.' });
    else if (system.startsWith('You are the Narrator') && system.includes('falls between characters')) text = 'A torch gutters in the wind.';
    else if (system.startsWith('You are the Narrator')) text = 'You slip past the torchlight.';
    else if (system.includes('You are playing Keeper')) text = '"Who goes there?" Keeper squints.';
    else if (system.includes('You are playing Mira')) text = 'Mira lowers her hood. "You\'re not from here."';
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

  // You play the active persona unless another is picked here.
  await expect(page.getByRole('combobox', { name: 'Persona' })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Persona' }).locator('option').first()).toHaveText('The active persona (Rook)');
  await page.getByRole('button', { name: 'Start the adventure' }).click();
  await expect(page.getByText('The gate looms before you.')).toBeVisible();

  await page.getByPlaceholder(/What do you do, Rook/).fill('I sneak past the gate.');
  await page.getByPlaceholder(/What do you do, Rook/).press('Enter');
  await expect(page.getByText('Nobody, that\'s who.', { exact: false })).toBeVisible();
  await expect(page.getByText('You slip past the torchlight.')).toBeVisible();
  await expect(page.getByText('A torch gutters in the wind.')).toBeVisible();
  await expect(page.getByText(/Sneaking past: 1d20 → \d+ vs 1: success/)).toBeVisible();
  await expect(page.getByText(/Turn 1 · 5 calls · 500 in \/ 100 out/)).toBeVisible();
  await expect(page.getByText('📍 Iron Gate · dusk')).toBeVisible();
  await page.screenshot({ path: 'test-results/adventure-turn.png', fullPage: true });

  // The Director saw the world the Scout found; the Cast each got their sheet.
  const director = sent.find((s) => s.system.startsWith('You are the Director') && s.user.includes('I sneak past'));
  expect(director?.user).toContain('Grim: A grumpy guard.');
  expect(director?.user).toContain('- Keys open doors.');
  const grim = sent.find((s) => s.system.includes('You are playing Grim'))?.user;
  expect(grim).toContain('<character name="Grim">\nA grumpy guard.');
  // Beats run in order: Grim answers Keeper, after the torch gutters; the first passage leaves both to themselves.
  expect(grim).toContain('[Keeper] "Who goes there?"');
  expect(grim).toContain('[Narrator] A torch gutters in the wind.');
  expect(sent.find((s) => s.system.startsWith('You are the Narrator') && !s.system.includes('falls between'))?.system).toContain('Keeper, Grim act right after this passage');

  // Redo plays the turn again from the same action.
  const before = sent.length;
  await page.getByRole('button', { name: /Redo turn/ }).click();
  await expect.poll(() => sent.length).toBe(before + 5);
  await expect(page.getByText('I sneak past the gate.')).toHaveCount(1);
  await expect(page.getByText('You slip past the torchlight.')).toHaveCount(1);

  // Someone new: the Director brings her in, she joins this adventure's Cast and is played from her sheet.
  await page.getByPlaceholder(/What do you do, Rook/).fill('I hail the stranger.');
  await page.getByPlaceholder(/What do you do, Rook/).press('Enter');
  await expect(page.getByText('🎭 New in the Cast: Mira')).toBeVisible();
  await expect(page.getByText("You're not from here.", { exact: false })).toBeVisible();
  expect(sent.find((s) => s.system.includes('You are playing Mira'))?.user).toContain('<character name="Mira">\nA hooded smuggler with a scar.');
  await page.getByRole('button', { name: /World/ }).click();
  await page.getByRole('tab', { name: 'This adventure' }).click();
  await expect(page.locator('input[value="Mira"]')).toBeVisible();
  await expect(page.getByText('added here', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/adventure-newcast.png' });
  // ⇪ makes her part of the card's Cast.
  await page.getByRole('button', { name: "Add to the card's world, for every adventure" }).click();
  await page.getByRole('tab', { name: 'The card' }).click();
  await expect(page.locator('input[value="Mira"]')).toBeVisible();
});
