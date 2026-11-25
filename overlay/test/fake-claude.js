#!/usr/bin/env node
// Speaks enough of `claude -p --input-format stream-json --output-format stream-json` for tests.
// Env: FAKE_CLAUDE_LOG=<file> logs argv and every stdin message.
// FAKE_CLAUDE_GONE=1 with --resume: acts like resuming an unknown conversation (stderr, an
// is_error result, exit 1); FAKE_CLAUDE_GONE=exit does the same without the result.
// FAKE_CLAUDE_CRASH=1: writes "boom" to stderr and exits 1.
// FAKE_CLAUDE_SESSION=<text>: reports that text as the session id instead of a UUID.
import fs from 'node:fs';

const SESSION = process.env.FAKE_CLAUDE_SESSION ?? '11111111-1111-4111-8111-111111111111';
const log = process.env.FAKE_CLAUDE_LOG;
if (log) fs.appendFileSync(log, JSON.stringify({ argv: process.argv.slice(2) }) + '\n');
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const argv = process.argv.slice(2);
if (process.env.FAKE_CLAUDE_GONE && argv.includes('--resume')) {
  const id = argv[argv.indexOf('--resume') + 1];
  const msg = `No conversation found with session ID: ${id}`;
  process.stderr.write(msg + '\n');
  if (process.env.FAKE_CLAUDE_GONE !== 'exit') {
    send({ type: 'result', subtype: 'error_during_execution', is_error: true, num_turns: 0, session_id: id, errors: [msg], usage: { input_tokens: 0, output_tokens: 0 } });
  }
  process.exit(1);
}
if (process.env.FAKE_CLAUDE_CRASH) {
  process.stderr.write('boom\n');
  process.exit(1);
}
send({ type: 'system', subtype: 'init', session_id: SESSION, model: 'claude-sonnet' });
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (log) fs.appendFileSync(log, JSON.stringify(msg) + '\n');
    if (process.env.FAKE_CLAUDE_HANG) continue; // never answers: simulates a long run
    // The real CLI answers /compact with a status, a compact_boundary and an empty result.
    if (msg.message?.content?.[0]?.text === '/compact') {
      send({ type: 'system', subtype: 'status', status: 'compacting', session_id: SESSION });
      send({ type: 'system', subtype: 'status', status: null, compact_result: 'success', session_id: SESSION });
      send({ type: 'system', subtype: 'compact_boundary', session_id: SESSION, compact_metadata: { trigger: 'manual', pre_tokens: 4191, post_tokens: 1539 } });
      send({ type: 'result', subtype: 'success', is_error: false, result: '', session_id: SESSION, usage: { input_tokens: 0, output_tokens: 0 } });
      continue;
    }
    if (process.env.FAKE_CLAUDE_TWO_BLOCKS) {
      send({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text' } } });
      send({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Let me check.' } } });
      send({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'Bash' } } });
      send({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text' } } });
      send({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'You are level 8.' } } });
      send({ type: 'result', subtype: 'success', is_error: false, result: 'You are level 8.', usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 100 } });
      continue;
    }
    send({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'Bash' } } });
    send({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } } });
    send({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } } });
    send({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } });
    send({ type: 'result', subtype: 'success', is_error: false, result: 'Hello', session_id: SESSION,
      usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }, total_cost_usd: 0.01 });
  }
});
