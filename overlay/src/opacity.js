// Whole-window opacity for the chat overlay. The window stays opaque internally (see
// window-options.js: transparent windows blur text), so the fade includes the text; the
// floor keeps it readable.
export const MIN_OPACITY = 0.4;

export function clampOpacity(value) {
  // Only real numbers (or numeric strings) count; '', ' ', true and false would coerce to 0/1.
  if (typeof value !== 'number' && !(typeof value === 'string' && value.trim() !== '')) return 1;
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(MIN_OPACITY, n));
}
