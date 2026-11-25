import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

// Cermin chat WhatsApp nomor kantor: salinan hanya baca dari webhook WAHA (message.any, message.revoked, message.edited)
// dan dari penarik riwayat (cermin-tarik.js). Disimpan di database terpisah supaya data chat pribadi bisa dihapus atau
// dicadangkan sendiri. Modul ini tidak pernah mengirim pesan dan tidak pernah mengambil media.url. Log konsol tidak
// boleh memuat isi pesan, nama, atau nomor.
const berkas = process.env.CERMIN_DB || "/data/cermin.db";
fs.mkdirSync(path.dirname(berkas), { recursive: true });
export const cdb = new DatabaseSync(berkas);
cdb.exec(`
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS cermin_chat (
  jid TEXT PRIMARY KEY, nama TEXT, grup INTEGER NOT NULL DEFAULT 0, terakhir_at INTEGER, jumlah INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cermin_pesan (
  id TEXT NOT NULL, jid TEXT NOT NULL, waktu INTEGER NOT NULL, pengirim TEXT NOT NULL, peserta_nomor TEXT, peserta_nama TEXT,
  jenis TEXT NOT NULL, teks TEXT, nama_berkas TEXT, balas_id TEXT, diedit_at INTEGER, dihapus_at INTEGER, asal TEXT NOT NULL,
  UNIQUE(id, jid)
);
CREATE INDEX IF NOT EXISTS cermin_pesan_jid_waktu ON cermin_pesan(jid, waktu);
CREATE INDEX IF NOT EXISTS cermin_pesan_waktu ON cermin_pesan(waktu);
CREATE TABLE IF NOT EXISTS cermin_dilihat (admin TEXT NOT NULL, jid TEXT NOT NULL, dilihat_at INTEGER NOT NULL, PRIMARY KEY(admin, jid));
CREATE TABLE IF NOT EXISTS cermin_lid (lid TEXT PRIMARY KEY, nomor TEXT NOT NULL, diperbarui_at INTEGER NOT NULL);
`);

const detik = () => Math.floor(Date.now() / 1000);
const digit = (s) => String(s ?? "").replace(/\D/g, "");
const MAKS_BADAN = 1024 * 1024;

// ---------- Nomor dan pengecualian ----------
// Nomor dibandingkan lewat 10 digit terakhir supaya 0819..., 62819..., dan +62 819... dianggap sama.
const ekor = (s) => digit(s).slice(-10);
export function dikecualikan(nomor) {
  const n = ekor(nomor);
  if (n.length < 8) return false;
  const daftar = (process.env.CERMIN_KECUALI ?? "6281938938800").split(",").map(ekor).filter((x) => x.length >= 8);
  return daftar.includes(n);
}

// Pencari LID bisa diganti (tes). Bawaannya memanggil WAHA lewat pembungkus GET di cermin-tarik.js (diimpor malas supaya tidak melingkar).
let pencariLid = async (lid) => (await import("./cermin-tarik.js")).cariLid(lid);
export const aturPencariLid = (fn) => { pencariLid = fn; };
const lidGagal = new Map(); // lid -> waktu gagal terakhir, supaya WAHA tidak dihujani permintaan untuk LID yang belum bisa diterjemahkan
const bersihLid = (jid) => String(jid).replace(/:\d+@/, "@");

async function nomorDariLid(lid) {
  const baris = cdb.prepare("SELECT nomor FROM cermin_lid WHERE lid = ?").get(lid);
  if (baris) return baris.nomor;
  if (Date.now() - (lidGagal.get(lid) || 0) < 5 * 60_000) return null;
  let nomor = null;
  try { nomor = digit(await pencariLid(lid)) || null; } catch { nomor = null; }
  if (!nomor) { lidGagal.set(lid, Date.now()); return null; }
  cdb.prepare("INSERT INTO cermin_lid(lid, nomor, diperbarui_at) VALUES (?, ?, ?) ON CONFLICT(lid) DO UPDATE SET nomor = excluded.nomor, diperbarui_at = excluded.diperbarui_at").run(lid, nomor, detik());
  return nomor;
}

