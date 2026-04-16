import { expect, test } from '@playwright/test';

test('loads the planner shell and manages the tabbed settings experience', async ({ page }) => {
  const qaTitle = `QA event ${Date.now()}`;
  const assistantTitle = 'Pack school bag';

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toHaveText('Family weekly planner');
  await expect(page.getByRole('button', { name: 'Create event' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Member' }).locator('option')).toHaveCount(3, { timeout: 15000 });

  await page.getByRole('textbox', { name: 'Title' }).fill(qaTitle);
  await page.getByRole('combobox', { name: 'Repeat' }).selectOption('FREQ=WEEKLY;COUNT=6');
  await page.getByRole('button', { name: 'Create event' }).click();

  await expect(page.getByText(qaTitle).first()).toBeVisible();

  await page.getByRole('button', { name: 'Mark complete' }).first().click();
  await expect(page.getByText('Done').first()).toBeVisible();

  await page.getByRole('textbox', { name: 'Assistant message' }).fill('add task: Pack school bag');
  await page.getByRole('button', { name: 'Parse with assistant' }).click();
  await expect(page.getByText(assistantTitle).first()).toBeVisible();
  await expect(page.getByText(/need date\/time/i)).toBeVisible();

  await page.getByRole('textbox', { name: 'Assistant message' }).fill('tomorrow at 18:30');
  await page.getByRole('button', { name: 'Parse with assistant' }).click();
  await expect(page.getByRole('button', { name: 'Confirm assistant draft' })).toBeVisible();

  await page.getByRole('button', { name: 'Confirm assistant draft' }).click();
  await expect(page.getByRole('button', { name: 'Confirm assistant draft' })).toHaveCount(0);
  await expect(page.getByText(assistantTitle).first()).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings hub' })).toBeVisible();

  await page.getByRole('tab', { name: 'Theme' }).click();
  await page.getByRole('combobox', { name: 'Theme mode' }).selectOption('dark');

  await page.getByRole('tab', { name: 'Sync & mail' }).click();
  await page.getByRole('combobox', { name: 'Sync provider' }).selectOption('google');
  await page.getByRole('textbox', { name: 'Sync source' }).fill([
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'SUMMARY:Imported from sync',
    'DTSTART:20260430T080000Z',
    'DTEND:20260430T090000Z',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));
  await page.getByRole('button', { name: 'Connect sync' }).click();
  await expect(page.getByText(/connected/i).first()).toBeVisible();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  await page.getByRole('button', { name: 'Run manual sync' }).click();
  await expect(page.getByText('Imported from sync').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Birthdays' }).click();
  await page.getByRole('textbox', { name: 'Birthday name' }).fill('Noah');
  await page.getByRole('textbox', { name: 'Birthday date' }).fill('2026-05-01');
  await page.getByRole('button', { name: 'Save birthday' }).click();
  await expect(page.getByText('🇩🇰 Noah').first()).toBeVisible();

  await page.getByRole('tab', { name: 'AI playground' }).click();
  await page.getByRole('textbox', { name: 'Fun AI prompt' }).fill('Write a cheerful one-liner');
  await page.getByRole('button', { name: 'Ask AI' }).click();
  await expect(page.getByText(/MentalLoad|family/i).first()).toBeVisible();
});
