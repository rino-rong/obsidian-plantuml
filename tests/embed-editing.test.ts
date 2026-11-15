import {EditorView} from "@codemirror/view";
import {TFile} from "obsidian";
import {describe, expect, it, vi} from "vitest";
import {PumlEmbed} from "../src/embed";
import {createPlugin} from "./helpers";

async function setup() {
    const plugin = createPlugin();
    const file = Object.assign(new TFile(), {path: "B/Shared.puml"});
    let disk = "draft";
    Object.assign(plugin.app.vault, {
        cachedRead: async () => disk, read: async () => disk, getAbstractFileByPath: () => file,
        process: async (target: TFile, transform: (data: string) => string) => {
            expect(target).toBe(file);
            return disk = transform(disk);
        },
    });
    plugin.debouncedProcessor = {default: vi.fn()} as never;
    const containerEl = document.body.createDiv();
    const embed = new PumlEmbed(plugin, file, {app: plugin.app, containerEl});
    await embed.loadFile();
    const root = containerEl.querySelector<HTMLElement>(".plantuml-embed")!;
    function layout(value: string, target: HTMLElement = root) {
        target.dispatchEvent(new CustomEvent("plantuml-embed-layout", {bubbles: true, detail: {layout: value}}));
    }
    return {root, layout, disk: () => disk, external: (value: string) => {disk = value;}, embed};
}

describe("editing the resolved embed file", () => {
    it("only accepts root layout events and flushes the same editor on collapse", async () => {
        const {root, layout, disk, embed} = await setup();
        layout("side", root.querySelector("button")!);
        expect(root.dataset.plantumlCompareLayout).toBe("none");
        layout("inline");
        const view = EditorView.findFromDOM(root.querySelector(".cm-content")!)!;
        view.dispatch({changes: {from: 5, insert: " update"}});
        layout("side");
        expect(EditorView.findFromDOM(root.querySelector(".cm-content")!)).toBe(view);
        layout("none");
        await vi.waitFor(() => expect(disk()).toBe("draft update"));
        embed.onunload();
    });

    it("does not overwrite an external write racing the pending save; keeps the local draft", async () => {
        const {root, layout, disk, external, embed} = await setup();
        layout("inline");
        const view = EditorView.findFromDOM(root.querySelector(".cm-content")!)!;
        view.dispatch({changes: {from: 0, to: 5, insert: "local"}});
        external("external");
        layout("none");
        await vi.waitFor(() => expect(root.querySelector("[role=status]")?.textContent).toContain("暂停保存"));
        expect(disk()).toBe("external");
        expect(view.state.doc.toString()).toBe("local");
        embed.onunload();
    });
});
