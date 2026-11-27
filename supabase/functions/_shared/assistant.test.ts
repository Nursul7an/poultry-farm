import { describe, expect, it } from 'vitest';
import { citeSources, clampContext, searchQuery, userMessage } from './assistant';

const sn = (id: string) => ({ id, section: 'S', title: 'T ' + id, body_md: 'текст ' + id });

describe('assistant helpers', () => {
  it('renumbers cited sources in order of first use and drops unknown numbers', () => {
    const r = citeSources('Держите 30 °C [3]. Проверьте поилки [1][3]. Вымысел [9].', [sn('a'), sn('b'), sn('c')]);
    expect(r.answer).toBe('Держите 30 °C [1]. Проверьте поилки [2][1]. Вымысел .');
    expect(r.sources.map((s) => s.id)).toEqual(['c', 'a']);
  });
  it('no citations → no sources', () => {
    expect(citeSources('Не знаю.', [sn('a')]).sources).toEqual([]);
  });
  it('search words skip short words', () => {
    expect(searchQuery('Что с падёжом на 5-й день?')).toBe('что падёжом день');
  });
  it('message has numbered snippets, house data and the question; long bodies are cut', () => {
    const m = userMessage('Почему?', [{ ...sn('a'), body_md: 'x'.repeat(50) }], { houseName: 'П-1', dayOfAge: 5, liveBirds: 16900, recent: '' }, 10);
    expect(m).toContain('[1] S — T a');
    expect(m).toContain('xxxxxxxxxx…');
    expect(m).toContain('день выращивания 5');
    expect(m.endsWith('Вопрос: Почему?')).toBe(true);
  });
  it('context from the client is sanitised', () => {
    expect(clampContext({ houseName: 'П-1'.repeat(20), dayOfAge: 'x', liveBirds: 5 })).toEqual({ houseName: 'П-1П-1П-1П-1П-1П-1П-', dayOfAge: 0, liveBirds: 5, recent: '' });
    expect(clampContext(null)).toBeNull();
  });
});
