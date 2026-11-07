/* Copy the generated VAPID private key into .dev.vars for local testing.
 * Values are never printed. */

import { readFileSync, writeFileSync } from "node:fs";

const keysPath = new URL("./vapid.json", import.meta.url);
const varsPath = new URL("../.dev.vars", import.meta.url);
const keys = JSON.parse(readFileSync(keysPath, "utf8"));

let text = "";
try {
  text = readFileSync(varsPath, "utf8");
} catch (err) {
  text = "";
}

const lines = text.split(/\r?\n/).filter((line) => line && !line.startsWith("VAPID_PRIVATE_KEY="));
lines.push("VAPID_PRIVATE_KEY=" + keys.privateKey);
writeFileSync(varsPath, lines.join("\n") + "\n", { mode: 0o600 });
console.log("VAPID_PRIVATE_KEY written to .dev.vars (value hidden).");
