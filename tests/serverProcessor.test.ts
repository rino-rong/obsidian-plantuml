import {describe, expect, it, vi} from "vitest";
import {request, requestUrl} from "obsidian";
import * as plantuml from "plantuml-encoder";
import {ServerProcessor} from "../src/processors/serverProcessor";
import {createPlugin, setTheme} from "./helpers";

const SOURCE = "@startuml\nA -> B\n@enduml";

describe("ServerProcessor", () => {
    it.each([200, 400])("shares an in-flight response (%i) but not the DOM or future requests", async status => {
        const server = new ServerProcessor(createPlugin());
        const ctx = {sourcePath: "Note.md"};
        const a = document.createElement("div"), b = document.createElement("div");
        let release!: () => void;
        const gate = new Promise<void>(r => { release = r; });
        const body = {status, text: '<svg xmlns="http://www.w3.org/2000/svg"><text>result</text></svg>'};
        vi.mocked(requestUrl).mockImplementation(async () => {
            await gate;
            return body as Awaited<ReturnType<typeof requestUrl>>;
        });
        const first = server.svg(SOURCE, a, ctx), second = server.svg(SOURCE, b, ctx);
        release();
        await Promise.all([first, second]);
        expect(requestUrl).toHaveBeenCalledTimes(1);
        expect(a.textContent).toBe("result");
        expect(b.textContent).toBe("result");
        expect(a.firstChild).not.toBe(b.firstChild);
        for (const el of [a, b]) expect(el.dataset.plantumlRenderError).toBe(status === 400 ? "400" : undefined);
        await server.svg(SOURCE, document.createElement("div"), ctx);
        expect(requestUrl).toHaveBeenCalledTimes(2);
    });

    it("requests the svg from the configured server", async () => {
        const plugin = createPlugin({settings: {server_url: "http://localhost:8080"}});
        vi.mocked(requestUrl).mockResolvedValue({text: '<svg xmlns="http://www.w3.org/2000/svg"></svg>'} as Awaited<ReturnType<typeof requestUrl>>);
        const el = document.createElement("div");

        await new ServerProcessor(plugin).svg(SOURCE, el, {sourcePath: "Note.md"});
        await vi.waitFor(() => expect(el.querySelector("svg")).not.toBeNull());

        expect(requestUrl).toHaveBeenCalledWith({
            url: "http://localhost:8080/svg/" + plantuml.encode(SOURCE),
            method: "GET",
            throw: false,
        });
    });

    it("uses the png endpoint plus the image map", async () => {
        const plugin = createPlugin({settings: {server_url: "http://localhost:8080"}});
        vi.mocked(request).mockResolvedValue("");
        setTheme("light");
        const el = document.createElement("div");

        await new ServerProcessor(plugin).png(SOURCE, el, {sourcePath: "Note.md"});

        const encoded = plantuml.encode(SOURCE);
        expect(el.querySelector("img")?.getAttribute("src")).toBe("http://localhost:8080/png/" + encoded);
        expect(request).toHaveBeenCalledWith({url: "http://localhost:8080/map/" + encoded, method: "GET"});
    });
});
