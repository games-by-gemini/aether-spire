import { type Server } from "./bus/server.js";
import type { Backend } from "./saves/backend/types.js";
import type { Where } from "./saves/rules.js";
export type ServeOptions = {
    game: string;
    channel: string;
    version: string | null;
    backend: Backend;
    where?: Where;
    now?: () => Date;
};
type HostOptions = ServeOptions & {
    frame: HTMLIFrameElement;
    origin: string;
    window?: Window;
};
export declare function serve(options: ServeOptions): Server;
export declare function createHost(options: HostOptions): {
    close(): void;
};
export type { Server } from "./bus/server.js";
export { indexedDBBackend } from "./saves/backend/indexeddb.js";
export { memoryBackend } from "./saves/backend/memory.js";
