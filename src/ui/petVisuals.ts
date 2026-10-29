import guga from '../../public/pet-sprites/manifest.json';
import doro from '../../public/pet-sprites/doro/manifest.json';

export interface SpriteSheet { file: string; frames: number; width: number; height: number; columns: number; fps: number; loop: boolean }
export function petVisuals(petId = 'gugugaga') {
  const isDoro = petId === 'doro';
  return {
    manifest: (isDoro ? doro : guga) as Record<string, SpriteSheet>,
    root: `${import.meta.env.BASE_URL}pet-sprites/${isDoro ? 'doro/' : ''}`,
    // 两只宠物先使用相同显示比例，不按素材制作时的缩放率反向补偿。
    defaultScale: 1,
    rootMotionCorrection: !isDoro,
  };
}
export const hasPetPortrait = (id: string) => id === 'gugugaga' || id === 'doro';
export const petPortraitUrl = (id: string) => `${import.meta.env.BASE_URL}pet-portraits/${id}.webp`;
