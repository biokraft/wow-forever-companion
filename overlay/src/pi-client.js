// Talks to `pi --mode rpc` over JSONL. Plain Node (no Electron) so it can be unit-tested.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { isSessionId } from './session-id.js';
import { ADVICE_RULES } from './advice-rules.js';
import { resolveTool } from '../../src/tool-command.js';

// Read-only built-ins plus the Forever Companion tools; never bash, edit or write.
export const OVERLAY_TOOLS = ['read', 'grep', 'find', 'ls', 'wow_state', 'wow_quests', 'wow_npc', 'wow_plan_write', 'wow_knowledge', 'wow_web_fetch'];

// Pi keeps a session per working folder and id: the same id in the same folder continues it.
// The last gate before the command line: anything that is not a UUID is left out.
const sessionArgs = (id) => (isSessionId(id) ? ['--session-id', id] : []);

export function piArgs({ extensionPath, skillsPath, model, sessionId } = {}) {
  const args = ['--mode', 'rpc', '--no-approve', '--no-extensions', '--no-skills',
    '-e', extensionPath, '--skill', skillsPath, '--tools', OVERLAY_TOOLS.join(','),
    '--append-system-prompt', ADVICE_RULES];
  if (model) args.push('--model', model);
  args.push(...sessionArgs(sessionId));
  return args;
}

/** `args` with its `--model <x>` pair set to `model` (added when there is none). */
function withModel(args, model) {
  const i = args.indexOf('--model');
  if (i < 0) return [...args, '--model', model];
  return [...args.slice(0, i), '--model', model, ...args.slice(i + 2)];
}

export class PiClient extends EventEmitter {
  // `args` are the launch arguments without a session id (piArgs without sessionId);
  // start() appends the current one.
  // `resolve` finds how to start `command` without a shell (on Windows, Pi is an npm .cmd
  // shim, and its arguments include free text that must never reach a shell).
  // `spawn` is injectable for tests.
  constructor({ command = 'pi', args = [], cwd, env, resolve = resolveTool, spawn: spawnFn = spawn } = {}) {
    super();
    this.opts = { command, args, cwd, env, resolve, spawn: spawnFn };
    this.sessionId = null;
    // The model picked with setModel ("provider/id"); null = the one in the launch arguments.
    this.model = null;
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map(); // id -> {resolve, reject}
    this.run = null; // {resolve, reject, text}
  }

  get canResume() { return true; }

  /**
   * Points the next start at a saved conversation; stops a running process. null, or an id
   * that is not a UUID (see session-id.js), starts a fresh conversation.
   */
  openSession(id) {
    if (this.run) throw new Error('Pi is still answering the previous message');
    this.stop('stopped to switch chat');
    this.sessionId = isSessionId(id) ? id : null;
  }

  start() {
    if (this.proc) return;
    // A fresh chat gets an id too, so it can be saved and continued later.
    if (!isSessionId(this.sessionId)) this.sessionId = randomUUID();
    // A restart (every chat switch stops the process) must keep the model the player picked.
    const base = this.model ? withModel(this.opts.args, this.model) : this.opts.args;
    const tool = this.opts.resolve(this.opts.command, { env: this.opts.env ?? process.env });
    const args = [...tool.args, ...base, ...sessionArgs(this.sessionId)];
    // windowsHide: the overlay has no console, so Windows would open one over the game.
    const proc = this.opts.spawn(tool.command, args, { cwd: this.opts.cwd, env: this.opts.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.proc = proc;
    let buf = '';
    proc.stdout.setEncoding('utf8');
    // Split on LF only: readline would also split on U+2028/U+2029 inside JSON strings.
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (line.trim()) this.#record(line);
      }
    });
    proc.stderr.on('data', () => {}); // Pi logs to stderr; ignore
    proc.stdin.on('error', () => {}); // EPIPE when Pi died; surfaced via the exit handler
    proc.on('exit', (code) => this.#exited(proc, code));
    proc.on('error', (err) => this.#exited(proc, null, err));
  }

  #exited(proc, code, err) {
    if (this.proc !== proc) return;
    this.proc = null;
    const e = err ?? new Error(`Pi exited (code ${code})`);
    if (this.run) { this.run.reject(e); this.run = null; this.emit('error', e); }
    for (const p of this.pending.values()) p.reject(e);
    this.pending.clear();
  }

