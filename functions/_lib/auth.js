/* Staff passcode verification and opaque cookie sessions.
 * Only a PBKDF2 hash of the shared passcode and SHA-256 hashes of session
 * tokens ever reach D1. The raw passcode is never stored. */

import { clientIp } from "./http.js";

const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const RENEW_AFTER_MS = 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 5;

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomToken(bytes = 32) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return bytesToBase64(buffer).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function parsePasscodeHash(value) {
  const parts = String(value || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return null;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 10000 || iterations > 1000000) return null;
  if (!parts[2] || !parts[3]) return null;
  return { iterations, salt: parts[2], hash: parts[3] };
}

async function derive(passcode, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passcode),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: base64ToBytes(salt), iterations, hash: "SHA-256" },
    key,
    256
  );
  return bytesToBase64(new Uint8Array(bits));
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPasscode(passcode, stored) {
  const derived = await derive(passcode, stored.salt, stored.iterations);
  return constantTimeEqual(derived, stored.hash);
}

export function cookieName(request) {
  return new URL(request.url).protocol === "https:" ? "__Host-miso_staff" : "miso_staff";
}

function isSecure(request) {
  return new URL(request.url).protocol === "https:";
}

export function readSessionToken(request) {
  const raw = request.headers.get("Cookie") || "";
  const name = cookieName(request);
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    const split = trimmed.indexOf("=");
    if (split === -1) continue;
    if (trimmed.slice(0, split) === name) return trimmed.slice(split + 1);
  }
  return null;
}

export function sessionCookie(request, token, maxAgeSeconds) {
  return (
    cookieName(request) +
    "=" +
    token +
    "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" +
    maxAgeSeconds +
    (isSecure(request) ? "; Secure" : "")
  );
}

export function clearedCookie(request) {
  return cookieName(request) + "=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" +
    (isSecure(request) ? "; Secure" : "");
}

export async function createSession(env, request) {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_MS).toISOString();

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO sessions (id, token_hash, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)"
    ).bind(
      crypto.randomUUID(),
      tokenHash,
      expiresAt,
      clientIp(request),
      (request.headers.get("User-Agent") || "").slice(0, 200)
    ),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(new Date().toISOString())
  ]);

  return { token, expiresAt, maxAge: SESSION_DAYS * 24 * 60 * 60 };
}

/* Returns the live session or null. Slides the expiry at most once an hour. */
export async function requireStaff(env, request) {
  const token = readSessionToken(request);
  if (!token || token.length < 20) return null;

  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    "SELECT id, expires_at, last_seen_at FROM sessions WHERE token_hash = ?"
  ).bind(tokenHash).first();

  if (!row) return null;
  const now = Date.now();
  if (Date.parse(row.expires_at) <= now) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(row.id).run();
    return null;
  }

  let expiresAt = row.expires_at;
  if (now - Date.parse(row.last_seen_at) > RENEW_AFTER_MS) {
    expiresAt = new Date(now + SESSION_MS).toISOString();
    await env.DB.prepare(
      "UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?"
    ).bind(new Date(now).toISOString(), expiresAt, row.id).run();
  }

  return { id: row.id, expiresAt };
}

export async function deleteSession(env, sessionId) {
  await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}

export async function recentLoginFailures(env, ip) {
  const since = new Date(Date.now() - LOGIN_WINDOW_MS).toISOString();
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at > ?"
  ).bind(ip, since).first();
  return row ? Number(row.n) : 0;
}

export async function recordLoginFailure(env, ip) {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO login_attempts (ip, at) VALUES (?, ?)").bind(ip, new Date().toISOString()),
    env.DB.prepare("DELETE FROM login_attempts WHERE at < ?").bind(
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    )
  ]);
}

export async function clearLoginFailures(env, ip) {
  await env.DB.prepare("DELETE FROM login_attempts WHERE ip = ?").bind(ip).run();
}

export { LOGIN_MAX };