// Mengubah id chat atau peserta jadi { jid, nomor, grup }. Mengembalikan null kalau tidak boleh disimpan atau belum bisa diterjemahkan
// (status, saluran, atau LID tanpa nomor). `alt` adalah jid nomor dari _data.Info bila ada, dipakai sebelum bertanya ke WAHA.
export async function selesaikanJid(jid, alt = "") {
  jid = bersihLid(jid || "");
  if (!jid || jid === "status@broadcast" || jid.endsWith("@broadcast") || jid.endsWith("@newsletter")) return null;
  if (jid.endsWith("@g.us")) return { jid, nomor: null, grup: 1 };
  let nomor = null;
  if (jid.endsWith("@c.us") || jid.endsWith("@s.whatsapp.net")) nomor = digit(jid.split("@")[0]);
  else if (jid.endsWith("@lid")) {
    // SenderAlt dari endpoint riwayat bisa membawa kode perangkat ("62xx:12@s.whatsapp.net"), jadi dibuang dulu
    // supaya nomor tidak tergabung dengan kode itu (bug 25 Nov 2026: pesan owner di grup lolos dari pengecualian).
    const a = bersihLid(alt || "");
    const dariAlt = /@(s\.whatsapp\.net|c\.us)$/.test(a) ? digit(a.split("@")[0]) : "";
    nomor = dariAlt || (await nomorDariLid(jid));
  }
  return nomor ? { jid: `${nomor}@c.us`, nomor, grup: 0 } : null;
}

// ---------- Mengurai payload WAHA (GOWS) ----------
// Id pesan WAHA: "true_628xx@c.us_3EB0ABC" atau di grup "false_xxx@g.us_3EB0ABC_628yy@lid". Id polos = bagian sesudah jid chat.
export function idPolos(id) {
  const bagian = String(id ?? "").split("_");
  const i = bagian.findIndex((b) => b.includes("@"));
  return (i >= 0 && bagian[i + 1]) || bagian.at(-1) || "";
}
const BUNGKUS = ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension", "documentWithCaptionMessage"];
function protoGows(p) {
  let m = p?._data?.Message;
  for (let i = 0; i < 5 && m; i++) { const k = BUNGKUS.find((x) => m[x]?.message); if (!k) break; m = m[k].message; }
  return m || null;
}
const ABAIKAN = new Set(["messageContextInfo", "senderKeyDistributionMessage"]);
const TIDAK_DICATAT = new Set(["reactionMessage", "encReactionMessage", "pollUpdateMessage"]);
// Jenis media dan teks dari proto. Hanya jenis, nama berkas, dan keterangan; media.url tidak pernah dibaca.
function jenis(p) {
  const m = protoGows(p);
  const mime = String(p?.media?.mimetype || "");
  const dariMime = () => (mime.startsWith("image/webp") ? "stiker" : mime.startsWith("image/") ? "gambar" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "suara" : "dokumen");
  if (!m) { // mesin lain atau payload tanpa proto: pakai body dan hasMedia
    if (p?.hasMedia) return { jenis: dariMime(), teks: p.body || null, namaBerkas: p.media?.filename || null };
    if (p?.location) return { jenis: "lokasi", teks: p.location.name || p.location.address || p.body || null };
    if (Array.isArray(p?.vCards) && p.vCards.length) return { jenis: "kontak", teks: p.body || null };
    return p?.body ? { jenis: "teks", teks: String(p.body) } : null;
  }
  if (m.protocolMessage) return { protokol: m.protocolMessage };
  const kunci = Object.keys(m).filter((k) => !ABAIKAN.has(k));
  if (!kunci.length || kunci.some((k) => TIDAK_DICATAT.has(k))) return null;
  const balas = m.extendedTextMessage?.contextInfo?.stanzaID || m.extendedTextMessage?.contextInfo?.stanzaId || null;
  if (m.conversation != null) return { jenis: "teks", teks: m.conversation, balas };
  if (m.extendedTextMessage) return { jenis: "teks", teks: m.extendedTextMessage.text ?? p.body ?? "", balas };
  const ctx = (x) => x?.contextInfo?.stanzaID || x?.contextInfo?.stanzaId || null;
  if (m.imageMessage) return { jenis: "gambar", teks: m.imageMessage.caption || null, balas: ctx(m.imageMessage) };
  if (m.videoMessage) return { jenis: "video", teks: m.videoMessage.caption || null, balas: ctx(m.videoMessage) };
  if (m.audioMessage) return { jenis: "suara", balas: ctx(m.audioMessage) };
  if (m.documentMessage) return { jenis: "dokumen", teks: m.documentMessage.caption || null, namaBerkas: m.documentMessage.fileName || p.media?.filename || null, balas: ctx(m.documentMessage) };
  if (m.stickerMessage) return { jenis: "stiker" };
  if (m.contactMessage) return { jenis: "kontak", teks: m.contactMessage.displayName || null };
  if (m.contactsArrayMessage) return { jenis: "kontak", teks: m.contactsArrayMessage.displayName || null };
  const lok = m.locationMessage || m.liveLocationMessage;
  if (lok) return { jenis: "lokasi", teks: lok.name || lok.address || lok.caption || null };
  const tombol = m.buttonsResponseMessage?.selectedDisplayText || m.templateButtonReplyMessage?.selectedDisplayText || m.listResponseMessage?.title;
  if (tombol) return { jenis: "teks", teks: tombol };
  return { jenis: "lainnya", teks: p.body || null };
}

