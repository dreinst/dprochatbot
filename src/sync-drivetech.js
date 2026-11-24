import fs from "node:fs";
import pg from "pg";
import { db, setSetting } from "./db.js";
import { hp62, hapusYangHilang } from "./sync-kuwera.js";

// Sinkron kontak DriveTech Vol. 1 (database drivetech, akun baca dprochatbot_ro, lihat sql/drivetech-ro.sql):
// tenant (dealer, mitra booth, UMKM, penjual mobil bekas) dan pemesan serta peserta Jalan Sehat.
// Ada juga nomor yang cuma pernah chat soal DriveTech ke WA kantor tanpa mendaftar. Nomor itu dan nomor orang
// dalam kantor yang harus dilewati disimpan di DRIVETECH_KONTAK_FILE (JSON, di /data, bukan di repo):
//   { "kecuali": ["62..."], "tambahan": [{ "hp": "62...", "nama": "..." }] }
// Nomor di "tambahan" yang sudah ada di database DriveTech memakai nama dari "tambahan" (misalnya "Serda Haryo").
const EVENT = { kode: "drivetech-2026", nama: "DriveTech Vol. 1", kategori: "Otomotif", tanggal: "2026-11-07" };
const STATUS_JS = { lunas: "lunas", menunggu: "menunggu", dicek: "menunggu", batal: "batal" };

// Server Postgres-nya sama dengan KUWERA, jadi sertifikat CA dan servername SSL-nya juga sama.
let pool = null;
function drivetech() {
  if (!pool && process.env.DRIVETECH_DATABASE_URL) {
    const ca = process.env.KUWERA_DB_CA_FILE;
    pool = new pg.Pool({ connectionString: process.env.DRIVETECH_DATABASE_URL, max: 2,
      ssl: ca ? { ca: fs.readFileSync(ca, "utf8"), rejectUnauthorized: true, servername: process.env.KUWERA_DB_SERVERNAME || undefined } : undefined });
  }
  return pool;
}

function bacaFile() {
  const file = process.env.DRIVETECH_KONTAK_FILE || "/data/drivetech-kontak.json";
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (e.code === "ENOENT") return {}; throw e; }
}

export async function syncDrivetech() {
  const p = drivetech();
  if (!p) return { dilewati: "DRIVETECH_DATABASE_URL belum diatur" };
  const [tenant, pesanan, peserta] = await Promise.all([
    p.query("SELECT id, name, phone, created_at FROM tenants WHERE phone IS NOT NULL AND phone <> ''"),
    p.query("SELECT id, kode, nama, phone, status, created_at FROM jalan_sehat_pesanan"),
    p.query("SELECT id, nama, phone, created_at FROM jalan_sehat_peserta WHERE phone IS NOT NULL AND phone <> ''"),
  ]);
  const { kecuali = [], tambahan = [] } = bacaFile();
  const lewati = new Set(kecuali.map(hp62));
  const namaTambahan = new Map(tambahan.map((t) => [hp62(t.hp), String(t.nama).trim()]));

  const baris = [
    ...tenant.rows.map((r) => ({ ref: `tenant:${r.id}`, hp: r.phone, nama: r.name, status: "terdaftar", at: r.created_at })),
    ...pesanan.rows.map((r) => ({ ref: `js:${r.id}`, hp: r.phone, nama: r.nama, status: STATUS_JS[r.status] || "menunggu", at: r.created_at, nomor: r.kode })),
    ...peserta.rows.map((r) => ({ ref: `jsp:${r.id}`, hp: r.phone, nama: r.nama, status: "terdaftar", at: r.created_at })),
  ].map((b) => ({ ...b, hp: hp62(b.hp) })).filter((b) => b.hp && !lewati.has(b.hp));
  const adaDiDb = new Set(baris.map((b) => b.hp));
  for (const [hp, nama] of namaTambahan) {
    if (lewati.has(hp)) continue;
    if (adaDiDb.has(hp)) for (const b of baris) { if (b.hp === hp) b.nama = nama; }
    else baris.push({ ref: `chat:${hp}`, hp, nama, status: "terdaftar", at: null });
  }

  const upsertContact = db.prepare(`INSERT INTO contacts(kunci, nama, hp) VALUES (?, ?, ?)
    ON CONFLICT(kunci) DO UPDATE SET nama = excluded.nama, hp = excluded.hp, updated_at = datetime('now')`);
  const idOf = db.prepare("SELECT id FROM contacts WHERE kunci = ?");
  const upsertIkut = db.prepare(`INSERT INTO ikut(contact_id, event_id, ref, status, daftar_at, nomor) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id, ref) DO UPDATE SET contact_id = excluded.contact_id, status = excluded.status, nomor = excluded.nomor`);
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO events(kode, nama, kategori, tanggal, sumber) VALUES (?, ?, ?, ?, 'drivetech') ON CONFLICT(kode) DO NOTHING")
      .run(EVENT.kode, EVENT.nama, EVENT.kategori, EVENT.tanggal);
    const eventId = db.prepare("SELECT id FROM events WHERE kode = ?").get(EVENT.kode).id;
    for (const b of baris) {
      const nama = String(b.nama ?? "").trim() || b.hp;
      const kunci = `hp:${b.hp}:${nama.toLowerCase()}`;
      upsertContact.run(kunci, nama, b.hp);
      upsertIkut.run(idOf.get(kunci).id, eventId, b.ref, b.status, b.at?.toISOString?.() ?? b.at ?? null, b.nomor ?? null);
    }
    if (baris.length) hapusYangHilang(eventId, baris.map((b) => b.ref));
    db.exec("COMMIT");
  } catch (err) { db.exec("ROLLBACK"); throw err; }
  setSetting("sync_drivetech_at", new Date().toISOString());
  return { jumlah: baris.length };
}
