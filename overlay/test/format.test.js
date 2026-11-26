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

test('a markdown link to an https page becomes a link that shows its text', () => {
  assert.equal(renderLite('See [Mining guide](https://warcraft.wiki.gg/wiki/Mining) first.'),
    'See <a href="https://warcraft.wiki.gg/wiki/Mining" title="https://warcraft.wiki.gg/wiki/Mining">Mining guide</a> first.');
});

test('a link address keeps its underscores, stars and ampersands as they are', () => {
  const html = renderLite('[a_b *c*](https://example.org/x_y_z?a=1&b=*2*)');
  assert.equal(html, '<a href="https://example.org/x_y_z?a=1&amp;b=*2*" title="https://example.org/x_y_z?a=1&amp;b=*2*">a_b <em>c</em></a>');
});

test('only https links become links; anything else shows as written', () => {
  for (const t of ['[x](http://example.org)', '[x](javascript:alert(1))', '[x](file:///etc/passwd)', '[x](https://)', '[x]( https://example.org)', '[x](https://exa"mple.org)']) {
    assert.doesNotMatch(renderLite(t), /<a /, t);
  }
});

test('a link cannot smuggle markup or a second attribute', () => {
  const html = renderLite('[<b>x</b>](https://example.org/"onmouseover="x)');
  assert.doesNotMatch(html, /<b>|onmouseover="x"/);
  assert.doesNotMatch(html, /<a /);
});

test('links work inside lists and tables, and a half-streamed link shows as written', () => {
  assert.match(renderMarkdown('- [Guide](https://example.org/g)'), /<li><a href="https:\/\/example\.org\/g"/);
  assert.match(renderMarkdown('| Source |\n|---|\n| [Guide](https://example.org/g) |'), /<td><a href=/);
  assert.equal(renderLite('[Guide](https://example.org/g'), '[Guide](https://example.org/g');
});

test('a numbered list keeps the number it was written with after a paragraph or bullets in between', () => {
  assert.equal(renderMarkdown('1. Fly\n\nIn the city:\n\n2. Train\n3. Smelt'),
    '<ol><li>Fly</li></ol><p>In the city:</p><ol start="2"><li>Train</li><li>Smelt</li></ol>');
  assert.equal(renderMarkdown('4. Learn Engineering:\n- Buy a hammer\n- Make powder\n5. Learn Cooking'),
    '<ol start="4"><li>Learn Engineering:</li></ol><ul><li>Buy a hammer</li><li>Make powder</li></ul><ol start="5"><li>Learn Cooking</li></ol>');
  assert.equal(renderMarkdown('1. One\n2. Two'), '<ol><li>One</li><li>Two</li></ol>', 'a list from 1 needs no start');
  assert.equal(renderMarkdown('0. Zero'), '<ol start="0"><li>Zero</li></ol>');
});

test('indented bullets nest under their numbered step, and the steps go on counting', () => {
  assert.equal(renderMarkdown('4. Learn Engineering:\n   - Buy a hammer\n   - Make powder\n     from stone\n5. Learn Cooking\n   1. Recipe\n6. First Aid'),
    '<ol start="4"><li>Learn Engineering:<ul><li>Buy a hammer</li><li>Make powder from stone</li></ul></li>'
    + '<li>Learn Cooking<ol><li>Recipe</li></ol></li><li>First Aid</li></ol>');
  assert.equal(renderMarkdown('- Bags\n  - Linen\n  - Ore\n- Bank'), '<ul><li>Bags<ul><li>Linen</li><li>Ore</li></ul></li><li>Bank</li></ul>');
});

test('a list number is never markup: only digits reach the start attribute', () => {
  assert.equal(renderMarkdown('7) <b>x</b>'), '<ol start="7"><li>&lt;b&gt;x&lt;/b&gt;</li></ol>');
  assert.doesNotMatch(renderMarkdown('12345678901. too long to be a step'), /<ol/);
});

test('a fenced code block is shown as written: no heading, no emphasis, HTML escaped', () => {
  assert.equal(renderMarkdown('Make this macro:\n```\n#showtooltip Charge\n/cast [stance:1] Charge; Battle Stance\n```\nDrag it to your bar.'),
    '<p>Make this macro:</p><pre class="code"><code>#showtooltip Charge\n/cast [stance:1] Charge; Battle Stance</code></pre><p>Drag it to your bar.</p>');
  assert.equal(renderMarkdown('```lua\nlocal a = "<b>" -- *not* _em_\n```'),
    '<pre class="code"><code>local a = &quot;&lt;b&gt;&quot; -- *not* _em_</code></pre>');
  assert.equal(renderMarkdown('~~~\n/use [@player] Linen Bandage\n~~~'), '<pre class="code"><code>/use [@player] Linen Bandage</code></pre>');
});

test('code blocks under numbered steps lose the step indent, and the steps keep their numbers', () => {
  const text = '1. **Bandage yourself**\n   ```\n   #showtooltip Linen Bandage\n   /use [@player] Linen Bandage\n   ```\n\n2. **Charge**\n   ```\n   /cast Charge\n   ```';
  assert.equal(renderMarkdown(text),
    '<ol><li><strong>Bandage yourself</strong></li></ol><pre class="code"><code>#showtooltip Linen Bandage\n/use [@player] Linen Bandage</code></pre>'
    + '<ol start="2"><li><strong>Charge</strong></li></ol><pre class="code"><code>/cast Charge</code></pre>');
});

test('a code block keeps blank lines and inner indent, and one still streaming runs to the end', () => {
  assert.equal(renderMarkdown('```\nif x then\n\n  y()\nend\n```'), '<pre class="code"><code>if x then\n\n  y()\nend</code></pre>');
  assert.equal(renderMarkdown('Here:\n```\n/cast Charge'), '<p>Here:</p><pre class="code"><code>/cast Charge</code></pre>');
  assert.equal(renderMarkdown('````\n```\ninner\n```\n````'), '<pre class="code"><code>```\ninner\n```</code></pre>', 'a longer fence holds a shorter one');
});