const waktuPesan = (p) => { const t = Number(p?.timestamp); return !t ? detik() : t > 1e12 ? Math.floor(t / 1000) : Math.floor(t); };
const potong = (s, n = 20000) => (s == null ? null : String(s).slice(0, n));

function simpanChat(c, nama, waktu, tambah) {
  cdb.prepare(`INSERT INTO cermin_chat(jid, nama, grup, terakhir_at, jumlah) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET nama = COALESCE(NULLIF(?, ''), nama), terakhir_at = MAX(COALESCE(terakhir_at, 0), excluded.terakhir_at), jumlah = jumlah + ?`)
    .run(c.jid, nama || null, c.grup, waktu, tambah, nama || "", tambah);
}

// Simpan satu pesan. Hasil: "baru", "dobel", "lewat" (jenis yang memang tidak dicatat), "kecuali" (nomor dikecualikan),
// "tunda" (LID belum bisa diterjemahkan, nanti diambil penarik), atau "edit" (pesan edit yang datang lewat message.any).
export async function simpanPesan(p, asal = "webhook") {
  if (!p || typeof p !== "object") return "lewat";
  if (p.editedMessageId) return ubahPesan(p);
  const fromMe = !!p.fromMe;
  const info = p._data?.Info || {};
  const mentah = fromMe ? p.to : p.from;
  const chat = await selesaikanJid(mentah, fromMe ? info.RecipientAlt : info.SenderAlt);
  if (!chat) return String(mentah).endsWith("@lid") ? "tunda" : "lewat";
  if (chat.nomor && dikecualikan(chat.nomor)) return "kecuali";
  const j = jenis(p);
  if (!j) return "lewat";
  if (j.protokol) { // pesan edit yang dibungkus protokol: tangani kalau bentuknya dikenali, selainnya dilewati
    const t = j.protokol;
    const baru = t.editedMessage?.conversation ?? t.editedMessage?.extendedTextMessage?.text;
    return t.key?.ID && baru != null ? ubahPesan({ ...p, editedMessageId: t.key.ID, body: baru }) : "lewat";
  }
  let peserta = { nomor: null };
  if (chat.grup && !fromMe) {
    const pr = await selesaikanJid(p.participant || info.Sender, info.SenderAlt);
    if (!pr) return String(p.participant || "").endsWith("@lid") ? "tunda" : "lewat";
    if (pr.nomor && dikecualikan(pr.nomor)) return "kecuali";
    peserta = pr;
  }
  const pengirim = fromMe ? (p.source === "api" ? "bot" : "admin") : "pelanggan";
  const id = idPolos(p.id);
  if (!id) return "lewat";
  const waktu = waktuPesan(p);
  const pushName = !fromMe && info.PushName ? String(info.PushName).slice(0, 120) : null;
  const balas = idPolos(p.replyTo?.id) || j.balas || null;
  cdb.exec("BEGIN");
  try {
    const r = cdb.prepare(`INSERT INTO cermin_pesan(id, jid, waktu, pengirim, peserta_nomor, peserta_nama, jenis, teks, nama_berkas, balas_id, asal)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id, jid) DO NOTHING`)
      .run(id, chat.jid, waktu, pengirim, peserta.nomor, chat.grup ? pushName : null, j.jenis, potong(j.teks), potong(j.namaBerkas, 300), balas, asal);
    simpanChat(chat, chat.grup ? null : pushName, waktu, r.changes);
    cdb.exec("COMMIT");
    return r.changes ? "baru" : "dobel";
  } catch (e) { cdb.exec("ROLLBACK"); throw e; }
}

