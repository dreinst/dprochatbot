import { db } from "./db.js";

// File kontak (.vcf) semua pelanggan dengan nama "EVENT NOMOR Nama" (misalnya "PB 088 Hanin Inaland"), diunduh dari
// dashboard lalu dibuka di HP kantor supaya semua kontak tersimpan sekaligus. Tiap nomor HP memakai pendaftaran
// terbarunya. Kontak yang sudah ada di HP dengan nomor sama biasanya digabung atau ditawarkan untuk diperbarui.
const LABEL = { "kuwera-2026": "KUWERA", "petblessing-2026": "PB", "pawrade-2026": "PAWRADE" };

const terbaru = db.prepare(`
  WITH t AS (
    SELECT c.hp, c.nama, e.kode, i.nomor,
           ROW_NUMBER() OVER (PARTITION BY c.hp ORDER BY i.daftar_at DESC, i.id DESC) AS r
      FROM contacts c JOIN ikut i ON i.contact_id = c.id JOIN events e ON e.id = i.event_id
     WHERE c.hp IS NOT NULL)
  SELECT hp, nama, kode, nomor FROM t WHERE r = 1 ORDER BY kode, nomor, nama`);

const v = (s) => s.replace(/[\\,;]/g, (m) => "\\" + m).replace(/\n/g, " ");

export function vcf() {
  return terbaru.all().map((t) => {
    const nama = v([LABEL[t.kode] || t.kode, t.nomor, t.nama.trim()].filter(Boolean).join(" "));
    return `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${nama}\r\nN:${nama};;;;\r\nTEL;TYPE=CELL:+${t.hp}\r\nEND:VCARD\r\n`;
  }).join("");
}
