import {describe, expect, it, vi} from "vitest";
import {TFile} from "obsidian";
import {PumlEmbed} from "../src/embed";
import {createPlugin} from "./helpers";

describe("PlantUML embed actions", () => {
    it("opens the resolved file and preserves partner actions across renders", async () => {
        const plugin = createPlugin();
        const openFile = vi.fn();
        Object.assign(plugin.app.workspace, {getLeaf: () => ({openFile})});
        plugin.app.vault.cachedRead = vi.fn(async file => file.path);
        plugin.debouncedProcessor = {default: async (source: string, target: HTMLElement) => {
            target.replaceChildren(document.createTextNode(source));
        }} as never;
        for (const path of ["A/Shared.puml", "B/Shared.puml"]) {
            const containerEl = document.createElement("div");
            const file = new TFile(path);
            const embed = new PumlEmbed(plugin, file, {app: plugin.app, containerEl});
            await embed.loadFile();
            const root = containerEl.querySelector<HTMLElement>("[data-plantuml-source-path]")!;
            expect(root?.dataset.plantumlSourcePath).toBe(path);
            const actions = root.querySelector(":scope > .plantuml-embed-actions")!;
            const partner = actions.appendChild(document.createElement("button"));
            await embed.loadFile();
            expect(root.querySelectorAll(".plantuml-embed-actions")).toHaveLength(1);
            expect(partner.parentElement).toBe(actions);
            expect(root.contains(partner)).toBe(true);
            expect(root.querySelectorAll(".plantuml-open-source")).toHaveLength(1);
            root.querySelector<HTMLButtonElement>(".plantuml-open-source")!.click();
            expect(openFile.mock.lastCall?.[0]).toBe(file);
        }
    });
});