// message.edited: { id (aksi edit), editedMessageId, body, fromMe, from, to, timestamp }.
export async function ubahPesan(p) {
  const chat = await selesaikanJid(p.fromMe ? p.to : p.from);
  if (chat?.nomor && dikecualikan(chat.nomor)) return "kecuali";
  const id = idPolos(p.editedMessageId);
  if (!id) return "lewat";
  const teks = p.body ?? p._data?.Message?.conversation ?? null;
  const r = chat
    ? cdb.prepare("UPDATE cermin_pesan SET teks = ?, diedit_at = ? WHERE id = ? AND jid = ?").run(potong(teks), waktuPesan(p), id, chat.jid)
    : cdb.prepare("UPDATE cermin_pesan SET teks = ?, diedit_at = ? WHERE id = ?").run(potong(teks), waktuPesan(p), id);
  return r.changes ? "edit" : "lewat";
}

// message.revoked: { after: { id, from, to, fromMe, timestamp }, revokedMessageId, before }. Isi pesan tetap disimpan, hanya ditandai.
export async function hapusPesan(p) {
  const id = idPolos(p.revokedMessageId || p.before?.id);
  if (!id) return "lewat";
  const ref = p.after || p.before || {};
  const chat = ref.from || ref.to ? await selesaikanJid(ref.fromMe ? ref.to : ref.from) : null;
  const waktu = ref.timestamp ? waktuPesan(ref) : detik();
  const r = chat
    ? cdb.prepare("UPDATE cermin_pesan SET dihapus_at = ? WHERE id = ? AND jid = ? AND dihapus_at IS NULL").run(waktu, id, chat.jid)
    : cdb.prepare("UPDATE cermin_pesan SET dihapus_at = ? WHERE id = ? AND dihapus_at IS NULL").run(waktu, id);
  return r.changes ? "hapus" : "lewat";
}

// Nama chat dari penarik (daftar chat atau overview). Hanya memperbarui chat yang sudah punya pesan.
export function setNamaChat(jid, nama) {
  if (nama && String(nama).trim() && digit(nama) !== digit(jid)) cdb.prepare("UPDATE cermin_chat SET nama = ? WHERE jid = ?").run(String(nama).slice(0, 120), jid);
}

