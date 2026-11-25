// Forever Companion overlay: a small chat window above WoW, backed by `pi --mode rpc`.
import { app, BrowserWindow, clipboard, desktopCapturer, globalShortcut, ipcMain, screen, shell, systemPreferences } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { windowOptions, buttonOptions, applyOverlayLevel, COLLAPSED_HEIGHT, defaultButtonPosition, clampButton, chatBounds } from './src/window-options.js';
import { checkSetup } from './src/setup-check.js';
import { PiClient, piArgs } from './src/pi-client.js';
import { ClaudeClient } from './src/claude-client.js';
import { captureWow, captureWowBitmap } from './src/capture.js';
import { createLiveWriter, createSlugResolver, createLiveReader, scheduleReads, liveStatusLine } from './src/bridge-reader.js';
import { focusBack, isWowRunning } from './src/focus.js';
import { watchWow } from './src/wow-watch.js';
import { clampOpacity } from './src/opacity.js';
import { buildHints, STARTERS } from './src/hints.js';
import { createChatStore, planChatId, isPlanChatId } from './src/chat-store.js';
import { createChatSession, isCompactCommand } from './src/chat-session.js';
import { hintsData, lazyChats, chatsData, exclusiveSend, gamePlanData, copyText } from './src/ipc-data.js';
import { foldsWith, introSeenWith } from './src/plan-page.js';
import { loadConfig, saveConfig } from '../src/config.js';
import { readCharacter, characterSlug } from '../src/core.js';
import { syncAll } from '../src/sync.js';
import { reportUrl } from './src/report-url.js';
import { characterTag } from '../src/bridge/codec.js';
import { checkForUpdate } from '../src/update-check.js';
import { claimSingleInstance } from './src/single-instance.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
let win;
let button;
// The button, chat and hotkey exist only while WoW runs (macOS; elsewhere always).
let wowUp = process.platform !== 'darwin';
let buttonReady = false;
let client;
let expandedHeight = 520;
let collapsed = false;
// Pixel bridge: reads live state from the strip ForeverLog draws while WoW runs (macOS only).
let liveReader = null;
let stopLiveReads = null;
const LIVE_READ_BEFORE_SEND_MS = 2000;
// answering: true from a question's arrival until its answer or error is saved. Opening,
// starting or deleting a chat switches the backend's conversation, which the client refuses
// mid-answer; a second question in that time is refused too (exclusiveSend).
const sendState = { answering: false };
// chat-current opens the latest chat only once (and never after a question was sent).
let chatStarted = false;
// The normal chat that was open when the plan page opened: closing the plan page reopens it.
let chatBeforePlan = null;

function safeConfig() {
  try { return loadConfig(); } catch { return null; }
}

// The new-version notice: { latest, newer } once known, shown as the first hint. Checked at
// start and then hourly; the check itself asks GitHub at most once a day (cached), and is off
// with "updateCheck": false. Never awaited, every error swallowed: it never delays or breaks
// anything, and it opens or focuses nothing.
let update = null;
// { key, ok }: the key that opens the chat and whether it could be taken; null until tried.
let hotkeyState = null;
const UPDATE_CHECK_EVERY_MS = 3600 * 1000;
function checkUpdate() {
  try {
    const current = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
    checkForUpdate({ current, enabled: safeConfig()?.updateCheck !== false })
      .then((u) => { update = u; })
      .catch(() => {});
  } catch { /* no notice */ }
}

