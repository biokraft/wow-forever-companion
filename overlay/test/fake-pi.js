#!/usr/bin/env node
// Speaks enough of Pi's RPC protocol for PiClient tests.
// Env: FAKE_PI_LOG=<file> appends argv and each received command; FAKE_PI_DIE_ONCE=<file> exits mid-answer
// on the first prompt if <file> does not exist yet (and creates it), so a restarted Pi works.
import fs from 'node:fs';

const log = process.env.FAKE_PI_LOG;
const dieOnce = process.env.FAKE_PI_DIE_ONCE;
// FAKE_PI_COMPACT=during|failed: a compaction runs inside the first prompt. FAKE_PI_HANG=1: a prompt never settles.
const compact = process.env.FAKE_PI_COMPACT;
const hang = process.env.FAKE_PI_HANG;
if (log) fs.appendFileSync(log, JSON.stringify({ argv: process.argv.slice(2) }) + '\n');
let buf = '';
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');

process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const cmd = JSON.parse(line);
    if (log) fs.appendFileSync(log, JSON.stringify(cmd) + '\n');
    if (cmd.type === 'prompt') {
      send({ id: cmd.id, type: 'response', command: 'prompt', success: true, data: { disposition: 'started' } });
      send({ type: 'agent_start' });
      if (hang) continue;
      if (compact) {
        send({ type: 'compaction_start', reason: 'threshold' });
        send(compact === 'failed'
          ? { type: 'compaction_end', reason: 'threshold', aborted: false, errorMessage: 'summary failed' }
          : { type: 'compaction_end', reason: 'threshold', result: { summary: 's', tokensBefore: 9, estimatedTokensAfter: 3 }, aborted: false, willRetry: false });
      }
      send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hel' } });
      if (dieOnce && !fs.existsSync(dieOnce)) { fs.writeFileSync(dieOnce, 'x'); process.exit(3); }
      send({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'wow_state', args: {} });
      send({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'wow_state' });
      send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'lo there' } });
      send({ type: 'message_end', message: { role: 'assistant', usage: { input: 100, output: 5, totalTokens: 105, cost: { total: 0.001 } } } });
      send({ type: 'agent_end' });
      send({ type: 'agent_settled', aborted: false });
    } else if (cmd.type === 'get_state') {
      send({ id: cmd.id, type: 'response', command: cmd.type, success: true, data: { model: { provider: 'fake', id: 'model-b', name: 'Model B' } } });
    } else if (cmd.type === 'get_available_models') {
      send({ id: cmd.id, type: 'response', command: cmd.type, success: true, data: { models: [{ provider: 'fake', id: 'model-a', name: 'Model A' }] } });
    } else {
      send({ id: cmd.id, type: 'response', command: cmd.type, success: true, data: {} });
    }
  }
});
