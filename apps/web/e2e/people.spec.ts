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
  await form.getByRole('group', { name: 'Птичники работника' }).getByRole('button', { name: 'П-4' }).click();
  await form.getByRole('button', { name: 'Добавить работника' }).click();
  const pin = await pinShown(page);
  expect(pin).toMatch(/^\d{6}$/);
  await expect(page.getByRole('link', { name: /Бакыт С\..*П-4/ })).toBeVisible();

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
  await expect(page.getByText('П-4').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Записать день · П-1/ })).toHaveCount(0);
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
  await page.getByRole('link', { name: /^П-1/ }).click();
  await page.getByRole('button', { name: 'Удалить птичник' }).click();
  await expect(page.getByRole('alert')).toHaveText(/только отключить/);
  await page.goto('/people');
  await page.getByRole('button', { name: '+ Добавить птичники' }).click();
  await page.getByRole('form', { name: 'Добавить птичники' }).getByRole('button', { name: 'Добавить П-5' }).click();
  await page.getByRole('link', { name: /^П-5/ }).click();
  await page.getByRole('button', { name: 'Удалить птичник' }).click();
  await expect(page).toHaveURL(/\/people$/);
  await expect(page.getByRole('link', { name: /^П-5/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Изменить ферму' }).click();
  await page.getByLabel('Название фермы').fill('Ферма Ак-Суу');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Ферма сохранена')).toBeVisible();
  await page.getByRole('link', { name: 'Ферма', exact: true }).click();
  await expect(page.getByText(/Ферма Ак-Суу/).first()).toBeVisible();
});

test('empty farm: first sign-in opens the 3-step setup; the new worker can sign in', async ({ page }) => {
  await signIn(page, /Директор/);
  // Turn the demo into an empty farm: only the director, no houses or batches.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('farm-demo-v2')!);
    Object.assign(s, { houses: [], hbs: [], logs: [], feed: [], health: [], weighings: [], handovers: [], users: s.users.filter((u: any) => u.role === 'head') });
    localStorage.setItem('farm-demo-v2', JSON.stringify(s));
  });
  await page.goto('/farm');
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByText('Шаг 1 из 3 · Ферма')).toBeVisible();
  await page.getByLabel('Название фермы').fill('Новая ферма');
  await page.getByRole('button', { name: 'Дальше' }).click();

  await expect(page.getByText('Шаг 2 из 3 · Птичники')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Дальше: работники' })).toBeDisabled();
  await page.getByRole('button', { name: 'Добавить П-1, П-2, П-3, П-4' }).click();
  await expect(page.getByText('Добавлены: П-1, П-2, П-3, П-4')).toBeVisible();
  // Interrupted setup continues where it stopped.
  await page.reload();
  await expect(page.getByText('Шаг 2 из 3 · Птичники')).toBeVisible();
  await page.getByRole('button', { name: 'Дальше: работники' }).click();

  const form = page.getByRole('form', { name: 'Новый работник' });
  await form.getByLabel('Имя').fill('Айбек');
  await form.getByLabel('Телефон').fill('700111222');
  await form.getByRole('group', { name: 'Птичники работника' }).getByRole('button', { name: 'П-1' }).click();
  await form.getByRole('group', { name: 'Птичники работника' }).getByRole('button', { name: 'П-2' }).click();
  await form.getByRole('button', { name: 'Добавить работника' }).click();
  const pin = await pinShown(page);
  await page.getByRole('button', { name: 'Готово', exact: true }).click(); // closes the PIN card
  await page.getByRole('button', { name: 'Готово', exact: true }).click(); // finishes setup
  await expect(page).toHaveURL(/\/farm/);
  await expect(page.getByText('Ферма настроена. Передайте работникам телефон и PIN.')).toBeVisible();
  await expect(page.getByText(/Нет открытой партии/)).toBeVisible();

  await signOut(page);
  await signInWith(page, '700111222', pin);
  await expect(page.getByRole('navigation', { name: 'Основное меню' })).toBeVisible();
});
