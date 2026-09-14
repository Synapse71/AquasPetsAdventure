import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(readFileSync('electron-builder.json', 'utf8'));
describe('Demo distribution configuration', () => {
  it('ships only compiled runtime files and approved final icons', () => {
    expect(config.files.filter((file: string) => !file.startsWith('!'))).toEqual([
      'dist/**/*', 'desktop/main.cjs', 'desktop/login-item.cjs', 'desktop/preload.cjs', 'desktop/geometry.mjs',
      'public/icons/aquamarine-1024.png', 'public/pet-sprites/standing.png', 'package.json',
    ]);
    expect(config.asar).toBe(true);
  });
  it('builds both Mac architectures and Windows x64 without credential discovery or publishing', () => {
    expect(config.mac.target).toEqual([{ target: 'dmg', arch: ['universal'] }]);
    expect(config.win.target).toEqual([{ target: 'portable', arch: ['x64'] }]);
    expect(config.mac.identity).toBe('-');
    expect(config.mac.notarize).toBe(false);
    expect(config.win.signExecutable).toBe(false);
    expect(config.publish).toBeNull();
  });
});
