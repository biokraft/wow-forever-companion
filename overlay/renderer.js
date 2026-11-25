// Overlay page logic. Talks to the main process only through window.fc (preload bridge).
const $ = (id) => document.getElementById(id);
const messages = $('messages');
let busy = false;
let current = null;
let tokens = 0;
// Hints: what main last sent, the keys the player already clicked (this window's life only),
// and the 15 s refresh that runs only while the window is shown.
let hints = { live: [], starters: [] };
const dismissed = new Set();
let refreshTimer = null;
const REFRESH_MS = 15000;
// Saved chats: true while the page waits for main to open, start or delete one, so a question
// cannot slip in between and land in the wrong chat view.
let switching = false;
const KINDS = new Set(['user', 'bot', 'note', 'error']);

import { renderMarkdown as render } from './src/format.js';
import { visibleHints } from './src/hint-view.js';
import { groupChats, dateLabel } from './src/chat-groups.js';
import { errorLine, settlePending, activityLabel, workingHtml, elapsedText } from './src/answer-view.js';

function add(kind, text) {
  const div = document.createElement('div');
  div.className = `msg ${kind}`;
  div.innerHTML = render(text);
  messages.append(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

async function refreshStatus() {
  $('status').textContent = await window.fc.status();
}

// Hint text comes from game data: built with createElement/textContent only, never innerHTML.
function hintButton(className, mark, text, prompt, onPick) {
  const b = document.createElement('button');
  b.type = 'button'; // inside the #ask form: never submit it
  b.className = className;
  b.disabled = busy;
  const m = document.createElement('span');
  m.className = 'mark';
  m.textContent = mark;
  const t = document.createElement('span');
  t.className = 'label';
  t.textContent = text;
  b.append(m, t);
  // The click redraws the hints and removes this button, which takes the typing focus with
  // it: give it back to the input (an element focus only; the window is left alone).
  // A hint is dismissed only when its question really goes out (ask() has the same guard).
  // A notice (no prompt, like the update notice) sends nothing and dismisses nothing.
  b.addEventListener('click', () => {
    if (prompt != null && !busy && !switching) { onPick?.(); ask(prompt); }
    $('input').focus();
  });
  return b;
}

function drawHints() {
  const empty = messages.children.length === 0;
  const v = visibleHints({ live: hints.live, starters: hints.starters, dismissed, empty });
  const pick = (h) => () => dismissed.add(h.key);
  // A notice's row carries both parts ("0.4.1 is out; run: node bin/wowf update").
  const rowText = (h) => (h.prompt == null ? `${h.label}; ${h.text}` : h.text);
  $('hint-rows').replaceChildren(...v.rows.map((h) => hintButton('hint hint-row', '◆', rowText(h), h.prompt, pick(h))));
  $('starters').replaceChildren(...v.starters.map((s) => hintButton('hint starter', '·', s.label, s.prompt)));
  $('hintbar').replaceChildren(...v.chips.map((h) => {
    const b = hintButton('hint chip', '◆', h.label, h.prompt, pick(h));
    b.title = h.text;
    return b;
  }));
  $('welcome').hidden = !empty;
  $('hintbar').hidden = v.chips.length === 0;
}

async function refreshHints() {
  try { hints = await window.fc.hints(); } catch { /* keep the last ones */ }
  drawHints();
}

// The status line and the hints, re-read from the game data. Not while an answer streams:
// it would overwrite the "checking …" status and run a sync under the answer. ask() refreshes
// both when the answer is in.
function refreshLive() {
  if (busy) return;
  refreshStatus();
  refreshHints();
}

function startRefresh() {
  if (refreshTimer) return;
  refreshTimer = setInterval(refreshLive, REFRESH_MS);
}

function stopRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = null;
}

// ---- Saved chats -------------------------------------------------------------------------

function resetUsage() {
  tokens = 0;
  $('usage').textContent = '';
}

// An empty chat view: the welcome with its hints comes back.
function clearView() {
  messages.replaceChildren();
  resetUsage();
  drawHints();
  refreshHints();
}

// Shows a saved chat ({ id, messages }); stored roles are the add() kinds.
function showChat(chat) {
  messages.replaceChildren();
  for (const m of chat.messages ?? []) {
    if (!KINDS.has(m.role)) continue;
    const text = String(m.text ?? '');
    add(m.role, m.role === 'error' ? errorLine(text) : text); // as the live error line reads
  }
  resetUsage();
  drawHints();
  refreshHints();
}

// Chat switching waits for no answer: these controls are off while one runs.
function syncBusy() {
  for (const b of [$('newchat'), $('drawer-new'), ...$('chatlist').querySelectorAll('button')]) b.disabled = busy;
}

// Runs one call that switches the open chat in main; returns its result, or null when it
// failed, was refused (an answer is running) or there is nothing to switch to.
async function switchChat(call) {
  if (busy || switching) return null;
  switching = true;
  try {
    const res = await call();
    return res && !res.busy ? res : null;
  } catch {
    return null;
  } finally {
    switching = false;
  }
}

const drawerOpen = () => !$('drawer').hidden;
function closeDrawer() { $('drawer').hidden = true; }

// Chat titles are the player's own text: rows use createElement/textContent only.
function chatRow(item, isOpen, showDate) {
  const row = document.createElement('div');
  row.className = isOpen ? 'chat-row open' : 'chat-row';
  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'chat-title';
  pick.disabled = busy;
  pick.title = item.title || 'New chat';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = item.title || 'New chat';
  pick.append(name);
  if (showDate) {
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = dateLabel(item.updatedAt);
    pick.append(when);
  }
  pick.addEventListener('click', () => openChat(item.id));
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'chat-del';
  del.disabled = busy;
  del.title = 'Delete chat';
  del.textContent = '×';
  // Two clicks: the first asks, the second deletes. Leaving the row takes the question back.
  del.addEventListener('click', () => {
    if (del.classList.contains('confirm')) return deleteChat(item.id);
    del.classList.add('confirm');
    del.textContent = 'Delete?';
  });
  row.addEventListener('mouseleave', () => {
    del.classList.remove('confirm');
    del.textContent = '×';
  });
  row.append(pick, del);
  return row;
}

async function drawChatList() {
  let res;
  try { res = await window.fc.chats(); } catch { res = null; }
  const items = Array.isArray(res?.items) ? res.items : [];
  const nodes = [];
  for (const group of groupChats(items, Math.floor(Date.now() / 1000))) {
    const label = document.createElement('div');
    label.className = 'chat-group';
    label.textContent = group.label;
    nodes.push(label, ...group.items.map((it) => chatRow(it, it.id === res.openId, group.label === 'Earlier')));
  }
  if (nodes.length === 0) {
    const none = document.createElement('div');
    none.className = 'chat-none muted';
    none.textContent = 'No saved chats yet.';
    nodes.push(none);
  }
  $('chatlist').replaceChildren(...nodes);
}

function toggleDrawer() {
  if (drawerOpen()) return closeDrawer();
  $('drawer').hidden = false;
  drawChatList();
}

async function openChat(id) {
  const chat = await switchChat(() => window.fc.openChat(id));
  if (!chat) return drawChatList(); // gone in the meantime, or refused: show what is there now
  showChat(chat);
  closeDrawer();
  $('input').focus(); // an element focus only; the window is left alone
}

async function newChat() {
  const res = await switchChat(() => window.fc.newChat());
  if (!res) return;
  clearView();
  closeDrawer();
  $('input').focus(); // an element focus only; the window is left alone
}

async function deleteChat(id) {
  const res = await switchChat(() => window.fc.deleteChat(id));
  if (res?.openChanged) clearView();
  drawChatList();
}

// The chat main has open (the latest recent one the first time), shown once setup is ok.
async function loadCurrentChat() {
  let chat;
  try { chat = await window.fc.currentChat(); } catch { chat = null; }
  if (chat && !chat.busy && !busy) showChat(chat);
  else refreshHints();
}

async function runSetup() {
  const { ok, problems } = await window.fc.setup();
  $('setup').hidden = ok;
  $('chat').hidden = !ok;
  $('problems').replaceChildren(...problems.map((p) => Object.assign(document.createElement('li'), { textContent: p.text })));
  $('history').hidden = !ok;
  $('newchat').hidden = !ok;
  if (ok) {
    refreshStatus();
    await loadCurrentChat(); // also draws and refreshes the hints
    const { models, current } = await window.fc.models();
    $('model').replaceChildren(...models.map((m) => Object.assign(document.createElement('option'), {
      value: `${m.provider}/${m.id}`, textContent: m.name ?? `${m.provider}/${m.id}`,
    })));
    if (current) $('model').value = `${current.provider}/${current.id}`;
    $('input').focus();
  }
}

function send() {
  const text = $('input').value.trim();
  if (!text || busy || switching) return;
  $('input').value = '';
  ask(text);
}

// Ends the pending answer bubble: without any streamed text it would keep showing the
// thinking indicator, so it gets the answer that came with the result, or goes away.
function settle(bubble, res) {
  const s = settlePending({ raw: bubble.dataset.raw, ok: res?.ok, answer: res?.answer });
  if (s.action === 'keep') bubble.innerHTML = render(bubble.dataset.raw); // drops the working line
  else if (s.action === 'remove') bubble.remove();
  else if (s.action === 'fill') {
    bubble.dataset.raw = s.text;
    bubble.innerHTML = render(s.text); // render() escapes HTML first, as for streamed text
  }
}

// The one path a question takes, whether typed or picked from a hint.
async function ask(text) {
  if (!text || busy || switching) return;
  busy = true;
  syncBusy();
  $('model').disabled = true; // switching models restarts the backend mid-answer
  add('user', text);
  current = add('bot', '');
  current.dataset.raw = '';
  current.dataset.activity = 'Thinking';
  current.dataset.started = String(Date.now());
  paintPending();
  const pending = current;
  // The time under the answer ticks in place, so the dots' animation keeps running.
  const ticker = setInterval(() => {
    const el = pending.querySelector('.working .elapsed');
    if (el) el.textContent = elapsedText((Date.now() - Number(pending.dataset.started)) / 1000);
  }, 1000);
  drawHints(); // the welcome goes, chips turn disabled
  try {
    const res = await window.fc.send(text, $('look').checked);
    settle(pending, res);
    if (res.note) add('note', res.note);
    for (const n of res.notes ?? []) add('note', n);
    if (!res.ok) add('error', errorLine(res.error));
  } catch (e) {
    // The call itself failed (no result from main): still say so.
    settle(pending, null);
    add('error', errorLine(e?.message ?? e));
  } finally {
    // Even if the call itself rejects, the page must not stay stuck in "answering".
    clearInterval(ticker);
    current = null;
    busy = false;
    syncBusy();
    if (drawerOpen()) drawChatList(); // the answered chat moves up the list
    $('model').disabled = false;
    refreshStatus();
    refreshHints();
  }
}

// The open answer: text so far plus a line saying what the companion is doing right now
// (thinking, a tool in plain words, or writing) and for how long, until the answer ends.
function paintPending() {
  if (!current) return;
  const sec = (Date.now() - Number(current.dataset.started)) / 1000;
  current.innerHTML = render(current.dataset.raw) + workingHtml(current.dataset.activity, sec);
  messages.scrollTop = messages.scrollHeight;
}

window.fc.onDelta((d) => {
  if (!current) return;
  current.dataset.raw += d;
  current.dataset.activity = 'Writing';
  paintPending();
});
window.fc.onTool((t) => {
  if (t.phase === 'start') $('status').textContent = t.name === 'compact' ? 'summarising…' : `checking ${t.name.replace('wow_', '')}…`;
  if (!current) return;
  current.dataset.activity = t.phase === 'start' ? activityLabel(t.name) : 'Thinking';
  paintPending();
});
window.fc.onUsage((u) => {
  tokens += u.totalTokens ?? 0;
  $('usage').textContent = `${(tokens / 1000).toFixed(1)}k tokens`;
});
window.fc.onShown(() => { $('input').focus(); refreshLive(); startRefresh(); });
// A drawer left open would sit over the input the next time the window is shown.
window.fc.onHidden(() => { stopRefresh(); closeDrawer(); });

$('ask').addEventListener('submit', (e) => { e.preventDefault(); send(); });
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (drawerOpen()) closeDrawer();
  else window.fc.hide();
});
$('history').addEventListener('click', toggleDrawer);
$('newchat').addEventListener('click', newChat);
$('drawer-new').addEventListener('click', newChat);
// The browser opens only from this click; the main process builds the address.
$('report').addEventListener('click', () => window.fc.reportProblem());
$('close').addEventListener('click', () => window.fc.hide());
$('collapse').addEventListener('click', () => {
  const collapsed = document.body.classList.toggle('collapsed');
  $('collapse').textContent = collapsed ? '+' : '–';
  if (collapsed) closeDrawer(); // not visible when collapsed: Esc must hide the window, not close it
  window.fc.collapse(collapsed);
});
$('model').addEventListener('change', (e) => {
  const [provider, ...rest] = e.target.value.split('/');
  window.fc.setModel(provider, rest.join('/'));
});
// Opacity: follow the slider while it moves, save once it is let go.
$('opacity').addEventListener('input', (e) => window.fc.setOpacity(e.target.value / 100, false));
$('opacity').addEventListener('change', (e) => window.fc.setOpacity(e.target.value / 100, true));
window.fc.opacity().then((v) => { $('opacity').value = Math.round(v * 100); });
$('recheck').addEventListener('click', runSetup);

runSetup();
