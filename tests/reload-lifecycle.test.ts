import {describe, expect, it, vi} from "vitest";
import PlantumlPlugin from "../src/main";
import {DiagramCache} from "../src/cache";
import {createPlugin} from "./helpers";

vi.mock("localforage", () => ({default: {config: vi.fn()}}));

describe("disabling PlantUML during startup", () => {
    it.each(["settings", "migration", "expiry"])("does not resume registration after stopping during %s", async phase => {
        const {app} = createPlugin();
        const embeds = {registerExtensions: vi.fn(), unregisterExtensions: vi.fn()};
        Object.assign(app, {embedRegistry: embeds});
        Object.assign(app.vault, {on: vi.fn()});
        let release!: () => void;
        const gate = new Promise<void>(resolve => {release = resolve});
        const pause = async (step: string) => {if (phase === step) await gate};
        const plugin = new PlantumlPlugin(app, {} as never);
        const settings = vi.spyOn(plugin, "loadSettings").mockImplementation(async () => {
            plugin.settings = createPlugin().settings;
            await pause("settings");
        });
        const migrate = vi.spyOn(DiagramCache.prototype, "migrateFromV1").mockImplementation(() => pause("migration"));
        const expire = vi.spyOn(DiagramCache.prototype, "evictExpired").mockImplementation(() => pause("expiry"));
        try {
            const loading = plugin.onload();
            await vi.waitFor(() => expect(({settings, migration: migrate, expiry: expire})[phase]).toHaveBeenCalled());
            expect(() => plugin.onunload()).not.toThrow();
            release();
            await loading;
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(plugin.observer).toBeUndefined();
            expect(app.vault.on).not.toHaveBeenCalled();
            expect(embeds.registerExtensions).toHaveBeenCalledTimes(phase === "settings" ? 0 : 1);
            expect(embeds.unregisterExtensions).toHaveBeenCalledTimes(phase === "settings" ? 0 : 1);
            if (phase !== "expiry") expect(expire).not.toHaveBeenCalled();
        } finally {
            release();
            vi.restoreAllMocks();
        }
    });
});
