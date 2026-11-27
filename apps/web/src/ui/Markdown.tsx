import { Fragment, type ReactNode } from 'react';

/** Bold (**x**) and inline code (`x`) only; everything else is plain text. Never renders HTML. */
function inline(s: string, mark?: RegExp): ReactNode[] {
  const out: ReactNode[] = [];
  s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).forEach((part, i) => {
    if (!part) return;
    if (part.startsWith('**') && part.endsWith('**')) out.push(<b key={i}>{highlight(part.slice(2, -2), mark)}</b>);
    else if (part.startsWith('`') && part.endsWith('`')) out.push(<code key={i}>{part.slice(1, -1)}</code>);
    else out.push(<Fragment key={i}>{highlight(part, mark)}</Fragment>);
  });
  return out;
}
function highlight(s: string, mark?: RegExp): ReactNode {
  if (!mark) return s;
  return s.split(mark).map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p));
}
const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

/** The handbook's markdown subset: paragraphs, bullet and numbered lists, tables, bold. */
export function Markdown({ md, mark }: { md: string; mark?: RegExp }) {
  const lines = md.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    if (!l.trim()) { i++; continue; }
    if (l.trim().startsWith('|')) {
      const rows: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('|')) rows.push(lines[i++]!);
      const body = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
      const [head, ...rest] = body;
      blocks.push(
        <div className="md-table" key={blocks.length}><table>
          {head && <thead><tr>{cells(head).map((c, k) => <th key={k}>{inline(c, mark)}</th>)}</tr></thead>}
          <tbody>{rest.map((r, k) => <tr key={k}>{cells(r).map((c, j) => <td key={j}>{inline(c, mark)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
      continue;
    }
    const bullet = /^\s*[-*] /, num = /^\s*\d+[.)] /;
    if (bullet.test(l) || num.test(l)) {
      const re = bullet.test(l) ? bullet : num;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i]!)) items.push(lines[i++]!.replace(re, ''));
      const Tag = re === bullet ? 'ul' : 'ol';
      blocks.push(<Tag key={blocks.length}>{items.map((t, k) => <li key={k}>{inline(t, mark)}</li>)}</Tag>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !lines[i]!.trim().startsWith('|') && !bullet.test(lines[i]!) && !num.test(lines[i]!)) para.push(lines[i++]!);
    blocks.push(<p key={blocks.length}>{inline(para.join(' '), mark)}</p>);
  }
  return <div className="md">{blocks}</div>;
}
