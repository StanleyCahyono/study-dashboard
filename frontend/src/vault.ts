// Encrypted offline copy of the latest Today data, kept on this device only.
//
// * The server gives each signed-in session its own random 256-bit key
//   ("snapshot key"). Snapshots are encrypted with it (AES-GCM).
// * At sign-in, while the passphrase is in hand, the snapshot key is wrapped
//   with a key derived from the passphrase (PBKDF2-SHA256, 600k rounds) and
//   stored here. Nothing stored here can be read without the passphrase.
// * When the server can't be reached, the owner types the passphrase to unlock
//   a read-only view of the last copy.
// * Sign-out, a revoked/expired session, or "Delete saved copy" wipes it.

import type { Today } from "./api";

const DB_NAME = "studydash-offline";
const STORE = "vault";
const KEY = "current";
const ITERATIONS = 600_000;

type VaultRecord = {
  v: 1;
  profile: string;
  sessionId: string;
  salt: string;
  iterations: number;
  wrapIv: string;
  wrappedKey: string;
  snapIv?: string;
  snapshot?: string;
  savedAt?: string;
};

export type Snapshot = { today: Today };

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function unb64url(text: string): Uint8Array<ArrayBuffer> {
  const t = text.replace(/-/g, "+").replace(/_/g, "/");
  return unb64(t + "=".repeat((4 - (t.length % 4)) % 4));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function read(): Promise<VaultRecord | undefined> {
  try {
    return (await withStore("readonly", (s) => s.get(KEY))) as VaultRecord | undefined;
  } catch {
    return undefined;
  }
}

async function write(rec: VaultRecord): Promise<void> {
  await withStore("readwrite", (s) => s.put(rec, KEY));
}

export async function wipeVault(): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.delete(KEY));
  } catch {
    /* nothing stored */
  }
}

export async function vaultInfo(): Promise<{ savedAt: string | null; profile: string } | null> {
  const rec = await read();
  if (!rec) return null;
  return { savedAt: rec.savedAt ?? null, profile: rec.profile };
}

async function passphraseKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function snapshotKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Called right after sign-in, while the passphrase is available. */
export async function createVault(passphrase: string, snapshotKeyB64url: string, sessionId: string, profile: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  const kek = await passphraseKey(passphrase, salt, ITERATIONS);
  const wrapped = await crypto.subtle.encrypt({ name: "AES-GCM", iv: wrapIv }, kek, unb64url(snapshotKeyB64url));
  await write({ v: 1, profile, sessionId, salt: b64(salt), iterations: ITERATIONS, wrapIv: b64(wrapIv), wrappedKey: b64(wrapped) });
}

/** Called after each successful online load. No-op unless this device opted in. */
export async function saveSnapshot(snapshotKeyB64url: string, sessionId: string, snap: Snapshot): Promise<boolean> {
  const rec = await read();
  if (!rec || rec.sessionId !== sessionId) return false;
  const key = await snapshotKey(unb64url(snapshotKeyB64url));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(snap)));
  await write({ ...rec, snapIv: b64(iv), snapshot: b64(ct), savedAt: new Date().toISOString() });
  return true;
}

export class WrongPassphrase extends Error {}

/** Offline: unlock the saved copy with the passphrase. */
export async function unlockVault(passphrase: string): Promise<{ snap: Snapshot; savedAt: string } | null> {
  const rec = await read();
  if (!rec || !rec.snapshot || !rec.snapIv || !rec.savedAt) return null;
  const kek = await passphraseKey(passphrase, unb64(rec.salt), rec.iterations);
  let raw: ArrayBuffer;
  try {
    raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(rec.wrapIv) }, kek, unb64(rec.wrappedKey));
  } catch {
    throw new WrongPassphrase("wrong passphrase");
  }
  const key = await snapshotKey(new Uint8Array(raw));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(rec.snapIv) }, key, unb64(rec.snapshot));
  return { snap: JSON.parse(dec.decode(pt)) as Snapshot, savedAt: rec.savedAt };
}
