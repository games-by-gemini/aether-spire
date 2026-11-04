// Saves' rules, shared by the game's side and the page's so they can't drift
// apart: the shapes, the limits, and their checks (DESIGN.md, section 6).
// [import]
import { ArcadibleError, Codes, isNumber, isObject, isStringOrNull, utf8Size, } from "../bus/protocol.js";
// [declare]
// Saves' limits, the same everywhere (DESIGN.md, section 6, Limits).
export const MAX_SAVES = 32;
// Every save's document together, in UTF-8 bytes.
export const MAX_TOTAL = 1024 * 1024;
const NAME = /^[A-Za-z0-9_.-]{1,64}$/u;
// A lone surrogate: half a character, which storage and the network corrupt.
const LONE_SURROGATE = /\p{Surrogate}/u;
// [function]
function isWellFormed(text) {
    return !LONE_SURROGATE.test(text);
}
// [function]
// Why a save's name is refused, or null.
export function checkName(name) {
    if (typeof name !== "string" || !NAME.test(name)) {
        return new ArcadibleError(Codes.Invalid, "A save's name is 1 to 64 letters, digits, '-', '_', or '.'.");
    }
    return null;
}
// [function]
// Why a save is refused, given the saves already kept (`saves`), or null.
export function checkWrite(saves, name, data) {
    const refused = checkName(name);
    if (refused)
        return refused;
    if (typeof data !== "string") {
        return new ArcadibleError(Codes.Invalid, "A save is a string: serialize it first, such as with JSON.stringify.");
    }
    if (!isWellFormed(data)) {
        return new ArcadibleError(Codes.Invalid, "A save can't hold half a character (a lone surrogate).");
    }
    if (!saves.has(name) && saves.size >= MAX_SAVES) {
        return new ArcadibleError(Codes.TooMany, `A game keeps at most ${MAX_SAVES} saves. Remove one, or combine them.`);
    }
    let total = utf8Size(data);
    for (const [other, save] of saves) {
        if (other !== name)
            total += save.info.size;
    }
    if (total > MAX_TOTAL) {
        return new ArcadibleError(Codes.TooLarge, `A game's saves hold at most ${MAX_TOTAL / 1024 / 1024} MB together.`);
    }
    return null;
}
// [function]
// What the page sends of a save, checked for only what a game relies on
// (DESIGN.md, The host is never trusted): extra fields pass.
export function isSaveMeta(value) {
    return (isObject(value) &&
        isStringOrNull(value["version"]) &&
        typeof value["savedAt"] === "string" &&
        isNumber(value["size"]) &&
        isNumber(value["revision"]));
}
// [function]
export function isSaveInfoOrNull(value) {
    return (value === null ||
        (isObject(value) &&
            isStringOrNull(value["version"]) &&
            typeof value["savedAt"] === "string"));
}
// [function]
export function isSave(value) {
    return (isObject(value) &&
        checkName(value["name"]) === null &&
        typeof value["data"] === "string" &&
        isSaveMeta(value["info"]));
}
// [function]
// A load the memory copy can take whole: every save readable, or none.
export function isSavesLoad(value) {
    return (isObject(value) &&
        Array.isArray(value["items"]) &&
        (value["error"] !== undefined || value["items"].every(isSave)));
}
// [function]
export function isSavesChange(value) {
    if (!isObject(value) ||
        checkName(value["name"]) !== null ||
        !isNumber(value["revision"])) {
        return false;
    }
    const save = value["save"];
    return save === null || (isSave(save) && save.name === value["name"]);
}
// [function]
export function isRevisionOrNull(value) {
    return value === null || isNumber(value);
}
