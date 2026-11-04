import { type Bus } from "../bus/client.js";
import { type SaveInfo, type Where } from "./rules.js";
/** `arcadible.saves`: each save is a name holding one string. */
export interface Saves {
    /** Keeps `data` as the save `name`, replacing what it held. */
    write(name: string, data: string): Promise<SaveInfo>;
    /** The save's string, or `null` when there's none. */
    read(name: string): Promise<string | null>;
    /** The names of the game's saves, sorted. */
    list(): Promise<string[]>;
    /** Which version wrote the save, and when, or `null` when there's none. */
    info(name: string): Promise<SaveInfo | null>;
    /** Removes the save, if there is one. */
    remove(name: string): Promise<void>;
    /** After `ready`, the save's string from memory; before it, throws `not_ready`. */
    readSync(name: string): string | null;
    /** After `ready`, the names of the game's saves from memory, sorted. */
    listSync(): string[];
    /** After `ready`, the save's version and time from memory, or `null`. */
    infoSync(name: string): SaveInfo | null;
    /**
     * Who can read the saves back, once `ready` has settled: `"game"` (every
     * version of the game), `"build"` (only this build), or `"memory"` (only
     * until the page closes). `undefined` until it's known. Other values may
     * be added: treat one you don't know as `"game"`.
     */
    readonly where: Where | undefined;
}
export declare function createSaves(bus: Bus, { timeout }: {
    timeout: number;
}): {
    saves: Saves;
    opened: Promise<void>;
};
