import {describe, expect, it, vi} from "vitest";
import {requestUrl} from "obsidian";
import PlantumlPlugin from "../src/main";
import {createPlugin, setTheme} from "./helpers";

vi.mock("localforage", () => {
    const api = {config: vi.fn(), iterate: vi.fn(async () => undefined)};
    return {...api, default: api};
});

describe("theme changes with an open diagram", () => {
    it("updates the existing block light → dark → light without rendering twice for unrelated CSS changes", async () => {
        const {app} = createPlugin();
        const events = new EventTarget();
        Object.assign(app.workspace, {
            on: (name: string, cb: () => void) => events.addEventListener(name, cb),
            iterateAllLeaves: () => undefined,
        });
        Object.assign(app, {embedRegistry: {registerExtensions: vi.fn(), unregisterExtensions: vi.fn()}});
        Object.assign(app.vault, {on: vi.fn()});
        const plugin = new PlantumlPlugin(app, {} as never);
        vi.spyOn(plugin, "loadData").mockResolvedValue({debounce: 0, codeBlockProcessor: "svg"});
        const urls: string[] = [];
        vi.mocked(requestUrl).mockImplementation((async ({url}: {url: string}) => {
            urls.push(url);
            return {text: '<svg xmlns="http://www.w3.org/2000/svg"><text>' +
                (url.includes("/dsvg/") ? "dark" : "light") + '</text></svg>'};
        }) as typeof requestUrl);
        plugin.onload();
        await vi.waitFor(() => expect(plugin.observer).toBeDefined());
        const el = document.body.createDiv();
        const refresh = () => events.dispatchEvent(new Event("css-change"));
        try {
            setTheme("light");
            await plugin.debouncedProcessor.codeBlock("A -> B", el, {sourcePath: "Test.md"});
            expect(el.querySelector("svg text")?.textContent).toBe("light");
            for (const theme of ["dark", "light"] as const) {
                setTheme(theme);
                refresh();
                refresh();
                await vi.waitFor(() => expect(el.querySelector("svg text")?.textContent).toBe(theme));
            }
            expect(urls.map(url => url.includes("/dsvg/"))).toEqual([false, true, false]);
        } finally {
            plugin.onunload();
        }
    });
});
