import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { expect, test } from '@playwright/test';

// Library images added to a card's gallery: one from the viewer, then a
// selection where one is already there (skipped, and said so).

test('adds library gens to the open card’s gallery, never twice', async ({ page, request }) => {
  const gens = mkdtempSync(path.join(tmpdir(), 'uccb-e2e-gens-'));
  try {
    const png = (color: string) => sharp({ create: { width: 64, height: 96, channels: 4, background: color } }).png().toBuffer();
    writeFileSync(path.join(gens, 'red.png'), await png('#e33'));
    writeFileSync(path.join(gens, 'blue.png'), await png('#33e'));
    await request.put('/api/config', { data: { libraryFolders: [gens] } });

    await page.goto('/');
    await page.getByRole('button', { name: '+ New card' }).first().click();
    await page.getByPlaceholder('Character name').fill('Collector');
    await page.getByRole('tab', { name: '📚 Library' }).click();
    await expect(page.getByText('2 images')).toBeVisible();

    await page.locator('button[title="red.png"]').click();
    await page.getByRole('button', { name: '☆ Add to gallery' }).click();
    await expect(page.getByText("Added 1 image to Collector's gallery.")).toBeVisible();
    await expect(page.getByRole('button', { name: '★ In gallery' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('button[title="red.png"]').getByText('★')).toBeVisible();

    await page.getByRole('button', { name: "Select images to add to this card's gallery" }).click();
    await page.locator('button[title="red.png"]').click();
    await page.locator('button[title="blue.png"]').click();
    await page.getByRole('button', { name: '☆ Add to gallery' }).click();
    await expect(page.getByText("Added 1 image to Collector's gallery (1 already there).")).toBeVisible();
    await expect(page.locator('button[title="blue.png"]').getByText('★')).toBeVisible();

    await page.getByRole('tab', { name: /Gallery/ }).click();
    await expect(page.getByText('Kept with this card (2)')).toBeVisible();
  } finally {
    rmSync(gens, { recursive: true, force: true });
  }
});
