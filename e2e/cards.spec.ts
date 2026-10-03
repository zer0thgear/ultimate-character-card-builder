import { expect, test, type Page } from '@playwright/test';

// Card management: a version kept by hand and restored, a duplicate, and a
// deleted card brought back from the trash.

const stamp = Date.now().toString(36);

async function newCard(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: '+ New card' }).first().click();
  await page.getByPlaceholder('Character name').fill(name);
}

test('a version kept by hand shows what changed since, and restores', async ({ page }) => {
  await newCard(page, `Versioned ${stamp}`);
  await page.getByLabel('Description', { exact: true }).fill('A quiet archivist.');
  await page.getByRole('button', { name: /Versions: earlier versions/ }).click();
  await page.getByRole('button', { name: 'Save this version…' }).click();
  await page.getByPlaceholder('e.g. before the rewrite').fill('first draft');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('★ first draft')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last().click();

  await page.getByLabel('Description', { exact: true }).fill('A loud archivist.');
  await page.getByRole('button', { name: /Versions: earlier versions/ }).click();
  await page.getByText('★ first draft').click();
  await expect(page.getByText('1 field changed')).toBeVisible();
  await expect(page.locator('.line-through', { hasText: 'quiet' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore this version' }).click();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('A quiet archivist.');
});

test('a card can be duplicated, deleted, and restored from the trash', async ({ page }) => {
  const name = `Binned ${stamp}`;
  await newCard(page, name);
  await page.getByLabel('Description', { exact: true }).fill('Soon to be copied.');
  // Let the name save before the list is used.
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  const row = page.getByRole('navigation').locator('.group', { hasText: name }).first();
  await row.hover();
  await row.getByRole('button', { name: 'Duplicate card' }).click();
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(page.getByPlaceholder('Character name')).toHaveValue(`${name} (copy)`);
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Soon to be copied.');

  const copy = page.getByRole('navigation').locator('.group', { hasText: `${name} (copy)` }).first();
  await copy.hover();
  await copy.getByRole('button', { name: 'Delete card' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('navigation').getByText(`${name} (copy)`)).toHaveCount(0);

  await page.getByRole('button', { name: '🗑 Trash' }).first().click();
  const trashed = page.getByRole('dialog').locator('div', { hasText: `${name} (copy)` }).last();
  await trashed.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByPlaceholder('Character name')).toHaveValue(`${name} (copy)`);
});
