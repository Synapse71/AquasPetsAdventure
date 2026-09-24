import spriteManifest from '../../public/pet-sprites/manifest.json';

export const IDLE_CLIPS = ['idle-magnifier', 'idle-digging', 'blink-plain', 'blink-breath', 'blink-tilt', 'idle-selfie'] as const;
export const TRAVEL_CLIPS = ['travel-map', 'travel-rest', 'travel-alert'] as const;
export const ARRIVAL_CLIPS = ['arrive-a', 'arrive-b'] as const;
export type TravelClip = typeof TRAVEL_CLIPS[number];
export type ArrivalClip = typeof ARRIVAL_CLIPS[number];
export type Clip = typeof IDLE_CLIPS[number] | TravelClip | ArrivalClip | 'start-explore' | 'walk' | 'sleep-start' | 'sleep-loop' | 'sleep-end';
export type Pose = Clip | 'standing';
export const isArrival = (pose: Pose): pose is ArrivalClip => pose === 'arrive-a' || pose === 'arrive-b';
export const isTravelClip = (pose: Pose): pose is TravelClip => (TRAVEL_CLIPS as readonly string[]).includes(pose);
export const chooseArrival = (random = Math.random): ArrivalClip => random() < .5 ? 'arrive-a' : 'arrive-b';
// Parallel to IDLE_CLIPS. idle-selfie is the longest (10s) and rarest — a special
// one-off bit, so it carries the lowest weight.
const WEIGHTS = [2, 2, 5, 5, 2, 1];
export const SLEEP_AFTER = 180_000;
export const IDLE_PAUSE = 6_000;
// One travel leg runs 25–90 minutes while the walk loop is only 4.8s, so a
// one-off "on the road" beat is dropped in every so often to break up the
// repetition. Every travel clip starts AND ends on the same walk frame, so the
// loop resumes without a jump. The interval is fixed so nothing is drawn until
// a break actually happens; only which clip plays is random.
export const TRAVEL_BREAK_EVERY = 60_000;
export function chooseTravel(previous: Pose, random = Math.random): TravelClip {
  const pool = TRAVEL_CLIPS.filter(clip => clip !== previous);
  const usable = pool.length ? pool : TRAVEL_CLIPS;
  return usable[Math.min(usable.length - 1, Math.floor(random() * usable.length))];
}
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
  private pendingArrival?: ArrivalClip;
  private walkStopAt?: number;
  private walkTailSince?: number;
  private queuedDeparture = false;
  private travelBreakAt?: number;
  private previousTravel: Pose = 'standing';
  constructor(now: number, private random = Math.random) { this.since = now; this.lastInteraction = now; this.restingSince = now; }
  set(pose: Pose, now: number) { this.pose = pose; this.since = now; }
  interact(now: number) {
    this.lastInteraction = now;
    if (this.pose === 'sleep-loop' || this.pose === 'sleep-start') this.set('sleep-end', now);
  }
  frame(now: number) {
    if (this.pose === 'standing') return 0;
    const sheet = spriteManifest[this.pose];
    // Explicitly show the anchor frame even if a slow/suspended RAF skipped it.
    if (this.pose === 'walk' && this.walkTailSince !== undefined) return sheet.frames - 1;
    const index = Math.floor(Math.max(0, now - this.since) * sheet.fps / 1000);
    return sheet.loop ? index % sheet.frames : Math.min(sheet.frames - 1, index);
  }
  update(now: number, traveling: boolean, menuOpen: boolean, departureId?: string) {
    // Travel is activity, not idle time. Start a fresh inactivity window on
    // arrival, including after suspended frames or a restored in-progress trip.
    if (this.wasTraveling && !traveling) {
      this.restingSince = now;
      if (!this.pendingArrival && !isArrival(this.pose)) this.pendingArrival = chooseArrival(this.random);
    }
    this.wasTraveling = traveling;
    // The first observation may be a restored trip. Only a newly started segment
    // observed while this animator is alive starts a one-shot departure.
    if (this.observed && traveling && departureId && departureId !== this.lastDepartureId) {
      // A quickly chosen next route waits for the current arrival to finish.
      if (this.pendingArrival || isArrival(this.pose)) this.queuedDeparture = true;
      else this.set('start-explore', now);
      this.lastInteraction = now;
    }
    this.observed = true;
    if (departureId) this.lastDepartureId = departureId;
    // One-shot animation owns the pose until its actual manifest duration ends.
    if (this.pose === 'start-explore') {
      if (now < this.since + clipDuration(this.pose)) return this.pose;
      this.set(traveling || this.pendingArrival ? 'walk' : 'standing', now);
    }
    if (this.pendingArrival) {
      if (this.pose !== 'walk') this.set('walk', now);
      const duration = clipDuration('walk'), frameTime = 1000 / spriteManifest.walk.fps;
      this.walkStopAt ??= this.since + (Math.floor(Math.max(0, now - this.since) / duration) + 1) * duration;
      if (now >= this.walkStopAt - frameTime) {
        this.walkTailSince ??= now;
        if (now - this.walkTailSince >= frameTime) {
          this.set(this.pendingArrival, now);
          this.pendingArrival = undefined;
          this.walkStopAt = undefined;
          this.walkTailSince = undefined;
        }
      }
      return this.pose;
    }
    if (isArrival(this.pose)) {
      if (now < this.since + clipDuration(this.pose)) return this.pose;
      this.set(traveling ? (this.queuedDeparture ? 'start-explore' : 'walk') : 'standing', now);
      this.queuedDeparture = false;
      return this.pose;
    }
    // Travel: mostly the walk loop, with a one-off "on the road" beat dropped
    // in every TRAVEL_BREAK_EVERY. Those clips start and end on the very walk
    // frame the loop is parked on, so resuming the loop is seamless.
    if (traveling) {
      if (isTravelClip(this.pose)) {
        if (now < this.since + clipDuration(this.pose)) return this.pose;
        this.set('walk', now);
        this.travelBreakAt = now + TRAVEL_BREAK_EVERY;
        return this.pose;
      }
      if (this.pose !== 'walk' || this.travelBreakAt === undefined) {
        if (this.pose !== 'walk') this.set('walk', now);
        this.travelBreakAt = now + TRAVEL_BREAK_EVERY;
      }
      if (now >= this.travelBreakAt) {
        const next = chooseTravel(this.previousTravel, this.random);
        this.previousTravel = next;
        this.travelBreakAt = undefined;
        this.set(next, now);
      }
      return this.pose;
    }
    this.travelBreakAt = undefined;
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
