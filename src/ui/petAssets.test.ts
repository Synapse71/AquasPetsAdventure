import { describe, expect, it } from "vitest";
import { FALLBACK_PET, getPetAsset } from "./petAssets";

describe("optional pet assets", () => {
  it("always provides a renderable source for every visual state", () => {
    expect(getPetAsset("idle")).toBeTruthy();
    expect(getPetAsset("traveling")).toBeTruthy();
    expect(getPetAsset("settlement")).toBeTruthy();
  });

  it("keeps a self-contained fallback independent of the art workspace", () => {
    expect(FALLBACK_PET).toMatch(/^data:image\/svg\+xml/);
  });
});
