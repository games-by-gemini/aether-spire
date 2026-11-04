// Saves, the game's side: `arcadible.saves`, and its memory copy of the
// game's saves, so reads after `ready` answer at once.
// [import]
import { mayHaveLanded } from "../bus/client.js";
import { ArcadibleError, buildOf, Codes, isStringArray, isStringOrNull, log, utf8Size, } from "../bus/protocol.js";
import { checkName, checkWrite, isRevisionOrNull, isSaveInfoOrNull, isSaveMeta, isSavesChange, isSavesLoad, } from "./rules.js";
// [function]
function isAnything(_value) {
    return true;
}
// [function]
function infoOf(meta) {
    return { version: meta.version, savedAt: meta.savedAt };
}
// [function]
// The saves module on `bus`. `opened` settles once the game's saves have
// arrived, the channel's first message, or after `timeout` if they haven't,
// since `ready` never fails.
export function createSaves(bus, { timeout }) {
    // whether `opened` has settled: the sync calls answer from then.
    let settled = false;
    // whether the memory copy holds the game's saves.
    let loaded = false;
    let where;
    let version = null;
    const mirror = new Map();
    // the newest revision seen of each save, removals included.
    const revisions = new Map();
    const early = [];
    // the newest write of each save, until the page answers it: an older
    // write's answer, merged with it or ahead of it, mustn't replace it in
    // the memory copy.
    const writing = new Map();
    let writes = 0;
    let open = () => undefined;
    const opened = new Promise((resolve) => {
        open = () => {
            settled = true;
            resolve();
        };
    });
    // [function]
    // what the page kept for `name`, unless a newer change got there first:
    // changes can arrive out of order. Whether it was newer.
    const kept = function (name, revision, save) {
        if (revision <= (revisions.get(name) ?? 0))
            return false;
        revisions.set(name, revision);
        if (save)
            mirror.set(name, save);
        else
            mirror.delete(name);
        return true;
    };
    // [function]
    // another tab's change (later, another device's): the memory copy keeps
    // up, so the next read sees it.
    const apply = function ({ name, save, revision }) {
        kept(name, revision, save);
    };
    // [function]
    // the answer to a write or remove that timed out, once it comes: the
    // page did keep it, so the memory copy takes it, unless a newer write of
    // the save is waiting, whose answer will be newer still.
    const landed = function (name, revision, save) {
        if (!writing.has(name))
            kept(name, revision, save);
    };
    // [function]
    const restore = function (name, previous) {
        if (previous)
            mirror.set(name, previous);
        else
            mirror.delete(name);
    };
    // [function]
    const assertReady = function () {
        if (!settled) {
            throw new ArcadibleError(Codes.NotReady, "Saves aren't loaded yet. Wait for arcadible.ready first.");
        }
    };
    // [function]
    const assertLoaded = function () {
        assertReady();
        if (!loaded) {
            throw new ArcadibleError(Codes.Unavailable, "Saves haven't loaded yet. Try again, or use the async calls.");
        }
    };
    // [function]
    // runs `call` once `ready` has settled: at once when it has, so a write
    // changes the memory copy in the same tick, and a `readSync` right after
    // it sees the save.
    const whenOpened = function (call) {
        return settled ? call() : opened.then(call);
    };
    // [function]
    const send = function (name, data) {
        // before the saves have loaded, only the name and document can be
        // checked here; the page checks the rest once they have.
        const optimistic = loaded;
        const refused = checkWrite(optimistic ? mirror : new Map(), name, data);
        if (refused)
            return Promise.reject(refused);
        // the memory copy changes at once, so the next read sees it; the
        // promise settles once the page has kept it.
        const previous = mirror.get(name);
        const ticket = ++writes;
        writing.set(name, ticket);
        if (optimistic) {
            mirror.set(name, {
                name,
                data,
                info: {
                    version,
                    savedAt: new Date().toISOString(),
                    size: utf8Size(data),
                    revision: previous?.info.revision ?? 0,
                },
            });
        }
        const save = (meta) => ({ name, data, info: meta });
        return bus
            .request("saves.write", { name, data }, isSaveMeta, {
            late: (meta) => landed(name, meta.revision, save(meta)),
        })
            .then((meta) => {
            if (writing.get(name) === ticket) {
                writing.delete(name);
                kept(name, meta.revision, save(meta));
            }
            return infoOf(meta);
        }, (err) => {
            if (writing.get(name) === ticket)
                writing.delete(name);
            // one the page refused is rolled back, unless something newer
            // replaced it meanwhile; one it may have kept stays.
            if (optimistic &&
                !mayHaveLanded(err) &&
                mirror.get(name)?.data === data) {
                restore(name, previous);
            }
            throw err;
        });
    };
    // [function]
    const erase = function (name) {
        const optimistic = loaded;
        const previous = mirror.get(name);
        if (optimistic)
            mirror.delete(name);
        return bus
            .request("saves.remove", { name }, isRevisionOrNull, {
            late: (revision) => {
                if (revision !== null)
                    landed(name, revision, null);
            },
        })
            .then((revision) => {
            if (revision !== null)
                kept(name, revision, null);
        }, (err) => {
            if (optimistic && !mayHaveLanded(err) && !mirror.has(name)) {
                restore(name, previous);
            }
            throw err;
        });
    };
    // [start]
    let timer;
    // the load is checked here, not by the bus, so even a malformed one
    // settles `ready` at once: the saves didn't load, and the sync reads say so.
    bus.on("saves.load", isAnything, (load) => {
        if (loaded)
            return;
        clearTimeout(timer);
        if (!isSavesLoad(load)) {
            log("warn", "the play page sent saves the game couldn't read.");
            open();
            return;
        }
        if (load.error) {
            open();
            return;
        }
        for (const save of load.items) {
            mirror.set(save.name, save);
            revisions.set(save.name, save.info.revision);
        }
        loaded = true;
        where = typeof load.where === "string" ? load.where : undefined;
        for (const change of early.splice(0))
            apply(change);
        open();
    });
    bus.on("saves.change", isSavesChange, (change) => {
        // one that comes before the saves is kept until they do.
        if (loaded)
            apply(change);
        else
            early.push(change);
    });
    bus.welcomed.then((welcome) => {
        version = buildOf(welcome.build)?.version ?? null;
        // the memory copy doesn't pretend to be empty while the saves are late:
        // a game that took that for "no save yet" could start over, and
        // overwrite the player's progress once they arrived.
        if (!settled) {
            timer = setTimeout(() => {
                if (!loaded) {
                    log("warn", "the game's saves haven't arrived yet, so the sync reads throw unavailable until they do.");
                }
                open();
            }, timeout);
        }
    });
    const saves = {
        write(name, data) {
            return whenOpened(() => send(name, data));
        },
        async read(name) {
            const refused = checkName(name);
            if (refused)
                throw refused;
            await opened;
            return bus.request("saves.read", { name }, isStringOrNull);
        },
        async list() {
            await opened;
            return bus.request("saves.list", undefined, isStringArray);
        },
        async info(name) {
            const refused = checkName(name);
            if (refused)
                throw refused;
            await opened;
            const meta = await bus.request("saves.info", { name }, isSaveInfoOrNull);
            return meta ? infoOf(meta) : null;
        },
        async remove(name) {
            const refused = checkName(name);
            if (refused)
                throw refused;
            return whenOpened(() => erase(name));
        },
        readSync(name) {
            assertLoaded();
            const refused = checkName(name);
            if (refused)
                throw refused;
            return mirror.get(name)?.data ?? null;
        },
        listSync() {
            assertLoaded();
            return [...mirror.keys()].sort();
        },
        infoSync(name) {
            assertLoaded();
            const refused = checkName(name);
            if (refused)
                throw refused;
            const save = mirror.get(name);
            return save ? infoOf(save.info) : null;
        },
        get where() {
            return where;
        },
    };
    return { saves, opened };
}
