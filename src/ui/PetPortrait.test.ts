import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { PetPortrait } from './PetPortrait';

describe('shared Guga portrait', () => {
  it('uses the final avatar rather than an animation sheet', () => {
    const html = renderToStaticMarkup(createElement(PetPortrait));
    expect(html).toContain('pet-portraits/gugugaga.webp');
    expect(html).not.toContain('blink-plain');
  });
  it.each(['gugugaga', 'doro'])('uses %s own portrait as the undiscovered silhouette', (petId) => {
    const html = renderToStaticMarkup(createElement(PetPortrait, { known: false, petId }));
    expect(html).toContain('class="sp-portrait unknown"');
    expect(html).toContain(`pet-portraits/${petId}.webp`);
    expect(html).not.toContain('blink-plain');
    const css = readFileSync('src/ui/petPortrait.css', 'utf8');
    expect(css).toMatch(/\.sp-portrait\.unknown>img\s*\{[^}]*filter:brightness\(0\)/);
  });
  it('shows Doro original portrait after recruitment', () => {
    const html = renderToStaticMarkup(createElement(PetPortrait, { known: true, petId: 'doro' }));
    expect(html).toContain('pet-portraits/doro.webp');
    expect(html).not.toContain('unknown');
  });
  it('ships a small runtime asset without requiring source artwork', () => {
    expect(existsSync('public/pet-portraits/gugugaga.webp')).toBe(true);
    expect(statSync('public/pet-portraits/gugugaga.webp').size).toBeLessThan(100_000);
  });
});
