import type { BackendStatus } from "../rules.js";
export type Scope = {
    game: string;
    channel: string;
};
export type SaveRecord = {
    name: string;
    data: string;
    version: string | null;
    savedAt: string;
    size: number;
    revision: number;
};
export type NewRecord = Omit<SaveRecord, "revision">;
export type Change = {
    name: string;
    record: SaveRecord | null;
    revision: number;
};
export interface Backend {
    status(): BackendStatus;
    list(scope: Scope): Promise<SaveRecord[]>;
    get(scope: Scope, name: string): Promise<SaveRecord | null>;
    change(scope: Scope, name: string, decide: (saves: SaveRecord[]) => NewRecord | null, source: string): Promise<Change | null>;
    touch(scope: Scope, at: string): Promise<void>;
    subscribe(scope: Scope, listener: (change: Change, source: string) => void): () => void;
}
