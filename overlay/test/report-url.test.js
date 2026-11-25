import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportUrl } from '../src/report-url.js';

test('builds the pre-filled bug form URL', () => {
  assert.equal(
    reportUrl({ version: '0.4.0', platform: 'darwin', backend: 'pi' }),
    'https://github.com/biokraft/wow-forever-companion/issues/new?template=bug.yml&version=0.4.0&os=darwin&backend=pi',
  );
});

test('a backend other than pi or claude becomes unknown', () => {
  const url = new URL(reportUrl({ version: '0.4.0', platform: 'win32', backend: '"; rm -rf' }));
  assert.equal(url.searchParams.get('backend'), 'unknown');
  assert.equal(new URL(reportUrl({ version: '1', platform: 'linux', backend: 'claude' })).searchParams.get('backend'), 'claude');
  assert.equal(new URL(reportUrl({ version: '1', platform: 'linux' })).searchParams.get('backend'), 'unknown');
});

test('the URL has exactly four query keys', () => {
  const url = new URL(reportUrl({ version: '0.4.0', platform: 'darwin', backend: 'pi' }));
  assert.deepEqual([...url.searchParams.keys()], ['template', 'version', 'os', 'backend']);
});

test('values are URL-encoded', () => {
  const url = reportUrl({ version: '1.0 & x=y', platform: 'dar win', backend: 'pi' });
  assert.ok(url.includes('version=1.0%20%26%20x%3Dy'));
  assert.ok(url.includes('os=dar%20win'));
  assert.equal([...new URL(url).searchParams.keys()].length, 4);
});
