import { test, expect, type Page } from '@playwright/test';

// Role model v2.1: workers run every operation of their own houses and never see money; the director sees everything.
async function signIn(page: Page, who: RegExp) {
  await page.goto('/');
  await page.getByRole('button', { name: who }).click();
  await expect(page.getByRole('navigation', { name: 'Основное меню' })).toBeVisible();
}
const demo = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('farm-demo-v2')!));

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    for (const db of (await indexedDB.databases?.()) ?? []) if (db.name) indexedDB.deleteDatabase(db.name);
  });
});

test('worker records a feed delivery offline; it arrives once when back online', async ({ page, context }) => {
  await signIn(page, /Айгуль/);
  await page.getByRole('link', { name: 'Корм' }).click();
  await expect(page.getByText('В бункере П-1')).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Записать поставку' }).click();
  await page.getByLabel('Тонн по накладной').fill('8,5');
  await page.getByRole('button', { name: 'Сохранить поставку' }).click();
  await expect(page.getByText('Записано: Рост 8,5 т')).toBeVisible();
  expect((await demo(page)).feed.filter((f: any) => f.tonnes === 8.5)).toHaveLength(0);
  await context.setOffline(false);
  await expect.poll(async () => (await demo(page)).feed.filter((f: any) => f.tonnes === 8.5).length, { timeout: 15_000 }).toBe(1);
});

test('worker never sees money and cannot open the director screens', async ({ page }) => {
  await signIn(page, /Айгуль/);
  for (const path of ['/today', '/history', '/feed', '/health', '/more', '/placement', '/weighing', '/catch']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const text = await page.locator('main').innerText();
    expect(text, path).not.toMatch(/\d\s?сом|выручк|прибыл|себестоим/i);
  }
  await page.goto('/money');
  await expect(page).toHaveURL(/\/today$/);
  await page.goto('/events');
  await expect(page).toHaveURL(/\/today$/);
});

test('treatment blocks an early catch; override with a reason reaches the director', async ({ page }) => {
  await signIn(page, /Айгуль/);
  await page.getByRole('link', { name: 'Здоровье' }).click();
  await page.getByRole('group', { name: 'Птичник' }).getByRole('button', { name: 'П-2' }).click();
  await page.getByLabel('Препарат').fill('Амоксициллин 10%');
  await page.getByRole('button', { name: 'Сохранить лечение' }).click();
  await expect(page.getByText(/Сохранено\. Убой не ранее .* Директор уведомлён/)).toBeVisible();
  await page.getByRole('link', { name: 'Сегодня' }).click();
  await expect(page.getByText(/Лечение: Амоксициллин 10%, день 1 из 5/)).toBeVisible();

  await page.goto('/catch');
  await page.getByLabel('Дата').fill(await page.evaluate(() => { const d = new Date(Date.now() + 3 * 86_400_000); return d.toISOString().slice(0, 10); }));
  await expect(page.getByText('■ Отлов раньше конца срока ожидания')).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить план' }).click();
  await expect(page.getByText(/перенесите дату или укажите причину/)).toBeVisible();
  await page.getByLabel(/Или причина/).fill('покупатель забирает раньше');
  await page.getByRole('button', { name: 'Сохранить план' }).click();
  await expect(page.getByText('План сохранён. Директор уведомлён о причине.')).toBeVisible();
  await expect.poll(async () => (await demo(page)).overrides.length, { timeout: 10_000 }).toBe(1);

  await page.goto('/queue');
  await page.getByRole('button', { name: /Выйти/ }).click();
  await signIn(page, /Директор/);
  await page.getByRole('link', { name: 'События' }).click();
  await expect(page.getByText(/Отлов в срок ожидания .* Причина: покупатель забирает раньше/)).toBeVisible();
  await expect(page.getByText(/Лечение: Амоксициллин 10%/)).toBeVisible();
});

test('director prices what workers recorded; the item leaves the list and the cost appears', async ({ page }) => {
  await signIn(page, /Директор/);
  await page.getByRole('link', { name: 'Деньги' }).click();
  const row = page.getByRole('textbox', { name: /Корм П-3 · Рост 8,0 т: цена за тонну/ });
  await expect(row).toBeVisible();
  await row.fill('38000');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByText('Цена сохранена')).toBeVisible();
  await expect(page.getByText('Всё оценено ✔')).toBeVisible();
  await page.getByRole('button', { name: 'Газ, уголь, свет' }).click();
  await page.getByLabel('Сумма').fill('85000');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(page.getByText('Затрата добавлена')).toBeVisible();
  const s = await demo(page);
  expect(s.costs.some((c: any) => c.amount === 85000 && c.category === 'energy')).toBe(true);
});

test('worker records weighing (director sees it); an old placement edit is refused after 48 h', async ({ page }) => {
  await signIn(page, /Нурлан/);
  await page.goto('/weighing');
  for (const g of ['980', '1020', '1000', '1100', '900']) { await page.getByLabel('Вес, г').fill(g); await page.getByRole('button', { name: 'Добавить' }).click(); }
  await expect(page.locator('.tile').filter({ hasText: 'CV%' })).toContainText('7,2');
  await page.getByRole('button', { name: 'Сохранить взвешивание' }).click();
  await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
  await page.goto('/placement');
  await page.getByLabel('24 ч · норма ≥ 95').fill('97');
  await page.getByRole('button', { name: 'Сохранить посадку' }).click();
  await expect(page.getByText(/Сохранено: посажено/)).toBeVisible();
  // The placement was recorded 23 days ago: past the 48 h window, so the server refuses the worker's edit
  // and the record waits in «Отправка» as «не принято» (the director can correct it).
  await expect(page.getByRole('link', { name: /Не принято: 1/ })).toBeVisible({ timeout: 10_000 });
  expect((await demo(page)).hbs.find((h: any) => h.id === 'hb-3').cropFill['24']).toBe(95);

  await page.goto('/queue');
  await page.getByRole('button', { name: /Выйти/ }).click();
  await page.getByRole('button', { name: 'Всё равно выйти' }).click(); // the refused record stays on the phone
  await signIn(page, /Директор/);
  await page.goto('/events');
  await expect(page.getByText(/Взвешивание: 1\s000 г, 5 гол\., CV 7,2%/)).toBeVisible();
});
