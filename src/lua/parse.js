// Parser for the Lua subset WoW writes into SavedVariables files:
// top-level `NAME = value` statements; values are nil, booleans, numbers, double-quoted
// strings, and tables with `["k"] = v`, `[n] = v`, or positional entries.
// Tables whose keys are exactly 1..n become arrays (an empty table becomes []); others
// become objects with stringified keys.

export class LuaParseError extends Error {
  constructor(message, line) {
    super(`${message} (line ${line})`);
    this.name = 'LuaParseError';
    this.line = line;
  }
}

const ESCAPES = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'", '\n': '\n' };

export function parseSavedVariables(text) {
  let pos = 0;

  const lineAt = (p) => {
    let line = 1;
    for (let i = 0; i < p && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
    return line;
  };
  const fail = (msg) => { throw new LuaParseError(msg, lineAt(pos)); };

  const skip = () => {
    for (;;) {
      const c = text[pos];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ';') { pos++; continue; }
      if (c === '-' && text[pos + 1] === '-') {
        if (text[pos + 2] === '[' && text[pos + 3] === '[') {
          const end = text.indexOf(']]', pos + 4);
          if (end === -1) fail('unterminated block comment');
          pos = end + 2;
        } else {
          while (pos < text.length && text[pos] !== '\n') pos++;
        }
        continue;
      }
      return;
    }
  };

  const expect = (ch) => {
    skip();
    if (text[pos] !== ch) fail(pos >= text.length ? `unexpected end of input, expected '${ch}'` : `expected '${ch}', got '${text[pos]}'`);
    pos++;
  };

  const parseString = () => {
    const quote = text[pos++];
    let out = '';
    for (;;) {
      if (pos >= text.length) fail('unterminated string');
      const c = text[pos++];
      if (c === quote) return out;
      if (c === '\n') fail('newline in string');
      if (c !== '\\') { out += c; continue; }
      const e = text[pos++];
      if (e === undefined) fail('unterminated string');
      if (/[0-9]/.test(e)) {
        let digits = e;
        while (digits.length < 3 && /[0-9]/.test(text[pos])) digits += text[pos++];
        out += String.fromCharCode(Number(digits));
      } else if (e in ESCAPES) {
        out += ESCAPES[e];
      } else {
        fail(`bad escape \\${e}`);
      }
    }
  };

  const NUMBER = /^-?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|inf|nan)/;
  const parseNumber = () => {
    const m = NUMBER.exec(text.slice(pos, pos + 64));
    if (!m) fail(`unexpected '${text[pos]}'`);
    pos += m[0].length;
    const s = m[0];
    if (/inf$/.test(s)) return s.startsWith('-') ? -Infinity : Infinity;
    if (/nan$/.test(s)) return NaN;
    if (/0[xX]/.test(s)) return (s.startsWith('-') ? -1 : 1) * parseInt(s.replace(/^-/, ''), 16);
    return Number(s);
  };

  const parseValue = () => {
    skip();
    if (pos >= text.length) fail('unexpected end of input');
    const c = text[pos];
    if (c === '{') return parseTable();
    if (c === '"' || c === "'") return parseString();
    if (text.startsWith('nil', pos)) { pos += 3; return null; }
    if (text.startsWith('true', pos)) { pos += 4; return true; }
    if (text.startsWith('false', pos)) { pos += 5; return false; }
    return parseNumber();
  };

  const parseTable = () => {
    pos++; // {
    const entries = [];
    let nextIndex = 1;
    for (;;) {
      skip();
      if (pos >= text.length) fail('unterminated table');
      if (text[pos] === '}') { pos++; break; }
      let key;
      if (text[pos] === '[') {
        pos++;
        key = parseValue();
        expect(']');
        expect('=');
      } else {
        const ident = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(pos, pos + 128));
        const after = ident ? text.slice(pos + ident[0].length).match(/^\s*=/) : null;
        if (ident && after && !['nil', 'true', 'false'].includes(ident[0])) {
          key = ident[0];
          pos += ident[0].length;
          expect('=');
        } else {
          key = nextIndex++;
        }
      }
      entries.push([key, parseValue()]);
      skip();
      if (text[pos] === ',') pos++;
      else if (text[pos] !== '}') fail(pos >= text.length ? 'unterminated table' : `expected ',' or '}', got '${text[pos]}'`);
    }
    const isArray = entries.every(([k], i) => k === i + 1);
    if (isArray) return entries.map(([, v]) => v);
    const obj = {};
    for (const [k, v] of entries) obj[String(k)] = v;
    return obj;
  };

  const result = {};
  for (;;) {
    skip();
    if (pos >= text.length) break;
    const ident = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(pos, pos + 256));
    if (!ident) fail(`expected variable name, got '${text[pos]}'`);
    pos += ident[0].length;
    expect('=');
    result[ident[0]] = parseValue();
  }
  return result;
}
