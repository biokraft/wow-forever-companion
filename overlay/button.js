// Click opens the chat; drag moves the button (its spot is remembered).
const btn = document.getElementById('open');
let start = null;
let moved = false;

btn.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  start = { x: e.screenX, y: e.screenY };
  moved = false;
});
window.addEventListener('mousemove', (e) => {
  if (!start) return;
  const dx = e.screenX - start.x;
  const dy = e.screenY - start.y;
  if (!moved && Math.hypot(dx, dy) < 4) return;
  moved = true;
  start = { x: e.screenX, y: e.screenY };
  window.fc.moveButton(dx, dy);
});
window.addEventListener('mouseup', () => {
  if (!start) return;
  const wasDrag = moved;
  start = null;
  if (wasDrag) window.fc.saveButton();
  else window.fc.toggle();
});
