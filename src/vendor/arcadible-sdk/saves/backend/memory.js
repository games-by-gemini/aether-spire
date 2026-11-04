// [import]
import { listenersByKey } from "./listeners.js";
// [function]
function keyOf(scope) {
    return `${scope.game}\u0000${scope.channel}`;
}
// [function]
// Saves kept in memory, for tests, and wherever IndexedDB
// won't open. Hosts sharing one act like tabs sharing a device. Its saves
// last as long as the page, so it says `memory`; tests pretend it's a
// device's with `device`.
export function memoryBackend({ status = "memory", } = {}) {
    const games = new Map();
    const listeners = listenersByKey();
    const gameOf = function (scope) {
        const key = keyOf(scope);
        let game = games.get(key);
        if (!game) {
            game = { saves: new Map(), revision: 0 };
            games.set(key, game);
        }
        return game;
    };
    return {
        status: () => status,
        list: async (scope) => [...gameOf(scope).saves.values()].map((r) => ({ ...r })),
        get: async (scope, name) => {
            const record = gameOf(scope).saves.get(name);
            return record ? { ...record } : null;
        },
        change: async (scope, name, decide, source) => {
            const game = gameOf(scope);
            const next = decide([...game.saves.values()].map((r) => ({ ...r })));
            if (!next && !game.saves.has(name))
                return null;
            const revision = ++game.revision;
            const record = next ? { ...next, revision } : null;
            if (record)
                game.saves.set(name, record);
            else
                game.saves.delete(name);
            const change = { name, record: record && { ...record }, revision };
            listeners.tell(keyOf(scope), change, source);
            return change;
        },
        touch: async (scope, at) => {
            gameOf(scope).usedAt = at;
        },
        subscribe: (scope, listener) => listeners.add(keyOf(scope), listener),
        used: (scope) => games.get(keyOf(scope))?.usedAt,
    };
}
