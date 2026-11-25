// The game plan card on the plan page: a model of what to show (pure data) and its HTML, every
// text from the plan escaped. Pure: no I/O, no DOM. The plan shape is src/gameplan.js.

export const PLAN_SECTIONS = [
  { id: 'goal', title: 'Goal' },
  { id: 'role', title: 'Role and build' },
  { id: 'playstyle', title: 'Playstyle' },
  { id: 'professions', title: 'Professions' },
  { id: 'milestones', title: 'Milestones' },
  { id: 'avoid', title: 'Avoid' },
  { id: 'notes', title: 'Notes' },
];

const ROLE = [['spec', 'Spec'], ['weapons', 'Weapons'], ['notes', 'Notes']];

const textLines = (s) => (typeof s === 'string' ? s.split('\n').map((l) => l.trim()).filter(Boolean) : []);
const items = (list) => (Array.isArray(list) ? list : []);

function sectionLines(id, plan, level) {
  switch (id) {
    case 'goal':
    case 'notes':
      return textLines(plan[id]).map((text) => ({ text }));
    case 'role':
      return ROLE.filter(([k]) => plan.role?.[k]).map(([k, label]) => ({ text: `${label}: ${plan.role[k]}` }));
    case 'playstyle':
    case 'avoid':
      return items(plan[id]).filter((t) => typeof t === 'string' && t).map((text) => ({ text }));
    case 'professions':
      return items(plan.professions).filter((p) => p?.name).map((p) => ({ text: p.why ? `${p.name}: ${p.why}` : p.name }));
    case 'milestones':
      return items(plan.milestones).filter((m) => m?.text).map((m) => {
        if (m.level == null) return { text: m.text };
        const line = { text: `Level ${m.level}: ${m.text}` };
        if (typeof level === 'number' && m.level <= level) line.reached = true;
        return line;
      });
    default:
      return [];
  }
}

/** "Updated 2 h ago" from updatedAt (seconds); '' when unknown. */
export function updatedText(updatedAt, nowSec) {
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return '';
  const sec = Math.max(0, nowSec - updatedAt);
  if (sec < 60) return 'Updated just now';
  if (sec < 3600) return `Updated ${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `Updated ${Math.floor(sec / 3600)} h ago`;
  const days = Math.floor(sec / 86400);
  return `Updated ${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * What the card shows. `level` is the live level (milestones at or below it are reached);
 * `folds` is the saved fold state ({ [sectionId | 'card']: false } when folded), every
 * section open by default; `open` is false when the whole card is folded to its summary.
 */
export function planCardModel(plan, { level = null, folds = {}, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const f = folds ?? {};
  const sections = [];
  for (const { id, title } of PLAN_SECTIONS) {
    const lines = sectionLines(id, plan, level);
    if (lines.length) sections.push({ id, title, open: f[id] !== false, lines });
  }
  return { summary: plan.summary ?? '', updatedText: updatedText(plan.updatedAt, nowSec), open: f.card !== false, sections };
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// A header that folds its part in and out: a real button, its state in aria-expanded.
function foldButton(id, open, label, className, title) {
  return `<button type="button" class="${className}" data-fold="${id}" aria-expanded="${open}" title="${escapeHtml(title)}">`
    + `<span class="mark">${open ? '▾' : '▸'}</span>${escapeHtml(label)}</button>`;
}

/** The card's HTML: summary line and fold-all control, then the sections and the age line. */
export function planCardHtml(model) {
  const top = `<div class="plan-top"><div class="plan-summary">${escapeHtml(model.summary)}</div>`
    + `${foldButton('card', model.open, model.open ? 'Fold all' : 'Show all', 'hint plan-fold-all', model.open ? 'Fold the card to its summary line' : 'Show the whole card')}</div>`;
  if (!model.open) return `<div class="plan-card">${top}</div>`;
  const sections = model.sections.map((s) => {
    const head = foldButton(s.id, s.open, s.title, 'chat-group plan-head', s.open ? `Fold ${s.title}` : `Show ${s.title}`);
    if (!s.open) return `<section class="plan-section">${head}</section>`;
    const lines = s.lines.map((l) => (l.reached ? `<li class="muted">✓ ${escapeHtml(l.text)}</li>` : `<li>${escapeHtml(l.text)}</li>`)).join('');
    return `<section class="plan-section">${head}<ul class="plan-lines">${lines}</ul></section>`;
  }).join('');
  const updated = model.updatedText ? `<div class="plan-updated muted">${escapeHtml(model.updatedText)}</div>` : '';
  return `<div class="plan-card">${top}${sections}${updated}</div>`;
}
