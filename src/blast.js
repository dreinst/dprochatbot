import fs from "node:fs";
import path from "node:path";
import { db, catat } from "./db.js";

// Blast WhatsApp lewat bot kantor (kuwera-wa-bot): tiap pesan ditulis sebagai berkas ke folder outbox bot, lalu bot
// mengirimnya. Supaya nomor kantor tidak ditandai spam: satu pesan tiap 45 sampai 90 detik (acak), hanya pukul
// 08.00 sampai 20.00 WIB, paling banyak BLAST_PER_HARI pesan per hari, dan kontak yang membalas STOP dilewati.
const BOT = process.env.BOT_DATA || "/bot-data";
const PER_HARI = Number(process.env.BLAST_PER_HARI || 200);
export const PENUTUP = "\n\nBalas STOP kalau tidak ingin menerima info event dari kami lagi.";

// Segmen: kategori (misalnya Lari), event tertentu, dan status keikutsertaan (lunas, menunggu, kedaluwarsa, batal).
function segmenQuery(seg) {
  const where = ["c.hp IS NOT NULL", "c.berhenti_at IS NULL"];
  const args = [];
  if (seg.kategori) { where.push("e.kategori = ?"); args.push(seg.kategori); }
  if (seg.event) { where.push("e.kode = ?"); args.push(seg.event); }
  if (seg.status?.length) { where.push(`i.status IN (${seg.status.map(() => "?").join(",")})`); args.push(...seg.status); }
  return { sql: `FROM contacts c JOIN ikut i ON i.contact_id = c.id JOIN events e ON e.id = i.event_id WHERE ${where.join(" AND ")}`, args };
}

export function penerima(seg) {
  const q = segmenQuery(seg);
  return db.prepare(`SELECT c.hp, MIN(c.nama) AS nama ${q.sql} GROUP BY c.hp ORDER BY MIN(c.nama)`).all(...q.args);
}

export function buatBlast({ judul, pesan, poster, posterNama, segmen }, admin) {
  const list = penerima(segmen);
  if (!list.length) throw new Error("Tidak ada penerima di segmen ini");
  let posterFile = null;
  if (poster) {
    const buf = Buffer.from(poster, "base64");
    if (buf.length > 5 * 1024 * 1024) throw new Error("Poster maksimal 5 MB");
    const ext = (path.extname(posterNama || "").toLowerCase().match(/^\.(jpe?g|png|webp)$/) || [".jpg"])[0];
    // Bot mengirim gambar dari /data/media (folder yang sama dipakai balasan CS bergambar).
    posterFile = `blast-${Date.now()}${ext}`;
    fs.mkdirSync(path.join(BOT, "media"), { recursive: true });
    fs.writeFileSync(path.join(BOT, "media", posterFile), buf);
  }
  db.exec("BEGIN");
  try {
    const { lastInsertRowid: id } = db.prepare("INSERT INTO blasts(judul, pesan, poster, segmen, dibuat_oleh) VALUES (?, ?, ?, ?, ?)")
      .run(judul, pesan, posterFile, JSON.stringify(segmen), admin);
    const ins = db.prepare("INSERT OR IGNORE INTO blast_penerima(blast_id, hp, nama) VALUES (?, ?, ?)");
    for (const p of list) ins.run(id, p.hp, p.nama);
    db.exec("COMMIT");
    catat(admin, "buat_blast", `#${id} ${judul} ke ${list.length} kontak`);
    return Number(id);
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}

const jamWib = () => Number(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta", hour: "2-digit", hour12: false }));
let nextAt = 0;

export function tickBlast() {
  if (Date.now() < nextAt) return;
  const jam = jamWib();
  if (jam < 8 || jam >= 20) return;
  const hariIni = db.prepare("SELECT count(*) AS n FROM blast_penerima WHERE status = 'terkirim' AND date(waktu, '+7 hours') = date('now', '+7 hours')").get().n;
  if (hariIni >= PER_HARI) return;
  const b = db.prepare("SELECT * FROM blasts WHERE status = 'berjalan' ORDER BY id LIMIT 1").get();
  if (!b) return;
  const p = db.prepare("SELECT * FROM blast_penerima WHERE blast_id = ? AND status = 'antre' ORDER BY id LIMIT 1").get(b.id);
  if (!p) {
    db.prepare("UPDATE blasts SET status = 'selesai', selesai_at = datetime('now') WHERE id = ?").run(b.id);
    return;
  }
  if (db.prepare("SELECT 1 FROM contacts WHERE hp = ? AND berhenti_at IS NOT NULL").get(p.hp)) {
    db.prepare("UPDATE blast_penerima SET status = 'dilewati', waktu = datetime('now') WHERE id = ?").run(p.id);
    return;
  }
  const nama = (p.nama || "").split(" ")[0] || "Kak";
  const text = b.pesan.replaceAll("{nama}", nama) + PENUTUP;
  fs.mkdirSync(path.join(BOT, "outbox"), { recursive: true });
  const file = path.join(BOT, "outbox", `${Date.now()}-blast-${b.id}-${p.id}.json`);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ jid: `${p.hp}@s.whatsapp.net`, text, image: b.poster || undefined, topik: `blast #${b.id}` }));
  fs.renameSync(`${file}.tmp`, file);
  db.prepare("UPDATE blast_penerima SET status = 'terkirim', waktu = datetime('now') WHERE id = ?").run(p.id);
  nextAt = Date.now() + (45 + Math.random() * 45) * 1000;
}

export function hentikanBlast(id, admin) {
  db.prepare("UPDATE blasts SET status = 'dihentikan', selesai_at = datetime('now') WHERE id = ? AND status = 'berjalan'").run(id);
  catat(admin, "hentikan_blast", `#${id}`);
}
