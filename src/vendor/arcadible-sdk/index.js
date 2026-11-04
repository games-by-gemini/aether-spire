// `@arcadible/sdk`: the `arcadible` object a game calls. One per page, so a
// game that has both the hosted script and the package shares it.
// [import]
import { createClient } from "./client.js";
// [declare]
const scope = globalThis;
// [export]
export const arcadible = scope.arcadible ?? createClient();
scope.arcadible = arcadible;
export { ArcadibleError, Codes } from "./bus/protocol.js";
