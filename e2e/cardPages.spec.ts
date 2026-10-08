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