// Pages never navigate away or open windows (e.g. a file dropped on the chat).
function lockDown(w) {
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

// Saved chats: one store and one session ({ session, store, character }), made on first use
// once a config exists. Creating them spawns nothing: the client starts its process on the
// first send.
const chatParts = lazyChats({
  safeConfig,
  make: (cfg) => {
    const store = createChatStore({ dir: path.join(cfg.dataDir, 'chats') });
    const session = createChatSession({ store, getClient, backend: cfg.overlay?.backend ?? 'pi', character: cfg.main });
    return { session, store, character: cfg.main };
  },
});

// The chat session, or null while there is no config.
const chats = () => chatParts()?.session ?? null;

// Whether `id` is a saved chat of the current character (ids come from the page).
function isSavedChat(id) {
  const { store, character } = chatParts();
  return store.list({ character }).some((c) => c.id === id);
}

const chatView = (chat) => ({ id: chat.id, messages: chat.messages });

// Saves one change to the overlay part of the config; nothing without a config.
function saveOverlay(change) {
  const cfg = safeConfig();
  if (!cfg) return;
  const overlay = cfg.overlay ?? {};
  saveConfig({ ...cfg, overlay: { ...overlay, ...change(overlay) } });
}

function hasSnapshot(cfg) {
  try { readCharacter(cfg); return true; } catch { return false; }
}

function getClient() {
  if (client) return client;
  const cfg = safeConfig();
  // overlay.backend: "claude" = the player's own Claude Code (their subscription, the
  // Forever Companion plugin loads from the data folder); "pi" = any model through Pi.
  client = cfg?.overlay?.backend === 'claude'
    ? new ClaudeClient({ cwd: cfg.dataDir, env: process.env, model: cfg.overlay.claudeModel ?? 'sonnet', repo: REPO.replace(/[\\/]+$/, '') })
    : new PiClient({
      command: process.env.FC_PI ?? 'pi',
      args: piArgs({ extensionPath: path.join(REPO, 'pi', 'extension.js'), skillsPath: path.join(REPO, 'skills'), model: cfg?.overlay?.model }),
      cwd: cfg?.dataDir ?? REPO,
      env: process.env,
    });
  client.on('delta', (d) => win?.webContents.send('delta', d));
  client.on('tool', (t) => win?.webContents.send('tool', t));
  client.on('usage', (u) => win?.webContents.send('usage', u));
  // The backend summarised older messages (by itself or on /compact): the open chat keeps a note.
  client.on('compacted', () => { try { chats()?.noteCompacted(); } catch { /* the note is a nicety */ } });
  client.on('error', () => {}); // surfaced through the rejected send()
  return client;
}

function statusLine() {
  const cfg = safeConfig();
  if (!cfg) return 'Not set up yet';
  try {
    syncAll(cfg);
    const { snapshot: s } = readCharacter(cfg, undefined, { questTitles: false });
    // readCharacter lays fresh live state over the snapshot and names the live zone.
    if (s.live) {
      const pct = s.xpMax > 0 ? Math.floor((s.xp / s.xpMax) * 100) : 0;
      return `${String(s.name ?? '').split(/\s+/)[0]} L${s.level} ${pct}% XP · ${s.liveMap?.zone ?? (s.subzone || s.zone)} (live)`;
    }
    const live = liveStatusLine({ snapshot: s, live: liveReader?.latest(characterTag(s.name, s.classFile)), nowMs: Date.now() });
    if (live) return live;
    const age = Math.max(0, Math.round((Date.now() / 1000 - (s.time ?? 0)) / 60));
    const pct = s.xpMax > 0 ? Math.floor((s.xp / s.xpMax) * 100) : 0;
    return `${String(s.name ?? '').split(/\s+/)[0]} L${s.level} ${pct}% XP · ${s.subzone || s.zone} · data ${age} min old`;
  } catch (e) {
    return e.message;
  }
}

// Captures and decodes the strip every 10 s (with quick follow-ups while the quest log is
// incomplete) and writes <dataDir>/characters/<slug>.live.json. It only reads pixels: it never
// shows, focuses, or activates a window and never sends input to WoW.
function startLiveReads() {
  if (stopLiveReads) return;
  const cfg = safeConfig();
  if (!cfg?.dataDir) return;
  const windowId = {}; // WoW's window id, reused between reads (see captureWowBitmap)
  liveReader = createLiveReader({
    capture: () => captureWowBitmap({ desktopCapturer, screen, systemPreferences, cache: windowId }),
    writer: createLiveWriter({ dataDir: cfg.dataDir, slugForTag: createSlugResolver({ dataDir: cfg.dataDir }) }),
    log: (m) => console.error(m),
  });
  stopLiveReads = scheduleReads({ read: liveReader.read });
}

function stopLive() {
  stopLiveReads?.();
  stopLiveReads = null;
}

// One fresh read before a question; a slow or failed read never holds the question up.
async function readLiveOnce() {
  if (!liveReader || !stopLiveReads) return;
  let timer;
  await Promise.race([
    liveReader.read().catch(() => {}),
    new Promise((r) => { timer = setTimeout(r, LIVE_READ_BEFORE_SEND_MS); }),
  ]);
  clearTimeout(timer);
}

function toggle() {
  if (!win) return;
  if (win.isVisible() && win.isFocused()) return hide();
  win.show();
  // An accessory app is not active by itself; take focus only when the player asks.
  if (process.platform === 'darwin') app.focus({ steal: true });
  win.focus();
  win.webContents.send('shown');
}

function hide() {
  win?.hide();
  win?.webContents.send('hidden');
  focusBack({ app }); // activate WoW again; the launcher button stays visible
}

function createButton() {
  button = new BrowserWindow(buttonOptions());
  applyOverlayLevel(button);
  const { workArea } = screen.getPrimaryDisplay();
  const saved = safeConfig()?.overlay?.button;
  const pos = saved ? clampButton(saved, workArea) : defaultButtonPosition(workArea);
  button.setPosition(pos.x, pos.y);
  lockDown(button);
  button.loadFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'button.html'));
  // showInactive: visible over the game without taking focus or the cursor away from it.
  button.once('ready-to-show', () => { buttonReady = true; if (wowUp) button.showInactive(); });
  debugWindow('button', button);
}

