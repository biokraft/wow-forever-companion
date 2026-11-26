// Tiny, safe formatter for answers: escape HTML first, then **bold**, *em*/_em_, `code`
// and [text](https://...) links.
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const inline = (escaped) => escaped
  .replace(/`([^`\n]+)`/g, '<code>$1</code>')
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^\w*])\*([^*\n]+?)\*(?![\w*])/g, '$1<em>$2</em>')
  .replace(/(^|[^\w])_([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>');

// [text](https://...): https only, and no character in the address that could end an
// attribute or start markup. Anything else stays as written.
const LINK = /\[([^\]\n]+)\]\((https:\/\/[^\s()"'<>`\\]+)\)/g;
const HOLD = '\u0000';

export function renderLite(text) {
  // Links are set aside before the inline formatting, which would read the underscores and
  // stars of an address as emphasis, and put back as real links afterwards.
  const links = [];
  const held = String(text).replaceAll(HOLD, '').replace(LINK, (_m, label, url) => {
    const href = escapeHtml(url);
    links.push(`<a href="${href}" title="${href}">${inline(escapeHtml(label))}</a>`);
    return `${HOLD}${links.length - 1}${HOLD}`;
  });
  return inline(escapeHtml(held)).replace(/\u0000(\d+)\u0000/g, (_m, i) => links[Number(i)]);
}

// Block-level markdown for answers: headings, lists, code blocks, tables, rules, quotes,
// paragraphs. Every line goes through renderLite, which escapes HTML first; code block
// lines are only escaped.
const FENCE = /^(\s*)(`{3,}|~{3,})\s*[\w+-]*\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function renderMarkdown(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  // { tag, start, indent, items: [{ text, sub }] }; `sub` is a list nested under an item.
  let list = null;

  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(renderLite).join('<br>')}</p>`);
    para = [];
  };
  // A numbered list keeps the number its first item was written with: steps go on counting
  // after a paragraph or bullets in between ("4." stays 4, it does not restart at 1).
  const listHtml = (l) => {
    const start = l.tag === 'ol' && l.start !== 1 ? ` start="${l.start}"` : '';
    return `<${l.tag}${start}>${l.items.map((i) => `<li>${renderLite(i.text)}${i.sub ? listHtml(i.sub) : ''}</li>`).join('')}</${l.tag}>`;
  };
  const newList = (tag, number, indent) => ({ tag, start: number ?? 1, indent, items: [] });
  const flushList = () => {
    if (list) out.push(listHtml(list));
    list = null;
  };
  const flush = () => { flushPara(); flushList(); };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    let m;
    // A fenced code block (a macro, a command): shown exactly as written, never formatted,
    // so "#showtooltip" is not a heading and "/cast [stance:1]" keeps its brackets. The
    // fence's own indent comes off each line (a block under a list step is indented). A
    // block still arriving while streaming runs to the end of the text.
    if ((m = FENCE.exec(line))) {
      flush();
      const indent = m[1].length;
      const mark = m[2][0];
      const closing = new RegExp(`^\\s*\\${mark}{${m[2].length},}\\s*$`);
      const code = [];
      for (i += 1; i < lines.length && !closing.test(lines[i]); i++) {
        const lead = /^\s*/.exec(lines[i])[0].length;
        code.push(lines[i].slice(Math.min(indent, lead)).trimEnd());
      }
      while (code.length && !code[code.length - 1]) code.pop();
      out.push(`<pre class="code"><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    // A table needs its header row and the |---| rule under it; until both have arrived
    // (while streaming) the header stays an ordinary line.
    if (TABLE_ROW.test(line) && lines[i + 1]?.includes('-') && TABLE_RULE.test(lines[i + 1])) {
      flush();
      const head = cells(line);
      const rows = [];
      for (i += 2; i < lines.length && TABLE_ROW.test(lines[i]); i++) rows.push(cells(lines[i]));
      i--;
      const tr = (tag, row) => `<tr>${head.map((_, c) => `<${tag}>${renderLite(row[c] ?? '')}</${tag}>`).join('')}</tr>`;
      out.push(`<table><thead>${tr('th', head)}</thead><tbody>${rows.map((r) => tr('td', r)).join('')}</tbody></table>`);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }
    if ((m = /^\s*(#{1,6})\s+(.*)$/.exec(line))) {
      flush();
      const level = Math.min(6, m[1].length + 1); // h2..h6: keep headings small in a chat bubble
      out.push(`<h${level}>${renderLite(m[2].replace(/\s+#+\s*$/, ''))}</h${level}>`);
      continue;
    }
    if ((m = /^\s*>\s?(.*)$/.exec(line))) { flush(); out.push(`<blockquote>${renderLite(m[1])}</blockquote>`); continue; }
    if ((m = /^(\s*)[-*+]\s+(.*)$/.exec(line)) || (m = /^(\s*)(\d{1,9})[.)]\s+(.*)$/.exec(line))) {
      const tag = m.length === 4 ? 'ol' : 'ul';
      const number = tag === 'ol' ? Number(m[2]) : null;
      const item = { text: m[m.length - 1], sub: null };
      const indent = m[1].length;
      flushPara();
      // Indented further than the open list: it belongs to that list's last item.
      if (list && indent >= list.indent + 2) {
        const parent = list.items[list.items.length - 1];
        if (parent.sub && parent.sub.tag !== tag) { flushList(); } else {
          parent.sub ??= newList(tag, number, indent);
          parent.sub.items.push(item);
          continue;
        }
      }
      if (list && list.tag !== tag) flushList();
      if (!list) list = newList(tag, number, indent);
      list.items.push(item);
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) {
      const last = list.items[list.items.length - 1];
      const target = last.sub ? last.sub.items[last.sub.items.length - 1] : last;
      target.text += ` ${line.trim()}`;
      continue;
    }
    flushList();
    para.push(line);
  }
  flush();
  return out.join('');
}

export const THINKING_HTML = '<span class="muted thinking">thinking<span class="dots" aria-hidden="true"></span></span>';
