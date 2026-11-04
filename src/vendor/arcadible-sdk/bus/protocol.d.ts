export declare const BUS_VERSION = 1;
export declare const HANDSHAKE_TIMEOUT = 1000;
export declare const REQUEST_TIMEOUT = 10000;
export declare function isHostOrigin(origin: string, origins: readonly string[] | undefined): boolean;
export declare const MAX_IN_FLIGHT = 64;
export declare const MAX_MESSAGE: number;
export declare const Codes: {
    readonly Busy: "busy";
    readonly Full: "full";
    readonly Invalid: "invalid";
    readonly NotReady: "not_ready";
    readonly Timeout: "timeout";
    readonly TooLarge: "too_large";
    readonly TooMany: "too_many";
    readonly Unavailable: "unavailable";
    readonly Unsupported: "unsupported";
};
export type Code = (typeof Codes)[keyof typeof Codes];
/**
 * The build that's running, from the page's own lookup: its version, from
 * `arcadible.toml` or `package.json`, and its channel (`production`,
 * `staging`, or `local` under `arc serve`). `null` standing alone, or when
 * the page doesn't say.
 */
export type Build = {
    version: string;
    channel: string;
};
export type Hello = {
    arcadible: "hello";
    v: number;
    client: string;
};
export type Welcome = {
    arcadible: "welcome";
    v: number;
    build: Build | null;
};
export type Shape<T> = (value: unknown) => value is T;
export type ErrorBody = {
    code: string;
    message: string;
};
export type Request = {
    kind: "request";
    id: number;
    name: string;
    params?: unknown;
};
type Response = {
    kind: "response";
    id: number;
    result: unknown;
} | {
    kind: "response";
    id: number;
    error: ErrorBody;
};
type BusEvent = {
    kind: "event";
    name: string;
    data?: unknown;
};
export type Message = Request | Response | BusEvent;
/** A failed call. Match on `code`; the message is for people. */
export declare class ArcadibleError extends Error {
    readonly code: Code;
    constructor(code: Code, message: string);
    toJSON(): ErrorBody;
}
export declare function isObject(value: unknown): value is Record<string, unknown>;
export declare function isString(value: unknown): value is string;
export declare function isNumber(value: unknown): value is number;
export declare function isStringOrNull(value: unknown): value is string | null;
export declare function isStringArray(value: unknown): value is string[];
export declare function isErrorBody(value: unknown): value is {
    code: string;
};
export declare function log(level: "warn" | "error", sentence: string, ...detail: unknown[]): void;
export declare function isHello(value: unknown): value is Hello;
export declare function isWelcome(value: unknown): value is Welcome;
export declare function buildOf(value: unknown): Build | null;
export declare function isMessage(value: unknown): value is Message;
export declare function utf8Size(text: string): number;
export declare function messageSize(value: unknown, limit?: number): number;
export {};
