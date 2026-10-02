import fs from "node:fs";
import path from "node:path";
import { db } from "./db.js";

// Simpan semua kontak ke WhatsApp nomor kantor dengan nama "EVENT NOMOR Nama" (misalnya "PB 088 Hanin Inaland").
// Tiap nomor HP memakai pendaftaran terbarunya. Bot kantor (kuwera-wa-bot) yang menyimpan, lewat berkas tipe "kontak"
// di outbox-nya. Satu kontak tiap 2 menit (30 per jam) supaya tidak membanjiri sinkron WhatsApp; kontak yang namanya
// berubah (misalnya ikut event baru) disimpan ulang.
const BOT = process.env.BOT_DATA || "/bot-data";
const LABEL = { "kuwera-2026": "KUWERA", "petblessing-2026": "PB", "pawrade-2026": "PAWRADE" };

const berikutnya = db.prepare(`
  WITH terbaru AS (
    SELECT c.hp, c.nama, e.kode, i.nomor,
           ROW_NUMBER() OVER (PARTITION BY c.hp ORDER BY i.daftar_at DESC, i.id DESC) AS r
      FROM contacts c JOIN ikut i ON i.contact_id = c.id JOIN events e ON e.id = i.event_id
     WHERE c.hp IS NOT NULL)
  SELECT t.hp, t.nama, t.kode, t.nomor, k.nama AS tersimpan FROM terbaru t LEFT JOIN kontak_wa k ON k.hp = t.hp WHERE t.r = 1`);

export function tickKontak() {
  for (const t of berikutnya.all()) {
    const nama = [LABEL[t.kode] || t.kode, t.nomor, t.nama.trim()].filter(Boolean).join(" ");
    if (nama === t.tersimpan) continue;
    fs.mkdirSync(path.join(BOT, "outbox"), { recursive: true });
    const file = path.join(BOT, "outbox", `${Date.now()}-kontak.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ tipe: "kontak", jid: `${t.hp}@s.whatsapp.net`, nama }));
    fs.renameSync(`${file}.tmp`, file);
    db.prepare("INSERT INTO kontak_wa(hp, nama) VALUES (?, ?) ON CONFLICT(hp) DO UPDATE SET nama = excluded.nama, waktu = datetime('now')").run(t.hp, nama);
    return;
  }
}