  #record(line) {
    let rec;
    try { rec = JSON.parse(line); } catch { return; }
    if (rec.type === 'response') {
      const p = this.pending.get(rec.id);
      if (!p) return;
      this.pending.delete(rec.id);
      if (rec.success) p.resolve(rec.data);
      else p.reject(new Error(rec.error ?? `${rec.command} failed`));
      return;
    }
    const run = this.run;
    if (rec.type === 'message_start' && rec.message?.role === 'assistant' && run?.text) {
      run.text += '\n\n'; // a new assistant message after earlier text: new paragraph
      this.emit('delta', '\n\n');
    } else if (rec.type === 'message_update' && rec.assistantMessageEvent?.type === 'text_delta') {
      const d = rec.assistantMessageEvent.delta ?? '';
      if (run) run.text += d;
      this.emit('delta', d);
    } else if (rec.type === 'tool_execution_start' || rec.type === 'tool_execution_end') {
      this.emit('tool', { name: rec.toolName, phase: rec.type.endsWith('start') ? 'start' : 'end' });
    } else if (rec.type === 'message_end' && rec.message?.role === 'assistant' && rec.message.usage) {
      this.emit('usage', rec.message.usage);
    } else if (rec.type === 'compaction_start' || rec.type === 'compaction_end') {
      // Pi summarises older messages (by itself near the context limit, or on compact()).
      const start = rec.type === 'compaction_start';
      this.emit('tool', { name: 'compact', phase: start ? 'start' : 'end' });
      if (!start && rec.result) this.emit('compacted');
    } else if (rec.type === 'extension_error') {
      this.emit('warning', rec.error);
    } else if (rec.type === 'agent_settled' && run) {
      this.run = null;
      run.resolve(run.text);
    }
  }

  #command(type, fields = {}) {
    this.start();
    const id = `c${this.nextId++}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ id, type, ...fields }) + '\n');
    });
  }

  /** Sends one user message; resolves with the full answer when Pi has settled. */
  async send(text, { images } = {}) {
    if (this.run) throw new Error('Pi is still answering the previous message');
    const done = new Promise((resolve, reject) => { this.run = { resolve, reject, text: '' }; });
    done.catch(() => {}); // the caller gets the error via the return below; avoid an unhandled rejection
    const fields = { message: text };
    if (images?.length) fields.images = images.map((im) => ({ type: 'image', data: im.data, mimeType: im.mimeType }));
    try {
      await this.#command('prompt', fields);
    } catch (e) {
      if (this.run) { this.run = null; }
      throw e;
    }
    return done;
  }

  /** Summarises the older part of the conversation now; resolves when Pi has done it. */
  async compact() {
    if (this.run) throw new Error('Pi is still answering the previous message');
    return this.#command('compact');
  }

  async availableModels() {
    return (await this.#command('get_available_models'))?.models ?? [];
  }

  async currentModel() {
    const m = (await this.#command('get_state'))?.model;
    return m ? { provider: m.provider, id: m.id } : null;
  }

  // Switches inside the running process and remembers the pick for the next start().
  async setModel(provider, modelId) {
    const res = await this.#command('set_model', { provider, modelId });
    this.model = `${provider}/${modelId}`;
    return res;
  }

  abort() {
    return this.proc ? this.#command('abort') : Promise.resolve();
  }

  stop(reason = 'stopped') {
    const proc = this.proc;
    this.proc = null;
    // Reject an answer in progress; otherwise its promise would wait forever.
    if (this.run) { const r = this.run; this.run = null; r.reject(new Error(`Pi ${reason}`)); }
    for (const p of this.pending?.values?.() ?? []) p.reject(new Error(`Pi ${reason}`));
    this.pending?.clear?.();
    if (proc) { proc.stdin.end(); proc.kill(); }
  }
}
