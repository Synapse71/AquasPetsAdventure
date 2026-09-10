export type PetVisualState = "idle" | "traveling" | "settlement";

const optionalPetAssets = import.meta.glob<string>(
  "../../assets/gugugaga/{idle-digging,idle-magnifier,walk}/anim.webp",
  {
    eager: true,
    query: "?url",
    import: "default",
  },
);

const FOLDER_BY_STATE: Record<PetVisualState, string> = {
  idle: "idle-magnifier",
  traveling: "walk",
  settlement: "idle-digging",
};

export const FALLBACK_PET =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 560">
      <ellipse cx="240" cy="514" rx="126" ry="22" fill="#30342f" opacity=".12"/>
      <path d="M240 55c-96 0-156 94-156 226 0 140 57 222 156 222s156-82 156-222C396 149 336 55 240 55Z" fill="#343a37"/>
      <ellipse cx="240" cy="326" rx="104" ry="132" fill="#f1efe7"/>
      <circle cx="187" cy="177" r="18" fill="#f7f6f0"/>
      <circle cx="293" cy="177" r="18" fill="#f7f6f0"/>
      <circle cx="187" cy="177" r="8" fill="#343a37"/>
      <circle cx="293" cy="177" r="8" fill="#343a37"/>
      <path d="M200 215 240 188l40 27-40 25Z" fill="#e7b74f"/>
      <path d="M151 488 105 520h101l34-23 34 23h101l-46-32" fill="#e7b74f"/>
      <text x="240" y="378" text-anchor="middle" font-family="system-ui,sans-serif" font-size="24" font-weight="700" fill="#7b8179">PET</text>
    </svg>
  `);

export function getPetAsset(state: PetVisualState): string {
  const folder = FOLDER_BY_STATE[state];
  const entry = Object.entries(optionalPetAssets).find(([path]) =>
    path.endsWith(`/${folder}/anim.webp`),
  );
  return entry?.[1] ?? FALLBACK_PET;
}
