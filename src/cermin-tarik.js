import { cdb, simpanPesan, selesaikanJid, setNamaChat } from "./cermin.js";

// Penarik riwayat dari API WAHA kantor, untuk mengisi celah saat pertama dipasang atau sesudah webhook mati.
// Semua panggilan lewat wahaFetch yang hanya mengizinkan GET dan menolak jalur kirim, jadi modul ini tidak mungkin mengirim pesan.
const sesi = () => process.env.CERMIN_SESI || "kantor";
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
const detik = () => Math.floor(Date.now() / 1000);

export async function wahaFetch(jalur, { method = "GET", params = {} } = {}) {
  if (String(method).toUpperCase() !== "GET") throw new Error("cermin hanya boleh GET ke WAHA");
  if (/\/send/i.test(String(jalur))) throw new Error("jalur kirim ditolak");
  const kunci = process.env.WAHA_KANTOR_KEY;
  if (!kunci) throw new Error("WAHA_KANTOR_KEY kosong");
  const url = new URL(String(jalur), (process.env.WAHA_KANTOR_URL || "http://waha-kantor:3000").replace(/\/+$/, "") + "/");
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  const r = await fetch(url, { method: "GET", headers: { "X-Api-Key": kunci, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`WAHA menjawab ${r.status}`);
  return r.json();
}

// LID ke nomor HP. Jawaban WAHA: { lid, pn: "62...@c.us" }. Mencoba bentuk "xxx@lid", lalu hanya "xxx".
export async function cariLid(lid) {
  for (const bentuk of [lid, String(lid).split("@")[0]]) {
    try {
      const d = await wahaFetch(`/api/${sesi()}/lids/${encodeURIComponent(bentuk)}`);
      if (d?.pn) return String(d.pn);
    } catch { /* coba bentuk berikutnya */ }
  }
  return null;
}

const abaikanId = (id) => !id || id === "status@broadcast" || String(id).endsWith("@broadcast") || String(id).endsWith("@newsletter");

// Tarik pesan satu chat, terbaru dulu, per halaman 100. Berhenti kalau halaman sudah memuat pesan lebih tua dari `batas` (detik).
async function tarikChat(idChat, { batas, sejak, jeda }) {
  let baru = 0;
  for (let offset = 0; ; offset += 100) {
    const halaman = await wahaFetch(`/api/${sesi()}/chats/${encodeURIComponent(idChat)}/messages`,
      { params: { limit: 100, offset, downloadMedia: "false", "filter.timestamp.gte": sejak } });
    if (!Array.isArray(halaman) || !halaman.length) break;
    for (const p of halaman) if ((await simpanPesan(p, "tarik")) === "baru") baru++;
    const tertua = Math.min(...halaman.map((p) => Number(p.timestamp) || Infinity));
    if (halaman.length < 100 || tertua < batas) break;
    await tidur(jeda);
  }
  return baru;
}

const batasRetensi = () => detik() - Number(process.env.CERMIN_HARI || 180) * 86400;
let sedangJalan = false;

// Mode penuh: semua chat di store WAHA.
export async function tarikSemua({ jeda = 300 } = {}) {
  if (sedangJalan) throw new Error("penarik masih berjalan");
  sedangJalan = true;
  const hasil = { chat: 0, pesan: 0 };
  try {
    for (let offset = 0; ; offset += 100) {
      const daftar = await wahaFetch(`/api/${sesi()}/chats`, { params: { limit: 100, offset } });
      if (!Array.isArray(daftar) || !daftar.length) break;
      for (const c of daftar) {
        const id = c.id?._serialized || c.id;
        if (abaikanId(id)) continue;
        const baru = await tarikChat(id, { batas: batasRetensi(), jeda });
        const s = await selesaikanJid(id);
        if (s) setNamaChat(s.jid, c.name);
        hasil.chat++; hasil.pesan += baru;
        await tidur(jeda);
      }
      if (daftar.length < 100) break;
    }
  } finally { sedangJalan = false; }
  return hasil;
}

// Mode celah: dari overview, hanya chat yang pesan terakhirnya lebih baru dari yang tersimpan.
export async function tarikCelah({ jeda = 300 } = {}) {
  if (sedangJalan) return { chat: 0, pesan: 0 };
  sedangJalan = true;
  const hasil = { chat: 0, pesan: 0 };
  try {
    for (let offset = 0; ; offset += 100) {
      const daftar = await wahaFetch(`/api/${sesi()}/chats/overview`, { params: { limit: 100, offset } });
      if (!Array.isArray(daftar) || !daftar.length) break;
      for (const c of daftar) {
        const id = c.id?._serialized || c.id;
        if (abaikanId(id)) continue;
        const terakhir = Number(c.lastMessage?.timestamp) || 0;
        const s = await selesaikanJid(id);
        if (!s) continue;
        const simpan = cdb.prepare("SELECT terakhir_at FROM cermin_chat WHERE jid = ?").get(s.jid)?.terakhir_at || 0;
        if (terakhir && terakhir <= simpan) continue;
        const baru = await tarikChat(id, { batas: batasRetensi(), sejak: simpan ? simpan - 600 : undefined, jeda });
        setNamaChat(s.jid, c.name);
        hasil.chat++; hasil.pesan += baru;
        await tidur(jeda);
      }
      if (daftar.length < 100) break;
    }
  } finally { sedangJalan = false; }
  return hasil;
}
