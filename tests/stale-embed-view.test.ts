import {describe, expect, it, vi} from "vitest";
import type {MarkdownView, WorkspaceLeaf} from "obsidian";
import {hasStaleEmbed, markCurrentEmbed, refreshStaleEmbedView} from "../src/staleEmbedView";

describe("refreshing pre-upgrade embeds", () => {
    it("only rebuilds a stale view on request after saving, with no open editor or conflict", async () => {
        const containerEl = document.createElement("div");
        const root = containerEl.createDiv({cls: "plantuml-embed"});
        root.dataset.plantumlSourcePath = "A/test.puml";
        const status = root.createDiv({attr: {role: "status"}});
        const save = vi.fn(async () => {});
        const view = {containerEl, file: {}, save} as unknown as MarkdownView;
        const leaf = {view, rebuildView: vi.fn(() => {expect(save).toHaveBeenCalledOnce();})};
        const refresh = () => refreshStaleEmbedView(leaf as unknown as WorkspaceLeaf, view);
        root.dataset.plantumlCompareLayout = "side";
        await refresh();
        root.dataset.plantumlCompareLayout = "none";
        status.textContent = "暂停保存";
        await refresh();
        expect(save).not.toHaveBeenCalled();
        status.textContent = "已保存";
        await refresh();
        expect(leaf.rebuildView).toHaveBeenCalledOnce();
        markCurrentEmbed(root);
        expect(hasStaleEmbed(containerEl)).toBe(false);
    });
});
