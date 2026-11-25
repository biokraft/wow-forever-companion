// Talks to the user's own Claude Code CLI in headless streaming mode. Same interface as
// PiClient, so the overlay can use either. Plain Node, unit-tested with a fake `claude`.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { isSessionId } from './session-id.js';
import { ADVICE_RULES, CHOICES_RULES } from './advice-rules.js';
import { resolveTool } from '../../src/tool-command.js';

const MODELS = [
  { provider: 'claude', id: 'haiku', name: 'Claude Haiku' },
  { provider: 'claude', id: 'sonnet', name: 'Claude Sonnet' },
  { provider: 'claude', id: 'opus', name: 'Claude Opus' },
];

// Runs the player's own Claude Code isolated from their personal setup:
// --restricted ignores user/project/local settings (their permission rules and hooks) and
// keeps file tools inside the working folders; --strict-mcp-config drops MCP servers; only
// this repo's plugin loads. dontAsk denies anything not allowed below, without prompting.
const SAFE_WOWF = ['sync', 'sync *', 'state', 'state *', 'quests *', 'npc *', 'plan show', 'plan show *', 'plan write --json *', 'plan write drafts/*',
  'gameplan show', 'gameplan show *', 'gameplan write drafts/*', 'gameplan write --json *', 'knowledge *'];
// Free text (notes, plans) goes through files, never shell arguments: an apostrophe in
// "Gar'Thok" would break the quoting. Writes are limited to two folders of the data folder.
const WRITABLE = ['./knowledge/*.md', './drafts/*.json'];
// Never instruction files, whatever the case (case-insensitive disks).
const NOT_WRITABLE = ['CLAUDE.md', 'claude.md', 'Claude.md', 'AGENTS.md', 'agents.md', 'Agents.md'].map((f) => `./knowledge/${f}`);
// Same WoW-site allowlist as the Pi tool; fetches anywhere else are denied (no exfiltration).
// No Wowhead: its terms allow only ordinary browsers.
const WEB_DOMAINS = ['www.warcrafttavern.com', 'warcrafttavern.com', 'warcraft.wiki.gg',
  'us.forums.blizzard.com', 'eu.forums.blizzard.com', 'news.blizzard.com', 'www.icy-veins.com', 'www.method.gg'];
const DENIED_WOWF = ['init *', 'install-addon *', 'overlay *'];
// What `claude -p --resume <id>` prints when it has no conversation with that id.
const GONE = 'No conversation found';
const STDERR_KEEP = 2000;
// An exit can arrive before the last stdout/stderr data; wait this long for the pipes to close.
const CLOSE_GRACE_MS = 250;

function sessionGone() {
  return Object.assign(new Error('Claude Code no longer has this conversation'), { code: 'session_gone' });
}

// The wowf command line goes into Bash permission rules and the system prompt. Claude Code
// runs Bash through Git Bash on Windows, where backslashes are escapes, so on win32 the path
// uses forward slashes (C:/...), which Node and Git Bash both accept.
export function wowfCommand(repo, platform = process.platform) {
  let dir = String(repo).replace(/[\\/]+$/, '');
  if (platform === 'win32') dir = dir.replace(/\\/g, '/');
  const wowfPath = `${dir}/bin/wowf`;
  return /\s/.test(wowfPath) ? `node "${wowfPath}"` : `node ${wowfPath}`;
}

