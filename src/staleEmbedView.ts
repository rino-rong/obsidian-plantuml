import {MarkdownView, Notice, WorkspaceLeaf} from "obsidian";

const roots = ".plantuml-embed[data-plantuml-source-path]";
const current = new WeakSet<Element>();
export function markCurrentEmbed(root: Element): void {
    current.add(root);
}

export function hasStaleEmbed(container: Element): boolean {
    return Array.from(container.querySelectorAll(roots)).some(root => !current.has(root));
}

export function hasBusyEmbed(container: Element): boolean {
    return Array.from(container.querySelectorAll<HTMLElement>(roots)).some(root =>
        (root.dataset.plantumlCompareLayout ?? "none") !== "none"
        || /待保存|暂停保存/.test(root.querySelector("[role=status]")?.textContent ?? ""));
}

// Changing Markdown mode can reuse the old live-preview widgets. Rebuild only on
// explicit request, because replacing a host view also resets its editor history.
export async function refreshStaleEmbedView(leaf: WorkspaceLeaf, view: MarkdownView): Promise<void> {
    const file = view.file;
    const rebuild = (leaf as WorkspaceLeaf & {rebuildView?: () => Promise<void>}).rebuildView;
    if (!rebuild) {
        new Notice("请保存编辑后重新打开库窗口，以刷新旧版引用图。");
        return;
    }
    if (hasBusyEmbed(view.containerEl)) {
        new Notice("请先处理未保存的图源并收起对照编辑，再刷新这篇笔记。");
        return;
    }
    await view.save();
    if (leaf.view !== view || view.file !== file || hasBusyEmbed(view.containerEl) || !hasStaleEmbed(view.containerEl)) return;
    await rebuild.call(leaf);
}
