import {afterEach, describe, expect, it, vi} from "vitest";
import {requestUrl} from "obsidian";
import {ServerProcessor} from "../src/processors/serverProcessor";
import {DebouncedProcessors} from "../src/processors/debouncedProcessors";
import {createPlugin} from "./helpers";

function response(label: string) {
    return {status: 200, text: '<svg xmlns="http://www.w3.org/2000/svg"><text>' + label + '</text></svg>',
        headers: {}, arrayBuffer: new ArrayBuffer(0), json: null};
}

describe("overlapping online SVG requests", () => {
    afterEach(() => vi.useRealTimers());

    it.each(["success", "failure"])("ignores a late %s after the edited diagram is visible", async outcome => {
        vi.useFakeTimers();
        const plugin = createPlugin({settings: {codeBlockProcessor: "svg", debounce: 1}});
        plugin.serverProcessor = new ServerProcessor(plugin);
        const processors = new DebouncedProcessors(plugin);
        const container = document.createElement("div");
        const ctx = {sourcePath: "Note.md"};
        let finishOld!: () => void;
        vi.mocked(requestUrl).mockImplementationOnce(() => new Promise((resolve, reject) => {
            finishOld = () => outcome === "success" ? resolve(response("A")) : reject(new Error("offline"));
        })).mockResolvedValueOnce(response("B"));
        const old = processors.codeBlock("Alice -> Bob: A", container, ctx);
        await processors.codeBlock("Alice -> Bob: B", container, ctx);
        await vi.advanceTimersByTimeAsync(1000);
        expect(container.querySelector("svg text")?.textContent).toBe("B");
        finishOld();
        await old;
        expect(container.querySelector("svg text")?.textContent).toBe("B");
        expect(container.querySelector(".mod-error")).toBeNull();
    });
});
