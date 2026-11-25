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
// Reply chips the last answer offered ({ multi, options }, from choices.js) and, for a multi
// choice, the indexes the player ticked. Gone once the player types or sends anything.
let offered = null;
const picked = new Set();
const KINDS = new Set(['user', 'bot', 'note', 'error']);
// The game plan page: 'chat' or 'plan' (the card above the plan chat). planData is the last
// { hasSnapshot, plan, level, introSeen, folds } from main; chatless is true on a plan page
// without character data (no plan chat to type into). The first-use page opens by itself at
// most once, and only once the player has shown the window (introChecked).
let page = 'chat';
let planData = null;
let chatless = false;
let shown = false;
let setupOk = false;
let introChecked = false;

import { renderMarkdown as render } from './src/format.js';
import { visibleHints } from './src/hint-view.js';
import { groupChats, dateLabel } from './src/chat-groups.js';
import { errorLine, settlePending, activityLabel, workingHtml, elapsedText } from './src/answer-view.js';
import { parseChoices, visibleText, answerFromChoices } from './src/choices.js';
import { planCardModel, planCardHtml } from './src/plan-card.js';
import { planPageState, canSwitch, cardMode, foldsWith, KICKOFF, START_LABEL, INTRO_TEXT, NO_PLAN_TEXT, NO_SNAPSHOT_TEXT } from './src/plan-page.js';

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

function clearOffer() {
  offered = null;
  picked.clear();
}

// A multi-choice chip: a click ticks or unticks it (aria-pressed shows which, with the hover
// border), nothing is sent until "Send these".
function choiceToggle(h) {
  const on = picked.has(h.index);
  const b = hintButton('hint chip', on ? '◆' : '◇', h.label, null);
  b.setAttribute('aria-pressed', String(on));
  b.title = h.text;
  b.addEventListener('click', () => {
    if (busy || switching) return;
    if (!picked.delete(h.index)) picked.add(h.index);
    drawHints();
  });
  return b;
}

// Sends the ticked options as one message ("A, B and C"); off until one is ticked.
function sendPicked(h) {
  const b = hintButton('hint chip', '→', h.label, null);
  b.disabled = busy || picked.size === 0;
  b.title = h.text;
  b.addEventListener('click', () => {
    if (busy || switching || !offered) return;
    const labels = offered.options.filter((_, i) => picked.has(i));
    if (labels.length) ask(answerFromChoices(labels));
  });
  return b;
}

// A hint that opens the plan page ("Set up your game plan"): sends nothing, stays until a
// plan exists.
function planHintButton(className, h) {
  const b = hintButton(className, '◆', h.label, null);
  b.title = h.text;
  b.addEventListener('click', () => setPage('plan'));
  return b;
}

function drawHints() {
  const empty = messages.children.length === 0;
  // The plan page keeps to its one task: only the reply chips of its own answers.
  const onPlan = page === 'plan';
  const v = visibleHints({ live: onPlan ? [] : hints.live, starters: onPlan ? [] : hints.starters, dismissed, empty, choices: offered });
  const pick = (h) => () => dismissed.add(h.key);
  // A notice's row carries both parts ("0.4.1 is out; run: node bin/wowf update").
  const rowText = (h) => (h.prompt == null ? `${h.label}; ${h.text}` : h.text);
  $('hint-rows').replaceChildren(...v.rows.map((h) => (h.action === 'open-plan'
    ? planHintButton('hint hint-row', h)
    : hintButton('hint hint-row', '◆', rowText(h), h.prompt, pick(h)))));
  $('starters').replaceChildren(...v.starters.map((s) => hintButton('hint starter', '·', s.label, s.prompt)));
  $('hintbar').replaceChildren(...v.chips.map((h) => {
    if (h.kind === 'choice-send') return sendPicked(h);
    if (h.kind === 'choice' && offered?.multi) return choiceToggle(h);
    if (h.action === 'open-plan') return planHintButton('hint chip', h);
    // A single choice sends its label as the player's message; ask() takes the chips away.
    const b = hintButton('hint chip', '◆', h.label, h.prompt, h.kind === 'choice' ? null : pick(h));
    b.title = h.text;
    return b;
  }));
  $('welcome').hidden = !empty || onPlan;
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
  clearOffer();
  resetUsage();
  drawHints();
  refreshHints();
}

