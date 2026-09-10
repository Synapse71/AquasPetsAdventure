import type { GameState } from '../domain/types';
// A backup contains game state only, never desktop position or uncommitted UI plans.
export function encodeSaveBackup(game: GameState, now = new Date()): string {
  return JSON.stringify({ format: 'idle-pet-save', backupVersion: 1, exportedAt: now.toISOString(), game }, null, 2);
}
export function downloadSaveBackup(game: GameState): void {
  const now = new Date();
  const url = URL.createObjectURL(new Blob([encodeSaveBackup(game, now)], {type:'application/json'}));
  const a = document.createElement('a');
  a.href = url; a.download = `idle-save-${now.toISOString().replace(/[:.]/g,'-')}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
