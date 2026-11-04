import type { Module, ModuleContext } from "../bus/server.js";
import type { Backend, Scope } from "./backend/types.js";
import { type Where } from "./rules.js";
type SavesServerOptions = {
    scope: Scope;
    version: string | null;
    where: Where;
    backend: Backend;
    now: () => Date;
};
export declare function savesServer(options: SavesServerOptions): (context: ModuleContext) => Module;
export {};
