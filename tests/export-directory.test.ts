import {describe, expect, it, vi} from "vitest";
import {TFolder} from "obsidian";
import {createPlugin} from "./helpers";
import {DebouncedProcessors} from "../src/processors/debouncedProcessors";

describe.each(["svg", "png"])("%s export location", type => {
    it.each([
        ["exports", "Projects/Notes", "exports"],
        ["", "Projects/Notes", "Projects/Notes"],
        ["", "/", ""],
        ["/exports/", "Projects/Notes", "exports"],
    ])("setting %j and note folder %j produce folder %j", async (setting, parent, expected) => {
        const sourcePath = (parent === "/" ? "" : parent + "/") + "note.md";
        const plugin = createPlugin({settings: {exportPath: setting}, files: [sourcePath]});
        plugin.app.vault.getAbstractFileByPath(sourcePath)!.parent = Object.assign(new TFolder(), {path: parent});
        vi.mocked(plugin.app.vault.adapter.exists).mockResolvedValue(false);
        const processor = new DebouncedProcessors(plugin);
        expect(await processor.getFilePath("@startuml Controller\n@enduml", {sourcePath}, type))
            .toBe((expected ? expected + "/" : "") + "Controller." + type);
        if (setting) expect(plugin.app.vault.createFolder).toHaveBeenCalledWith(expected);
        else expect(plugin.app.vault.createFolder).not.toHaveBeenCalled();
    });
});
