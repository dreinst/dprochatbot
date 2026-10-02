import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

// Database sendiri (SQLite), terpisah dari database KUWERA. Satu kontak = satu orang (dikenali dari hash NIK,
// atau nomor HP + nama kalau NIK tidak ada); keikutsertaan di tiap event dicatat terpisah supaya satu orang bisa
// punya riwayat banyak event. Event dikelompokkan per kategori (misalnya "Lari") untuk menentukan target blast.
const file = process.env.DB_FILE || "/data/dprochatbot.db";
fs.mkdirSync(path.dirname(file), { recursive: true });
export const db = new DatabaseSync(file);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin', session_version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY, waktu TEXT NOT NULL DEFAULT (datetime('now')), admin TEXT, aksi TEXT NOT NULL, detail TEXT);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, kode TEXT UNIQUE NOT NULL, nama TEXT NOT NULL, kategori TEXT NOT NULL, tanggal TEXT, sumber TEXT
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY, kunci TEXT UNIQUE NOT NULL, nama TEXT NOT NULL, hp TEXT, email TEXT, nik_samar TEXT,
  tgl_lahir TEXT, gender TEXT, gol_darah TEXT, alamat TEXT, provinsi TEXT, kota TEXT, komunitas TEXT,
  umat TEXT, asal TEXT, -- dari Pet Blessing: umat paroki (ya/bukan) dan asal paroki/wilayah
  berhenti_at TEXT, -- membalas STOP: tidak menerima blast lagi
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS contacts_hp ON contacts(hp);
CREATE TABLE IF NOT EXISTS ikut (
  id INTEGER PRIMARY KEY, contact_id INTEGER NOT NULL REFERENCES contacts(id), event_id INTEGER NOT NULL REFERENCES events(id),
  ref TEXT NOT NULL, status TEXT NOT NULL, daftar_at TEXT, UNIQUE(event_id, ref)
);
CREATE TABLE IF NOT EXISTS blasts (
  id INTEGER PRIMARY KEY, judul TEXT NOT NULL, pesan TEXT NOT NULL, poster TEXT, segmen TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'berjalan', dibuat_oleh TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), selesai_at TEXT
);
CREATE TABLE IF NOT EXISTS blast_penerima (
  id INTEGER PRIMARY KEY, blast_id INTEGER NOT NULL REFERENCES blasts(id), hp TEXT NOT NULL, nama TEXT,
  status TEXT NOT NULL DEFAULT 'antre', waktu TEXT, UNIQUE(blast_id, hp)
);
`);

// Database hanya menyimpan kolom yang dipakai: kolom lama (kode pos, jersey, kontak darurat, kode tiket) dibuang,
// kolom Pet Blessing (umat, asal) ditambahkan.
const kolom = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
for (const c of ["kode_pos", "jersey", "darurat_nama", "darurat_hp"]) if (kolom("contacts").includes(c)) db.exec(`ALTER TABLE contacts DROP COLUMN ${c}`);
if (kolom("ikut").includes("kode_tiket")) db.exec("ALTER TABLE ikut DROP COLUMN kode_tiket");
if (!kolom("ikut").includes("nomor")) db.exec("ALTER TABLE ikut ADD COLUMN nomor TEXT"); // nomor pendaftaran/order, untuk nama kontak
for (const c of ["umat", "asal"]) if (!kolom("contacts").includes(c)) db.exec(`ALTER TABLE contacts ADD COLUMN ${c} TEXT`);

export const setting = (key, fallback = null) => db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? fallback;
export const setSetting = (key, value) => db.prepare("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
export const catat = (admin, aksi, detail = null) => db.prepare("INSERT INTO log(admin, aksi, detail) VALUES (?, ?, ?)").run(admin, aksi, detail);
