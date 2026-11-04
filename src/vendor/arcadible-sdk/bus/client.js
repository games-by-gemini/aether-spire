// The game's end of the bus: it says hello to the play page, and stands
// alone when no page answers, running the page's end itself, in its own
// page, so the rules are the same. It takes nothing the page sends on trust:
// every call settles, with what its request expects or a code.
// [import]
import { ArcadibleError, BUS_VERSION, Codes, HANDSHAKE_TIMEOUT, isErrorBody, isHostOrigin, isMessage, isWelcome, log, REQUEST_TIMEOUT, } from "./protocol.js";
// [declare]
// How many calls that timed out keep waiting for a late answer; past it,
// the oldest stop.
const MAX_LATE = 64;
// failures after which the page may still have done what was asked: a
// `timeout`, or an answer the game couldn't read.
const uncertain = new WeakSet();
// [function]
// Whether the page may have done what a failed call asked, so a game's
// memory copy keeps what it showed.
export function mayHaveLanded(err) {
    return err instanceof ArcadibleError && uncertain.has(err);
}
// [function]
function unsure(code, message) {
    const err = new ArcadibleError(code, message);
    uncertain.add(err);
    return err;
}
// [function]
export function openBus(options) {
    const win = options.window ?? (typeof window === "undefined" ? undefined : window);
    const origins = options.origins;
    const requestTimeout = options.requestTimeout ?? REQUEST_TIMEOUT;
    let state = "waiting";
    let port = null;
    let nextId = 1;
    let handshakeTimer;
    const pending = new Map();
    const late = new Map();
    const listeners = new Map();
    let welcome = () => undefined;
    const welcomed = new Promise((resolve) => {
        welcome = resolve;
    });
    // [function]
    const onPortMessage = function (event) {
        const message = event.data;
        if (!isMessage(message))
            return;
        try {
            handle(message);
        }
        catch (err) {
            log("error", "a message from the play page failed.", err);
        }
    };
    // [function]
    // a call's answer: settled before anything else is read, so whatever the
    // page sent, the call ends.
    const settle = function (call, message) {
        const error = message["error"];
        if (error !== undefined) {
            if (!isErrorBody(error)) {
                call.reject(unsure(Codes.Unavailable, "The play page's answer was malformed."));
                return;
            }
            const text = error.message;
            call.reject(new ArcadibleError(error.code, typeof text === "string" ? text : "That failed. Try again."));
        }
        else if (call.shape(message["result"])) {
            call.resolve(message["result"]);
        }
        else {
            call.reject(unsure(Codes.Unavailable, "The play page's answer was malformed."));
        }
    };
    // [function]
    const answerLate = function (id, message) {
        const call = late.get(id);
        if (!call)
            return;
        late.delete(id);
        const result = message["result"];
        if (message["error"] === undefined && call.shape(result)) {
            call.late(result);
        }
    };
    // [function]
    const handle = function (message) {
        if (message.kind === "response") {
            const call = pending.get(message.id);
            if (!call) {
                answerLate(message.id, message);
                return;
            }
            pending.delete(message.id);
            clearTimeout(call.timer);
            try {
                settle(call, message);
            }
            catch (err) {
                // `settle` rejects before it could throw; this only keeps a call
                // from hanging if that ever changes.
                call.reject(unsure(Codes.Unavailable, "The play page's answer was malformed."));
                log("error", `${call.name}'s answer couldn't be read.`, err);
            }
        }
        else if (message.kind === "event") {
            for (const listener of [...(listeners.get(message.name) ?? [])]) {
                listener(message.data);
            }
        }
        else {
            // the page asks nothing yet; a newer page's request gets `unsupported`.
            port?.postMessage({
                kind: "response",
                id: message.id,
                error: {
                    code: Codes.Unsupported,
                    message: `Unknown request: ${message.name}`,
                },
            });
        }
    };
    // [function]
    const attach = function (link, body) {
        port = link;
        port.onmessage = onPortMessage;
        welcome(body);
    };
    // [function]
    // no play page: the page's end runs here, over a channel within this page.
    const standAlone = function () {
        if (state !== "waiting")
            return;
        state = "standalone";
        win?.removeEventListener("message", onWindowMessage);
        if (win && win.parent !== win) {
            log("warn", 'no play page answered within a second, so this game keeps its saves on its own origin, where only this build reads them (saves.where is "build"); reloading usually fixes it.');
        }
        const channel = new MessageChannel();
        attach(channel.port1, options.standalone().connect(channel.port2));
    };
    // [function]
    const onWindowMessage = function (event) {
        if (state !== "waiting" ||
            !win ||
            event.source !== win.parent ||
            !isHostOrigin(event.origin, origins) ||
            !isWelcome(event.data) ||
            !event.ports[0]) {
            return;
        }
        state = "connected";
        clearTimeout(handshakeTimer);
        win.removeEventListener("message", onWindowMessage);
        attach(event.ports[0], event.data);
    };
    // [start]
    if (!win || win.parent === win) {
        // not in a frame, so there's no play page to wait for.
        standAlone();
    }
    else {
        win.addEventListener("message", onWindowMessage);
        handshakeTimer = setTimeout(standAlone, options.handshakeTimeout ?? HANDSHAKE_TIMEOUT);
        win.parent.postMessage({ arcadible: "hello", v: BUS_VERSION, client: options.client }, "*");
    }
    return {
        welcomed,
        async request(name, params, shape, requestOptions = {}) {
            await welcomed;
            // welcomed, so there's a channel: the play page's, or this page's own.
            const link = port;
            if (!link) {
                throw new ArcadibleError(Codes.Unavailable, "Not connected.");
            }
            const id = nextId++;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    const call = pending.get(id);
                    pending.delete(id);
                    if (call?.late) {
                        late.set(id, { shape: call.shape, late: call.late });
                        if (late.size > MAX_LATE) {
                            late.delete(late.keys().next().value);
                        }
                    }
                    reject(unsure(Codes.Timeout, "The play page took too long to answer. Try again."));
                }, requestTimeout);
                pending.set(id, {
                    name,
                    resolve: resolve,
                    reject,
                    timer,
                    shape,
                    late: requestOptions.late,
                });
                link.postMessage({ kind: "request", id, name, params });
            });
        },
        on(name, shape, listener) {
            // each listener on its own: one that throws, or data it can't take,
            // doesn't stop the others.
            const checked = function (data) {
                if (!shape(data)) {
                    log("warn", `ignored a malformed ${name} from the play page.`);
                    return;
                }
                try {
                    listener(data);
                }
                catch (err) {
                    log("error", `a ${name} listener failed.`, err);
                }
            };
            let set = listeners.get(name);
            if (!set) {
                set = new Set();
                listeners.set(name, set);
            }
            set.add(checked);
            return () => {
                set.delete(checked);
            };
        },
    };
}
