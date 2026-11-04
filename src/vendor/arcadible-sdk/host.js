// The page's side of the bus. The play page uses `createHost`;
// a game standing alone runs `serve` in its own page.
// [import]
import { answerHellos, createServer } from "./bus/server.js";
import { savesServer } from "./saves/server.js";
// [function]
// Answers the bus for one game in one channel, on any number of ports.
export function serve(options) {
    const { backend, channel, game, version } = options;
    return createServer({
        build: version === null ? null : { version, channel },
        modules: [
            savesServer({
                backend,
                now: options.now ?? (() => new Date()),
                scope: { game, channel },
                version,
                where: options.where ?? "game",
            }),
        ],
    });
}
// [function]
// The play page's host: it answers its iframe's hello with a welcome and a
// private channel. Call it before inserting the iframe, so no hello is
// missed.
export function createHost(options) {
    return answerHellos({
        frame: options.frame,
        origin: options.origin,
        server: serve(options),
        window: options.window ?? window,
    });
}
export { indexedDBBackend } from "./saves/backend/indexeddb.js";
export { memoryBackend } from "./saves/backend/memory.js";
