// Reply chips: the companion may end an answer with a block of a few short answers the player
// can click instead of typing. Pure: no DOM. The syntax (CHOICES_RULES in advice-rules.js):
//
//   <choices>            or  <choices multi>   (pick several)
//   Fast questing
//   Dungeons
//   </choices>
//
// as the very last thing in the answer, 2-6 options of 1-40 characters. Anything else is not a
// chip block and the answer shows as written.

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;
export const MAX_OPTION_LENGTH = 40;

const OPEN = { '<choices>': false, '<choices multi>': true };
const CLOSE = '</choices>';
const TAG = '<choices';

/**
 * Splits a final answer into its text and the chip block at its end.
 * Returns { text, choices: null | { multi, options } }; without a valid block, `text` is
 * `raw` unchanged.
 */
export function parseChoices(raw) {
  const text = String(raw ?? '');
  const none = { text, choices: null };
  const lines = text.replace(/\s+$/, '').split('\n');
  if (lines.at(-1).trim() !== CLOSE) return none;
  // The nearest opening line above the closing one: an earlier block stays as written.
  let open = -1;
  for (let i = lines.length - 2; i >= 0; i--) {
    if (lines[i].trim().startsWith(TAG)) { open = i; break; }
  }
  if (open < 0 || !(lines[open].trim() in OPEN)) return none;
  const options = lines.slice(open + 1, -1).map((l) => l.trim());
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) return none;
  if (options.some((o) => o.length < 1 || o.length > MAX_OPTION_LENGTH || o.includes(CLOSE))) return none;
  return {
    text: lines.slice(0, open).join('\n').replace(/\s+$/, ''),
    choices: { multi: OPEN[lines[open].trim()], options },
  };
}

/**
 * The part of a streaming answer to show: everything before a trailing chip block, complete
 * or still arriving (`<cho` on the last line), so the markup never flashes. A tag that is not
 * at the start of a line, or a block with more text after it, is ordinary text.
 */
export function visibleText(raw) {
  const text = String(raw ?? '');
  const lines = text.split('\n');
  let start = text.length;
  let offset = text.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    offset -= lines[i].length;
    const t = lines[i].trimStart();
    const isTag = t.startsWith(TAG) || (i === lines.length - 1 && t.length > 0 && TAG.startsWith(t));
    if (isTag) { start = offset; break; }
    offset -= 1; // the newline before this line
  }
  if (start === text.length) return text;
  const tail = text.slice(start);
  const close = tail.indexOf(CLOSE);
  if (close >= 0 && tail.slice(close + CLOSE.length).trim() !== '') return text;
  return text.slice(0, start);
}

/** The player's message for several picked chips: "A", "A and B", "A, B and C". */
export function answerFromChoices(selected) {
  const picks = [...(selected ?? [])];
  if (picks.length <= 1) return picks.join('');
  return `${picks.slice(0, -1).join(', ')} and ${picks.at(-1)}`;
}
