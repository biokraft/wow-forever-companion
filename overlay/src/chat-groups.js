// Groups the saved chats for the drawer by local calendar day: Today, Yesterday, Earlier.
// Pure: no DOM, no Electron, so the page and the tests share it.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Seconds of local midnight `daysBack` days before the day that contains `nowSec`. */
function midnight(nowSec, daysBack) {
  const d = new Date(nowSec * 1000);
  // Built from the calendar date, not by subtracting 86400 s, so DST days stay right.
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysBack).getTime() / 1000);
}

/**
 * items: { id, title, updatedAt (seconds) }[] in the order to show (the store gives newest
 * first). Returns { label, items }[] for Today, Yesterday and Earlier, leaving out empty groups.
 */
export function groupChats(items, nowSec) {
  const today = midnight(nowSec, 0);
  const yesterday = midnight(nowSec, 1);
  const groups = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Earlier', items: [] },
  ];
  for (const it of items) {
    const g = it.updatedAt >= today ? 0 : it.updatedAt >= yesterday ? 1 : 2;
    groups[g].items.push(it);
  }
  return groups.filter((g) => g.items.length > 0);
}

/** 'D Mon' in local time, for rows under Earlier. */
export function dateLabel(updatedAt) {
  const d = new Date(updatedAt * 1000);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
