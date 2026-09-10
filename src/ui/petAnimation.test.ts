import { describe, it, expect } from 'vitest';
import { PetAnimator, chooseIdle, IDLE_CLIPS, SLEEP_AFTER, clipDuration } from './petAnimation';

describe('pet animation scheduler', () => {
  it('starts still and waits six seconds before a weighted idle action', () => {
    const animator = new PetAnimator(0, () => 0);
    expect(animator.update(5999, false, false)).toBe('standing');
    expect(animator.update(6000, false, false)).toBe('idle-magnifier');
    expect(animator.update(6000 + clipDuration('idle-magnifier'), false, false)).toBe('standing');
    expect(animator.update(12000, false, false)).toBe('standing');
  });
  it('never repeats the previous idle clip', () => {
    for (const previous of IDLE_CLIPS) for (const roll of [0, .2, .5, .9, .99999]) expect(chooseIdle(previous, () => roll)).not.toBe(previous);
  });
  it('sleeps after three minutes even with menu open, and wakes only on interaction', () => {
    const animator = new PetAnimator(0);
    expect(animator.update(SLEEP_AFTER, false, true)).toBe('sleep-start');
    expect(animator.update(SLEEP_AFTER + 5100, false, false)).toBe('sleep-loop');
    expect(animator.update(SLEEP_AFTER + 60_000, false, false)).toBe('sleep-loop');
    animator.interact(SLEEP_AFTER + 60_001);
    expect(animator.pose).toBe('sleep-end');
    expect(animator.update(SLEEP_AFTER + 61_000, false, true)).toBe('sleep-end');
    expect(animator.update(SLEEP_AFTER + 66_000, false, true)).toBe('standing');
  });
  it('travel loops in place and ends without choosing a route', () => {
    const animator = new PetAnimator(0);
    expect(animator.update(1, true, false)).toBe('walk');
    expect(animator.update(500_000, true, false)).toBe('walk');
    expect(animator.update(500_001, false, false)).toBe('standing');
    expect(animator.update(500_001 + SLEEP_AFTER - 1, false, true)).not.toMatch(/^sleep/);
    expect(animator.update(500_001 + SLEEP_AFTER, false, true)).toBe('sleep-start');
  });
  it('plays the whole departure clip before travel can take over', () => {
    const animator = new PetAnimator(0);
    animator.update(0, false, false);
    expect(animator.update(1, true, false, 'exp-new')).toBe('start-explore');
    const end = 1 + 121 / 24 * 1000;
    expect(animator.update(end - 1, true, true, 'exp-new')).toBe('start-explore');
    expect(animator.update(end, true, false, 'exp-new')).toBe('walk');
  });
  it('plays departure for each new segment, but never replays restored or unchanged segments', () => {
    const restored = new PetAnimator(0);
    expect(restored.update(0, true, false, 'trip:entry')).toBe('walk');
    expect(restored.update(1000, true, true, 'trip:entry')).toBe('walk');
    restored.update(2000, false, false);
    expect(restored.update(3000, true, false, 'trip:route-1')).toBe('start-explore');
    expect(restored.update(3000 + clipDuration('start-explore') - 1, true, true, 'trip:route-1')).toBe('start-explore');
    expect(restored.update(3000 + clipDuration('start-explore'), true, false, 'trip:route-1')).toBe('walk');
    expect(restored.update(10000, true, false, 'trip:route-1')).toBe('walk');
    restored.update(11000, false, false);
    expect(restored.update(12000, true, false, 'trip:route-2')).toBe('start-explore');
    const reloaded = new PetAnimator(12500);
    expect(reloaded.update(12500, true, false, 'trip:route-2')).toBe('walk');
  });
  it('notices a new segment even if the arrival frame was not rendered', () => {
    const animator = new PetAnimator(0);
    animator.update(0, true, false, 'trip:route-1');
    expect(animator.update(10000, true, false, 'trip:route-2')).toBe('start-explore');
  });
  it('clicks, panels and arrival cannot interrupt the departure one-shot', () => {
    const animator = new PetAnimator(0);
    animator.update(0, false, false);
    animator.update(1, true, false, 'trip');
    animator.interact(1000);
    expect(animator.update(1000, true, true, 'trip')).toBe('start-explore');
    expect(animator.since).toBe(1);
    expect(animator.update(2000, false, false)).toBe('start-explore');
    expect(animator.update(1 + clipDuration('start-explore'), false, false)).toBe('standing');
  });
  it('starts a fresh inactivity window after every route, even with sparse updates', () => {
    const animator = new PetAnimator(0);
    animator.update(0, true, false);
    const arrival = 2 * 60 * 60 * 1000;
    expect(animator.update(arrival, false, false)).toBe('standing');
    expect(animator.update(arrival + SLEEP_AFTER - 1, false, true)).not.toMatch(/^sleep/);
    animator.update(arrival + SLEEP_AFTER, true, false);
    const nextArrival = arrival + 2 * SLEEP_AFTER;
    expect(animator.update(nextArrival, false, false)).toBe('standing');
    expect(animator.update(nextArrival + SLEEP_AFTER - 1, false, true)).not.toMatch(/^sleep/);
    expect(animator.update(nextArrival + SLEEP_AFTER, false, true)).toBe('sleep-start');
  });
  it('interacting after arrival extends inactivity, but waiting does not', () => {
    const animator = new PetAnimator(0);
    animator.update(0, true, false);
    const arrival = 500_000;
    animator.update(arrival, false, false);
    animator.interact(arrival + 60_000);
    expect(animator.update(arrival + SLEEP_AFTER, false, true)).not.toMatch(/^sleep/);
    expect(animator.update(arrival + 60_000 + SLEEP_AFTER, false, true)).toBe('sleep-start');
  });
});
