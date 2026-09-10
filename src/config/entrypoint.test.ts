import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  render: vi.fn(), initialize: vi.fn(),
  Game: () => null, Editor: () => null,
}));
vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: mocks.render }) }));
vi.mock("../ui/App", () => ({ App: mocks.Game }));
vi.mock("./ConfigApp", () => ({ ConfigApp: mocks.Editor }));
vi.mock("./catalogStore", () => ({ initializeCatalog: mocks.initialize }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("document", { getElementById: () => ({}) });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function boot(dev: boolean, search: string) {
  vi.stubEnv("DEV", dev);
  vi.stubGlobal("window", { location: { search } });
  await import("../main");
  await vi.dynamicImportSettled();
  return mocks.render.mock.lastCall?.[0].props.children.type;
}

it("opens the editor only in dev mode and initializes local authoring data first", async () => {
  expect(await boot(true, "?config=1")).toBe(mocks.Editor);
  expect(mocks.initialize).toHaveBeenCalledOnce();
  expect(mocks.initialize.mock.invocationCallOrder[0]).toBeLessThan(mocks.render.mock.invocationCallOrder[0]);
});

it("keeps development game previews using the locally applied catalog", async () => {
  expect(await boot(true, "")).toBe(mocks.Game);
  expect(mocks.initialize).toHaveBeenCalledOnce();
});

it("ignores config query parameters and local editor overrides in production", async () => {
  expect(await boot(false, "?config=1")).toBe(mocks.Game);
  expect(mocks.initialize).not.toHaveBeenCalled();
});
