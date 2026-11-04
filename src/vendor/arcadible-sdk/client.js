// `createClient`: the `arcadible` object a game calls, the bus with its
// modules on top. It says hello to the play page, and stands alone, with the
// same rules in its own page, when no page answers.
// [import]
import { openBus } from "./bus/client.js";
import { buildOf, REQUEST_TIMEOUT } from "./bus/protocol.js";
import { indexedDBBackend } from "./saves/backend/indexeddb.js";
import { createSaves } from "./saves/client.js";
import { serve } from "./host.js";
import { VERSION } from "./version.js";
// The scope a game standing alone keeps its saves under, on its own origin,
// where only this build reads them. Standing alone there's no version to
// stamp: saves say `null`.
const STANDALONE = {
    game: "standalone",
    channel: "local",
    version: null,
    where: "build",
};
// [function]
export function createClient(options = {}) {
    const backend = options.backend ?? (() => indexedDBBackend());
    const bus = openBus({
        client: VERSION,
        window: options.window,
        origins: options.origins,
        handshakeTimeout: options.handshakeTimeout,
        requestTimeout: options.requestTimeout,
        standalone: () => serve({ ...STANDALONE, backend: backend() }),
    });
    const { saves, opened } = createSaves(bus, {
        timeout: options.requestTimeout ?? REQUEST_TIMEOUT,
    });
    let settled = null;
    // ready once welcomed, and each module's first messages have arrived.
    const ready = Promise.all([bus.welcomed, opened]).then(([welcome]) => {
        settled = { build: buildOf(welcome.build) };
        return settled;
    });
    return {
        version: VERSION,
        ready,
        get build() {
            return settled ? settled.build : undefined;
        },
        saves,
    };
}
