// One geometry implementation for Electron, the browser preview, and tests.
const PANEL_WIDTHS = { pets: 500, inventory: 812, adventure: 760, codex: 760, settings: 760 };
const PANEL_HEIGHTS = { pets: 750, inventory: 614, adventure: 614, codex: 614, settings: 614 };
const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
function computeLayout(position, area, panelId = null, canvas = 300) {
  const size = clamp(canvas, 260, 420);
  const pet = {
    x: clamp(Math.round(position.x), area.x, area.x + area.width - size),
    y: clamp(Math.round(position.y), area.y, area.y + area.height - Math.ceil(size * .94 + 88)),
    width: size, height: Math.ceil(size * .94 + 88),
  };
  let panel = null;
  if (Object.hasOwn(PANEL_WIDTHS, panelId)) {
    const width = Math.min(PANEL_WIDTHS[panelId], area.width - 16);
    const height = Math.min(PANEL_HEIGHTS[panelId], area.height - 16);
    const right = pet.x + pet.width + 12;
    const left = pet.x - width - 12;
    // Prefer the side with more room, never reposition the pet when opening a panel.
    const rightRoom = area.x + area.width - right;
    const leftRoom = pet.x - 12 - area.x;
    let x = rightRoom >= leftRoom ? right : left;
    if (rightRoom < width && leftRoom >= width) x = left;
    if (leftRoom < width && rightRoom >= width) x = right;
    panel = { x: clamp(x, area.x + 8, area.x + area.width - width - 8),
      y: clamp(pet.y + (pet.height - height) / 2, area.y + 8, area.y + area.height - height - 8),
      width, height };
  }
  const x = Math.floor(Math.min(pet.x, panel?.x ?? pet.x));
  const y = Math.floor(Math.min(pet.y, panel?.y ?? pet.y));
  const width = Math.ceil(Math.max(pet.x + pet.width, panel ? panel.x + panel.width : pet.x + pet.width) - x);
  const height = Math.ceil(Math.max(pet.y + pet.height, panel ? panel.y + panel.height : pet.y + pet.height) - y);
  const local = rect => rect && ({ ...rect, x: rect.x - x, y: rect.y - y });
  return { bounds: { x, y, width, height }, pet: local(pet), panel: local(panel), position: { x: pet.x, y: pet.y } };
}
// Native setBounds and renderer IPC are not one atomic presentation. Keep both
// the window origin and pet's local origin fixed while panels open/close/switch.
// Reserve only the union of possible panels, not a full-screen overlay.
function computeNativeLayout(position, area, panelId = null, canvas = 300) {
  const current = computeLayout(position, area, panelId, canvas);
  const candidates = [current, ...Object.keys(PANEL_WIDTHS).map(id => computeLayout(position, area, id, canvas))];
  const x = Math.min(...candidates.map(candidate => candidate.bounds.x));
  const y = Math.min(...candidates.map(candidate => candidate.bounds.y));
  const right = Math.max(...candidates.map(candidate => candidate.bounds.x + candidate.bounds.width));
  const bottom = Math.max(...candidates.map(candidate => candidate.bounds.y + candidate.bounds.height));
  const rebase = rect => rect && ({ ...rect, x: rect.x + current.bounds.x - x, y: rect.y + current.bounds.y - y });
  return { bounds: { x, y, width: right - x, height: bottom - y },
    pet: rebase(current.pet), panel: rebase(current.panel), position: current.position };
}
export { computeLayout, computeNativeLayout, PANEL_WIDTHS, PANEL_HEIGHTS };
