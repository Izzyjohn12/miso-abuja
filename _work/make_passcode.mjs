/* Generate a one-time staff passcode and its PBKDF2 hash.
 *
 * The passcode is shown once and saved to the git-ignored
 * _work/staff-passcode.txt. Only the hash goes into .dev.vars and the
 * Cloudflare Pages secret STAFF_PASSCODE_HASH.
 *
 * Usage: node _work/make_passcode.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto as crypto } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "_work", "staff-passcode.txt");
const ITERATIONS = 100000;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function group(size) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

function base64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

const passcode = "MISO-" + group(4) + "-" + group(4);
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(passcode),
  "PBKDF2",
  false,
  ["deriveBits"]
);
const bits = await crypto.subtle.deriveBits(
  { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
  key,
  256
);
const hash = `pbkdf2-sha256$${ITERATIONS}$${base64(salt)}$${base64(new Uint8Array(bits))}`;

fs.writeFileSync(
  OUT,
  [
    "MISO staff console — one-time passcode",
    "Created: " + new Date().toISOString(),
    "Passcode: " + passcode,
    "Hash: " + hash,
    "",
    "Keep this file private. To rotate, rerun this script and update",
    "STAFF_PASSCODE_HASH in .dev.vars and in Cloudflare Pages secrets.",
    ""
  ].join("\n"),
  "utf8"
);

console.log("Passcode: " + passcode);
console.log("Hash: " + hash);
console.log("Saved to " + path.relative(ROOT, OUT));
