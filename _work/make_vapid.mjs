/* Generate a VAPID key pair once for Web Push.
 * Writes _work/vapid.json (gitignored). Public key goes in wrangler.toml;
 * the private key becomes the VAPID_PRIVATE_KEY secret. */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const OUT = new URL("./vapid.json", import.meta.url);
const SUBJECT = "https://miso-abuja.pages.dev";

function base64url(bytes) {
  return Buffer.from(bytes).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

if (existsSync(OUT)) {
  const current = JSON.parse(readFileSync(OUT, "utf8"));
  console.log("VAPID keys already exist (created " + current.createdAt + ").");
  console.log("Public key: " + current.publicKey);
  process.exit(0);
}

const pair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"]
);
const rawPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);

const keys = {
  subject: SUBJECT,
  publicKey: base64url(rawPublic),
  privateKey: jwk.d,
  createdAt: new Date().toISOString()
};

writeFileSync(OUT, JSON.stringify(keys, null, 2) + "\n", { mode: 0o600 });
console.log("VAPID keys written to _work/vapid.json.");
console.log("Subject: " + keys.subject);
console.log("Public key: " + keys.publicKey);
