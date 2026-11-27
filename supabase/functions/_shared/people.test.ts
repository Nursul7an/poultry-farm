import { describe, expect, it } from 'vitest';
import { normalizeKgPhone, parseAction, phoneToEmail, Rejected } from './people';

const U = '11111111-2222-3333-4444-555555555555';
describe('worker account rules', () => {
  it('normalises Kyrgyz phones', () => {
    expect(normalizeKgPhone('+996 555 81 04 74')).toBe('+996555810474');
    expect(normalizeKgPhone('555810474')).toBe('+996555810474');
    expect(normalizeKgPhone('12345')).toBeNull();
    expect(phoneToEmail('+996555810474')).toBe('p996555810474@phone.farm.local');
  });
  it('create: name, phone, 6-digit PIN; drops bad house ids; old invite body still works', () => {
    expect(parseAction({ display_name: ' Айгуль ', phone: '700000002', pin: '123456', house_ids: [U, 'x'] }))
      .toEqual({ action: 'create', display_name: 'Айгуль', phone: '+996700000002', pin: '123456', house_ids: [U] });
    expect(() => parseAction({ action: 'create', display_name: 'A', phone: '700000002', pin: '12345' })).toThrow(Rejected);
    expect(() => parseAction({ action: 'create', display_name: '', phone: '700000002', pin: '123456' })).toThrow('имя');
  });
  it('other actions validate their inputs', () => {
    expect(parseAction({ action: 'set_active', user_id: U, active: 'yes' })).toEqual({ action: 'set_active', user_id: U, active: false });
    expect(() => parseAction({ action: 'reset_pin', user_id: 'nope', pin: '123456' })).toThrow('не найден');
    expect(() => parseAction({ action: 'set_phone', user_id: U, phone: '1' })).toThrow('Телефон');
    expect(() => parseAction({ action: 'drop_tables' })).toThrow('Неизвестное');
  });
});
