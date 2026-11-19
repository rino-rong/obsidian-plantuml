import {listDrafts, removeDraft, storeDraft} from "./conflictDrafts";
import {markCurrentEmbed} from "./staleEmbedView";
import {EditorState} from "@codemirror/state";
import {EditorView, keymap} from "@codemirror/view";
import {defaultKeymap, history, historyKeymap} from "@codemirror/commands";
import {Component, EmbedChild, EmbedContext, Notice, setIcon, TFile} from "obsidian";
import PlantumlPlugin from "./main";

type Layout = "none" | "inline" | "side";

// Obsidian can replace the entire Markdown embed after a vault write.
// Retain an active surface briefly across that replacement, scoped to the
// Markdown view, host document, target TFile, and occurrence in that view.
const active = new WeakMap<HTMLElement, Map<string, EmbedSurface>>();

class EmbedSurface {
    private root: HTMLElement;
    private diagram: HTMLElement;
    private panel: HTMLElement;
    private pathLabel: HTMLElement;
    private message: HTMLElement;
    private recovery: HTMLElement;
    private conflictDraft?: {id: string; path: string};
    private draftWarning?: HTMLElement;
    private editor?: EditorView;
    private editorHost: HTMLElement;
    private get draft(): string { return this.editor?.state.sliceDoc() ?? this.base ?? ""; }
    private sourceButton: HTMLButtonElement;
    private revision = 0;
    private base?: string;
    private timer?: number;
    private saving?: Promise<void>;
    private blocked = false;
    private previewFailed = false;
    private opening = false;
    private disposed = false;
    private slot?: {map: Map<string, EmbedSurface>; key: string};
    private expiry?: number;
    private restoreFocus = false;
    private mountObserver?: MutationObserver;
    private retired = false;
    owner?: PumlEmbed;

