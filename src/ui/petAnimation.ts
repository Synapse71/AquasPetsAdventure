import spriteManifest from '../../public/pet-sprites/manifest.json';

export const IDLE_CLIPS = ['idle-magnifier', 'idle-digging', 'blink-plain', 'blink-breath', 'blink-tilt'] as const;
export type Clip = typeof IDLE_CLIPS[number] | 'start-explore' | 'walk' | 'sleep-start' | 'sleep-loop' | 'sleep-end';
export type Pose = Clip | 'standing';
const WEIGHTS = [2, 2, 5, 5, 2];
export const SLEEP_AFTER = 180_000;
export const IDLE_PAUSE = 6_000;
export function chooseIdle(previous: Pose, random = Math.random): Clip {
  const choices = IDLE_CLIPS.map((clip, index) => ({ clip, weight: clip === previous ? 0 : WEIGHTS[index] }));
  let roll = random() * choices.reduce((sum, entry) => sum + entry.weight, 0);
  for (const entry of choices) { roll -= entry.weight; if (roll < 0) return entry.clip; }
  return choices.find(entry => entry.weight > 0)!.clip;
}
export function clipDuration(clip: Pose) {
  if (clip === 'standing') return 0;
  const sheet = spriteManifest[clip];
  return sheet.frames / sheet.fps * 1000;
}
// Pending work is deliberately NOT an input: it only affects the independent bulb.
export class PetAnimator {
  pose: Pose = 'standing';
  since: number;
  lastInteraction: number;
  previousIdle: Pose = 'standing';
  private observed = false;
  private lastDepartureId?: string;
  private wasTraveling = false;
  private restingSince: number;
  constructor(now: number, private random = Math.random) { this.since = now; this.lastInteraction = now; this.restingSince = now; }
  set(pose: Pose, now: number) { this.pose = pose; this.since = now; }
  interact(now: number) {
    this.lastInteraction = now;
    if (this.pose === 'sleep-loop' || this.pose === 'sleep-start') this.set('sleep-end', now);
  }
  update(now: number, traveling: boolean, menuOpen: boolean, departureId?: string) {
    // Travel is activity, not idle time. Start a fresh inactivity window on
    // arrival, including after suspended frames or a restored in-progress trip.
    if (this.wasTraveling && !traveling) this.restingSince = now;
    this.wasTraveling = traveling;
    // The first observation may be a restored trip. Only a newly started segment
    // observed while this animator is alive starts a one-shot departure.
    if (this.observed && traveling && departureId && departureId !== this.lastDepartureId) {
      this.set('start-explore', now);
      this.lastInteraction = now;
    }
    this.observed = true;
    if (departureId) this.lastDepartureId = departureId;
    // One-shot animation owns the pose until its actual manifest duration ends.
    if (this.pose === 'start-explore') {
      if (now - this.since < clipDuration(this.pose)) return this.pose;
      this.set(traveling ? 'walk' : 'standing', now);
    }
    if (traveling) { if (this.pose !== 'walk') this.set('walk', now); return this.pose; }
    if (this.pose === 'walk') this.set('standing', now);
    if (this.pose === 'sleep-end') {
      if (now - this.since >= clipDuration(this.pose)) this.set('standing', now);
      return this.pose;
    }
    if (this.pose === 'sleep-start') {
      if (now - this.since >= clipDuration(this.pose)) this.set('sleep-loop', now);
      return this.pose;
    }
    if (this.pose === 'sleep-loop') return this.pose;
    if (now - Math.max(this.lastInteraction, this.restingSince) >= SLEEP_AFTER) { this.set('sleep-start', now); return this.pose; }
    if (this.pose !== 'standing' && now - this.since >= clipDuration(this.pose)) this.set('standing', now);
    if (menuOpen && this.pose === 'standing') this.since = now;
    if (!menuOpen && this.pose === 'standing' && now - this.since >= IDLE_PAUSE) {
      const next = chooseIdle(this.previousIdle, this.random);
      this.previousIdle = next; this.set(next, now);
    }
    return this.pose;
  }
}
