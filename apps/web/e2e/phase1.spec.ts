import { test, expect, type Page } from '@playwright/test';

async function signIn(page: Page, who: RegExp) {
  await page.goto('/');
  await page.getByRole('button', { name: who }).click();
  await expect(page.getByRole('navigation', { name: 'Основное меню' })).toBeVisible();
}
/** Number of logs the demo "server" holds for a house on a given day. */
async function serverLogs(page: Page, hb: string) {
  return page.evaluate((hb) => {
    const s = JSON.parse(localStorage.getItem('farm-demo-v2')!);
    return s.logs.filter((l: any) => l.houseBatchId === hb && !String(l.id).startsWith('seed-'));
  }, hb);
}
async function fillLog(page: Page, deaths: string) {
  await page.getByLabel('Падёж, голов').fill(deaths);
  await page.getByLabel('Корм, кг').fill('1970');
  // A realistic reading: previous reading + 3.45 m³ (≈ 3 450 L), so no spike confirmation.
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

test('worker sees only assigned houses and logs a day online', async ({ page }) => {
  await signIn(page, /Айгуль/);
  await expect(page.getByRole('group', { name: 'Мои птичники' }).getByRole('button')).toHaveText(['П-1', 'П-2']);
  await expect(page.getByText('День 23', { exact: true }).first()).toBeVisible();
  await page.getByRole('link', { name: /Записать день · П-1/ }).click();
  await fillLog(page, '9');
  await page.getByRole('button', { name: 'Сохранить журнал' }).click();
  await expect(page.getByText('Журнал сохранён и отправлен')).toBeVisible();
  expect(await serverLogs(page, 'hb-1')).toHaveLength(1);
});

test('offline: saved on the phone, survives reload, sent exactly once when back online', async ({ page, context }) => {
  await signIn(page, /Айгуль/);
  await expect(page.getByText('День 23', { exact: true }).first()).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); // make sure the service worker controls the page
  await expect(page.getByText('День 23', { exact: true }).first()).toBeVisible();

  await context.setOffline(true);
  await page.getByRole('link', { name: /Записать день · П-1/ }).click();
  await fillLog(page, '12');
  await page.getByRole('button', { name: 'Сохранить журнал' }).click();
  await expect(page.getByText('Сохранено на телефоне')).toBeVisible();
  await expect(page.getByRole('link', { name: /Нет сети · 1 ждут/ })).toBeVisible();
  expect(await serverLogs(page, 'hb-1')).toHaveLength(0);

  // Offline navigation + reload: app shell from the service worker, data from IndexedDB.
  await page.goto('/today');
  await page.reload();
  await expect(page.getByText('Записано, ждёт отправки')).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText('Записано и отправлено')).toBeVisible({ timeout: 15_000 });
  const logs = await serverLogs(page, 'hb-1');
  expect(logs).toHaveLength(1);
  expect(logs[0].deaths).toBe(12);
});

test('plausibility: 90 deaths asks "Это верно?", Исправить keeps the values', async ({ page }) => {
  await signIn(page, /Айгуль/);
  await page.getByRole('link', { name: /Записать день · П-1/ }).click();
  await fillLog(page, '90');
  await page.getByRole('button', { name: 'Сохранить журнал' }).click();
  await expect(page.getByRole('dialog', { name: 'Это верно?' })).toContainText('Падёж 90');
  await page.getByRole('button', { name: 'Исправить' }).click();
  await expect(page.getByLabel('Падёж, голов')).toHaveValue('90');
  await page.getByLabel('Падёж, голов').fill('9');
  await page.getByRole('button', { name: 'Сохранить журнал' }).click();
  await expect(page.getByText('Журнал сохранён и отправлен')).toBeVisible();
});

test('double tap on save creates one record', async ({ page }) => {
  await signIn(page, /Айгуль/);
  await page.getByRole('link', { name: /Записать день · П-1/ }).click();
  await fillLog(page, '9');
  await page.getByRole('button', { name: 'Сохранить журнал' }).dblclick();
  await expect(page.getByText('Журнал сохранён и отправлен')).toBeVisible();
  expect(await serverLogs(page, 'hb-1')).toHaveLength(1);
});

test('48-hour rule: worker cannot edit an old log; head must give a reason', async ({ page }) => {
  await signIn(page, /Айгуль/);
  await page.getByRole('link', { name: 'Журнал' }).click();
  await page.getByRole('link').filter({ hasText: 'д. 22' }).click();
  await expect(page.getByText('Прошло больше 48 часов — исправить может только директор')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохранить журнал' })).toHaveCount(0);

  await page.goto('/queue');
  await page.getByRole('button', { name: /Выйти/ }).click();
  await signIn(page, /Директор/);
  const day22 = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('farm-demo-v2')!); return s.logs.find((l: any) => l.id === 'seed-hb-1-22').productionDay; });
  await page.goto(`/log/hb-1/${day22}`);
  await page.getByRole('button', { name: 'Сохранить журнал' }).click();
  await expect(page.getByRole('alert')).toContainText('укажите причину');
  await page.getByLabel('Причина исправления (прошло больше 48 ч)').fill('ошибка в корме');
  await page.getByRole('button', { name: 'Сохранить журнал' }).click();
  await expect(page.getByText('Журнал сохранён и отправлен')).toBeVisible();
});

test('head sees all 4 houses with today status', async ({ page }) => {
  await signIn(page, /Директор/);
  const rows = page.locator('table.data tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText('П-1');
  await expect(page.getByText('нет записи').first()).toBeVisible();
});
