import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

// Make a card, export it as PNG and as JSON, import each one back, and
// check every field we wrote came through.

const stamp = Date.now().toString(36);
const card = {
  name: `Roundtrip ${stamp}`,
  nickname: 'Rou',
  description: 'A tester of round trips.\nSecond line, with "quotes" & <angle> brackets, and ünïcödé.',
  personality: 'Methodical, patient.',
  scenario: '{{user}} hands {{char}} a card file.',
  mes_example: '<START>\n{{user}}: Does it survive?\n{{char}}: Every field.',
  first_mes: '*{{char}} looks up.* Ready when you are, {{user}}.',
  creator: 'e2e',
  tag: `rt-${stamp}`,
};

async function newCard(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '+ New card' }).first().click();
  await expect(page.getByPlaceholder('Character name')).toBeVisible();
}

async function fillCard(page: Page) {
  await tab(page, 'Character');
  await page.getByPlaceholder('Character name').fill(card.name);
  await page.getByPlaceholder('optional').fill(card.nickname);
  await page.getByLabel('Description', { exact: true }).fill(card.description);
  await page.getByLabel('Personality', { exact: true }).fill(card.personality);
  await page.getByLabel('Scenario', { exact: true }).fill(card.scenario);
  await page.getByLabel('Example messages', { exact: true }).fill(card.mes_example);

  await tab(page, 'Greetings');
  await page.getByLabel('First message', { exact: true }).fill(card.first_mes);

  await tab(page, 'Creator');
  await page.getByLabel('Creator', { exact: true }).fill(card.creator);
  await page.getByPlaceholder('Type a tag and press Enter').fill(card.tag);
  await page.keyboard.press('Enter');
}

async function expectCard(page: Page) {
  await tab(page, 'Character');
  await expect(page.getByPlaceholder('Character name')).toHaveValue(card.name);
  await expect(page.getByPlaceholder('optional')).toHaveValue(card.nickname);
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue(card.description);
  await expect(page.getByLabel('Personality', { exact: true })).toHaveValue(card.personality);
  await expect(page.getByLabel('Scenario', { exact: true })).toHaveValue(card.scenario);
  await expect(page.getByLabel('Example messages', { exact: true })).toHaveValue(card.mes_example);

  await tab(page, 'Greetings');
  await expect(page.getByLabel('First message', { exact: true })).toHaveValue(card.first_mes);

  await tab(page, 'Creator');
  await expect(page.getByLabel('Creator', { exact: true })).toHaveValue(card.creator);
  // The card's own tag (its chip's ✕), not the same name among your tags.
  await expect(page.getByRole('button', { name: `Remove ${card.tag}`, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `Take off ${card.tag}`, exact: true })).toBeVisible();
}

// A tab's name can carry a count after it ("Greetings1").
const tab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();

async function exportAs(page: Page, label: string): Promise<{ name: string; bytes: Buffer }> {
  await page.getByRole('button', { name: 'Export ▾' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: label }).click()]);
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

async function importFile(page: Page, file: { name: string; bytes: Buffer }, mimeType: string) {
  // From the home screen, so the card that's open now isn't the one checked.
  await page.getByRole('button', { name: 'Close this card (back to the home screen)' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Import a card…' }).click()]);
  await chooser.setFiles({ name: file.name, mimeType, buffer: file.bytes });
  await expect(page.getByText(`Imported ${card.name}.`)).toBeVisible();
  // Its tags can become your own tags, as SillyTavern asks.
  await expect(page.getByText(`Add ${card.name}'s tags to your tags?`)).toBeVisible();
  await page.getByRole('button', { name: 'Add them all' }).click();
}

/** The tEXt chunks of a PNG, by keyword. */
function pngText(png: Buffer): Record<string, string> {
  expect(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  const out: Record<string, string> = {};
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    if (type === 'tEXt') {
      const data = png.subarray(at + 8, at + 8 + length);
      const nul = data.indexOf(0);
      out[data.toString('latin1', 0, nul)] = data.toString('latin1', nul + 1);
    }
    at += 12 + length;
  }
  return out;
}

function expectData(data: Record<string, unknown>) {
  expect(data).toMatchObject({
    name: card.name,
    description: card.description,
    personality: card.personality,
    scenario: card.scenario,
    mes_example: card.mes_example,
    first_mes: card.first_mes,
    creator: card.creator,
  });
  expect(data.tags).toContain(card.tag);
}

test('a card survives export to PNG and JSON and import back', async ({ page }) => {
  await newCard(page);
  await fillCard(page);

  const json = await exportAs(page, 'JSON (V3)');
  expect(json.name).toMatch(/\.json$/);
  const v3 = JSON.parse(json.bytes.toString('utf8'));
  expect(v3.spec).toBe('chara_card_v3');
  expectData(v3.data);
  expect(v3.data.nickname).toBe(card.nickname);

  const png = await exportAs(page, 'PNG card (V3 + V2)');
  expect(png.name).toMatch(/\.png$/);
  const chunks = pngText(png.bytes);
  const fromChunk = (key: string) => JSON.parse(Buffer.from(chunks[key], 'base64').toString('utf8'));
  expect(fromChunk('ccv3').spec).toBe('chara_card_v3');
  expectData(fromChunk('ccv3').data);
  expect(fromChunk('chara').spec).toBe('chara_card_v2');
  expectData(fromChunk('chara').data);

  await importFile(page, png, 'image/png');
  await expectCard(page);

  await importFile(page, json, 'application/json');
  await expectCard(page);
});
