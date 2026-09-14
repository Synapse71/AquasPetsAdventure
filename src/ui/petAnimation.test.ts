import { describe, it, expect } from 'vitest';
import { PetAnimator, chooseIdle, chooseArrival, isArrival, ARRIVAL_CLIPS, IDLE_CLIPS, SLEEP_AFTER, clipDuration } from './petAnimation';

function finishArrival(animator: PetAnimator, at: number) {
  animator.update(at, false, false);
  let sawArrival = false;
  for (let time = at + 17; time < at + 16_000; time += 17) {
    const pose = animator.update(time, false, false);
    sawArrival ||= isArrival(pose);
    if (sawArrival && pose === 'standing') return time;
  }
  throw new Error('Arrival did not finish');
}

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
    finishArrival(animator, 500_001);
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
    const next = finishArrival(restored, 2000) + 1;
    expect(restored.update(next, true, false, 'trip:route-1')).toBe('start-explore');
    expect(restored.update(next + clipDuration('start-explore') - 1, true, true, 'trip:route-1')).toBe('start-explore');
    expect(restored.update(next + clipDuration('start-explore'), true, false, 'trip:route-1')).toBe('walk');
    const later = finishArrival(restored, next + 10_000) + 1;
    expect(restored.update(later, true, false, 'trip:route-2')).toBe('start-explore');
    const reloaded = new PetAnimator(later + 500);
    expect(reloaded.update(later + 500, true, false, 'trip:route-2')).toBe('walk');
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
    expect(animator.update(1 + clipDuration('start-explore'), false, false)).toBe('walk');
    finishArrival(animator, 1 + clipDuration('start-explore'));
  });
  it('starts a fresh inactivity window after every route, even with sparse updates', () => {
    const animator = new PetAnimator(0);
    animator.update(0, true, false);
    const arrival = 2 * 60 * 60 * 1000;
    finishArrival(animator, arrival);
    expect(animator.update(arrival + SLEEP_AFTER - 1, false, true)).not.toMatch(/^sleep/);
    animator.update(arrival + SLEEP_AFTER, true, false);
    const nextArrival = arrival + 2 * SLEEP_AFTER;
    finishArrival(animator, nextArrival);
    expect(animator.update(nextArrival + SLEEP_AFTER - 1, false, true)).not.toMatch(/^sleep/);
    expect(animator.update(nextArrival + SLEEP_AFTER, false, true)).toBe('sleep-start');
  });
  it('interacting after arrival extends inactivity, but waiting does not', () => {
    const animator = new PetAnimator(0);
    animator.update(0, true, false);
    const arrival = 500_000;
    finishArrival(animator, arrival);
    animator.interact(arrival + 60_000);
    expect(animator.update(arrival + SLEEP_AFTER, false, true)).not.toMatch(/^sleep/);
    expect(animator.update(arrival + 60_000 + SLEEP_AFTER, false, true)).toBe('sleep-start');
  });
  it('selects A/B with equal ranges, independently of the previous arrival', () => {
    for (const roll of [0, .1, .49999]) expect(chooseArrival(() => roll)).toBe('arrive-a');
    for (const roll of [.5, .75, .99999]) expect(chooseArrival(() => roll)).toBe('arrive-b');
  });
  it.each(ARRIVAL_CLIPS)('finishes the walk tail then plays %s once without interruption', clip => {
    let draws = 0;
    const animator = new PetAnimator(0, () => { draws++; return clip === 'arrive-a' ? 0 : .9; });
    animator.update(0, true, false, 'entry');
    expect(animator.update(600, false, false)).toBe('walk');
    expect(animator.frame(600)).toBe(14);
    // Deliberately jump past the wrap: still draw frame 114 before arrival.
    const tail = clipDuration('walk') + 100;
    expect(animator.update(tail, false, true)).toBe('walk');
    expect(animator.frame(tail)).toBe(114);
    expect(animator.update(tail + 20, false, true)).toBe('walk');
    const start = tail + 42;
    expect(animator.update(start, false, false)).toBe(clip);
    expect(animator.frame(start)).toBe(0);
    animator.interact(start + 1000);
    expect(animator.update(start + 1000, false, true)).toBe(clip);
    expect(animator.update(start + clipDuration(clip) - 1, false, false)).toBe(clip);
    expect(animator.frame(start + clipDuration(clip) - 1)).toBe(121);
    expect(animator.update(start + clipDuration(clip), false, false)).toBe('standing');
    expect(draws).toBe(1);
  });
  it('queues a quickly selected next route until arrival finishes', () => {
    const animator = new PetAnimator(0, () => 0);
    animator.update(0, true, false, 'entry');
    animator.update(500, false, false);
    expect(animator.update(600, true, false, 'route-1')).toBe('walk');
    animator.update(4800, true, true, 'route-1');
    expect(animator.update(4842, true, true, 'route-1')).toBe('arrive-a');
    expect(animator.update(5000, true, true, 'route-1')).toBe('arrive-a');
    const next = 4842 + clipDuration('arrive-a');
    expect(animator.update(next, true, false, 'route-1')).toBe('start-explore');
    expect(animator.update(next + clipDuration('start-explore') - 1, true, false, 'route-1')).toBe('start-explore');
    expect(animator.update(next + clipDuration('start-explore'), true, false, 'route-1')).toBe('walk');
  });
  it('does not invent arrivals on startup in a resting or restored traveling state', () => {
    const resting = new PetAnimator(0, () => { throw new Error('Unexpected arrival roll'); });
    expect(resting.update(0, false, true)).toBe('standing');
    const traveling = new PetAnimator(0, () => { throw new Error('Unexpected arrival roll'); });
    expect(traveling.update(0, true, false, 'restored')).toBe('walk');
  });
});
