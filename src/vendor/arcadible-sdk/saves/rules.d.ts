import { ArcadibleError } from "../bus/protocol.js";
export declare const MAX_SAVES = 32;
export declare const MAX_TOTAL: number;
/**
 * Who can read the saves back: every version of the game (`"game"`), only
 * this build (`"build"`), or only until the page closes (`"memory"`). Other
 * values may be added, such as `"account"`: a game treats one it doesn't
 * know as `"game"`.
 */
export type Where = "game" | "build" | "memory" | (string & {});
export type BackendStatus = "device" | "memory";
/** What a game is told of a save. */
export type SaveInfo = {
    /**
     * The game's version that wrote it, stamped by the page; `null` when it
     * was written standing alone, where there's no version to stamp.
     */
    version: string | null;
    /** When it was written, as an ISO 8601 time. */
    savedAt: string;
};
export type SaveMeta = SaveInfo & {
    size: number;
    revision: number;
};
export type Save = {
    name: string;
    data: string;
    info: SaveMeta;
};
export type SavesLoad = {
    where?: Where;
    items: Save[];
    error?: {
        code: string;
        message: string;
    };
};
export type SavesChange = {
    name: string;
    save: Save | null;
    revision: number;
};
export declare function checkName(name: unknown): ArcadibleError | null;
export declare function checkWrite(saves: ReadonlyMap<string, {
    info: SaveMeta;
}>, name: unknown, data: unknown): ArcadibleError | null;
export declare function isSaveMeta(value: unknown): value is SaveMeta;
export declare function isSaveInfoOrNull(value: unknown): value is SaveInfo | null;
export declare function isSave(value: unknown): value is Save;
export declare function isSavesLoad(value: unknown): value is SavesLoad;
export declare function isSavesChange(value: unknown): value is SavesChange;
export declare function isRevisionOrNull(value: unknown): value is number | null;