// FC_DEBUG_DIR=<folder>: log load errors and save a picture of a window's content.
function debugWindow(name, w) {
  const dir = process.env.FC_DEBUG_DIR;
  if (!dir) return;
  const log = (...a) => console.log(`[fc-debug ${name}]`, ...a);
  w.webContents.on('did-fail-load', (_e, code, desc, url) => log('did-fail-load', code, desc, url));
  w.webContents.on('console-message', (_e, level, message) => log('console', level, message));
  w.webContents.on('did-finish-load', () => {
    log('did-finish-load', JSON.stringify(w.getBounds()), 'visible', w.isVisible());
    setTimeout(async () => {
      const img = await w.webContents.capturePage();
      fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
      log('captured', JSON.stringify(img.getSize()), 'visible', w.isVisible(), 'onTop', w.isAlwaysOnTop());
    }, 1500);
  });
}

// Saves the chat's place and size a moment after the last move or resize. While it is
// collapsed to its title bar, the height saved is the one it opens back to.
let rememberTimer = null;
function rememberChat() {
  clearTimeout(rememberTimer);
  rememberTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    try {
      saveOverlay(() => ({ chat: { x: b.x, y: b.y, width: b.width, height: collapsed ? expandedHeight : b.height } }));
    } catch { /* the place is a nicety: the chat opens at its last saved or default spot */ }
  }, 500);
}

