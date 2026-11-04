// [import]
import { log } from "../../bus/protocol.js";
// [function]
// Each game's subscribers, by key, for a backend to tell of changes. Each
// gets its own copy, so one can't change what the next one sees, and one
// that throws doesn't fail the change, which is already kept.
export function listenersByKey() {
    const listeners = new Map();
    return {
        add(key, listener) {
            let set = listeners.get(key);
            if (!set) {
                set = new Set();
                listeners.set(key, set);
            }
            set.add(listener);
            return () => {
                set.delete(listener);
                if (set.size === 0 && listeners.get(key) === set)
                    listeners.delete(key);
            };
        },
        tell(key, change, source) {
            for (const listener of [...(listeners.get(key) ?? [])]) {
                try {
                    listener(structuredClone(change), source);
                }
                catch (err) {
                    log("error", "a change's listener failed.", err);
                }
            }
        },
    };
}
