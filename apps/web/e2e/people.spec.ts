import { test, expect, type Page } from '@playwright/test';

async function signIn(page: Page, who: RegExp) {
  await page.goto('/');
  await page.getByRole('button', { name: who }).click();
  await expect(page.getByRole('navigation', { name: 'Основное меню' })).toBeVisible();
}
async function signInWith(page: Page, phone: string, pin: string) {
  await page.goto('/login');
  await page.getByLabel(/телефон/i).fill(phone);
  await page.getByLabel(/PIN/).fill(pin);
  await page.getByRole('button', { name: /Войти/ }).click();
}
async function signOut(page: Page) {
  await page.goto('/queue');
  await page.getByRole('button', { name: /Выйти/ }).click();
}
const pinShown = async (page: Page) => (await page.getByRole('dialog', { name: 'Данные для входа' }).getByLabel('PIN').textContent())!.trim();

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    for (const db of (await indexedDB.databases?.()) ?? []) if (db.name) indexedDB.deleteDatabase(db.name);
  });
});

test('director adds a worker; the worker signs in with the shown PIN and sees only the assigned house', async ({ page }) => {
  await signIn(page, /Директор/);
  await page.getByRole('link', { name: 'Ещё' }).click();
  await page.getByRole('link', { name: /Ферма и люди/ }).click();
  await page.getByRole('button', { name: '+ Добавить работника' }).click();
  const form = page.getByRole('form', { name: 'Новый работник' });
  await form.getByLabel('Имя').fill('Бакыт С.');
  await form.getByLabel('Телефон').fill('+996 700 000 004');
  await form.getByRole('group', { name: 'Блоки работника' }).getByRole('button', { name: 'Блок D' }).click();
  await form.getByRole('button', { name: 'Добавить работника' }).click();
  const pin = await pinShown(page);
  expect(pin).toMatch(/^\d{6}$/);
  await expect(page.getByRole('link', { name: /Бакыт С\..*Блок D/ })).toBeVisible();

  // Same phone again is refused with the owner's name.
  await page.getByRole('button', { name: 'Готово' }).click();
  await page.getByRole('button', { name: '+ Добавить работника' }).click();
  await form.getByLabel('Имя').fill('Дубль');
  await form.getByLabel('Телефон').fill('+996 700 000 004');
  await form.getByRole('button', { name: 'Добавить работника' }).click();
  await expect(page.getByRole('alert')).toHaveText('Этот номер уже есть у Бакыт С.');

  await signOut(page);
  await signInWith(page, '700000004', pin);
  await expect(page.getByRole('navigation', { name: 'Основное меню' })).toBeVisible();
  await expect(page.getByText('Блок D').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Записать день · Блок A/ })).toHaveCount(0);
});

test('new PIN: old one stops working; deactivated worker cannot sign in; director sees it in События', async ({ page }) => {
  await signIn(page, /Директор/);
  await page.goto('/people');
  await page.getByRole('link', { name: /^Айгуль/ }).click();
  await page.getByRole('button', { name: 'Новый PIN' }).click();
  await page.getByRole('button', { name: 'Выдать новый PIN' }).click();
  const pin = await pinShown(page);
  await page.getByRole('button', { name: 'Отключить работника' }).click();
  await page.getByRole('button', { name: 'Да, отключить' }).click();
  await expect(page.getByText('Айгуль Т. отключён')).toBeVisible();
  await page.getByRole('link', { name: 'События' }).click();
  await page.getByRole('button', { name: 'Люди' }).click();
  await expect(page.getByText('Айгуль Т.: доступ закрыт')).toBeVisible();
  await expect(page.getByText('Айгуль Т.: выдан новый PIN')).toBeVisible();

  await signOut(page);
  await signInWith(page, '700000002', '222222');
  await expect(page.getByRole('alert')).toHaveText('Неверный номер или PIN');
  await signInWith(page, '700000002', pin);
  await expect(page.getByRole('alert')).toHaveText('Доступ закрыт. Обратитесь к директору.');

  await signIn(page, /Директор/);
  await page.goto('/people');
  await page.getByRole('link', { name: /^Айгуль/ }).click();
  await page.getByRole('button', { name: 'Вернуть доступ' }).click();
  await expect(page.getByText(/снова может войти/)).toBeVisible();
  await signOut(page);
  await signInWith(page, '700000002', pin);
  await expect(page.getByRole('navigation', { name: 'Основное меню' })).toBeVisible();
});

