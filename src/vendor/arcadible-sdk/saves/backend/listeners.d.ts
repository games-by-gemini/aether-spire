import type { Change } from "./types.js";
export type Listener = (change: Change, source: string) => void;
export declare function listenersByKey(): {
    add(key: string, listener: Listener): () => void;
    tell(key: string, change: Change, source: string): void;
};
