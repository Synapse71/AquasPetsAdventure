import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { petVisuals } from './petVisuals';
import { PetPortrait } from './PetPortrait';
import { PetAnimator, DORO_IDLE_CLIPS, chooseIdle, clipDuration, SLEEP_AFTER } from './petAnimation';
import { computeNativeLayout, petMetrics } from '../../desktop/geometry.mjs';
import { bundledCatalog } from '../domain/catalog';
import { validateCatalog } from '../config/catalogStore';

describe('Doro runtime art', () => {
  it('ships all nine sheets, standing and portrait without source-art dependencies', () => {
    const visual = petVisuals('doro');
    expect(Object.keys(visual.manifest)).toHaveLength(9);
    expect(visual.rootMotionCorrection).toBe(false);
    expect(visual.defaultScale).toBe(1);
    expect(petVisuals().rootMotionCorrection).toBe(true);
    for (const [name, sheet] of Object.entries(visual.manifest)) {
      expect(existsSync(`public/pet-sprites/doro/${sheet.file}`)).toBe(true);
      expect(sheet.width).toBe(300); expect(sheet.height).toBe(282);
      expect(sheet.loop).toBe(['walk', 'sleep-loop'].includes(name));
    }
    expect(existsSync('public/pet-sprites/doro/standing.png')).toBe(true);
    expect(existsSync('public/pet-portraits/doro.webp')).toBe(true);
  });
  it('uses Doro portrait with silhouette styling until discovered', () => {
    expect(renderToStaticMarkup(createElement(PetPortrait, { petId: 'doro' }))).toContain('pet-portraits/doro.webp');
    const locked = renderToStaticMarkup(createElement(PetPortrait, { petId: 'doro', known: false }));
    expect(locked).toContain('pet-portraits/doro.webp'); expect(locked).toContain('unknown');
    expect(locked).not.toContain('blink-plain');
  });
  it('chooses only Doro idle clips without immediate repeats', () => {
    for (const previous of DORO_IDLE_CLIPS) for (const n of [0, .3, .6, .999]) {
      const next = chooseIdle(previous, () => n, 'doro');
      expect(DORO_IDLE_CLIPS).toContain(next); expect(next).not.toBe(previous);
    }
    const a = new PetAnimator(0, () => .5, 'doro');
    expect(a.update(6000, false, false)).toBe('orange-offer');
    expect(a.update(6000 + clipDuration('orange-offer', 'doro'), false, false)).toBe('standing');
  });
  it('uses Doro sleep timings and wakes to standing', () => {
    const a = new PetAnimator(0, () => 0, 'doro');
    expect(a.update(SLEEP_AFTER, false, true)).toBe('sleep-start');
    const asleep = SLEEP_AFTER + clipDuration('sleep-start', 'doro');
    expect(a.update(asleep, false, true)).toBe('sleep-loop');
    expect(a.frame(asleep + clipDuration('sleep-loop', 'doro') + 1000)).toBe(24);
    a.interact(asleep + 1000);
    expect(a.pose).toBe('sleep-end');
    expect(a.update(asleep + 1000 + clipDuration('sleep-end', 'doro'), false, true)).toBe('standing');
  });
  it('departure, endless walk and arrival use Doro sheets, no Guga travel beats', () => {
    const a = new PetAnimator(0, () => 0, 'doro');
    a.update(0, false, false);
    expect(a.update(1, true, false, 'leg1')).toBe('start-explore');
    expect(a.update(1 + clipDuration('start-explore', 'doro'), true, false, 'leg1')).toBe('walk');
    expect(a.update(100_000, true, false, 'leg1')).toBe('walk');
    a.update(100_001, false, false, 'leg1');
    let arrival = false, standing = false;
    for (let t = 100_018; t < 120_000; t += 17) {
      const pose = a.update(t, false, true, 'leg1');
      expect(pose === 'standing' || petVisuals('doro').manifest[pose]).toBeTruthy();
      arrival ||= pose === 'arrive';
      standing ||= arrival && pose === 'standing';
    }
    expect(arrival).toBe(true); expect(standing).toBe(true);
  });
  it('restoring a traveling Doro does not replay departure', () => {
    const a = new PetAnimator(0, () => 0, 'doro');
    expect(a.update(0, true, false, 'saved')).toBe('walk');
    const sheet = petVisuals('doro').manifest.walk;
    expect(a.frame(clipDuration('walk', 'doro') + 1000)).toBe(Math.floor(24) % sheet.frames);
  });
  it('compensated canvas fits native bounds, including screen edges and max slider', () => {
    const area = { x: 0, y: 0, width: 1440, height: 900 };
    for (const size of [130, 300, 420]) {
      const effective = petMetrics(size * 1.25).size;
      const l = computeNativeLayout({ x: 1400, y: 850 }, area, null, size * 1.25);
      expect(l.pet.width).toBe(effective);
      expect(l.pet.x + effective).toBeLessThanOrEqual(l.bounds.width);
      expect(l.pet.y + l.pet.height).toBeLessThanOrEqual(l.bounds.height);
      expect(l.bounds.x + l.pet.x + effective).toBeLessThanOrEqual(area.width);
    }
  });
  it('exposes scale in config and rejects unsafe values', () => {
    const c = structuredClone(bundledCatalog);
    expect(c.petTemplates.doro.visualScale).toBe(1);
    c.petTemplates.doro.visualScale = 100;
    expect(validateCatalog(c).some(i => i.path === 'petTemplates.doro.visualScale' && i.level === 'error')).toBe(true);
  });
  it('all consuming panels use pet identity, desktop selection is persisted and falls back safely', () => {
    for (const file of ['PetStatusPanel', 'AdventurePanel', 'CodexPanel']) {
      expect(readFileSync(`src/ui/${file}.tsx`, 'utf8')).toContain('petId={pet.id}');
    }
    const app = readFileSync('src/ui/App.tsx', 'utf8');
    expect(app).toContain('useUIState("desktop-pet-id"');
    expect(app).toContain('game.pets[desktopPetId] ?? Object.values(game.pets)[0]');
    expect(app).toContain('entry.petIds.includes(stagePet?.id)');
  });
  it('status opening targets the desktop pet, while point reminders retain an explicit target', () => {
    const app = readFileSync('src/ui/App.tsx', 'utf8');
    expect(app).toContain('statusPetId = stagePet?.id');
    expect(app).toContain('petId: statusPetId, key: (previous?.key ?? 0) + 1');
    expect(app).toContain('openPanel("pets", pet.id)');
    const panel = readFileSync('src/ui/PetStatusPanel.tsx', 'utf8');
    expect(panel).toContain('if (intent) setSelected(intent.petId)');
    expect(panel).toContain('className="ps-set-desktop"');
    const css = readFileSync('src/ui/petStatusPanel.css', 'utf8');
    expect(css).toMatch(/\.pet-status-panel \.ps-set-desktop\s*\{\s*padding:0 12px/);
  });
});
