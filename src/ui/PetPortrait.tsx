import './petPortrait.css';

export const GUGUGAGA_PORTRAIT = `${import.meta.env.BASE_URL}pet-portraits/gugugaga.webp`;

export function PetPortrait({ known = true }: { known?: boolean }) {
  return <div className={`sp-portrait${known ? '' : ' unknown'}`} aria-hidden="true">
    {known ? <img src={GUGUGAGA_PORTRAIT} alt="" draggable={false} />
      : <div style={{ backgroundImage: `url(${import.meta.env.BASE_URL}pet-sprites/blink-plain.webp)` }} />}
  </div>;
}