function createWindow() {
  win = new BrowserWindow(windowOptions());
  win.setOpacity(clampOpacity(safeConfig()?.overlay?.opacity));
  applyOverlayLevel(win);
  lockDown(win);
  // The chat opens where the player left it, at the size they gave it (overlay.chat).
  const primary = screen.getPrimaryDisplay();
  const areas = [primary, ...screen.getAllDisplays().filter((d) => d.id !== primary.id)].map((d) => d.workArea);
  const bounds = chatBounds(safeConfig()?.overlay?.chat, areas);
  win.setBounds(bounds);
  expandedHeight = bounds.height;
  win.on('move', rememberChat);
  win.on('resize', rememberChat);
  win.loadFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'));
  if (process.env.FC_DEBUG_DIR) {
    win.webContents.on('did-finish-load', async () => {
      const b = win.getBounds();
      const d = screen.getDisplayMatching(b);
      const dpr = await win.webContents.executeJavaScript('window.devicePixelRatio');
      const zoom = win.webContents.getZoomFactor();
      console.log('[fc-debug chat] bounds', JSON.stringify(b), 'display', d.id, d.label, 'scaleFactor', d.scaleFactor, 'size', JSON.stringify(d.size), 'dpr', dpr, 'zoom', zoom);
      for (const x of screen.getAllDisplays()) console.log('[fc-debug display]', x.id, x.label, 'scale', x.scaleFactor, JSON.stringify(x.bounds), 'primary', x.id === screen.getPrimaryDisplay().id);
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(process.env.FC_DEBUG_DIR, 'chat.png'), img.toPNG());
      // A second picture once setup, the open chat and the hints have had time to load.
      setTimeout(async () => {
        const late = await win.webContents.capturePage();
        fs.writeFileSync(path.join(process.env.FC_DEBUG_DIR, 'chat-ready.png'), late.toPNG());
      }, 5000);
    });
    win.webContents.on('console-message', (_e, level, message) => console.log('[fc-debug chat] console', level, message));
  }
}