// Satu event webhook. Sesi selain CERMIN_SESI diabaikan.
export async function olahEvent(ev) {
  if (!ev || ev.session !== (process.env.CERMIN_SESI || "kantor")) return "lewat";
  if (ev.event === "message.any") return simpanPesan(ev.payload, "webhook");
  if (ev.event === "message.edited") return ubahPesan(ev.payload || {});
  if (ev.event === "message.revoked") return hapusPesan(ev.payload || {});
  return "lewat";
}

// ---------- Listener webhook ----------
export function tandaTanganSah(badan, header, kunci) {
  if (!kunci || typeof header !== "string") return false;
  const harapan = Buffer.from(createHmac("sha512", kunci).update(badan).digest("hex"));
  const dapat = Buffer.from(header.trim().toLowerCase());
  return dapat.length === harapan.length && timingSafeEqual(dapat, harapan);
}

export function buatListener(kunci = process.env.CERMIN_HMAC) {
  return http.createServer((req, res) => {
    const balas = (kode) => { res.writeHead(kode, { "Content-Type": "text/plain" }); res.end(); };
    if (req.method !== "POST" || req.url.split("?")[0] !== "/webhook") return balas(404);
    if (Number(req.headers["content-length"]) > MAKS_BADAN) { balas(413); return req.destroy(); }
    const potongan = []; let ukuran = 0; let tolak = false;
    req.on("data", (c) => {
      if (tolak) return;
      ukuran += c.length;
      if (ukuran > MAKS_BADAN) { tolak = true; balas(413); return req.destroy(); }
      potongan.push(c);
    });
    req.on("end", () => {
      if (tolak) return;
      const badan = Buffer.concat(potongan);
      if (!tandaTanganSah(badan, req.headers["x-webhook-hmac"], kunci)) return balas(401);
      let ev;
      try { ev = JSON.parse(badan.toString()); } catch { return balas(400); }
      balas(200); // jawab dulu, olah sesudahnya
      olahEvent(ev).catch((e) => console.error(`cermin: gagal mengolah event (${e?.name || "galat"})`));
    });
    req.on("error", () => {});
  });
}

export function nyalakanListener() {
  const kunci = process.env.CERMIN_HMAC;
  if (!kunci) { console.log("cermin: CERMIN_HMAC kosong, listener webhook tidak dinyalakan"); return null; }
  const port = Number(process.env.CERMIN_PORT || 3020);
  const s = buatListener(kunci);
  s.on("error", () => console.error("cermin: listener webhook gagal dinyalakan"));
  s.listen(port, () => console.log(`cermin: webhook di port ${port}`));
  return s;
}

// ---------- Retensi ----------
export function hapusLama(hari = Number(process.env.CERMIN_HARI || 180), sekarang = detik()) {
  const batas = sekarang - hari * 86400;
  cdb.exec("BEGIN");
  try {
    const p = cdb.prepare("DELETE FROM cermin_pesan WHERE waktu < ?").run(batas).changes;
    cdb.exec(`UPDATE cermin_chat SET jumlah = (SELECT count(*) FROM cermin_pesan p WHERE p.jid = cermin_chat.jid),
      terakhir_at = (SELECT max(waktu) FROM cermin_pesan p WHERE p.jid = cermin_chat.jid)`);
    const c = cdb.prepare("DELETE FROM cermin_chat WHERE jumlah = 0").run().changes;
    cdb.exec("DELETE FROM cermin_dilihat WHERE jid NOT IN (SELECT jid FROM cermin_chat)");
    cdb.exec("COMMIT");
    return { pesan: p, chat: c };
  } catch (e) { cdb.exec("ROLLBACK"); throw e; }
}
// Milidetik sampai 03.00 WIB berikutnya (= 20.00 UTC).
export function msKeRetensi(sekarang = Date.now()) {
  const d = new Date(sekarang);
  let target = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 20, 0, 0);
  if (target <= sekarang) target += 86400_000;
  return target - sekarang;
}
export function jadwalkanRetensi() {
  const jalan = () => {
    try {
      const r = hapusLama();
      const hariWib = new Date(Date.now() + 7 * 3600_000).getUTCDay();
      if (hariWib === 0) cdb.exec("VACUUM"); // seminggu sekali, Minggu dini hari
      console.log(`cermin: retensi menghapus ${r.pesan} pesan dan ${r.chat} chat`);
    } catch (e) { console.error(`cermin: retensi gagal (${e?.name || "galat"})`); }
    setTimeout(jalan, msKeRetensi()).unref();
  };
  setTimeout(jalan, msKeRetensi()).unref();
}

