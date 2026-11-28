import { test, expect, type Page } from '@playwright/test';

async function signIn(page: Page, who: RegExp) {
  await page.goto('/');
  await page.getByRole('button', { name: who }).click();
  await expect(page.getByRole('navigation', { name: 'Основное меню' })).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    for (const db of (await indexedDB.databases?.()) ?? []) if (db.name) indexedDB.deleteDatabase(db.name);
  });
});

test('director creates a second farm (own setup, no blocks), switches back; each farm keeps its own data', async ({ page }) => {
  await signIn(page, /Директор/);
  await page.goto('/farms');
  await expect(page.getByText('Бройлерная ферма (демо) · открыта')).toBeVisible();
  await page.getByRole('button', { name: '+ Новая ферма' }).click();
  const form = page.getByRole('form', { name: 'Ферма' });
  await form.getByLabel('Название фермы').fill('Ферма Ак-Суу');
  await form.getByLabel('Область, район').fill('Чуйская обл.');
  await form.getByLabel('Адрес').fill('с. Ак-Суу');
  await form.getByRole('button', { name: 'Создать ферму' }).click();
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByText('Шаг 1 из 3 · Ферма')).toBeVisible();
  await expect(page.getByLabel('Название фермы')).toHaveValue('Ферма Ак-Суу');
  await page.goto('/farm');
  await expect(page).toHaveURL(/\/setup$/); // new farm: no blocks → setup

  await page.goto('/farms');
  await expect(page.getByText('Ферма Ак-Суу · открыта')).toBeVisible();
  await expect(page.getByText('Чуйская обл., с. Ак-Суу')).toBeVisible();
  const demo = page.locator('.row').filter({ hasText: 'Бройлерная ферма (демо)' });
  await expect(demo).toContainText('Блоков 5');
  await demo.getByRole('button', { name: 'Открыть' }).click();
  await expect(page).toHaveURL(/\/farm$/);
  await expect(page.getByRole('article', { name: 'Блок B' })).toContainText('День 23');
});

test('director edits the farm profile: location, capacity per m²', async ({ page }) => {
  await signIn(page, /Директор/);
  await page.goto('/people');
  await page.getByRole('button', { name: 'Изменить ферму' }).click();
  const form = page.getByRole('form', { name: 'Ферма' });
  await expect(form.getByText(/Блоков: 5 · площадь 5\s000 м² · вместимость ≈ 85\s000 голов/)).toBeVisible();
  await form.getByLabel('Область, район').fill('Чуйская обл., Аламединский р-н');
  await form.getByLabel('Адрес').fill('с. Кант');
  await form.getByLabel('Голов на м² (вместимость)').fill('16');
  await expect(form.getByText(/вместимость ≈ 80\s000 голов/)).toBeVisible();
  await form.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Ферма сохранена')).toBeVisible();
  await expect(page.getByText('Чуйская обл., Аламединский р-н, с. Кант')).toBeVisible();
  await page.reload();
  await expect(page.getByText(/вместимость ≈ 80\s000 гол/)).toBeVisible();
});
