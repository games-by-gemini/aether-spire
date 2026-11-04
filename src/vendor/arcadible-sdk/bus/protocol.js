// The bus's rules, shared by both ends so they can't drift apart: the
// handshake, the message shapes, the error codes, and the limits on what
// crosses it (DESIGN.md, section 4). It knows nothing of any module.
// [declare]
// The bus's own version: the handshake and the message shapes. New modules,
// names, and fields are additions within it.
export const BUS_VERSION = 1;
// How long a game waits for the play page's welcome before it stands alone.
export const HANDSHAKE_TIMEOUT = 1000;
// How long a request waits for its response.
export const REQUEST_TIMEOUT = 10_000;
// [function]
// Whether a game accepts a welcome from `origin`: one of `origins` when it
// was given (tests, and development pages), or else any real origin, `http`
// included, whatever framed it. Who may frame a build is decided outside the
// game, where it can change: on Arcadible by each build's `frame-ancestors`,
// which the browser enforces before the game runs, and elsewhere by whoever
// serves it. So the host is never trusted with anything of value (DESIGN.md,
// section 4). Only `null` is refused: a `file://` page or a sandboxed frame,
// which can't be told apart.
export function isHostOrigin(origin, origins) {
    return origins
        ? origins.includes(origin)
        : origin !== "null" && origin !== "";
}
// The most requests one game can have waiting on the page; past it, a
// request fails with `busy`.
export const MAX_IN_FLIGHT = 64;
// The largest message either side sends: room for a whole 1 MB save, or
// every save at once (a game's are 1 MB together), and the rest of the
// message. The page refuses a larger request, and never sends a larger
// answer or event (DESIGN.md, section 4).
export const MAX_MESSAGE = 1024 * 1024 + 64 * 1024;
// [declare]
// Every code a call can fail with. Worth retrying: `busy`, `timeout`, and
// `unavailable`. Not: `full` (the device has no room; the player must free
// some), `invalid`, `too_large`, and `too_many`. More may come: a game
// treats a code it doesn't know as `unavailable`.
export const Codes = {
    Busy: "busy",
    Full: "full",
    Invalid: "invalid",
    NotReady: "not_ready",
    Timeout: "timeout",
    TooLarge: "too_large",
    TooMany: "too_many",
    Unavailable: "unavailable",
    Unsupported: "unsupported",
};
// [class]
/** A failed call. Match on `code`; the message is for people. */
export class ArcadibleError extends Error {
    // [field]
    code;
    // [constructor]
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "ArcadibleError";
    }
    // [method]
    toJSON() {
        return { code: this.code, message: this.message };
    }
}
// [function]
export function isObject(value) {
    return typeof value === "object" && value !== null;
}
// [function]
export function isString(value) {
    return typeof value === "string";
}
// [function]
export function isNumber(value) {
    return typeof value === "number";
}
// [function]
export function isStringOrNull(value) {
    return value === null || typeof value === "string";
}
// [function]
export function isStringArray(value) {
    return Array.isArray(value) && value.every(isString);
}
// [function]
// What an error is sent as: a string `code`, and a message for people.
export function isErrorBody(value) {
    return isObject(value) && typeof value["code"] === "string";
}
// [function]
// The SDK's console line: one sentence after its name, so a developer can
// tell it from the game's own. `warn` for a degraded state, and `error`
// only for a bug.
export function log(level, sentence, ...detail) {
    console[level](`Arcadible SDK: ${sentence}`, ...detail);
}
// [function]
export function isHello(value) {
    return (isObject(value) &&
        value["arcadible"] === "hello" &&
        typeof value["v"] === "number" &&
        value["v"] >= 1);
}
// [function]
export function isWelcome(value) {
    return (isObject(value) &&
        value["arcadible"] === "welcome" &&
        value["v"] === BUS_VERSION);
}
// [function]
// The welcome's build as a game sees it: a copy of just its version and
// channel, so a page can't add fields games come to depend on, or `null`
// when the page doesn't say, or says it wrong.
export function buildOf(value) {
    return isObject(value) &&
        typeof value["version"] === "string" &&
        typeof value["channel"] === "string"
        ? { version: value["version"], channel: value["channel"] }
        : null;
}
// [function]
export function isMessage(value) {
    if (!isObject(value))
        return false;
    switch (value["kind"]) {
        case "request":
            return (typeof value["id"] === "number" && typeof value["name"] === "string");
        case "response":
            return typeof value["id"] === "number";
        case "event":
            return typeof value["name"] === "string";
        default:
            return false;
    }
}
// [function]
// A string's size in UTF-8 bytes, without encoding it.
export function utf8Size(text) {
    let size = 0;
    for (let i = 0; i < text.length; i++) {
        const unit = text.charCodeAt(i);
        if (unit < 0x80)
            size += 1;
        else if (unit < 0x800)
            size += 2;
        else if (unit >= 0xd800 && unit <= 0xdbff) {
            // a pair is one 4-byte character.
            size += 4;
            i++;
        }
        else
            size += 3;
    }
    return size;
}
// [function]
// A rough size of a message as the browser copies it: strings by their
// UTF-8 bytes, and a few bytes for anything else. It only has to be close
// enough to refuse a message far over the limit, so it stops counting once
// past `limit`, and counts an object it has seen (a cycle) once.
export function messageSize(value, limit = Number.POSITIVE_INFINITY) {
    const seen = new WeakSet();
    let size = 0;
    const stack = [value];
    while (stack.length > 0 && size <= limit) {
        const item = stack.pop();
        if (typeof item === "string")
            size += utf8Size(item) + 2;
        else if (!isObject(item))
            size += 8;
        else if (seen.has(item))
            size += 8;
        else {
            seen.add(item);
            size += 2;
            if (Array.isArray(item)) {
                for (const entry of item)
                    stack.push(entry);
            }
            else {
                for (const [key, entry] of Object.entries(item)) {
                    size += utf8Size(key);
                    stack.push(entry);
                }
            }
        }
    }
    return size;
}
