// The "Report a problem" link: a GitHub bug form pre-filled with three facts about the
// install. Nothing else goes in the URL: no names, paths or chat text.
const BASE = 'https://github.com/biokraft/wow-forever-companion/issues/new';
const BACKENDS = new Set(['pi', 'claude']);

export function reportUrl({ version, platform, backend }) {
  const query = [
    ['template', 'bug.yml'],
    ['version', String(version ?? 'unknown')],
    ['os', String(platform ?? 'unknown')],
    ['backend', BACKENDS.has(backend) ? backend : 'unknown'],
  ];
  return `${BASE}?${query.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}
