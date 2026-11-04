// [import]
import { ArcadibleError, Codes, log } from "../../bus/protocol.js";
import { listenersByKey } from "./listeners.js";
import { memoryBackend } from "./memory.js";
// [declare]
const DB_NAME = "arcadible-saves";
const DB_VERSION = 1;
const SAVES = "saves";
const GAMES = "games";
const BY_SCOPE = "scope";
// tells the page's other tabs about each change.
const CHANNEL = "arcadible-saves";
// every save is a guest's for One; a signed-in player's sit beside them
// later, under their own id, with no migration.
const GUEST = "guest";
// after a failed reopen, how long calls fail at once before it's tried again,
// so a game saving every frame doesn't try, and fail, every frame.
const REOPEN_WAIT = 1000;
// [function]
function settle(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
// [function]
function finish(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted."));
    });
}
// [function]
// Opens the database, however long it takes: a slow open is waited for,
// since the saves are late, not gone (the game's calls wait, or time out).
function open(factory) {
    return new Promise((resolve, reject) => {
        const request = factory.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            // the same key the server's records will have: player, game,
            // channel, and name.
            const saves = db.createObjectStore(SAVES, {
                keyPath: ["player", "game", "channel", "name"],
            });
            saves.createIndex(BY_SCOPE, ["player", "game", "channel"]);
            db.createObjectStore(GAMES, { keyPath: ["player", "game", "channel"] });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
// [function]
function toRecord(stored) {
    const { name, data, version, savedAt, size, revision } = stored;
    return { name, data, version, savedAt, size, revision };
}
// [function]
// the connection was closed under us (a newer page upgrading, or Safari
// dropping it): open again.
function isClosed(err) {
    return (err instanceof Error &&
        (err.name === "InvalidStateError" || err.name === "UnknownError"));
}
// [function]
// Saves kept in IndexedDB: the play page's, which every game shares, and a
// game standing alone on its own origin. Where there's no IndexedDB, or it
// refuses to open (a browser blocking site data, some `file://` pages),
// they're kept in memory, and `status()` says so. Once it has opened, it
// never switches: a lost connection fails calls with `unavailable` until it
// opens again, trying at most once a second, rather than show an empty copy.
export function indexedDBBackend(options = {}) {
    const factory = options.factory === undefined
        ? (globalThis.indexedDB ?? null)
        : options.factory;
    const player = options.player ?? GUEST;
    const fallback = memoryBackend();
    const listeners = listenersByKey();
    // memory only when the first open fails; never once it has opened.
    let status = "device";
    let opened = false;
    let current = null;
    let opening = null;
    // whether reopening has failed since it last worked, and when to try again.
    let down = false;
    let retryAt = 0;
    let asked = false;
    const keyOf = (scope) => `${player}\u0000${scope.game}\u0000${scope.channel}`;
    const rangeOf = (scope) => IDBKeyRange.only([player, scope.game, scope.channel]);
    const lost = function (db) {
        if (current === db)
            current = null;
    };
    const unreachable = () => new ArcadibleError(Codes.Unavailable, "Saves can't be reached right now. Try again.");
    const connect = async function () {
        try {
            if (!factory)
                throw new Error("IndexedDB isn't available here.");
            const db = await open(factory);
            // a newer version of this page wants to upgrade: step aside.
            db.onversionchange = () => {
                db.close();
                lost(db);
            };
            // the browser closed it under us (Safari can).
            db.onclose = () => lost(db);
            if (options.persist && !asked) {
                asked = true;
                globalThis.navigator?.storage?.persist?.().catch(() => false);
            }
            opened = true;
            down = false;
            current = db;
            return db;
        }
        catch (err) {
            if (opened) {
                // once until it works again: the calls failing meanwhile say so.
                if (!down) {
                    log("warn", "the saves' storage couldn't be opened again.", err);
                }
                down = true;
                retryAt = Date.now() + (options.reopenWait ?? REOPEN_WAIT);
                throw unreachable();
            }
            log("warn", "this browser won't keep saves here, so they're kept in memory until the page closes.", err);
            status = "memory";
            return null;
        }
        finally {
            opening = null;
        }
    };
    // the database, opening it once however many ask; null in memory.
    const database = function () {
        if (status === "memory")
            return Promise.resolve(null);
        if (current)
            return Promise.resolve(current);
        if (down && !opening && Date.now() < retryAt) {
            return Promise.reject(unreachable());
        }
        opening ??= connect();
        return opening;
    };
    // runs `op` on the database, opening it again once if it was closed, or
    // on the memory fallback when there's none.
    const run = async function (op, otherwise) {
        const db = await database();
        if (!db)
            return otherwise();
        try {
            return await op(db);
        }
        catch (err) {
            if (!isClosed(err))
                throw err;
            lost(db);
            const again = await database();
            return again ? op(again) : otherwise();
        }
    };
    database().catch(() => undefined);
    const broadcast = typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(CHANNEL);
    if (broadcast) {
        broadcast.onmessage = (event) => {
            const { key, change, source } = event.data;
            listeners.tell(key, change, source);
        };
    }
    const tell = function (scope, change, source) {
        const key = keyOf(scope);
        listeners.tell(key, change, source);
        broadcast?.postMessage({ key, change, source });
    };
    const change = async function (db, scope, name, decide) {
        // one transaction for the check and the write, so two tabs can't both
        // pass the limits, or take the same revision.
        const tx = db.transaction([SAVES, GAMES], "readwrite");
        const saves = tx.objectStore(SAVES);
        const games = tx.objectStore(GAMES);
        const gameKey = [player, scope.game, scope.channel];
        const [all, row] = await Promise.all([
            settle(saves.index(BY_SCOPE).getAll(rangeOf(scope))),
            settle(games.get(gameKey)),
        ]);
        let next;
        try {
            next = decide(all.map(toRecord));
        }
        catch (err) {
            tx.abort();
            await finish(tx).catch(() => undefined);
            throw err;
        }
        const exists = all.some((r) => r.name === name);
        if (!next && !exists) {
            await finish(tx);
            return null;
        }
        const game = row ?? {
            player,
            game: scope.game,
            channel: scope.channel,
        };
        const revision = (game.revision ?? 0) + 1;
        games.put({ ...game, revision });
        const record = next ? { ...next, revision } : null;
        if (record)
            saves.put({ ...record, player, ...scope });
        else
            saves.delete([player, scope.game, scope.channel, name]);
        await finish(tx);
        return { name, record, revision };
    };
    return {
        status: () => status,
        list(scope) {
            return run(async (db) => {
                const tx = db.transaction(SAVES, "readonly");
                const all = await settle(tx.objectStore(SAVES).index(BY_SCOPE).getAll(rangeOf(scope)));
                return all.map(toRecord);
            }, () => fallback.list(scope));
        },
        get(scope, name) {
            return run(async (db) => {
                const tx = db.transaction(SAVES, "readonly");
                const stored = await settle(tx
                    .objectStore(SAVES)
                    .get([player, scope.game, scope.channel, name]));
                return stored ? toRecord(stored) : null;
            }, () => fallback.get(scope, name));
        },
        async change(scope, name, decide, source) {
            const result = await run((db) => change(db, scope, name, decide), () => fallback.change(scope, name, decide, source));
            if (result)
                tell(scope, result, source);
            return result;
        },
        touch(scope, at) {
            return run(async (db) => {
                const tx = db.transaction(GAMES, "readwrite");
                const games = tx.objectStore(GAMES);
                const key = [player, scope.game, scope.channel];
                const row = (await settle(games.get(key)));
                games.put({
                    ...(row ?? { player, game: scope.game, channel: scope.channel }),
                    usedAt: at,
                });
                return finish(tx);
            }, () => fallback.touch(scope, at));
        },
        subscribe(scope, listener) {
            return listeners.add(keyOf(scope), listener);
        },
        close() {
            broadcast?.close();
            current?.close();
            opening?.then((db) => db?.close()).catch(() => undefined);
        },
    };
}
