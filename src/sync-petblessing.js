import pg from "pg";
import { db, setSetting } from "./db.js";
import { hp62 } from "./sync-kuwera.js";

// Sinkron pendaftar Pet Blessing 2026 dan Pawrade 2026 (database petblessing-db, akun baca dprochatbot_ro yang hanya
// melihat kolom nama, HP, umat, asal). Data uji tidak ikut. Kontak dikenali dari nomor HP + nama, jadi orang yang
// sama di KUWERA (tanpa NIK) atau di dua acara Pet Blessing tetap satu baris.
const KATEGORI = "Pet Blessing";
const EVENTS = [
  { kode: "petblessing-2026", nama: "Pet Blessing 2026", tanggal: "2026-10-04", sql: `SELECT id, queue_number, name, phone, is_parishioner, parish_origin, submitted_at FROM api.owners WHERE NOT is_test` },
  { kode: "pawrade-2026", nama: "Pawrade 2026", tanggal: null, sql: `SELECT id, queue_number, name, phone, is_parishioner, parish_origin, submitted_at FROM api.pawrade_owners` },
];

let pool = null;
const petblessing = () => (pool ??= process.env.PETBLESSING_DATABASE_URL ? new pg.Pool({ connectionString: process.env.PETBLESSING_DATABASE_URL, max: 2 }) : null);

export async function syncPetBlessing() {
  const p = petblessing();
  if (!p) return { dilewati: "PETBLESSING_DATABASE_URL belum diatur" };
  const hasil = [];
  for (const e of EVENTS) hasil.push([e, (await p.query(e.sql)).rows]);

  const upsertEvent = db.prepare("INSERT INTO events(kode, nama, kategori, tanggal, sumber) VALUES (?, ?, ?, ?, 'petblessing') ON CONFLICT(kode) DO NOTHING");
  const upsertContact = db.prepare(`INSERT INTO contacts(kunci, nama, hp, umat, asal) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(kunci) DO UPDATE SET nama = excluded.nama, hp = excluded.hp, umat = excluded.umat, asal = excluded.asal, updated_at = datetime('now')`);
  const idOf = db.prepare("SELECT id FROM contacts WHERE kunci = ?");
  const upsertIkut = db.prepare(`INSERT INTO ikut(contact_id, event_id, ref, status, daftar_at, nomor) VALUES (?, ?, ?, 'terdaftar', ?, ?)
    ON CONFLICT(event_id, ref) DO UPDATE SET contact_id = excluded.contact_id, nomor = excluded.nomor`);
  db.exec("BEGIN");
  try {
    for (const [e, rows] of hasil) {
      upsertEvent.run(e.kode, e.nama, KATEGORI, e.tanggal);
      const eventId = db.prepare("SELECT id FROM events WHERE kode = ?").get(e.kode).id;
      for (const r of rows) {
        const hp = hp62(r.phone);
        const nama = String(r.name).trim();
        const kunci = `hp:${hp}:${nama.toLowerCase()}`;
        upsertContact.run(kunci, nama, hp, r.is_parishioner, r.parish_origin?.trim() || null);
        upsertIkut.run(idOf.get(kunci).id, eventId, `${e.kode}:${r.id}`, r.submitted_at?.toISOString() ?? null, r.queue_number == null ? null : String(r.queue_number).padStart(3, "0"));
      }
    }
    db.exec("COMMIT");
  } catch (err) { db.exec("ROLLBACK"); throw err; }
  setSetting("sync_petblessing_at", new Date().toISOString());
  return { jumlah: hasil.reduce((n, [, rows]) => n + rows.length, 0) };
}
