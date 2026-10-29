import './petPortrait.css';
import { hasPetPortrait, petPortraitUrl } from './petVisuals';

export const GUGUGAGA_PORTRAIT = `${import.meta.env.BASE_URL}pet-portraits/gugugaga.webp`;

export function PetPortrait({ known = true, petId = 'gugugaga' }: { known?: boolean; petId?: string }) {
  return <div className={`sp-portrait${known ? '' : ' unknown'}`} aria-hidden="true">
    {hasPetPortrait(petId) ? <img src={petPortraitUrl(petId)} alt="" draggable={false} />
      : <div style={{ backgroundImage: `url(${import.meta.env.BASE_URL}pet-sprites/blink-plain.webp)` }} />}
  </div>;
}
