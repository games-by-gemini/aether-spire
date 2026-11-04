// Saves, the page's side: it answers a game's saves requests from its
// backend, enforces the limits, and stamps each save with the game's
// version. Its first message on each channel is the game's saves, and who
// can read them back.
// [import]
import { ArcadibleError, Codes, log, utf8Size } from "../bus/protocol.js";
import { checkName, checkWrite, } from "./rules.js";
// [function]
function toSave(record) {
    const { name, data, version, savedAt, size, revision } = record;
    return { name, data, info: { version, savedAt, size, revision } };
}
// [function]
// A writer's name, so the backend doesn't tell it of its own changes. It
// needn't be secret, and `crypto.randomUUID` isn't on plain-http pages.
function sourceId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
// [function]
function nameOf(params) {
    const refused = checkName(params["name"]);
    if (refused)
        throw refused;
    return params["name"];
}
// [function]
// what a write or remove is about, so they keep their order (bus/server.ts).
function saveKey(params) {
    return String(params["name"]);
}
// [function]
// the device is out of room: retrying won't help until the player frees
// some. Anything else is the bus's `unavailable`.
function storageError(err) {
    if (err?.name === "QuotaExceededError") {
        return new ArcadibleError(Codes.Full, "This device has no room left for saves.");
    }
    return err;
}
// [function]
export function savesServer(options) {
    const { backend, now, scope, version, where } = options;
    const source = sourceId();
    // a write, checked against the game's saves in the same step as it's kept.
    const write = async function (params) {
        const { name, data } = params;
        const change = await backend
            .change(scope, name, (saves) => {
            const refused = checkWrite(new Map(saves.map((r) => [r.name, toSave(r)])), name, data);
            if (refused)
                throw refused;
            return {
                name: name,
                data: data,
                version,
                savedAt: now().toISOString(),
                size: utf8Size(data),
            };
        }, source)
            .catch((err) => {
            throw storageError(err);
        });
        return change?.record ? toSave(change.record).info : null;
    };
    const load = async function () {
        // when the saves were last opened is bookkeeping: a device too full to
        // keep it still loads them.
        const [list] = await Promise.all([
            backend.list(scope),
            backend.touch(scope, now().toISOString()).catch((err) => {
                log("warn", "the saves' last use couldn't be kept.", err);
            }),
        ]);
        return {
            where: backend.status() === "memory" ? "memory" : where,
            items: list.map(toSave),
        };
    };
    return (context) => {
        // another tab (later, another device) changed a save: tell the game,
        // with the change's revision, so it can ignore one that arrives late.
        const unsubscribe = backend.subscribe(scope, (change, from) => {
            if (from === source)
                return;
            context.broadcast("saves.change", {
                name: change.name,
                save: change.record ? toSave(change.record) : null,
                revision: change.revision,
            });
        });
        return {
            handlers: {
                "saves.read": {
                    run: async (params) => (await backend.get(scope, nameOf(params)))?.data ?? null,
                },
                "saves.info": {
                    run: async (params) => {
                        const record = await backend.get(scope, nameOf(params));
                        return record ? toSave(record).info : null;
                    },
                },
                "saves.list": {
                    run: async () => (await backend.list(scope)).map((record) => record.name).sort(),
                },
                "saves.write": { run: write, key: saveKey, coalesce: true },
                // the removal's revision, or null when there was nothing to remove.
                "saves.remove": {
                    key: saveKey,
                    run: async (params) => {
                        // a removal writes too (the game's change counter), so a full
                        // device refuses it the same way.
                        const change = await backend
                            .change(scope, nameOf(params), () => null, source)
                            .catch((err) => {
                            throw storageError(err);
                        });
                        return change?.revision ?? null;
                    },
                },
            },
            async open(send) {
                try {
                    send("saves.load", await load());
                }
                catch (err) {
                    log("warn", "the game's saves couldn't load.", err);
                    const error = err instanceof ArcadibleError
                        ? err.toJSON()
                        : { code: Codes.Unavailable, message: "Saves couldn't load." };
                    send("saves.load", { items: [], error });
                }
            },
            close: unsubscribe,
        };
    };
}