// Shows a saved chat ({ id, messages }); stored roles are the add() kinds.
function showChat(chat) {
  messages.replaceChildren();
  clearOffer(); // saved answers carry no chip block: a reopened chat offers none
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
  for (const b of [$('newchat'), $('drawer-new'), $('planbtn'), ...$('chatlist').querySelectorAll('button')]) b.disabled = busy;
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
  setPageView('chat');
  showChat(chat);
  closeDrawer();
  $('input').focus(); // an element focus only; the window is left alone
}

async function newChat() {
  const res = await switchChat(() => window.fc.newChat());
  if (!res) return;
  setPageView('chat');
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

// ---- The game plan page ------------------------------------------------------------------

// The page's chrome: the Plan button's pressed state, the card area, the input.
function setPageView(next, { noChat = false } = {}) {
  page = next;
  chatless = next === 'plan' && noChat;
  $('planbtn').setAttribute('aria-pressed', String(page === 'plan'));
  $('plan').hidden = page !== 'plan';
  $('input').disabled = chatless;
}

// Switches between the normal chat and the plan page; main opens the matching chat (refused
// while an answer runs). Returns true once switched.
async function setPage(next) {
  if (next === page || !canSwitch({ busy, switching })) return false;
  const res = await switchChat(() => window.fc.planPage(next === 'plan'));
  if (!res) return false;
  setPageView(next, { noChat: !res.chat });
  closeDrawer();
  if (res.chat) showChat(res.chat);
  else clearView();
  if (page === 'plan') refreshPlan();
  $('input').focus(); // an element focus only; the window is left alone
  return true;
}

// Re-reads the plan file and redraws the card (page shown, and after every answer).
async function refreshPlan() {
  try { planData = await window.fc.gamePlan(); } catch { /* keep the last one */ }
  drawPlan();
}

// The card area: the card, or one readable line (with the Start chip on an empty plan chat).
// Plan text goes through planCardHtml, which escapes it.
function drawPlan() {
  const box = $('plan');
  if (page !== 'plan' || !planData) return box.replaceChildren();
  const mode = cardMode({ hasSnapshot: planData.hasSnapshot, hasPlan: !!planData.plan, chatEmpty: messages.children.length === 0 });
  if (mode === 'card') {
    box.innerHTML = planCardHtml(planCardModel(planData.plan, { level: planData.level, folds: planData.folds, nowSec: Math.floor(Date.now() / 1000) }));
    return;
  }
  const line = document.createElement('div');
  line.className = mode === 'start' ? '' : 'muted plan-note';
  line.textContent = { start: INTRO_TEXT, none: NO_PLAN_TEXT, empty: NO_SNAPSHOT_TEXT }[mode];
  if (mode !== 'start') return box.replaceChildren(line);
  // Nothing is sent before this click.
  box.replaceChildren(line, hintButton('hint chip plan-start', '◆', START_LABEL, KICKOFF));
}

// The first-use plan page: once the player opens the overlay, for a character with data but
// no plan that never saw it. Marked seen once shown; never forced again.
async function maybeIntro() {
  if (introChecked || !setupOk || !shown || page === 'plan' || !canSwitch({ busy, switching })) return;
  introChecked = true;
  let d;
  try { d = await window.fc.gamePlan(); } catch { return; }
  if (planPageState({ hasSnapshot: d?.hasSnapshot, hasPlan: !!d?.plan, introSeen: d?.introSeen }) !== 'intro') return;
  if (await setPage('plan')) window.fc.planIntroSeen();
  else introChecked = false; // refused (an answer started): try again on the next show
}

async function runSetup() {
  const { ok, problems } = await window.fc.setup();
  $('setup').hidden = ok;
  $('chat').hidden = !ok;
  $('problems').replaceChildren(...problems.map((p) => Object.assign(document.createElement('li'), { textContent: p.text })));
  $('history').hidden = !ok;
  $('newchat').hidden = !ok;
  $('planbtn').hidden = !ok;
  setupOk = ok;
  if (ok) {
    refreshStatus();
    await loadCurrentChat(); // also draws and refreshes the hints
    const { models, current } = await window.fc.models();
    $('model').replaceChildren(...models.map((m) => Object.assign(document.createElement('option'), {
      value: `${m.provider}/${m.id}`, textContent: m.name ?? `${m.provider}/${m.id}`,
    })));
    if (current) $('model').value = `${current.provider}/${current.id}`;
    $('input').focus();
    maybeIntro();
  }
}

function send() {
  const text = $('input').value.trim();
  if (!text || busy || switching || chatless) return;
  $('input').value = '';
  ask(text);
}

// Ends the pending answer bubble: without any streamed text it would keep showing the
// thinking indicator, so it gets the answer that came with the result, or goes away.
// A reply chip block at the end of the answer comes off the text and, for an answer that went
// through, becomes the offered chips.
function settle(bubble, res) {
  const s = settlePending({ raw: bubble.dataset.raw, ok: res?.ok, answer: res?.answer });
  if (s.action === 'remove') return bubble.remove();
  const { text, choices } = parseChoices(s.action === 'fill' ? s.text : bubble.dataset.raw);
  bubble.dataset.raw = text;
  bubble.innerHTML = render(text); // drops the working line; render() escapes HTML first
  if (res?.ok && choices) {
    offered = choices;
    picked.clear();
  }
}

// The one path a question takes, whether typed or picked from a hint.
async function ask(text) {
  if (!text || busy || switching || chatless) return;
  busy = true;
  clearOffer(); // answered: the offered chips go
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
  drawPlan(); // the Start chip goes with the first question
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
    refreshPlan(); // the answer may have written the plan (on either page)
  }
}