ipcMain.handle('setup', () => checkSetup({ loadConfig, hasSnapshot, backend: safeConfig()?.overlay?.backend ?? 'pi', piCommand: process.env.FC_PI ?? 'pi' }));
ipcMain.handle('status', () => statusLine());
// Hint chips: the merged (live) snapshot's nudges, with level-ups seen against the synced one.
// The page applies dismissals itself, so none are passed here.
ipcMain.handle('hints', () => hintsData({ safeConfig, readCharacter, buildHints, starters: STARTERS, update, hotkey: hotkeyState }));
// The key that opens the chat and whether it could be taken, for the button's tooltip.
ipcMain.handle('hotkey', () => hotkeyState);
ipcMain.handle('send', (_e, { text, look }) => exclusiveSend(sendState, async () => {
  const session = chats();
  if (!session) return { ok: false, error: 'Not set up yet' };
  let images;
  let note;
  chatStarted = true;
  try {
    await readLiveOnce();
    if (look) {
      const shot = await captureWow({ desktopCapturer, systemPreferences });
      if (shot.ok) images = [{ data: shot.png.toString('base64'), mimeType: 'image/png' }];
      else note = shot.text;
    }
    // `/compact` is a command to the backend, not a question: nothing is saved as a message
    // but the note that it happened.
    if (isCompactCommand(text)) {
      const { notes } = await session.compact();
      return { ok: true, answer: '', notes };
    }
    // The session saves the question and the answer (or the error) to the open chat.
    const { answer, notes, stopped } = await session.send(text, { images });
    return { ok: true, answer, note, notes, stopped };
  } catch (e) {
    return { ok: false, error: e.message, note };
  }
}));
// Saved chats of the current character, newest first, and which one is open.
ipcMain.handle('chats', () => chatsData({ getChats: chatParts }));
// The four calls below switch the backend's conversation, so they wait for no answer:
// while one runs they return { busy: true } and change nothing.
ipcMain.handle('chat-current', () => {
  const session = chats();
  if (!session) return null;
  if (sendState.answering) return { busy: true };
  if (!chatStarted) {
    chatStarted = true;
    session.openLatest();
  }
  return chatView(session.current());
});
ipcMain.handle('chat-open', (_e, id) => {
  const session = chats();
  if (!session) return null;
  if (sendState.answering) return { busy: true };
  // Ids come from the page: open only a saved chat of this character.
  if (!isSavedChat(id)) return null;
  chatStarted = true;
  const chat = session.open(id);
  return chat ? chatView(chat) : null;
});
ipcMain.handle('chat-new', () => {
  const session = chats();
  if (!session) return null;
  if (sendState.answering) return { busy: true };
  chatStarted = true;
  return { id: session.startNew().id };
});
ipcMain.handle('chat-delete', (_e, id) => {
  const session = chats();
  if (!session) return null;
  if (sendState.answering) return { busy: true };
  // Ids come from the page: delete only a saved chat of this character.
  if (!isSavedChat(id)) return { openChanged: false };
  chatStarted = true;
  return session.remove(id);
});
// The game plan page. Its chat (gameplan-<slug>) is one per character and never in the chat
// list; switching to or from it goes through the session's open path like any chat, and is
// refused while an answer runs.
ipcMain.handle('gameplan', () => gamePlanData({ safeConfig, readCharacter, characterSlug }));
ipcMain.handle('plan-page', (_e, open) => {
  const session = chats();
  if (!session) return null;
  if (sendState.answering) return { busy: true };
  chatStarted = true;
  if (open === true) {
    let id = null;
    try { id = planChatId(characterSlug(safeConfig())); } catch { /* no character data yet */ }
    if (!id) return { chat: null }; // the page shows its empty state; the open chat stays
    const cur = session.current();
    if (cur.id !== id) chatBeforePlan = cur.id;
    return { chat: chatView(session.openPlan(id)) };
  }
  // Not on the plan chat (the page had no character data): the open chat stays.
  if (!isPlanChatId(session.current().id)) return { chat: chatView(session.current()) };
  // Back to the chat that was open before: reopened when saved, else a new empty one (an
  // unsaved chat had no messages, so nothing is lost).
  const back = chatBeforePlan && isSavedChat(chatBeforePlan) ? session.open(chatBeforePlan) : null;
  chatBeforePlan = null;
  return { chat: chatView(back ?? session.startNew()) };
});
// Fold state of the plan card ({ [section | 'card']: false } when folded); unknown ids are ignored.
ipcMain.handle('plan-fold', (_e, { id, open } = {}) => {
  saveOverlay((o) => {
    const planFolds = foldsWith(o.planFolds, id, open);
    return planFolds ? { planFolds } : {};
  });
});
// The first-use plan page was shown for the main character: it never opens by itself again.
ipcMain.handle('plan-intro-seen', () => {
  saveOverlay((o) => {
    let slug = null;
    try { slug = characterSlug(safeConfig()); } catch { /* no character data yet */ }
    const planIntroSeen = introSeenWith(o.planIntroSeen, slug);
    return planIntroSeen ? { planIntroSeen } : {};
  });
});
ipcMain.handle('abort', () => client?.abort());
ipcMain.handle('models', async () => {
  try {
    const c = getClient();
    return { models: await c.availableModels(), current: await c.currentModel() };
  } catch {
    return { models: [], current: null };
  }
});
ipcMain.handle('set-model', async (_e, { provider, id }) => {
  await getClient().setModel(provider, id);
  const cfg = safeConfig();
  if (!cfg) return;
  const key = cfg.overlay?.backend === 'claude' ? 'claudeModel' : 'model';
  saveConfig({ ...cfg, overlay: { ...(cfg.overlay ?? {}), [key]: provider === 'claude' ? id : `${provider}/${id}` } });
});
ipcMain.handle('opacity', () => clampOpacity(safeConfig()?.overlay?.opacity));
ipcMain.handle('set-opacity', (_e, { value, save }) => {
  const opacity = clampOpacity(value);
  win?.setOpacity(opacity);
  const cfg = safeConfig();
  if (save && cfg) saveConfig({ ...cfg, overlay: { ...(cfg.overlay ?? {}), opacity } });
  return opacity;
});
// Opens the bug form in the player's browser. The address comes from trusted values only
// (app version, platform, configured backend); the page sends nothing.
ipcMain.handle('report-problem', async () => {
  let version = 'unknown';
  try { version = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version; } catch { /* keep unknown */ }
  try {
    await shell.openExternal(reportUrl({ version, platform: process.platform, backend: safeConfig()?.overlay?.backend ?? 'pi' }));
    return true;
  } catch {
    return false; // no browser could be opened; the click simply does nothing
  }
});
// A copy button on the page (a command to run, an answer): plain text onto the clipboard,
// only ever on the player's click.
ipcMain.handle('copy', (_e, value) => {
  const text = copyText(value);
  if (text === null) return false;
  clipboard.writeText(text);
  return true;
});
ipcMain.handle('hide', () => hide());
ipcMain.handle('toggle', () => toggle());
ipcMain.handle('button-move', (_e, { dx, dy }) => {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
  const [x, y] = button.getPosition();
  const pos = clampButton({ x: x + dx, y: y + dy }, screen.getDisplayMatching(button.getBounds()).workArea);
  button.setPosition(pos.x, pos.y);
});
ipcMain.handle('button-save', () => {
  const cfg = safeConfig();
  const [x, y] = button.getPosition();
  if (cfg) saveConfig({ ...cfg, overlay: { ...(cfg.overlay ?? {}), button: { x, y } } });
  if (!win?.isVisible()) focusBack({ app }); // a drag may have taken focus from WoW
});
ipcMain.handle('collapse', (_e, on) => {
  const [w, h] = win.getSize();
  if (on === collapsed) return;
  collapsed = on === true;
  if (collapsed) { expandedHeight = h; win.setSize(w, COLLAPSED_HEIGHT); } else win.setSize(w, expandedHeight);
});

