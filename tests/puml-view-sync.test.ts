import {afterEach, describe, expect, it, vi} from "vitest";
import type {TFile, WorkspaceLeaf} from "obsidian";
import type PlantumlPlugin from "../src/main";
import {PumlView} from "../src/PumlView";

// Obsidian supplies these optional keymap/search extensions at runtime.
// Keep the real CodeMirror editor, state, transactions and view update listener.
vi.mock("@codemirror/search", () => ({highlightSelectionMatches: () => [], search: () => []}));
vi.mock("@codemirror/commands", () => ({defaultKeymap: [], history: () => [], indentWithTab: {key: "Tab"}}));

const openViews = new Set<PumlView>();
const file = (path: string) => ({path} as TFile);
function open(f: TFile, text: string) {
    const view = new PumlView({} as WorkspaceLeaf, {} as PlantumlPlugin);
    openViews.add(view);
    view.file = f;
    view.setViewData(text, true);
    return view;
}
function close(view: PumlView) {
    openViews.delete(view);
    view.onunload();
}
function append(view: PumlView, text: string) {
    view.editor.dispatch({changes: {from: view.editor.state.doc.length, insert: text}});
}
afterEach(() => {
    for (const view of openViews) close(view);
});

describe("standalone PlantUML editor synchronization", () => {
    // The lightweight TextFileView mock has no app; real views inherit it from Obsidian.
    Object.defineProperty(PumlView.prototype, "app", {configurable: true, value: {vault: {getConfig: () => false}}});

    it("keeps same-named files in different folders independent", () => {
        const a = open(file("a/diagram.puml"), "A");
        const b = open(file("b/diagram.puml"), "B");
        append(a, "1");
        append(b, "2");
        expect([a.getViewData(), b.getViewData()]).toEqual(["A1", "B2"]);
    });

    it.each([0, 1])("syncs both ways and stays editable after split %i closes", index => {
        const f = file("diagram.puml");
        const splits = [open(f, "start"), open(f, "start")];
        append(splits[0], "A");
        expect(splits[1].getViewData()).toBe("startA");
        append(splits[1], "B");
        expect(splits[0].getViewData()).toBe("startAB");
        close(splits[index]);
        append(splits[1 - index], "C");
        expect(splits[1 - index].getViewData()).toBe("startABC");
    });

    it("stops syncing the old file when a pane switches files", () => {
        const f = file("first.puml");
        const a = open(f, "same");
        const b = open(f, "same");
        b.file = file("next.puml");
        b.setViewData("next", true);
        append(b, "!");
        expect(a.getViewData()).toBe("same");
    });
});
