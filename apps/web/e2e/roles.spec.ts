import { test, expect, type Page } from '@playwright/test';

// Role model v2.1: workers run every operation of their own houses and never see money; the director sees everything.
async function signIn(page: Page, who: RegExp) {
  await page.goto('/');
  await page.getByRole('button', { name: who }).click();
  await expect(page.getByRole('navigation', { name: 'Основное меню' })).toBeVisible();
}
const demo = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('farm-demo-v3')!));

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    for (const db of (await indexedDB.databases?.()) ?? []) if (db.name) indexedDB.deleteDatabase(db.name);
  });
});

test('worker records a warehouse delivery offline (arrives once), then issues feed to the block oldest-expiry first', async ({ page, context }) => {
  await signIn(page, /Айгуль/);
  await page.getByRole('link', { name: 'Корм' }).click();
  await expect(page.getByRole('heading', { name: 'Склад кормов' })).toBeVisible();
  await expect(page.getByText(/Скоро истекает: Агрокорм ПК-5 Старт/)).toBeVisible(); // demo: starter expires in 9 days
  await context.setOffline(true);
  await page.getByRole('link', { name: '+ Поступление' }).click();
  await page.getByRole('group', { name: 'Тип корма' }).getByRole('button', { name: 'Рост' }).click();
  await page.getByLabel('Производитель, марка').fill('Кормовит Рост');
  await page.getByLabel('Мешков').fill('200');
  await expect(page.getByText(/Итого: 8\s000 кг/)).toBeVisible();
  await page.getByRole('button', { name: /90 дн\. от поступления/ }).click();
  await page.getByRole('button', { name: 'Записать поступление' }).click();
  await expect(page.getByRole('link', { name: /Кормовит Рост/ })).toContainText('ждёт отправки');
  expect(((await demo(page)).feedLots ?? []).filter((l: any) => l.product === 'Кормовит Рост')).toHaveLength(0);
  await context.setOffline(false);
  await expect.poll(async () => (await demo(page)).feedLots.filter((l: any) => l.product === 'Кормовит Рост' && l.kg === 8000).length, { timeout: 15_000 }).toBe(1);

  // Issue 25 bags to Блок A: the grower delivery that expires first is offered first.
  await page.getByRole('link', { name: 'Выдать в блок' }).click();
  await page.getByRole('group', { name: 'Блок' }).getByRole('button', { name: 'Блок A' }).click();
  const first = page.getByRole('radiogroup', { name: 'Поставка' }).locator('label').first();
  await expect(first).toContainText('Агрокорм ПК-6 Рост');
  await expect(first).toContainText('Выдавать первым');
  await page.getByLabel('Мешков').fill('25');
  await page.getByRole('button', { name: 'Выдать 1 000 кг в Блок A' }).click();
  await expect(page.getByRole('heading', { name: 'Склад кормов' })).toBeVisible();
  await expect.poll(async () => (await demo(page)).feedIssues.filter((i: any) => i.kg === 1000 && i.houseBatchId === 'hb-1' && i.lotId === 'lot-3').length, { timeout: 15_000 }).toBe(1);
  await expect(page.getByRole('link', { name: /Агрокорм ПК-6 Рост/ }).first()).toContainText('Осталось 15 000 из 48 000 кг');
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
  await page.getByRole('group', { name: 'Блок' }).getByRole('button', { name: 'Блок B' }).click();
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
  const year = new Date().getFullYear();
  await page.getByRole('group', { name: 'Партия' }).getByRole('button', { name: `C-${year}-01 · Блок C` }).click();
  const row = page.getByRole('textbox', { name: /Склад · Рост 48,0 т · Агрокорм ПК-6 Рост: цена за тонну/ });
  await expect(row).toBeVisible();
  await row.fill('38000');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByText('Цена сохранена')).toBeVisible();
  await expect(page.getByText('Всё оценено ✔')).toBeVisible();
  // Shared farm costs (demo: gas 620 000, wages 450 000, litter 180 000) are split by chicks placed between 4 batches.
  await expect(page.getByText('в т.ч. доля общих затрат фермы (по посаженным головам)')).toBeVisible();
  const form = page.getByRole('form', { name: 'Добавить затрату' });
  await form.getByRole('button', { name: 'Только C-' + year + '-01' }).click();
  await form.getByRole('button', { name: 'Подстилка' }).click();
  await form.getByLabel('Сумма').fill('85000');
  await form.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(page.getByText(`Затрата добавлена в C-${year}-01`)).toBeVisible();
  const s = await demo(page);
  expect(s.costs.some((c: any) => c.amount === 85000 && c.category === 'litter' && c.batchId === 'batch-3')).toBe(true);
});

test('director closes a batch: result shown and kept on the card; the block is empty and the next number follows', async ({ page }) => {
  await signIn(page, /Директор/);
  const year = new Date().getFullYear();
  await page.goto('/farm');
  await page.getByRole('article', { name: 'Блок D' }).getByRole('link', { name: 'Закрыть партию' }).click();
  await expect(page.getByRole('heading', { name: `Закрыть партию D-${year}-01` })).toBeVisible();
  await expect(page.getByText('Посажено', { exact: true })).toBeVisible();
  await expect(page.getByText(/Сдача птицы не записана/)).toBeVisible();
  await page.getByRole('button', { name: `Закрыть партию D-${year}-01` }).click();
  await expect(page.getByText(`Партия D-${year}-01 закрыта. Блок пустой`)).toBeVisible();
  const d = page.getByRole('article', { name: 'Блок D' });
  await expect(d).toContainText(`Прошлая партия D-${year}-01`);
  await expect(d.getByLabel(`Итог D-${year}-01`)).toContainText('Сохр.');
  await expect(d.getByRole('link', { name: `+ Новая партия D-${year}-02` })).toBeVisible();
  expect((await demo(page)).batches.find((b: any) => b.id === 'batch-4').status).toBe('closed');

  // The worker of Блок D no longer has it among running blocks; it is offered for a new batch.
  await page.goto('/queue');
  await page.getByRole('button', { name: /Выйти/ }).click();
  await signIn(page, /Нурлан/);
  await expect(page.getByRole('article', { name: 'Блок D' }).getByRole('link', { name: `+ Новая партия D-${year}-02` })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Мои блоки' })).toHaveCount(0); // only Блок C is running now
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
