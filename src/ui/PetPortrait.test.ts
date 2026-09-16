import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { PetPortrait } from './PetPortrait';

describe('shared Guga portrait', () => {
  it('uses the final avatar rather than an animation sheet', () => {
    const html = renderToStaticMarkup(createElement(PetPortrait));
    expect(html).toContain('pet-portraits/gugugaga.webp');
    expect(html).not.toContain('blink-plain');
  });
  it('does not reveal the portrait for undiscovered pets', () => {
    const html = renderToStaticMarkup(createElement(PetPortrait, {known:false}));
    expect(html).toContain('unknown');
    expect(html).not.toContain('pet-portraits/gugugaga.webp');
  });
  it('ships a small runtime asset without requiring source artwork', () => {
    expect(existsSync('public/pet-portraits/gugugaga.webp')).toBe(true);
    expect(statSync('public/pet-portraits/gugugaga.webp').size).toBeLessThan(100_000);
  });
});