// Accessory apps never become the active app on launch, so starting the overlay
// does not pull focus (and the cursor) away from WoW. No dock icon either. Set before the
// single-instance check, so a second start that only restarts the running one is quiet too.
if (process.platform === 'darwin') app.setActivationPolicy?.('accessory');

// One overlay at a time: starting it again restarts the running one (see single-instance.js).
// app.exit skips will-quit, so the restart stops the child process and the hotkey itself.
const isPrimary = claimSingleInstance({
  app,
  beforeRestart: () => {
    stopLive();
    globalShortcut.unregisterAll();
    client?.stop();
  },
});

if (isPrimary) app.whenReady().then(() => {
  createWindow();
  createButton();
  checkUpdate();
  setInterval(checkUpdate, UPDATE_CHECK_EVERY_MS).unref?.();
  const hotkey = safeConfig()?.overlay?.hotkey ?? 'Alt+Space';
  const followWow = (running) => {
    wowUp = running;
    if (running) {
      // Start hidden: showing or focusing a window over a running game hides its cursor.
      // The player opens the chat with the button or the hotkey when they want it.
      if (buttonReady) button.showInactive();
      // Taken by another app, or not a key Electron knows: the chat says so (hotkeyHint).
      let ok = globalShortcut.isRegistered(hotkey);
      try { ok = ok || globalShortcut.register(hotkey, toggle); } catch { ok = false; }
      hotkeyState = { key: hotkey, ok };
      if (!ok) console.error(`Could not register hotkey ${hotkey}`);
      if (process.platform === 'darwin') startLiveReads();
    } else {
      stopLive();
      // WoW is closed: nothing on screen, and the hotkey goes back to other apps.
      win?.hide();
      win?.webContents.send('hidden');
      button?.hide();
      globalShortcut.unregister(hotkey);
    }
  };
  if (process.platform === 'darwin') watchWow({ isRunning: isWowRunning, onChange: followWow });
  else followWow(true);
});

// Only the running overlay cleans up: a second start quits before ready, when the hotkey
// module may not be used (an error there would show a dialog over the game).
if (isPrimary) {
  app.on('will-quit', () => {
    stopLive();
    globalShortcut.unregisterAll();
    client?.stop();
  });
  app.on('window-all-closed', () => app.quit());
}
