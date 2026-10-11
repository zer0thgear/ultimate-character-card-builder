import { expect, test } from '@playwright/test';

// A picture attached to a Brainstorm message can be looked at again, full
// size, after it's sent; and on a phone the avatar strip can be hidden.

test('a sent reference picture opens full size; the phone hides the avatar strip', async ({ page, request }) => {
  const connection = { id: 'c', name: 'Local', kind: 'openai', baseUrl: 'http://127.0.0.1:9/v1', apiKey: '', model: 'local', params: { max_tokens: 50 } };
  await request.put('/api/settings/llm', { data: { state: { connections: [connection], chatConnectionId: 'c', assistConnectionId: 'c' }, version: 0 } });
  await page.route('**/api/llm/chat', (route) => route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'text', text: 'A red square.' })}\n${JSON.stringify({ type: 'done', stopReason: 'stop' })}\n` }));

  await page.goto('/');
  await page.getByRole('button', { name: '+ New card' }).first().click();
  await page.getByPlaceholder('Character name').fill('Keeper');
  await page.getByRole('tab', { name: '✨ Brainstorm' }).click();

  await page.getByRole('button', { name: /📎 References/ }).click();
  // A picture to attach.
  const png = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = c.height = 600;
      const g = c.getContext('2d')!;
      g.fillStyle = '#c00';
      g.fillRect(0, 0, 600, 600);
      return c.toDataURL('image/png').split(',')[1];
    }),
    'base64',
  );
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '📁 Card or picture file…' }).click();
  await (await chooser).setFiles({ name: 'red.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Done (1)' }).click();
  await page.getByPlaceholder('Ask about the card…').fill('What is this?');
  await page.getByPlaceholder('Ask about the card…').press('Enter');
  await expect(page.getByText('A red square.')).toBeVisible();

  // Sent, the picture's chip opens it, full size.
  await page.getByRole('button', { name: 'red.png' }).click();
  await expect(page.locator('[data-lightbox] img').first()).toHaveAttribute('src', /^data:image\//);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-lightbox]')).toHaveCount(0);

  // A phone: the strip's switch is beside the editor's tabs, and remembered
  // apart from the desktop's.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Card' }).last().click();
  await expect(page.getByTitle('Change the avatar (or drop an image here)')).toBeVisible();
  await page.getByTitle('Hide the avatar strip').click();
  await expect(page.getByTitle('Change the avatar (or drop an image here)')).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByTitle('Change the avatar (or drop an image here)')).toBeVisible();
});
