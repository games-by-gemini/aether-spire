import type { Backend } from "./types.js";
export type IndexedDBOptions = {
    factory?: IDBFactory | null;
    player?: string;
    persist?: boolean;
    reopenWait?: number;
};
export declare function indexedDBBackend(options?: IndexedDBOptions): Backend & {
    close(): void;
};