// The open answer: text so far plus a line saying what the companion is doing right now
// (thinking, a tool in plain words, or writing) and for how long, until the answer ends.
function paintPending() {
  if (!current) return;
  const sec = (Date.now() - Number(current.dataset.started)) / 1000;
  // A chip block still arriving stays hidden, so its markup never flashes.
  current.innerHTML = render(visibleText(current.dataset.raw)) + workingHtml(current.dataset.activity, sec);
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
window.fc.onShown(() => {
  shown = true;
  $('input').focus();
  refreshLive();
  startRefresh();
  if (page === 'plan') refreshPlan();
  maybeIntro();
});
// A drawer left open would sit over the input the next time the window is shown.
window.fc.onHidden(() => { shown = false; stopRefresh(); closeDrawer(); });

$('ask').addEventListener('submit', (e) => { e.preventDefault(); send(); });
// Typing an answer of their own takes the offered chips away.
$('input').addEventListener('input', () => {
  if (!offered || !$('input').value.trim()) return;
  clearOffer();
  drawHints();
});
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (drawerOpen()) closeDrawer();
  else window.fc.hide();
});
$('history').addEventListener('click', toggleDrawer);
$('planbtn').addEventListener('click', () => setPage(page === 'plan' ? 'chat' : 'plan'));
// Card folds: a section header or "Fold all"/"Show all"; the state is saved in the config.
$('plan').addEventListener('click', (e) => {
  const b = e.target.closest('[data-fold]');
  if (!b || !planData) return;
  const open = b.getAttribute('aria-expanded') !== 'true';
  const folds = foldsWith(planData.folds, b.dataset.fold, open);
  if (!folds) return;
  planData = { ...planData, folds };
  drawPlan();
  window.fc.planFold(b.dataset.fold, open);
});
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
