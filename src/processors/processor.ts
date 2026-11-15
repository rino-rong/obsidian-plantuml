import {MarkdownPostProcessorContext} from "obsidian";

/**
 * the part of the post processor context the processors rely on,
 * so that embeds, the file view and hover previews can supply it as well
 */
export type ProcessorContext = Pick<MarkdownPostProcessorContext, "sourcePath"> & {
    // Editable embeds keep their last successful diagram when rendering fails.
    onPreviewResult?: (ok: boolean) => void;
};

export interface Processor {
    svg: (source: string, el: HTMLElement, ctx: ProcessorContext) => Promise<void>;
    png: (source: string, el: HTMLElement, ctx: ProcessorContext) => Promise<void>;
    ascii: (source: string, el: HTMLElement, ctx: ProcessorContext) => Promise<void>;
}
