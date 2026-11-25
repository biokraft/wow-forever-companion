import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLite } from '../src/format.js';

test('escapes HTML before formatting', () => {
  assert.equal(renderLite('<img src=x onerror=1>'), '&lt;img src=x onerror=1&gt;');
});

test('bold, italics and code render', () => {
  assert.equal(renderLite('**Hanashi** is *here* and _there_, use `/fc sync`'),
    '<strong>Hanashi</strong> is <em>here</em> and <em>there</em>, use <code>/fc sync</code>');
});

test('underscores inside words and coordinates stay plain', () => {
  assert.equal(renderLite('wow_state at 81_5'), 'wow_state at 81_5');
});

import { renderMarkdown } from '../src/format.js';

test('markdown: headings, rules and paragraphs', () => {
  assert.equal(renderMarkdown('### 2) Talents\nPick **this**.\n\n---\n\nDone'),
    '<h4>2) Talents</h4><p>Pick <strong>this</strong>.</p><hr><p>Done</p>');
});

test('markdown: bullet and numbered lists', () => {
  assert.equal(renderMarkdown('Next:\n- Turn in *Sarkoth*\n- Train\n\n1. Go\n2. Come back'),
    '<p>Next:</p><ul><li>Turn in <em>Sarkoth</em></li><li>Train</li></ul><ol><li>Go</li><li>Come back</li></ol>');
});

test('markdown: line breaks inside a paragraph are kept', () => {
  assert.equal(renderMarkdown('line one\nline two'), '<p>line one<br>line two</p>');
});

test('markdown: quotes and raw HTML stay escaped', () => {
  assert.equal(renderMarkdown('> tip <b>x</b>'), '<blockquote>tip &lt;b&gt;x&lt;/b&gt;</blockquote>');
});

test('markdown: partial text while streaming does not throw', () => {
  assert.equal(typeof renderMarkdown('**unfinished\n- item'), 'string');
});

test('markdown: a pipe table becomes a real table', () => {
  assert.equal(renderMarkdown('Plan:\n| Levels | Talent |\n|---|---|\n| 10–12 | **Improved Rend** 3/3 |\n| 20 | Anger Management |\nDone'),
    '<p>Plan:</p><table><thead><tr><th>Levels</th><th>Talent</th></tr></thead><tbody>'
    + '<tr><td>10–12</td><td><strong>Improved Rend</strong> 3/3</td></tr><tr><td>20</td><td>Anger Management</td></tr></tbody></table><p>Done</p>');
});

test('markdown: table cells stay escaped and short rows are padded', () => {
  assert.equal(renderMarkdown('| A | B |\n| :-- | --: |\n| <b>x</b> |'),
    '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>&lt;b&gt;x&lt;/b&gt;</td><td></td></tr></tbody></table>');
});

test('markdown: a lone pipe line or a half-streamed table is not a table', () => {
  assert.equal(renderMarkdown('a | b'), '<p>a | b</p>');
  assert.equal(renderMarkdown('| Levels | Talent |'), '<p>| Levels | Talent |</p>');
});

import { THINKING_HTML } from '../src/format.js';

test('the thinking placeholder has a dots element and no inline style', () => {
  assert.equal(THINKING_HTML, '<span class="muted thinking">thinking<span class="dots" aria-hidden="true"></span></span>');
});
