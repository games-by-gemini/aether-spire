import type { BackendStatus } from "../rules.js";
import type { Backend, Scope } from "./types.js";
export declare function memoryBackend({ status, }?: {
    status?: BackendStatus;
}): Backend & {
    used(scope: Scope): string | undefined;
};