export function claudeArgs({ model = 'sonnet', repo, sessionId, platform = process.platform } = {}) {
  const wowf = wowfCommand(repo, platform);
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--include-partial-messages', '--model', model,
    '--restricted', '--strict-mcp-config', '--plugin-dir', repo, '--add-dir', `${repo}/knowledge`,
    '--permission-mode', 'dontAsk',
    '--tools', 'Read,Glob,Grep,Bash,Skill,WebSearch,WebFetch,Write,Edit',
    '--allowedTools', 'Read', 'Glob', 'Grep', 'Skill', 'WebSearch', ...WEB_DOMAINS.map((d) => `WebFetch(domain:${d})`),
    ...WRITABLE.flatMap((p) => [`Write(${p})`, `Edit(${p})`]),
    ...SAFE_WOWF.map((c) => `Bash(${wowf} ${c})`),
    '--disallowedTools', ...DENIED_WOWF.map((c) => `Bash(${wowf} ${c})`),
    ...NOT_WRITABLE.flatMap((p) => [`Write(${p})`, `Edit(${p})`]),
    '--append-system-prompt', `Forever Companion overlay: run the toolkit CLI exactly as \`${wowf} <command>\` (allowed: sync, state, quests, npc, plan show, knowledge list|show, plan write drafts/plan.json, gameplan show, gameplan write drafts/gameplan.json). Save notes with the Write tool to knowledge/<slug>.md, plans to drafts/plan.json and the game plan to drafts/gameplan.json in the data folder; you cannot write anywhere else. Other shell commands are not available. ${ADVICE_RULES} ${CHOICES_RULES}`];
  // The last gate before the command line: anything that is not a UUID is left out.
  if (isSessionId(sessionId)) args.push('--resume', sessionId);
  return args;
}

export class ClaudeClient extends EventEmitter {
  // `resolve` finds how to start `command` without a shell (on Windows, an npm install of
  // Claude Code is a .cmd shim; the system prompt argument must never reach a shell).
  // `spawn` is injectable for tests.
  constructor({ command = 'claude', prefixArgs = [], cwd, env, model = 'sonnet', repo, resolve = resolveTool, spawn: spawnFn = spawn } = {}) {
    super();
    this.opts = { command, prefixArgs, cwd, env, repo, resolve, spawn: spawnFn };
    // Sent with every message: a resumed chat remembers the toolkit path from when it started,
    // and after the toolkit moved (another folder, a re-clone) that old path is not allowed.
    this.toolkitHint = `[Run the toolkit exactly as \`${wowfCommand(repo)} <command>\`; command paths used earlier in this chat may no longer work.]`;
    this.model = model;
    this.sessionId = null;
    this.proc = null;
    this.run = null;
  }

  get canResume() { return true; }

  /**
   * Points the next start at a saved conversation; stops a running process. null, or an id
   * that is not a UUID (see session-id.js), starts a fresh conversation.
   */
  openSession(id) {
    if (this.run) throw new Error('Claude is still answering the previous message');
    this.stop('stopped to switch chat');
    this.sessionId = isSessionId(id) ? id : null;
  }

