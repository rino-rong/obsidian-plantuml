import type {App} from "obsidian";

export type ConflictDraft = {id: string; text: string; updatedAt: number};

function storageKey(path: string) {
    return "obsidian-plantuml:conflict-drafts:" + path;
}

export function listDrafts(app: App, path: string): ConflictDraft[] {
    const value: unknown = app.loadLocalStorage(storageKey(path));
    if (!Array.isArray(value)) return [];
    return value.filter((draft: unknown): draft is ConflictDraft =>
        typeof draft === "object" && draft !== null
        && "id" in draft && typeof draft.id === "string"
        && "text" in draft && typeof draft.text === "string"
        && "updatedAt" in draft && typeof draft.updatedAt === "number");
}

export function storeDraft(app: App, path: string, draft: ConflictDraft): void {
    const rest = listDrafts(app, path).filter(item => item.id !== draft.id);
    app.saveLocalStorage(storageKey(path), [draft, ...rest]);
}

export function removeDraft(app: App, path: string, id: string): void {
    const rest = listDrafts(app, path).filter(item => item.id !== id);
    app.saveLocalStorage(storageKey(path), rest.length ? rest : null);
}
