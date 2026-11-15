import {Component, EmbedChild, EmbedContext, setIcon, TFile} from "obsidian";
import PlantumlPlugin from "./main";

export class PumlEmbed extends Component implements EmbedChild {
    private root: HTMLElement;
    private diagram: HTMLElement;
    private revision = 0;

    constructor(private plugin: PlantumlPlugin, private file: TFile, ctx: EmbedContext) {
        super();
        this.root = ctx.containerEl.createDiv({cls: "plantuml-embed"});
        this.root.dataset.plantumlSourcePath = file.path;
        const bar = this.root.createDiv({cls: "plantuml-embed-actions"});
        const button = bar.createEl("button", {
            cls: "clickable-icon plantuml-open-source",
            attr: {type: "button", "aria-label": "打开图源", title: "打开图源"},
        });
        setIcon(button, "file-pen-line");
        button.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            void this.plugin.app.workspace.getLeaf("tab").openFile(this.file, {state: {mode: "source"}});
        });
        // Renderers may replace every child of this element. Keep shared actions outside it.
        this.diagram = this.root.createDiv({cls: "plantuml-embed-diagram"});
    }

    onload() {
        this.registerEvent(this.plugin.app.vault.on("rename", () => {
            this.root.dataset.plantumlSourcePath = this.file.path;
        }));
    }

    onunload() {
        this.revision++;
        this.root.remove();
    }

    async loadFile() {
        const revision = ++this.revision;
        const data = await this.plugin.app.vault.cachedRead(this.file);
        if (revision !== this.revision) return;
        this.root.dataset.plantumlSourcePath = this.file.path;
        await this.plugin.debouncedProcessor.default(data, this.diagram, {sourcePath: this.file.path});
    }
}
