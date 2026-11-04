import { type Build } from "./bus/protocol.js";
import type { Backend } from "./saves/backend/types.js";
import { type Saves } from "./saves/client.js";
export type Ready = {
    build: Build | null;
};
/** The `arcadible` object a game calls. */
export interface Arcadible {
    /** The SDK's own version. */
    readonly version: string;
    /**
     * Settles once the game's saves have loaded, or after 10 seconds if they
     * haven't, and never fails. It resolves with `build`; each module's own
     * facts are on the module, such as `saves.where`.
     */
    readonly ready: Promise<Ready>;
    /**
     * The build that's running, its version and channel, once `ready` has
     * settled: compare a save's `info().version` with it, so as not to
     * overwrite a save from a newer version. `null` when nobody says, such as
     * standing alone, and `undefined` before.
     */
    readonly build: Build | null | undefined;
    /** Saves that carry over between the game's versions. */
    readonly saves: Saves;
}
export type ClientOptions = {
    window?: Window;
    origins?: readonly string[];
    handshakeTimeout?: number;
    requestTimeout?: number;
    backend?: () => Backend;
};
export declare function createClient(options?: ClientOptions): Arcadible;
