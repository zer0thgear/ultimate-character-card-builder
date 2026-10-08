import { expect, test } from '@playwright/test';

// The card lists a page at a time, and Import from URL taking several links
// (the server's fetch stood in for, so no site is reached).

const stamp = Date.now().toString(36);

test('the home card list goes a page at a time', async ({ page, request }) => {
  for (let i = 0; i < 30; i++) {
    const res = await request.post('/api/projects', { data: { card: { spec: 'chara_card_v3', spec_version: '3.0', data: { name: `Paged ${stamp} ${i}` } } } });
    expect(res.ok()).toBeTruthy();
  }
  await page.goto('/');
  const pageSize = page.getByTitle('Cards to a page').last();
  await pageSize.selectOption('25');
  await expect(page.getByText(/^Page 1 of \d+/)).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).last().click();
  await expect(page.getByText(/^Page 2 of \d+/)).toBeVisible();
  await pageSize.selectOption('0');
  await expect(page.getByText(/^Page \d+ of/)).toHaveCount(0);
  await expect(page.getByText(`Paged ${stamp} 0`, { exact: true }).last()).toBeVisible();
});

test('Import from URL takes one link per line', async ({ page }) => {
  await page.route('**/api/import-url', async (route) => {
    const { url } = route.request().postDataJSON() as { url: string };
    if (url.includes('broken')) return route.fulfill({ status: 400, json: { error: 'Not a character.' } });
    const name = `Linked ${stamp} ${url.split('/').pop()}`;
    await route.fulfill({ json: { card: { spec: 'chara_card_v3', spec_version: '3.0', data: { name } }, source: 'Chub', sourceUrl: url } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '🔗 Import from a URL…' }).click();
  await page.getByRole('dialog').locator('textarea').fill('https://chub.ai/characters/a/one\n\nhttps://chub.ai/characters/a/broken\nhttps://chub.ai/characters/a/two\n');
  await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText(`Imported 2 cards: Linked ${stamp} one (no picture), Linked ${stamp} two (no picture).`)).toBeVisible();
  await expect(page.getByText(/Couldn't import|Not a character/).first()).toBeVisible();
  await expect(page.getByPlaceholder('Character name')).toHaveValue(`Linked ${stamp} two`);
});

test('picking cards to tag them all at once', async ({ page, request }) => {
  for (const n of ['one', 'two', 'three']) {
    const res = await request.post('/api/projects', { data: { card: { spec: 'chara_card_v3', spec_version: '3.0', data: { name: `Picked ${stamp} ${n}` } } } });
    expect(res.ok()).toBeTruthy();
  }
  await page.goto('/');
  // Every card on one page, if there are enough for pages.
  const pageSize = page.getByTitle('Cards to a page').last();
  if (await pageSize.count()) await pageSize.selectOption('0');
  // The home grid (the sidebar lists them too, sharing the picks).
  const grid = (name: RegExp) => page.getByRole('button', { name }).last();
  await page.getByRole('button', { name: '☑ Select cards' }).last().click();
  await grid(new RegExp(`Picked ${stamp} one`)).click();
  await grid(new RegExp(`Picked ${stamp} three`)).click();
  await expect(page.getByText('2 selected').last()).toBeVisible();
  // Picking doesn't open the card.
  await expect(page.getByPlaceholder('Character name')).toHaveCount(0);
  await page.getByRole('button', { name: '🏷 Tag…' }).last().click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Tag 2 cards' }) });
  await dialog.getByPlaceholder('Tag name (new or yours)').fill(`batch-${stamp}`);
  await dialog.getByRole('button', { name: '+ Add to all' }).click();
  await expect(dialog.getByText('all', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Done' }).last().click();
  await expect(page.getByText('2 selected')).toHaveCount(0);
  await expect(grid(new RegExp(`Picked ${stamp} one.*batch-${stamp}`))).toBeVisible();
  await expect(grid(new RegExp(`Picked ${stamp} three.*batch-${stamp}`))).toBeVisible();
  await expect(grid(new RegExp(`Picked ${stamp} two.*batch-${stamp}`))).toHaveCount(0);
});

test("the sidebar's tag list can be tucked away", async ({ page, request }) => {
  const res = await request.post('/api/projects', { data: { card: { spec: 'chara_card_v3', spec_version: '3.0', data: { name: `Tucked ${stamp}` } } } });
  expect(res.ok()).toBeTruthy();
  const { id } = (await res.json()) as { id: string };
  const tags = await (await request.get('/api/tags')).json();
  const tagId = `tuck-${stamp}`;
  await request.put('/api/tags', { data: { ...tags, tags: [...tags.tags, { id: tagId, name: tagId, folder: 'none', order: 99, createdAt: 0 }], map: { ...tags.map, [id]: [tagId] } } });
  await page.goto('/');
  const nav = page.getByRole('navigation');
  const chip = nav.getByRole('button', { name: new RegExp(`^${tagId}`) });
  await expect(chip).toBeVisible();
  await nav.getByTitle('Hide the tag list').click();
  await expect(chip).toHaveCount(0);
  await page.reload();
  await expect(nav.getByRole('button', { name: '🏷 My tags ▸' })).toBeVisible();
  await nav.getByRole('button', { name: '🏷 My tags ▸' }).click();
  await expect(chip).toBeVisible();
});
