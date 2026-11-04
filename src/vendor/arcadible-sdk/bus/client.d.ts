import { type Shape, type Welcome } from "./protocol.js";
import type { Server } from "./server.js";
export type BusOptions = {
    client: string;
    window?: Window | undefined;
    origins?: readonly string[] | undefined;
    handshakeTimeout?: number | undefined;
    requestTimeout?: number | undefined;
    standalone: () => Server;
};
export type RequestOptions<T> = {
    late?: (result: T) => void;
};
export type Bus = {
    readonly welcomed: Promise<Welcome>;
    request<T>(name: string, params: object | undefined, shape: Shape<T>, options?: RequestOptions<T>): Promise<T>;
    on<T>(name: string, shape: Shape<T>, listener: (data: T) => void): () => void;
};
export declare function mayHaveLanded(err: unknown): boolean;
export declare function openBus(options: BusOptions): Bus;
