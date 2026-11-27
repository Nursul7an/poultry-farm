import type { Article } from './types';

/** Crude Russian stem: lower-case, ё→е, drop common endings so «падежа» matches «падёж». */
export function stem(w: string): string {
  const s = w.toLowerCase().replace(/ё/g, 'е');
  if (s.length <= 4) return s;
  return s.replace(/(ами|ями|ого|его|ому|ему|ыми|ими|иях|ах|ях|ов|ев|ей|ой|ий|ый|ая|яя|ое|ее|ые|ие|ом|ем|ам|ям|ую|юю|а|я|о|е|ы|и|у|ю|ь)$/u, '');
}
const words = (q: string) => (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 3).map(stem);

/** Offline handbook search: title hits weigh more than body hits; all words must appear somewhere. */
export function searchArticles(list: Article[], q: string): Article[] {
  const ws = words(q);
  if (!ws.length) return [];
  const scored = list.map((a) => {
    const t = a.title.toLowerCase().replace(/ё/g, 'е'), b = a.bodyMd.toLowerCase().replace(/ё/g, 'е');
    let score = 0, hit = 0;
    for (const w of ws) {
      const inT = t.includes(w), inB = b.includes(w);
      if (inT || inB) hit++;
      score += (inT ? 5 : 0) + (inB ? 1 + Math.min(4, b.split(w).length - 2) * 0.25 : 0);
    }
    return { a, score: hit >= Math.ceil(ws.length * 0.6) ? score : 0 };
  });
  return scored.filter((x) => x.score > 0).sort((x, y) => y.score - x.score).map((x) => x.a);
}
