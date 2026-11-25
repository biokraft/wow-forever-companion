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

// Block-level markdown for answers: headings, lists, tables, rules, quotes, paragraphs.
// Every line goes through renderLite, which escapes HTML first.
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function renderMarkdown(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null; // { tag, items }

  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(renderLite).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${renderLite(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  const flush = () => { flushPara(); flushList(); };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    let m;
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
    if ((m = /^\s*[-*+]\s+(.*)$/.exec(line)) || (m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      const tag = /^\s*\d/.test(line) ? 'ol' : 'ul';
      flushPara();
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push(m[1]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; }
    flushList();
    para.push(line);
  }
  flush();
  return out.join('');
}

export const THINKING_HTML = '<span class="muted thinking">thinking<span class="dots" aria-hidden="true"></span></span>';
