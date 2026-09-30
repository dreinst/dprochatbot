import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db, setting, setSetting, catat } from "./db.js";

// Login admin sistem ini sendiri (terpisah dari admin KUWERA): sandi scrypt, sesi = cookie bertanda tangan HMAC.
const COOKIE = "dcb_sesi";
const SESSION_HOURS = 12;

export function hashPassword(pw) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${scryptSync(pw, salt, 64).toString("base64")}`;
}
function verify(pw, stored) {
  const [scheme, s, h] = String(stored).split("$");
  if (scheme !== "scrypt") return false;
  const expected = Buffer.from(h, "base64");
  const got = scryptSync(pw, Buffer.from(s, "base64"), expected.length);
  return timingSafeEqual(got, expected);
}
const secret = () => {
  let s = setting("session_secret");
  if (!s) { s = randomBytes(32).toString("base64url"); setSetting("session_secret", s); }
  return s;
};
const sign = (payload) => createHmac("sha256", secret()).update(payload).digest("base64url");

// Batas percobaan login per IP: 10 kali per 15 menit.
const tries = new Map();
export function loginAllowed(ip) {
  const now = Date.now();
  const list = (tries.get(ip) || []).filter((t) => now - t < 15 * 60_000);
  tries.set(ip, list);
  return list.length < 10;
}

export function login(username, password, ip) {
  (tries.get(ip) || tries.set(ip, []).get(ip)).push(Date.now());
  const u = db.prepare("SELECT * FROM admins WHERE username = ?").get(String(username).trim().toLowerCase());
  const ok = u && verify(password, u.password_hash);
  catat(username, ok ? "login" : "login_gagal", ip);
  if (!ok) return null;
  const payload = Buffer.from(JSON.stringify({ u: u.id, v: u.session_version, exp: Date.now() + SESSION_HOURS * 3600_000 })).toString("base64url");
  return `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${SESSION_HOURS * 3600}`;
}

export function currentAdmin(req) {
  const raw = (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig || sig.length !== sign(payload).length || !timingSafeEqual(Buffer.from(sig), Buffer.from(sign(payload)))) return null;
  let d;
  try { d = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { return null; }
  if (!d.exp || d.exp < Date.now()) return null;
  const u = db.prepare("SELECT id, username, role, session_version FROM admins WHERE id = ?").get(d.u);
  return u && u.session_version === d.v ? u : null;
}

export const logoutCookie = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
export function logoutAll(adminId) { db.prepare("UPDATE admins SET session_version = session_version + 1 WHERE id = ?").run(adminId); }
