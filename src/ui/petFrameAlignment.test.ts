import { describe, expect, it } from 'vitest';
import { IDLE_CLIPS } from './petAnimation';
import { petFrameOffsetX } from './petFrameAlignment';

describe('departure root alignment', () => {
  it('matches the departure tail to the existing in-place walk anchor', () => {
    expect(111.5 + petFrameOffsetX('start-explore', 120)).toBe(150.5);
    expect(petFrameOffsetX('walk', 0)).toBe(0);
  });
  it('leaves the opening and wide raised-flag frames unchanged', () => {
    for (let frame = 0; frame <= 89; frame++) expect(petFrameOffsetX('start-explore', frame)).toBe(0);
  });
  it('compensates the source movement before the seam, without a last-frame snap', () => {
    for (let frame = 90; frame <= 120; frame++) {
      const x = petFrameOffsetX('start-explore', frame);
      expect(x).toBeGreaterThanOrEqual(petFrameOffsetX('start-explore', frame - 1));
      expect(x).toBeLessThanOrEqual(39);
      expect(x - petFrameOffsetX('start-explore', frame - 1)).toBeLessThanOrEqual(6);
    }
    for (let frame = 104; frame <= 120; frame++) expect(petFrameOffsetX('start-explore', frame)).toBe(39);
  });
  it('does not change idle, walk, standing or sleeping anchors', () => {
    for (const pose of [...IDLE_CLIPS, 'standing', 'walk', 'sleep-start', 'sleep-loop', 'sleep-end'] as const) {
      for (const frame of [0, 90, 120]) expect(petFrameOffsetX(pose, frame)).toBe(0);
    }
  });
});
