import fs from "node:fs";
import { createHash } from "node:crypto";
import pg from "pg";
import { db, setting, setSetting } from "./db.js";

// Sinkron pendaftar KUWERA Fun Run 5K 2026 (database KUWERA, akun khusus baca dprochatbot_ro) ke database ini.
// NIK tidak disalin utuh: yang disimpan hanya versi tersamar (tampil di dashboard) dan hash-nya (untuk mengenali
// orang yang sama di event lain). Order data uji tidak ikut.
const EVENT = { kode: "kuwera-2026", nama: "KUWERA Fun Run 5K 2026", kategori: "Lari", tanggal: "2026-10-24", sumber: "kuwera5k" };
const STATUS = { PAID: "lunas", PENDING: "menunggu", EXPIRED: "kedaluwarsa", FAILED: "batal", REFUNDED: "batal", DRAFT: "menunggu" };

export const hp62 = (v) => { const d = String(v || "").replace(/\D/g, ""); return d.startsWith("0") ? "62" + d.slice(1) : d.startsWith("62") ? d : d ? "62" + d : null; };
const samar = (nik) => (nik && nik.length >= 8 ? `${nik.slice(0, 4)}********${nik.slice(-4)}` : null);
const sha = (s) => createHash("sha256").update(s).digest("hex");

let pool = null;
function kuwera() {
  if (!pool && process.env.KUWERA_DATABASE_URL) {
    const ca = process.env.KUWERA_DB_CA_FILE;
    pool = new pg.Pool({ connectionString: process.env.KUWERA_DATABASE_URL, max: 2,
      ssl: ca ? { ca: fs.readFileSync(ca, "utf8"), rejectUnauthorized: true, servername: process.env.KUWERA_DB_SERVERNAME || undefined } : undefined });
  }
  return pool;
}

export async function syncKuwera() {
  const p = kuwera();
  if (!p) return { dilewati: "KUWERA_DATABASE_URL belum diatur" };
  const { rows } = await p.query(`
    SELECT pa.id, pa."fullName", pa."idNumber", pa."birthDate", pa.gender, pa."bloodType", pa.phone, pa.email, pa.address,
           pa.province, pa.city, pa.community,
           o.id AS "orderId", o.status, o."createdAt", o.source
      FROM "Participant" pa JOIN "Order" o ON o.id = pa."orderId"
     WHERE NOT o."isTest"`);
  db.prepare("INSERT INTO events(kode, nama, kategori, tanggal, sumber) VALUES (?, ?, ?, ?, ?) ON CONFLICT(kode) DO NOTHING")
    .run(EVENT.kode, EVENT.nama, EVENT.kategori, EVENT.tanggal, EVENT.sumber);
  const eventId = db.prepare("SELECT id FROM events WHERE kode = ?").get(EVENT.kode).id;
  const upsertContact = db.prepare(`INSERT INTO contacts(kunci, nama, hp, email, nik_samar, tgl_lahir, gender, gol_darah, alamat, provinsi, kota, komunitas)
    VALUES (@kunci, @nama, @hp, @email, @nik_samar, @tgl_lahir, @gender, @gol_darah, @alamat, @provinsi, @kota, @komunitas)
    ON CONFLICT(kunci) DO UPDATE SET nama = excluded.nama, hp = excluded.hp, email = excluded.email, nik_samar = excluded.nik_samar,
      tgl_lahir = excluded.tgl_lahir, gender = excluded.gender, gol_darah = excluded.gol_darah, alamat = excluded.alamat, provinsi = excluded.provinsi,
      kota = excluded.kota, komunitas = excluded.komunitas, updated_at = datetime('now')`);
  const idOf = db.prepare("SELECT id FROM contacts WHERE kunci = ?");
  const upsertIkut = db.prepare(`INSERT INTO ikut(contact_id, event_id, ref, status, daftar_at, nomor) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id, ref) DO UPDATE SET contact_id = excluded.contact_id, status = excluded.status, nomor = excluded.nomor`);
  db.exec("BEGIN");
  try {
    for (const r of rows) {
      const hp = hp62(r.phone);
      const kunci = r.idNumber && /^\d{16}$/.test(r.idNumber) ? `nik:${sha(r.idNumber)}` : `hp:${hp}:${String(r.fullName).toLowerCase()}`;
      upsertContact.run({
        kunci, nama: r.fullName, hp, email: r.email || null, nik_samar: samar(r.idNumber),
        tgl_lahir: r.source === "kudam" ? null : r.birthDate?.toISOString().slice(0, 10) ?? null,
        gender: r.source === "kudam" ? null : r.gender, gol_darah: r.bloodType, alamat: r.address, provinsi: r.province, kota: r.city,
        komunitas: r.community,
      });
      upsertIkut.run(idOf.get(kunci).id, eventId, `kuwera:${r.id}`, STATUS[r.status] || "menunggu", r.createdAt?.toISOString() ?? null, r.orderId.split("-").pop());
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  setSetting("sync_kuwera_at", new Date().toISOString());
  return { peserta: rows.length };
}

// Balasan STOP/MULAI ke nomor kantor dicatat bot WA di /bot-data/blast-stop/berhenti.jsonl. Berkasnya kecil, jadi dibaca utuh
// setiap kali; aksi terakhir per nomor yang berlaku, termasuk untuk kontak yang baru masuk setelah dia membalas STOP.
export function syncBerhenti() {
  const file = process.env.BERHENTI_FILE || "/bot-data/blast-stop/berhenti.jsonl";
  if (!fs.existsSync(file)) return 0;
  const akhir = new Map();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    const hp = hp62(e.phone);
    if (hp) akhir.set(hp, e.aksi === "mulai" ? null : new Date(e.waktu || Date.now()).toISOString());
  }
  const upd = db.prepare("UPDATE contacts SET berhenti_at = ? WHERE hp = ? AND berhenti_at IS NOT ?");
  for (const [hp, waktu] of akhir) upd.run(waktu, hp, waktu);
  return akhir.size;
}
