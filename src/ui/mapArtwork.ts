import foothillsArt from '../../assets/maps/ue15-review-2026-09-28/explorer-foothills-selected.png';
import kegnaArt from './art/kegna-selected.png';

// 锚点指向可交互地物；配置台保存 nodePositions 后覆盖这些初始位置。
export const mapArtwork: Record<string, string> = {
  'map-1': foothillsArt,
  'map-2': kegnaArt,
};

export const mapArtworkAnchors: Record<string, Record<string, { x: number; y: number }>> = {
  'map-1': {
    'm1-start': { x: 55.4, y: 91.3 },
    'm1-point-1': { x: 24.2, y: 61.3 },
    'm1-point-2': { x: 82.8, y: 59.5 },
    'm1-goal-1': { x: 54.9, y: 16 },
  },
  'map-2': {
    'm2-start': { x: 20.8, y: 86.8 },
    'm2-point-1': { x: 9.8, y: 33 },
    'm2-point-2': { x: 48.8, y: 35.2 },
    'm2-point-3': { x: 82, y: 78.1 },
    'm2-point-4': { x: 30.3, y: 23.4 },
    'm2-point-5': { x: 60.1, y: 27.8 },
    'm2-point-6': { x: 83, y: 39.1 },
    'm2-goal-1': { x: 83, y: 10.9 },
  },
};
