import { type Build, type Welcome } from "./protocol.js";
export type Params = Record<string, unknown>;
export type Handler = {
    run(params: Params): Promise<unknown>;
    key?(params: Params): string;
    coalesce?: boolean;
};
export type ModuleContext = {
    broadcast(name: string, data: unknown): void;
};
export type Module = {
    handlers: Record<string, Handler>;
    open?(send: (name: string, data: unknown) => void): Promise<void>;
    close?(): void;
};
export type ServerOptions = {
    build: Build | null;
    modules: ((context: ModuleContext) => Module)[];
};
export type Server = {
    connect(port: MessagePort): Welcome;
    disconnect(port: MessagePort): void;
    close(): void;
};
export declare function createServer(options: ServerOptions): Server;
export declare function answerHellos({ frame, origin, server, window: win, }: {
    frame: HTMLIFrameElement;
    origin: string;
    server: Server;
    window: Window;
}): {
    close(): void;
};
