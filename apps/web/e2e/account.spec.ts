import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    for (const db of (await indexedDB.databases?.()) ?? []) if (db.name) indexedDB.deleteDatabase(db.name);
  });
});

test('phone: «Ещё» shows who is signed in and «Выйти» signs out for good', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Директор/ }).click();
  await page.getByRole('link', { name: 'Ещё' }).click();
  const acc = page.getByRole('region', { name: 'Аккаунт' });
  await expect(acc).toContainText('Директор');
  await expect(acc).toContainText('+996 700 00 00 01');
  await acc.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.reload();
  await expect(page.getByRole('button', { name: /Войти/ })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Основное меню' })).toHaveCount(0);
  await page.goto('/farm');
  await expect(page).toHaveURL(/\/login$/);
});

test('worker with unsent records is warned before signing out', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Айгуль/ }).click();
  await expect(page.getByText('День 23', { exact: true }).first()).toBeVisible(); // houses loaded
  await context.setOffline(true);
  await page.getByRole('link', { name: 'Корм' }).click();
  await page.getByRole('button', { name: 'Записать поставку' }).click();
  await page.getByLabel('Тонн по накладной').fill('5');
  await page.getByRole('button', { name: 'Сохранить поставку' }).click();
  await page.getByRole('link', { name: /Ещё/ }).click();
  const acc = page.getByRole('region', { name: 'Аккаунт' });
  await acc.getByRole('button', { name: 'Выйти' }).click();
  const ask = acc.getByRole('alertdialog', { name: 'Выйти?' });
  await expect(ask).toContainText('Не отправлено записей: 1');
  await ask.getByRole('button', { name: 'Отмена' }).click();
  await expect(page).toHaveURL(/\/more$/); // still signed in
  await acc.getByRole('button', { name: 'Выйти' }).click();
  await acc.getByRole('button', { name: 'Всё равно выйти' }).click(); // works offline too
  await expect(page).toHaveURL(/\/login$/);
  await context.setOffline(false);
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });
  test('sidebar has the account and «Выйти»', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Директор/ }).click();
    const nav = page.getByRole('navigation', { name: 'Основное меню' });
    await expect(nav.getByText('Директор', { exact: false }).first()).toBeVisible();
    await nav.getByRole('button', { name: 'Выйти' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