    constructor(private plugin: PlantumlPlugin, private file: TFile, ctx: EmbedContext) {

        this.root = ctx.containerEl.createDiv({cls: "plantuml-embed"});
        markCurrentEmbed(this.root);
        this.root.dataset.plantumlCompareLayout = "none";
        const bar = this.root.createDiv({cls: "plantuml-embed-actions"});
        this.sourceButton = bar.createEl("button", {
            cls: "clickable-icon plantuml-open-source", attr: {type: "button"},
        });
        setIcon(this.sourceButton, "code-xml");
        this.sourceButton.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            void this.openSource();
        });
        this.panel = this.root.createDiv({cls: "plantuml-embed-editor"});
        this.pathLabel = this.panel.createEl("small");
        this.editorHost = this.panel.createDiv({cls: "plantuml-embed-code"});
        for (const name of ["keydown", "mousedown", "click", "beforeinput"])
            this.editorHost.addEventListener(name, event => event.stopPropagation());
        this.message = this.panel.createDiv({attr: {role: "status"}});
        this.recovery = this.root.createDiv({cls: "plantuml-embed-recovery"});
        this.updatePath();
        this.diagram = this.root.createDiv({cls: "plantuml-embed-diagram"});
        this.root.addEventListener("plantuml-embed-layout", event => {
            if (event.target !== this.root) return;
            const layout: Layout = (event as CustomEvent<{layout?: Layout}>).detail?.layout;
            if (!["none", "inline", "side"].includes(layout)) return;
            this.root.dataset.plantumlCompareLayout = layout;
            this.remember();
            this.showRecovery();
            if (layout === "none") void this.flush();
            else if (this.base !== undefined) this.ensureEditor().focus();
        });
    }

    private ensureEditor(data = this.base ?? ""): EditorView {
        if (this.editor) return this.editor;
        this.editor = new EditorView({
            parent: this.editorHost,
            state: EditorState.create({doc: data, extensions: [
                EditorState.lineSeparator.of(data.includes("\r\n") ? "\r\n" : "\n"),
                history(), keymap.of([...historyKeymap, ...defaultKeymap]), EditorView.lineWrapping,
                EditorView.contentAttributes.of({"aria-label": "编辑源文件", role: "textbox", "aria-multiline": "true"}),
                EditorView.updateListener.of(update => {
                    if (!update.docChanged || this.loading) return;
                    this.revision++;
                    void this.render(this.draft);
                    if (this.blocked) {
                        this.preserveDraft();
                        return;
                    }
                    this.message.textContent = "待保存";
                    this.cancelTimer();
                    this.timer = window.setTimeout((): void => { void this.flush(); }, 400);
                }),
            ]}),
        });
        this.editor.contentDOM.addEventListener("focus", (): void => { this.restoreFocus = true; });
        this.editor.contentDOM.addEventListener("blur", event => {
            if (event.relatedTarget) this.restoreFocus = false;
            void this.flush();
        });
        return this.editor;
    }

    private loading = false;
    private resetEditor(data: string) {
        this.base = data;
        this.replaceEditor(data);
    }

    private replaceEditor(data: string) {
        if (this.editor && this.draft !== data) {
            // External changes establish a new undo baseline.
            this.loading = true;
            try {
                this.editor.destroy();
                this.editor = undefined;
                this.ensureEditor(data);
            } finally { this.loading = false; }
        }
    }

    private location() {
        const view = this.root.closest<HTMLElement>(".markdown-reading-view, .markdown-source-view");
        const leaf = this.plugin.app.workspace.getLeavesOfType("markdown").find(l => l.view.containerEl.contains(view));
        if (!view || !leaf) return;
        const host = leaf.view.getState().file;
        const matches = Array.from(view.querySelectorAll<HTMLElement>(".plantuml-embed"))
            .filter(r => r.dataset.plantumlSourcePath === this.file.path);
        const index = matches.indexOf(this.root);
        if (index < 0 || typeof host !== "string") return;
        const map = active.get(view) ?? new Map<string, EmbedSurface>();
        active.set(view, map);
        return {map, key: JSON.stringify([host, this.file.path, index])};
    }

    private remember() {
        const slot = this.location();
        if (!slot) return;
        this.forget();
        slot.map.set(slot.key, this);
        this.slot = slot;
    }

    private forget() {
        if (this.slot?.map.get(this.slot.key) === this) this.slot.map.delete(this.slot.key);
        this.slot = undefined;
    }

    attach(adopt: (surface: EmbedSurface) => void) {
        const claim = () => {
            if (!this.root.isConnected) return;
            this.mountObserver?.disconnect();
            const slot = this.location();
            const old = slot?.map.get(slot.key);
            if (!old || old === this || old.file !== this.file || old.root.isConnected) return;
            window.clearTimeout(old.expiry);
            old.retired = false;
            this.root.replaceWith(old.root);
            this.disposed = true;
            adopt(old);
            if (old.restoreFocus && old.root.dataset.plantumlCompareLayout !== "none")
                old.editor?.focus();
            void old.loadFile();
        };
        if (this.root.isConnected) claim();
        else {
            this.mountObserver = new MutationObserver(claim);
            this.mountObserver.observe(this.root.ownerDocument.body, {subtree: true, childList: true});
        }
    }

    release() {
        this.mountObserver?.disconnect();
        this.revision++;
        this.retired = true;
        this.root.remove();
        void this.flush();
        const expire = () => {
            if (!this.retired) return;
            this.disposed = true;
            this.editor?.destroy();
            this.forget();
        };
        if (this.slot) this.expiry = window.setTimeout(expire, 1500);
        else expire();
    }

    updatePath() {
        const path = this.file.path;
        this.root.dataset.plantumlSourcePath = path;
        this.pathLabel.textContent = path;
        if (this.slot && this.root.isConnected) this.remember();
        this.sourceButton.title = "编辑源文件：" + path + "（在新标签打开）";
        this.sourceButton.setAttribute("aria-label", this.sourceButton.title);
    }

    private async openSource() {
        if (this.opening) return;
        this.opening = true;
        try {
            while (!this.blocked) {
                const pending = this.flush();
                if (pending === undefined) break;
                await pending;
            }
            if (!this.blocked) await this.plugin.app.workspace.getLeaf("tab").openFile(this.file, {state: {mode: "source"}});
            else new Notice("源文件尚未同步，请先处理保存提示");
        } catch (error) {
            new Notice(error instanceof Error ? error.message : "无法打开图源");
        } finally {
            this.opening = false;
        }
    }

    private updateStatus() {
        if (this.blocked) return;
        const saved = this.draft === this.base;
        this.message.textContent = this.previewFailed
            ? (saved ? "源码已保存 · 预览未更新" : "待保存 · 预览未更新")
            : (saved ? "已保存" : "待保存");
    }

    private render(data: string) {
        return this.plugin.debouncedProcessor.default(data, this.diagram, {
            sourcePath: this.file.path,
            onPreviewResult: ok => {
                if (this.disposed || data !== this.draft) return;
                this.previewFailed = !ok;
                this.updateStatus();
            },
        });
    }

    private cancelTimer() {
        window.clearTimeout(this.timer);
        this.timer = undefined;
    }

    // Serialize writes and compare within Vault.process, not in a separate read.
    private flush(): Promise<void> | undefined {
        this.cancelTimer();
        if (this.saving !== undefined || this.blocked || this.base === undefined || this.draft === this.base) return this.saving;
        const expected = this.base, next = this.draft;
        const vault = this.plugin.app.vault;
        this.saving = Promise.resolve().then(() => {
            if (vault.getAbstractFileByPath(this.file.path) !== this.file) throw Error("源文件已移除");
            return vault.process(this.file, disk => {
                if (disk !== expected && disk !== next) throw Error("源文件已在别处修改");
                return next;
            });
        }).then(() => {
            this.base = next;
            this.updateStatus();
        }).catch((error: unknown) => {
            this.conflict(error instanceof Error ? error.message : "保存失败");
        }).finally(() => {
            this.saving = undefined;
            if (!this.blocked && this.base !== this.draft) void this.flush();
        });
        return this.saving;
    }

    private preserveDraft() {
        const record = this.conflictDraft ??= {path: this.file.path, id: this.root.ownerDocument.defaultView?.crypto.randomUUID() ?? activeWindow.crypto.randomUUID()};
        try {
            storeDraft(this.plugin.app, record.path, {id: record.id, text: this.draft, updatedAt: Date.now()});
            this.draftWarning?.remove();
            this.draftWarning = undefined;
        } catch {
            this.draftWarning ??= this.message.createDiv({text: "无法保存恢复草稿，请在关闭前复制源码。"});
        }
    }

    private showRecovery() {
        this.recovery.empty();
        let drafts;
        try {
            drafts = listDrafts(this.plugin.app, this.file.path);
        } catch {
            return;
        }
        for (const [index, draft] of drafts.entries()) {
            const button = this.recovery.createEl("button", {
                text: drafts.length === 1 ? "恢复冲突草稿" : `恢复冲突草稿 ${index + 1}`,
                attr: {type: "button", title: new Date(draft.updatedAt).toLocaleString()},
            });
            button.addEventListener("click", event => {
                event.stopPropagation();
                if (this.conflictDraft?.id === draft.id) {
                    this.root.dispatchEvent(new CustomEvent("plantuml-embed-layout", {detail: {layout: "side"}}));
                } else {
                    void this.restoreDraft(draft.id).catch(() => new Notice("无法恢复冲突草稿"));
                }
            });
        }
    }

    private async restoreDraft(id: string) {
        if (this.blocked || this.draft !== this.base || this.saving !== undefined) {
            new Notice("请先处理当前编辑器的草稿。");
            return;
        }
        const path = this.file.path;
        const disk = await this.plugin.app.vault.read(this.file);
        if (this.disposed || this.blocked || this.draft !== this.base || this.saving !== undefined || path !== this.file.path) return;
        const record = listDrafts(this.plugin.app, path).find(draft => draft.id === id);
        if (!record) {
            this.showRecovery();
            return;
        }
        this.conflictDraft = {path, id};
        this.base = disk;
        this.ensureEditor();
        this.replaceEditor(record.text);
        this.conflict("已恢复冲突草稿，磁盘内容仍保留");
        this.root.dispatchEvent(new CustomEvent("plantuml-embed-layout", {detail: {layout: "side"}}));
        await this.render(record.text);
    }

    private conflict(reason: string) {
        if (this.blocked) return;
        this.blocked = true;
        this.cancelTimer();
        this.message.textContent = reason + "；已暂停保存。请复制需要保留的草稿，再重新载入源文件。";
        this.preserveDraft();
        this.showRecovery();
        new Notice(this.file.path + "：" + this.message.textContent);
        const reload = this.message.createEl("button", {text: "放弃草稿并重新载入", attr: {type: "button"}});
        const discardAndReload = async () => {
            const vault = this.plugin.app.vault;
            if (vault.getAbstractFileByPath(this.file.path) !== this.file) return;
            const draft = this.draft;
            const data = await vault.read(this.file);
            if (this.disposed || this.draft !== draft) return;
            if (this.conflictDraft) removeDraft(this.plugin.app, this.conflictDraft.path, this.conflictDraft.id);
            this.conflictDraft = undefined;
            this.draftWarning = undefined;
            this.blocked = false;
            this.resetEditor(data);
            this.showRecovery();
            this.message.empty();
            await this.render(data);
        };
        reload.addEventListener("click", () => { void discardAndReload().catch(() => new Notice("重新载入失败，草稿已保留")); });
    }

    async loadFile() {
        const revision = ++this.revision;
        const data = await this.plugin.app.vault.cachedRead(this.file);
        if (revision !== this.revision || this.disposed || this.blocked || this.saving !== undefined) return;
        if (this.base !== undefined && this.draft !== this.base) {
            if (data !== this.base && data !== this.draft) this.conflict("源文件已在别处修改");
            return;
        }
        this.resetEditor(data);
        this.showRecovery();
        if (this.root.dataset.plantumlCompareLayout !== "none") this.ensureEditor();
        this.updatePath();
        await this.render(data);
    }
}

export class PumlEmbed extends Component implements EmbedChild {
    private surface: EmbedSurface;

    constructor(private plugin: PlantumlPlugin, private file: TFile, ctx: EmbedContext) {
        super();
        this.surface = new EmbedSurface(plugin, file, ctx);
    }

    onload() {
        this.surface.owner = this;
        this.surface.attach(existing => { this.surface = existing; existing.owner = this; });
        const vault = this.plugin.app.vault;
        this.registerEvent(vault.on("rename", () => this.surface.updatePath()));
        this.registerEvent(vault.on("modify", file => {
            if (file === this.file) void this.surface.loadFile();
        }));
    }

    onunload() { if (this.surface.owner === this) this.surface.release(); }

    loadFile() { return this.surface.loadFile(); }
}
