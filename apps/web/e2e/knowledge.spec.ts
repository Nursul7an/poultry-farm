import { test, expect, type Page } from '@playwright/test';

async function signIn(page: Page, who: RegExp) {
  await page.goto('/');
  await page.getByRole('button', { name: who }).click();
  await expect(page.getByRole('navigation', { name: 'Основное меню' })).toBeVisible();
}
async function fillLog(page: Page, deaths: string) {
  await page.getByLabel('Падёж, голов').fill(deaths);
  await page.getByLabel('Корм, кг').fill('1970');
  const prev = await page.getByText(/Прошлое показание/).textContent();
  const p = Number(prev!.replace(/[^\d,]/g, '').replace(',', '.'));
  await page.getByLabel('Водосчётчик, м³').fill((p + 3.45).toFixed(2).replace('.', ','));
  await page.getByLabel('t мин, °C').fill('21,6');
  await page.getByLabel('t макс, °C').fill('23');
  await page.getByLabel('ОВ, %').fill('62');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    for (const db of (await indexedDB.databases?.()) ?? []) if (db.name) indexedDB.deleteDatabase(db.name);
  });
});

test('saved log is checked against the norms, with a link to the handbook', async ({ page }) => {
  await signIn(page, /Айгуль/);
  await page.getByRole('link', { name: /Записать день · П-1/ }).click();
  await fillLog(page, '60'); // 60 of ~16 800 ≈ 0.36 % > 0.2 % → critical
  await page.getByRole('button', { name: 'Сохранить журнал' }).click();
  await page.getByRole('button', { name: 'Да, верно — сохранить' }).click(); // 60 deaths is a spike vs. the last days
  const checks = page.getByRole('region', { name: 'Проверка по нормам' });
  await expect(checks.getByRole('heading', { name: /По нормам: \d+ отклон/ })).toBeVisible();
  await expect(checks.locator('[data-level="crit"]').filter({ hasText: 'Падёж и брак' })).toBeVisible();
  await expect(checks.locator('[data-level="ok"]').filter({ hasText: 'Температура' })).toBeVisible();
  await checks.getByRole('link', { name: 'Что делать?' }).first().click();
  await expect(page.getByRole('heading', { name: /Найдено: \d+/ })).toBeVisible();
});

test('handbook works offline: search, open an article with a table', async ({ page, context }) => {
  await signIn(page, /Нурлан/);
  await page.goto('/handbook');
  await expect(page.getByRole('heading', { name: /Нормы на сегодня · П-3, день 23/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Посадка, брудер/ })).toBeVisible(); // articles cached
  await context.setOffline(true);
  await page.getByRole('searchbox', { name: 'Поиск по справочнику' }).fill('температура по возрасту');
  await page.getByRole('link', { name: /Температура по возрасту/ }).first().click();
  await expect(page.locator('.md table').first()).toBeVisible();
  await expect(page.locator('.md mark').first()).toBeVisible();
  await context.setOffline(false);
});

test('director changes a norm; the worker\'s check uses it', async ({ page }) => {
  await signIn(page, /Директор/);
  await page.goto('/norms');
  await page.getByRole('button', { name: /^Отход/ }).click();
  await page.getByLabel('отход за сутки до %', { exact: true }).fill('0,5');
  await page.getByRole('button', { name: 'Сохранить для фермы' }).click();
  await expect(page.getByText(/Норма сохранена/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Отход.*изменено/ })).toBeVisible();

  await page.goto('/queue');
  await page.getByRole('button', { name: /Выйти/ }).click();
  await signIn(page, /Айгуль/);
  await page.getByRole('link', { name: /Записать день · П-1/ }).click();
  await fillLog(page, '60');
  await page.getByRole('button', { name: 'Сохранить журнал' }).click();
  await page.getByRole('button', { name: 'Да, верно — сохранить' }).click(); // 60 deaths is a spike vs. the last days
  // 0.36 % is now within the farm's 0.5 %.
  await expect(page.getByRole('region', { name: 'Проверка по нормам' }).locator('[data-level="ok"]').filter({ hasText: 'Падёж и брак' })).toBeVisible();
});

test('assistant in demo mode answers with handbook sources', async ({ page }) => {
  await signIn(page, /Айгуль/);
  await page.getByRole('link', { name: 'Ещё' }).click();
  await page.getByRole('link', { name: /Помощник/ }).click();
  await page.getByRole('textbox', { name: 'Вопрос' }).fill('Какая влажность нужна в первые дни?');
  await page.getByRole('button', { name: 'Спросить' }).click();
  const ans = page.getByRole('region', { name: 'Ответ' });
  await expect(ans.getByText(/Демо-режим/)).toBeVisible();
  await ans.getByRole('link', { name: /^\[1\]/ }).click();
  await expect(page.locator('.md')).toBeVisible();
});
