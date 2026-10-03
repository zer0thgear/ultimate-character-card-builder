import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

// SillyTavern's card extras set in the editor land in the exported card
// where SillyTavern reads them: the Character's Note, regex scripts and a
// lorebook entry's own rules.

const tab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();

test("the Character's note, regex scripts and lorebook rules export where SillyTavern reads them", async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '+ New card' }).first().click();
  await page.getByPlaceholder('Character name').fill('Parity');

  await tab(page, 'Prompts');
  await page.getByLabel("Character's note", { exact: true }).fill('Keep replies short.');
  await page.getByRole('button', { name: '+ Script' }).click();
  await page.getByPlaceholder('/\\[stats\\][\\s\\S]*?\\[\\/stats\\]/g').fill('/\\[hp:\\d+\\]/g');
  await page.getByPlaceholder('Paste a reply to see what this script makes of it…').fill('Ouch [hp:3] that hurt');
  await expect(page.getByText('Ouch  that hurt')).toBeVisible();

  await tab(page, 'Lorebook');
  await page.getByRole('button', { name: 'Attach a new lorebook' }).click();
  await page.getByRole('main').getByRole('button', { name: '+ Add' }).click();
  await page.getByText('More rules (as SillyTavern has them)').click();
  await page.getByLabel('Trigger %').fill('40');
  await page.getByLabel('Inclusion group').fill('moods');

  await page.getByRole('button', { name: 'Export ▾' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'JSON (V3)' }).click()]);
  const data = JSON.parse((await readFile(await download.path())).toString('utf8')).data;
  expect(data.extensions.depth_prompt).toMatchObject({ prompt: 'Keep replies short.' });
  expect(data.extensions.regex_scripts[0]).toMatchObject({ findRegex: '/\\[hp:\\d+\\]/g', placement: [2] });
  expect(data.character_book.entries[0].extensions).toMatchObject({ probability: 40, useProbability: true, group: 'moods' });
});
