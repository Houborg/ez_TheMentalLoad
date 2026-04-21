import { expect, test } from '@playwright/test';

test('loads the rebuilt dashboard and completes key backend-powered flows', async ({ page }) => {
  const qaTitle = `QA event ${Date.now()}`;
  const assistantTitle = 'Pack school bag';

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Family operations dashboard' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add event' })).toBeVisible();

  await page.getByRole('button', { name: 'Add event' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill(qaTitle);
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/v1/entries') && response.request().method() === 'POST' && response.status() === 201),
    page.getByRole('button', { name: 'Save entry' }).click(),
  ]);
  await expect(page.getByText(qaTitle).first()).toBeVisible({ timeout: 15000 });

  await page.getByRole('textbox', { name: 'Assistant message' }).fill('add task: Pack school bag');
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/v1/assistant/parse') && response.request().method() === 'POST' && response.ok()),
    page.getByRole('button', { name: 'Parse with assistant' }).click(),
  ]);
  await expect(page.getByText('Draft: Pack school bag')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/Missing: date\/time/i)).toBeVisible();

  await page.getByRole('textbox', { name: 'Assistant message' }).fill('tomorrow at 18:30');
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/v1/assistant/parse') && response.request().method() === 'POST' && response.ok()),
    page.getByRole('button', { name: 'Parse with assistant' }).click(),
  ]);
  await expect(page.getByRole('button', { name: 'Confirm assistant draft' })).toBeVisible();

  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/v1/assistant/confirm') && response.request().method() === 'POST' && response.status() === 201),
    page.getByRole('button', { name: 'Confirm assistant draft' }).click(),
  ]);
  await expect(page.getByText(`Created ${assistantTitle}`)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(assistantTitle).first()).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Theme mode' }).selectOption('dark');
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/v1/settings') && response.request().method() === 'PUT' && response.ok()),
    page.getByRole('button', { name: 'Save settings' }).click(),
  ]);
  await expect(page.getByRole('heading', { name: 'Settings' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Notifications' }).click();
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await page.getByRole('button', { name: 'Close Notifications' }).click();
  await expect(page.getByRole('heading', { name: 'Notifications' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Family' }).click();
  await expect(page.getByText('Family members').first()).toBeVisible();
});