// ---------- Kueri untuk halaman ----------
const lolos = (s) => `%${String(s).replace(/[\\%_]/g, (c) => "\\" + c)}%`;
export function daftarChat(admin, { tipe = "", q = "", dari = "", hal = 1 } = {}, per = 50) {
  const where = [], args = [];
  if (tipe === "pribadi") where.push("c.grup = 0");
  if (tipe === "grup") where.push("c.grup = 1");
  if (["pelanggan", "bot", "admin"].includes(dari)) { where.push("EXISTS (SELECT 1 FROM cermin_pesan p WHERE p.jid = c.jid AND p.pengirim = ?)"); args.push(dari); }
  if (q.trim()) {
    const t = lolos(q.trim());
    where.push(`(c.nama LIKE ? ESCAPE '\\' OR c.jid LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM cermin_pesan p WHERE p.jid = c.jid AND (p.teks LIKE ? ESCAPE '\\' OR p.nama_berkas LIKE ? ESCAPE '\\' OR p.peserta_nama LIKE ? ESCAPE '\\')))`);
    args.push(t, t, t, t, t);
  }
  const sql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = cdb.prepare(`SELECT count(*) AS n FROM cermin_chat c ${sql}`).get(...args).n;
  const baris = cdb.prepare(`SELECT c.*,
      (SELECT count(*) FROM cermin_pesan p WHERE p.jid = c.jid AND p.waktu > COALESCE((SELECT dilihat_at FROM cermin_dilihat d WHERE d.admin = ? AND d.jid = c.jid), 0)) AS baru,
      (SELECT p.pengirim FROM cermin_pesan p WHERE p.jid = c.jid ORDER BY p.waktu DESC, p.rowid DESC LIMIT 1) AS akhir_pengirim,
      (SELECT p.jenis FROM cermin_pesan p WHERE p.jid = c.jid ORDER BY p.waktu DESC, p.rowid DESC LIMIT 1) AS akhir_jenis,
      (SELECT p.teks FROM cermin_pesan p WHERE p.jid = c.jid ORDER BY p.waktu DESC, p.rowid DESC LIMIT 1) AS akhir_teks
    FROM cermin_chat c ${sql} ORDER BY c.terakhir_at DESC, c.jid LIMIT ? OFFSET ?`).all(admin, ...args, per, (Math.max(1, hal) - 1) * per);
  return { total, baris };
}
export const ambilChat = (jid) => cdb.prepare("SELECT * FROM cermin_chat WHERE jid = ?").get(jid);
// n pesan terakhir dalam urutan naik; `lebih` true kalau masih ada yang lebih lama.
export function pesanChat(jid, n = 200) {
  const baris = cdb.prepare("SELECT * FROM cermin_pesan WHERE jid = ? ORDER BY waktu DESC, rowid DESC LIMIT ?").all(jid, n + 1);
  return { lebih: baris.length > n, baris: baris.slice(0, n).reverse() };
}
export const tandaiDilihat = (admin, jid) => cdb.prepare(`INSERT INTO cermin_dilihat(admin, jid, dilihat_at) VALUES (?, ?, ?)
  ON CONFLICT(admin, jid) DO UPDATE SET dilihat_at = excluded.dilihat_at`).run(admin, jid, detik());
