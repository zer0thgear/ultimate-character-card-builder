import { expect, test } from '@playwright/test';

// The home screen's getting-started list, and ? for the shortcuts.

test('getting started list and the shortcuts dialog', async ({ page }) => {
  await page.goto('/');
  const list = page.getByRole('region', { name: 'Getting started' });
  await expect(list).toBeVisible();
  // Other tests may have done some steps already; image generation isn't.
  await expect(list.getByText(/of 5 done/)).toBeVisible();
  await list.getByRole('button', { name: 'Image settings' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.locator('body').press('?');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Keyboard shortcuts')).toBeVisible();
  await expect(dialog.getByText('Search the chat (with focus in it)')).toBeVisible();
  await page.keyboard.press('Escape');

  await list.getByTitle(/Hide this list/).click();
  await expect(list).toBeHidden();
  await page.reload();
  await expect(page.getByRole('button', { name: '+ New card' }).first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Getting started' })).toBeHidden();
});
