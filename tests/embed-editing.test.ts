import {EditorView} from "@codemirror/view";
import {TFile} from "obsidian";
import {describe, expect, it, vi} from "vitest";
import {PumlEmbed} from "../src/embed";
import {createPlugin} from "./helpers";

async function setup() {
    const plugin = createPlugin();
    const file = Object.assign(new TFile(), {path: "B/Shared.puml"});
    let disk = "draft";
    const storage = new Map<string, unknown>();
    Object.assign(plugin.app, {
        loadLocalStorage: (key: string) => storage.get(key),
        saveLocalStorage: (key: string, value: unknown) => storage.set(key, value),
    });
    Object.assign(plugin.app.vault, {
        cachedRead: async () => disk, read: async () => disk, getAbstractFileByPath: () => file,
        process: async (target: TFile, transform: (data: string) => string) => {
            expect(target).toBe(file);
            return disk = transform(disk);
        },
    });
    plugin.debouncedProcessor = {default: vi.fn()} as never;
    const mount = async () => {
        const containerEl = document.body.createDiv();
        const embed = new PumlEmbed(plugin, file, {app: plugin.app, containerEl});
        await embed.loadFile();
        const root = containerEl.querySelector<HTMLElement>(".plantuml-embed")!;
        function layout(value: string, target: HTMLElement = root) {
            target.dispatchEvent(new CustomEvent("plantuml-embed-layout", {bubbles: true, detail: {layout: value}}));
        }
        return {root, layout, embed};
    };
    return {...await mount(), mount, plugin, disk: () => disk, external: (value: string) => {disk = value;}};
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

    it("opens the source only after the last edit in a pending save chain reaches disk", async () => {
        const {root, layout, disk, embed, plugin} = await setup();
        const opened: string[] = [];
        Object.assign(plugin.app.workspace, {getLeaf: () => ({openFile: () => opened.push(disk())})});
        const process = plugin.app.vault.process.bind(plugin.app.vault);
        let release!: () => void;
        const gate = new Promise<void>(r => {release = r;});
        vi.spyOn(plugin.app.vault, "process").mockImplementation(async (...args) => {
            await gate;
            return process(...args);
        });
        layout("inline");
        const view = EditorView.findFromDOM(root.querySelector(".cm-content")!)!;
        view.dispatch({changes: {from: 5, insert: "1"}});
        root.querySelector<HTMLButtonElement>(".plantuml-open-source")!.click();
        await vi.waitFor(() => expect(plugin.app.vault.process).toHaveBeenCalledOnce());
        view.dispatch({changes: {from: 6, insert: "2"}});
        expect(opened).toEqual([]);
        release();
        await vi.waitFor(() => expect(opened).toEqual(["draft12"]));
        embed.onunload();
    });

    it("restores the latest conflict draft after remount without writing the source", async () => {
        const {root, layout, disk, external, embed, plugin, mount} = await setup();
        layout("side");
        const view = EditorView.findFromDOM(root.querySelector(".cm-content")!)!;
        view.dispatch({changes: {from: 0, to: 5, insert: "local"}});
        external("external");
        root.querySelector<HTMLButtonElement>(".plantuml-open-source")!.click();
        await vi.waitFor(() => expect(root.querySelector("[role=status]")?.textContent).toContain("暂停保存"));
        view.dispatch({changes: {from: 5, insert: " latest"}});
        layout("none");
        embed.onunload();

        const reopened = await mount();
        reopened.root.querySelector<HTMLButtonElement>(".plantuml-embed-recovery button")!.click();
        await vi.waitFor(() => expect(reopened.root.querySelector(".cm-content")?.textContent).toBe("local latest"));
        expect(reopened.root.querySelector("[role=status]")?.textContent).toContain("暂停保存");
        expect(disk()).toBe("external");
        expect(plugin.app.workspace.getLeaf).not.toHaveBeenCalled();

        reopened.root.querySelector<HTMLButtonElement>("[role=status] button")!.click();
        await vi.waitFor(() => expect(reopened.root.querySelector(".cm-content")?.textContent).toBe("external"));
        reopened.embed.onunload();
        const clean = await mount();
        expect(clean.root.querySelector(".plantuml-embed-recovery button")).toBeNull();
        expect(disk()).toBe("external");
        clean.embed.onunload();
    });

    it("does not overwrite an external write racing the pending save; keeps the local draft", async () => {
        const {root, layout, disk, external, embed, plugin} = await setup();
        layout("inline");
        const view = EditorView.findFromDOM(root.querySelector(".cm-content")!)!;
        view.dispatch({changes: {from: 0, to: 5, insert: "local"}});
        external("external");
        root.querySelector<HTMLButtonElement>(".plantuml-open-source")!.click();
        await vi.waitFor(() => expect(root.querySelector("[role=status]")?.textContent).toContain("暂停保存"));
        expect(plugin.app.workspace.getLeaf).not.toHaveBeenCalled();
        expect(disk()).toBe("external");
        expect(view.state.doc.toString()).toBe("local");
        embed.onunload();
    });
});
