// One geometry implementation for Electron, the browser preview, and tests.
const PANEL_WIDTHS = { pets: 812, inventory: 812, adventure: 812, codex: 812, settings: 812 };
const PANEL_HEIGHTS = { pets: 750, inventory: 750, adventure: 750, codex: 750, settings: 750 };
export const BOOKMARK_WIDTH = 44;
const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
export const MIN_PET_CANVAS = 130;
export const MAX_PET_CANVAS = 420;
export function petMetrics(canvas = 300) {
  const size = clamp(canvas, MIN_PET_CANVAS, MAX_PET_CANVAS);
  const bubble = size < 300 ? Math.round(16 + (size - 130) * 26 / 170) : Math.round(size * .14);
  const gap = size < 300 ? 3 + (size - 130) * 3 / 170 : 6;
  return { size, bubble, gap, menuWidth: bubble * 5 + gap * 4,
    height: Math.ceil(48 + size * .94 + bubble + 8) };
}
// The slider must not move underneath a held pointer. Keep the native window
// and panel exactly fixed; preview only the pet within the existing envelope.
export function computeResizePreview(start, canvas) {
  const { size, height } = petMetrics(canvas);
  const pet = { ...start.pet, width: size, height,
    x: clamp(start.pet.x, 0, start.bounds.width - size),
    y: clamp(start.pet.y, 0, start.bounds.height - height) };
  return { ...start, pet, position: { x: start.bounds.x + pet.x, y: start.bounds.y + pet.y } };
}
function computeLayout(position, area, panelId = null, canvas = 300) {
  const { size, menuWidth, height: petHeight } = petMetrics(canvas);
  // Small pets still need a usable menu; reserve its overhang plus animation padding.
  const overhang = Math.max(0, (Math.max(menuWidth + 8, 140) - size) / 2);
  const pet = {
    x: clamp(Math.round(position.x), area.x + overhang, area.x + area.width - size - overhang),
    y: clamp(Math.round(position.y), area.y, area.y + area.height - petHeight),
    width: size, height: petHeight,
  };
  let panel = null;
  if (Object.hasOwn(PANEL_WIDTHS, panelId)) {
    const width = Math.min(PANEL_WIDTHS[panelId], area.width - 16 - BOOKMARK_WIDTH);
    const height = Math.min(PANEL_HEIGHTS[panelId], area.height - 16);
    const right = pet.x + pet.width + 12 + BOOKMARK_WIDTH;
    const left = pet.x - width - 12;
    // Prefer the side with more room, never reposition the pet when opening a panel.
    const rightRoom = area.x + area.width - right;
    const leftRoom = pet.x - 12 - area.x - BOOKMARK_WIDTH;
    let x = rightRoom >= leftRoom ? right : left;
    if (rightRoom < width && leftRoom >= width) x = left;
    if (leftRoom < width && rightRoom >= width) x = right;
    panel = { x: clamp(x, area.x + 8 + BOOKMARK_WIDTH, area.x + area.width - width - 8),
      y: clamp(pet.y + (pet.height - height) / 2, area.y + 8, area.y + area.height - height - 8),
      width, height };
  }
  const x = Math.floor(Math.min(pet.x - overhang, panel ? panel.x - BOOKMARK_WIDTH : pet.x));
  const y = Math.floor(Math.min(pet.y, panel?.y ?? pet.y));
  const width = Math.ceil(Math.max(pet.x + pet.width + overhang, panel ? panel.x + panel.width : pet.x + pet.width) - x);
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
