import type { Pose } from './petAnimation';

// Draw-space root-motion correction for the current 300 × 282 Gugagaga sheets.
// start-explore moves left after raising the flag; walk was packed in-place.
// Measured torso anchor at the seam: 111.5 → 150.5, with the same foot baseline.
// Follow that leftward motion back toward the fixed anchor as it happens, rather
// than snapping at the seam or moving the canvas/window. Earlier frames stay
// unchanged so the raised flag is not pushed past the right canvas edge.
const DEPARTURE_ROOT_KEYS = [
  [89, 0], [90, 5], [93, 12], [94, 18], [97, 25],
  [98, 31], [102, 38], [104, 39],
] as const;

export function petFrameOffsetX(pose: Pose, frame: number): number {
  if (pose !== 'start-explore' || frame <= DEPARTURE_ROOT_KEYS[0][0]) return 0;
  for (let i = 1; i < DEPARTURE_ROOT_KEYS.length; i++) {
    const [endFrame, endX] = DEPARTURE_ROOT_KEYS[i];
    if (frame <= endFrame) {
      const [startFrame, startX] = DEPARTURE_ROOT_KEYS[i - 1];
      return startX + (endX - startX) * (frame - startFrame) / (endFrame - startFrame);
    }
  }
  return DEPARTURE_ROOT_KEYS.at(-1)![1];
}
