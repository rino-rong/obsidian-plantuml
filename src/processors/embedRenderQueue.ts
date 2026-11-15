type Batch = {timer: number; jobs: Map<HTMLElement, () => void>};

// Only pending work is shared. Saving the same file may enqueue both the
// visible editor and a hidden preview; neither should restart the deadline.
export class EmbedRenderQueue {
    private batches = new Map<string, Batch>();
    private keys = new WeakMap<HTMLElement, string>();

    schedule(el: HTMLElement, key: string, delay: number, run: () => void) {
        if (this.keys.get(el) !== key) this.cancel(el);
        let batch = this.batches.get(key);
        if (!batch) {
            batch = {jobs: new Map(), timer: window.setTimeout(() => this.dispatch(key), delay)};
            this.batches.set(key, batch);
        }
        this.keys.set(el, key);
        batch.jobs.set(el, run);
    }

    cancel(el: HTMLElement) {
        const key = this.keys.get(el);
        if (key === undefined) return;
        const batch = this.batches.get(key);
        this.keys.delete(el);
        if (!batch) return;
        batch.jobs.delete(el);
        if (!batch.jobs.size) {
            window.clearTimeout(batch.timer);
            this.batches.delete(key);
        }
    }

    clear() {
        for (const batch of this.batches.values()) window.clearTimeout(batch.timer);
        this.batches.clear();
        this.keys = new WeakMap();
    }

    private dispatch(key: string) {
        const batch = this.batches.get(key);
        if (!batch) return;
        this.batches.delete(key);
        for (const el of batch.jobs.keys()) this.keys.delete(el);
        for (const run of batch.jobs.values()) run();
    }
}
