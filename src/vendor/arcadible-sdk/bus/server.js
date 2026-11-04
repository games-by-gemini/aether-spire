// The page's end of the bus: it answers a game's requests with its modules'
// handlers, one at a time in order, and refuses what's too large, too many,
// or unknown. It never sends more than `MAX_MESSAGE` either. `answerHellos`
// connects it to the play page's iframe.
// [import]
import { ArcadibleError, BUS_VERSION, Codes, isHello, isMessage, log, MAX_IN_FLIGHT, MAX_MESSAGE, messageSize, } from "./protocol.js";
// [function]
function errorBody(err) {
    if (err instanceof ArcadibleError)
        return err.toJSON();
    log("error", "a request failed.", err);
    return {
        code: Codes.Unavailable,
        message: "That's unavailable right now. Try again.",
    };
}
// [function]
function paramsOf(value) {
    return typeof value === "object" && value !== null ? value : {};
}
// [function]
// Answers the bus for one game, on any number of ports, one request at a
// time in order, so a read always sees the writes before it.
export function createServer(options) {
    const ports = new Set();
    const inFlight = new Map();
    // the newest request waiting its turn, by key.
    const waiting = new Map();
    let queue = Promise.resolve();
    const enqueue = function (job) {
        const run = queue.then(job);
        queue = run.catch(() => undefined);
        return run;
    };
    // nothing goes to a game that's larger than a request may be: the limits
    // keep every answer and event within it, so one that isn't is a bug.
    const fits = function (message, what) {
        if (messageSize(message, MAX_MESSAGE) <= MAX_MESSAGE)
            return true;
        log("error", `${what} was too large to send.`);
        return false;
    };
    const send = function (port, name, data) {
        if (!ports.has(port))
            return;
        const message = { kind: "event", name, data };
        if (fits(message, name))
            port.postMessage(message);
    };
    const modules = options.modules.map((make) => make({
        broadcast(name, data) {
            for (const port of ports)
                send(port, name, data);
        },
    }));
    const handlers = new Map();
    for (const module of modules) {
        for (const [name, handler] of Object.entries(module.handlers)) {
            handlers.set(name, handler);
        }
    }
    const refuse = function (port, id, error) {
        port.postMessage({ kind: "response", id, error });
    };
    // answers each request in `entry`, which counted once toward the limit.
    const respond = function ({ ids, name, port }, outcome) {
        const count = inFlight.get(port);
        if (count !== undefined)
            inFlight.set(port, count - 1);
        if (!ports.has(port))
            return;
        const fitting = "result" in outcome && !fits(outcome, `${name}'s answer`)
            ? {
                error: {
                    code: Codes.Unavailable,
                    message: "That's unavailable right now. Try again.",
                },
            }
            : outcome;
        for (const id of ids)
            port.postMessage({ kind: "response", id, ...fitting });
    };
    const answer = function (port, request) {
        const { id, name } = request;
        const handler = handlers.get(name);
        if (!handler) {
            refuse(port, id, {
                code: Codes.Unsupported,
                message: `Unknown request: ${name}`,
            });
            return;
        }
        const params = paramsOf(request.params);
        const key = handler.key?.(params) ?? null;
        const pending = key === null ? undefined : waiting.get(key);
        if (handler.coalesce &&
            pending &&
            pending.name === name &&
            pending.port === port) {
            pending.params = params;
            pending.ids.push(id);
            return;
        }
        if ((inFlight.get(port) ?? 0) >= MAX_IN_FLIGHT) {
            refuse(port, id, {
                code: Codes.Busy,
                message: "Too many calls at once. Wait for some to finish.",
            });
            return;
        }
        inFlight.set(port, (inFlight.get(port) ?? 0) + 1);
        const entry = { name, port, params, ids: [id] };
        if (key !== null)
            waiting.set(key, entry);
        enqueue(() => {
            if (key !== null && waiting.get(key) === entry)
                waiting.delete(key);
            return handler.run(entry.params);
        }).then((result) => respond(entry, { result }), (err) => respond(entry, { error: errorBody(err) }));
    };
    const receive = function (port, data) {
        if (!isMessage(data) || data.kind !== "request")
            return;
        if (messageSize(data, MAX_MESSAGE) > MAX_MESSAGE) {
            refuse(port, data.id, {
                code: Codes.TooLarge,
                message: "The message is too large.",
            });
            return;
        }
        answer(port, data);
    };
    const disconnect = function (port) {
        ports.delete(port);
        inFlight.delete(port);
        port.onmessage = null;
        port.close();
    };
    return {
        connect(port) {
            ports.add(port);
            inFlight.set(port, 0);
            port.onmessage = (event) => receive(port, event.data);
            // first in the queue, so it's sent before any answer. A channel
            // replaced before its turn (hellos in a loop) opens nothing.
            enqueue(async () => {
                for (const module of modules) {
                    if (!ports.has(port))
                        return;
                    await module.open?.((name, data) => send(port, name, data));
                }
            });
            return {
                arcadible: "welcome",
                v: BUS_VERSION,
                build: options.build,
            };
        },
        disconnect,
        close() {
            for (const module of modules)
                module.close?.();
            for (const port of ports)
                disconnect(port);
        },
    };
}
// [function]
// The play page's end of the handshake: it answers a hello from its own
// iframe, at its build's exact origin, with a welcome and a private
// channel. A new page load in the frame says hello again, and replaces the
// channel. Call it before inserting the iframe, so no hello is missed.
export function answerHellos({ frame, origin, server, window: win, }) {
    let current = null;
    const onMessage = function (event) {
        const target = frame.contentWindow;
        if (!target ||
            event.source !== target ||
            event.origin !== origin ||
            !isHello(event.data)) {
            return;
        }
        const channel = new MessageChannel();
        const welcome = server.connect(channel.port1);
        if (current)
            server.disconnect(current);
        current = channel.port1;
        target.postMessage({ ...welcome, v: Math.min(event.data.v, BUS_VERSION) }, origin, [channel.port2]);
    };
    win.addEventListener("message", onMessage);
    return {
        close() {
            win.removeEventListener("message", onMessage);
            server.close();
            current = null;
        },
    };
}