test('a house with batch history cannot be deleted; a new empty one can; farm name is editable', async ({ page }) => {
  await signIn(page, /Директор/);
  await page.goto('/people');
  await page.getByRole('link', { name: /^Блок A/ }).click();
  await page.getByRole('button', { name: 'Удалить блок' }).click();
  await expect(page.getByRole('alert')).toHaveText(/только отключить/);
  await page.goto('/people');
  await page.getByRole('button', { name: '+ Добавить блоки' }).click();
  await page.getByRole('form', { name: 'Добавить блоки' }).getByRole('button', { name: 'Добавить: Блок F' }).click();
  await page.getByRole('link', { name: /^Блок F/ }).click();
  await page.getByRole('button', { name: 'Удалить блок' }).click();
  await expect(page).toHaveURL(/\/people$/);
  await expect(page.getByRole('link', { name: /^Блок F/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Изменить ферму' }).click();
  await page.getByLabel('Название фермы').fill('Ферма Ак-Суу');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Ферма сохранена')).toBeVisible();
  await page.getByRole('link', { name: 'Ферма', exact: true }).click();
  await expect(page.getByRole('banner').getByText(/Ферма Ак-Суу/)).toBeVisible();
});

test('empty farm: first sign-in opens the 3-step setup; the new worker can sign in', async ({ page }) => {
  await signIn(page, /Директор/);
  // Turn the demo into an empty farm: only the director, no houses or batches.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('farm-demo-v3')!);
    Object.assign(s, { houses: [], hbs: [], batches: [], logs: [], feed: [], health: [], weighings: [], handovers: [], users: s.users.filter((u: any) => u.role === 'head') });
    localStorage.setItem('farm-demo-v3', JSON.stringify(s));
  });
  await page.goto('/farm');
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByText('Шаг 1 из 3 · Ферма')).toBeVisible();
  await page.getByLabel('Название фермы').fill('Новая ферма');
  await page.getByRole('button', { name: 'Дальше' }).click();

  await expect(page.getByText('Шаг 2 из 3 · Блоки')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Дальше: работники' })).toBeDisabled();
  await page.getByRole('button', { name: 'Добавить: Блок A, Блок B, Блок C, Блок D' }).click();
  await expect(page.getByText('Добавлены: Блок A, Блок B, Блок C, Блок D')).toBeVisible();
  // Interrupted setup continues where it stopped.
  await page.reload();
  await expect(page.getByText('Шаг 2 из 3 · Блоки')).toBeVisible();
  await page.getByRole('button', { name: 'Дальше: работники' }).click();

  const form = page.getByRole('form', { name: 'Новый работник' });
  await form.getByLabel('Имя').fill('Айбек');
  await form.getByLabel('Телефон').fill('700111222');
  await form.getByRole('group', { name: 'Блоки работника' }).getByRole('button', { name: 'Блок A' }).click();
  await form.getByRole('group', { name: 'Блоки работника' }).getByRole('button', { name: 'Блок B' }).click();
  await form.getByRole('button', { name: 'Добавить работника' }).click();
  const pin = await pinShown(page);
  await page.getByRole('button', { name: 'Готово', exact: true }).click(); // closes the PIN card
  await page.getByRole('button', { name: 'Готово', exact: true }).click(); // finishes setup
  await expect(page).toHaveURL(/\/farm/);
  await expect(page.getByText('Ферма настроена. Передайте работникам телефон и PIN.')).toBeVisible();
  const year = new Date().getFullYear();
  await expect(page.getByRole('article', { name: 'Блок D' }).getByRole('link', { name: `+ Новая партия D-${year}-01` })).toBeVisible();

  // The worker starts the first batch in his block; the number is given automatically.
  await signOut(page);
  await signInWith(page, '700111222', pin);
  await expect(page.getByRole('navigation', { name: 'Основное меню' })).toBeVisible();
  await page.getByRole('article', { name: 'Блок A' }).getByRole('link', { name: `+ Новая партия A-${year}-01` }).click();
  await page.getByLabel('Цыплят по накладной').fill('17060');
  await page.getByLabel('Пали в дороге').fill('10');
  await expect(page.getByText(/Посажено: 17\s050/)).toBeVisible();
  await page.getByRole('button', { name: `Начать партию A-${year}-01` }).click();
  await expect(page.getByText(`Партия A-${year}-01 начата`)).toBeVisible();
  await expect(page.getByRole('link', { name: /Записать день · Блок A/ })).toBeVisible();
  // Блок B is still empty and offered below.
  await expect(page.getByRole('article', { name: 'Блок B' })).toBeVisible();
});

test('director starts a batch in an empty block; it shows as running with its number', async ({ page }) => {
  await signIn(page, /Директор/);
  const year = new Date().getFullYear();
  await page.goto('/farm');
  const e = page.getByRole('article', { name: 'Блок E' });
  await expect(e).toContainText('Партий ещё не было');
  await e.getByRole('link', { name: `+ Новая партия E-${year}-01` }).click();
  await page.getByLabel('Цыплят по накладной').fill('15000');
  await page.getByRole('button', { name: `Начать партию E-${year}-01` }).click();
  await expect(page.getByText(`Партия E-${year}-01 начата`)).toBeVisible(); // saved; the app moved to «Сегодня»
  await page.goto('/farm');
  await expect(page.getByRole('article', { name: 'Блок E' })).toContainText(`Партия E-${year}-01`);
  await expect(page.getByRole('article', { name: 'Блок B' })).toContainText('День 23');
});