  start() {
    if (this.proc) return;
    const tool = this.opts.resolve(this.opts.command, { env: this.opts.env ?? process.env });
    const args = [...tool.args, ...this.opts.prefixArgs, ...claudeArgs({ model: this.model, repo: this.opts.repo, sessionId: this.sessionId })];
    // windowsHide: the overlay has no console, so Windows would open one over the game.
    const proc = this.opts.spawn(tool.command, args, { cwd: this.opts.cwd, env: this.opts.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.proc = proc;
    let buf = '';
    let stderr = ''; // the last STDERR_KEEP characters of this process's stderr
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        // Output of a process that was stopped or replaced is ignored.
        if (line.trim() && this.proc === proc) this.#record(line, () => stderr);
      }
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-STDERR_KEEP); });
    proc.stdin.on('error', () => {}); // EPIPE when claude died; surfaced via the exit handler
    // 'close' comes after all output was read, so a result or stderr that names the cause is
    // seen first; the timer covers a child process that keeps the pipes open.
    proc.on('exit', (code) => setTimeout(() => this.#exited(proc, code, null, stderr), CLOSE_GRACE_MS).unref());
    proc.on('close', (code) => this.#exited(proc, code, null, stderr));
    proc.on('error', (err) => this.#exited(proc, null, err, stderr));
  }

  #exited(proc, code, err, stderr) {
    if (this.proc !== proc) return;
    this.proc = null;
    let e = err ?? new Error(`Claude Code exited (code ${code})`);
    if (!err && stderr.includes(GONE)) { this.sessionId = null; e = sessionGone(); }
    if (this.run) { const r = this.run; this.run = null; r.reject(e); this.emit('error', e); }
  }

  #record(line, stderr) {
    let rec;
    try { rec = JSON.parse(line); } catch { return; }
    if (isSessionId(rec.session_id)) this.sessionId = rec.session_id;
    const gone = rec.type === 'result' && rec.is_error
      && [stderr(), ...(rec.errors ?? [])].some((s) => String(s).includes(GONE));
    if (gone) {
      this.sessionId = null;
      // That process is on its way out: let go of it now, so a send() right after the
      // rejection below starts a fresh one instead of writing to it.
      const proc = this.proc;
      this.proc = null;
      proc.stdin.end();
      proc.kill();
    }
    const run = this.run;
    if (rec.type === 'stream_event') {
      const ev = rec.event ?? {};
      if (ev.type === 'content_block_start' && ev.content_block?.type === 'text' && run?.text) {
        // A new text block after earlier text (e.g. after a tool call): start a new paragraph.
        run.text += '\n\n';
        this.emit('delta', '\n\n');
      } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        if (run) run.text += ev.delta.text;
        this.emit('delta', ev.delta.text);
      } else if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
        this.emit('tool', { name: ev.content_block.name, phase: 'start' });
      }
    } else if (rec.type === 'system' && rec.subtype === 'status' && /compact/i.test(String(rec.status ?? ''))) {
      // Claude Code summarises older messages (by itself near the limit, or on /compact).
      this.emit('tool', { name: 'compact', phase: 'start' });
    } else if (rec.type === 'system' && rec.subtype === 'compact_boundary') {
      this.emit('tool', { name: 'compact', phase: 'end' });
      this.emit('compacted');
    } else if (rec.type === 'result' && run) {
      this.run = null;
      const u = rec.usage ?? {};
      this.emit('usage', {
        // Cached context is re-read cheaply on every turn; counting it would overstate usage.
        totalTokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
        costUsd: rec.total_cost_usd,
      });
      if (gone) run.reject(sessionGone());
      else if (rec.is_error) run.reject(new Error(rec.result || `Claude Code: ${rec.subtype}`));
      else run.resolve(run.text || rec.result || '');
    }
  }

  async send(text, { images } = {}) {
    if (this.run) throw new Error('Claude is still answering the previous message');
    this.start();
    const content = [{ type: 'text', text }];
    for (const im of images ?? []) content.push({ type: 'image', source: { type: 'base64', media_type: im.mimeType, data: im.data } });
    const done = new Promise((resolve, reject) => { this.run = { resolve, reject, text: '' }; });
    this.proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }) + '\n');
    return done;
  }

  /** Summarises the older part of the conversation now, with Claude Code's own /compact. */
  async compact() {
    if (this.run) throw new Error('Claude is still answering the previous message');
    await this.send('/compact');
  }

  async availableModels() { return MODELS; }

  async currentModel() { return { provider: 'claude', id: this.model }; }

  // Claude Code takes the model at launch: restart and resume the same conversation.
  async setModel(_provider, id) {
    this.model = id;
    this.stop('stopped to switch model');
  }

  async abort() {
    this.proc?.kill('SIGINT');
  }

  stop(reason = 'stopped') {
    const proc = this.proc;
    this.proc = null;
    // Reject an answer in progress; otherwise its promise would wait forever.
    if (this.run) { const r = this.run; this.run = null; r.reject(new Error(`Claude Code ${reason}`)); }
    for (const p of this.pending?.values?.() ?? []) p.reject(new Error(`Claude Code ${reason}`));
    this.pending?.clear?.();
    if (proc) { proc.stdin.end(); proc.kill(); }
  }
}
