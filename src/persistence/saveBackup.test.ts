import { expect, it } from 'vitest';
import { createInitialState } from '../domain/engine';
import { encodeSaveBackup } from './saveBackup';
it('exports a lossless versioned game backup without mutating the current game', () => {
  const game = createInitialState(), original = structuredClone(game);
  const backup = JSON.parse(encodeSaveBackup(game,new Date('2026-09-09T00:00:00Z')));
  expect(backup).toEqual({format:'idle-pet-save',backupVersion:1,exportedAt:'2026-09-09T00:00:00.000Z',game:original});
  expect(game).toEqual(original);
  expect(Object.keys(backup)).toEqual(['format','backupVersion','exportedAt','game']);
});
