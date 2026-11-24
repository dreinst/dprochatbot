import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";

// Semua data di sini rekaan (nomor palsu, teks karangan). Database sementara di direktori temp.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cermin-uji-"));
process.env.CERMIN_DB = path.join(tmp, "cermin.db");
process.env.DB_FILE = path.join(tmp, "dprochatbot.db");
process.env.WAHA_KANTOR_KEY = "kunci-waha-palsu";
process.env.WAHA_KANTOR_URL = "http://waha.palsu:3000";
delete process.env.CERMIN_KECUALI;
const realFetch = globalThis.fetch;

const C = await import("../src/cermin.js");
const T = await import("../src/cermin-tarik.js");
const { db } = await import("../src/db.js");
const { hashPassword } = await import("../src/auth.js");
const { cdb } = C;

const KANTOR = "6280000000000@c.us";
const PEL = "628111111111@c.us";
const OM = "6281938938800@c.us";
const TS = 1_760_000_000;
const semua = (sql, ...a) => cdb.prepare(sql).all(...a);

// Pembuat payload message.any gaya GOWS.
function pesan({ id = "3EB0AAA1", dari = PEL, fromMe = false, ke = KANTOR, source, ts = TS, proto, body = "", push = "Budi Rekaan", participant, extra = {} } = {}) {
  const from = fromMe ? KANTOR : dari;
  const to = fromMe ? dari : ke;
  const chat = fromMe ? to : from;
  return {
    id: `${fromMe}_${chat}_${id}`, timestamp: ts, from, to, fromMe, body, hasMedia: false, source, participant,
    _data: { Info: { PushName: push }, Message: proto ?? { conversation: body } }, ...extra,
  };
}
const kirim = (payload, event = "message.any") => ({ event, session: "kantor", payload });

beforeEach(() => {
  for (const t of ["cermin_pesan", "cermin_chat", "cermin_dilihat", "cermin_lid"]) cdb.exec(`DELETE FROM ${t}`);
  delete process.env.CERMIN_KECUALI;
  C.aturPencariLid(async () => null);
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// ---------- Webhook dan HMAC ----------
async function pakaiListener(fn, kunci = "kunci-uji") {
  const s = C.buatListener(kunci);
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const port = s.address().port;
  const post = (badan, header) => new Promise((ok, gagal) => {
    const req = http.request({ port, host: "127.0.0.1", path: "/webhook", method: "POST", headers: header ? { "X-Webhook-Hmac": header } : {} }, (res) => { res.resume(); res.on("end", () => ok(res.statusCode)); });
    req.on("error", gagal); req.end(badan);
  });
  try { await fn(post); } finally { await new Promise((r) => s.close(r)); }
}
const tanda = (badan, kunci = "kunci-uji") => createHmac("sha512", kunci).update(badan).digest("hex");
const tunggu = async (kondisi) => { for (let i = 0; i < 50; i++) { if (kondisi()) return; await new Promise((r) => setTimeout(r, 20)); } };

test("webhook: HMAC kosong atau salah 401, benar 200 dan pesan tersimpan", async () => {
  await pakaiListener(async (post) => {
    const badan = JSON.stringify(kirim(pesan({ body: "halo rekaan" })));
    assert.equal(await post(badan), 401);
    assert.equal(await post(badan, "abc"), 401);
    assert.equal(await post(badan, tanda(badan, "kunci-lain")), 401);
    assert.equal(semua("SELECT * FROM cermin_pesan").length, 0);
    assert.equal(await post(badan, tanda(badan)), 200);
    await tunggu(() => semua("SELECT * FROM cermin_pesan").length === 1);
    assert.equal(semua("SELECT teks FROM cermin_pesan")[0].teks, "halo rekaan");
  });
});

test("webhook: badan lebih dari 1 MB ditolak 413", async () => {
  await pakaiListener(async (post) => {
    const besar = "x".repeat(1024 * 1024 + 10);
    const kode = await post(besar, tanda(besar)).catch(() => 413); // koneksi bisa diputus server setelah 413
    assert.equal(kode, 413);
  });
});

test("webhook: sesi lain diabaikan, listener mati tanpa kunci", async () => {
  await C.olahEvent({ event: "message.any", session: "lain", payload: pesan({ body: "x" }) });
  assert.equal(semua("SELECT * FROM cermin_pesan").length, 0);
  const lama = process.env.CERMIN_HMAC; delete process.env.CERMIN_HMAC;
  assert.equal(C.nyalakanListener(), null);
  if (lama) process.env.CERMIN_HMAC = lama;
});

// ---------- Penyimpanan ----------
test("pesan dobel tetap satu baris, jumlah chat benar", async () => {
  assert.equal(await C.simpanPesan(pesan({ body: "satu" })), "baru");
  assert.equal(await C.simpanPesan(pesan({ body: "satu" }), "tarik"), "dobel");
  assert.equal(semua("SELECT * FROM cermin_pesan").length, 1);
  const chat = semua("SELECT * FROM cermin_chat")[0];
  assert.equal(chat.jumlah, 1);
  assert.equal(chat.jid, PEL);
  assert.equal(chat.nama, "Budi Rekaan");
});

test("edit memperbarui teks dan menandai diedit", async () => {
  await C.simpanPesan(pesan({ body: "teks lama" }));
  const hasil = await C.olahEvent(kirim({ id: `false_${PEL}_3EB0EDIT`, timestamp: TS + 60, from: PEL, to: KANTOR, fromMe: false, editedMessageId: "3EB0AAA1", body: "teks baru" }, "message.edited"));
  assert.equal(hasil, "edit");
  const b = semua("SELECT * FROM cermin_pesan")[0];
  assert.equal(b.teks, "teks baru");
  assert.equal(b.diedit_at, TS + 60);
  assert.equal(semua("SELECT * FROM cermin_pesan").length, 1);
});

test("revoke menandai dihapus tanpa menghapus isi", async () => {
  await C.simpanPesan(pesan({ body: "rahasia rekaan" }));
  const hasil = await C.olahEvent(kirim({ after: { id: `false_${PEL}_3EB0REVK`, timestamp: TS + 120, from: PEL, to: KANTOR, fromMe: false }, revokedMessageId: "3EB0AAA1", before: null }, "message.revoked"));
  assert.equal(hasil, "hapus");
  const b = semua("SELECT * FROM cermin_pesan")[0];
  assert.equal(b.teks, "rahasia rekaan");
  assert.equal(b.dihapus_at, TS + 120);
});

test("grup tersimpan dengan tanda grup dan peserta", async () => {
  const grup = "120363000000000001@g.us";
  await C.simpanPesan(pesan({ id: "3EB0GRP1", dari: grup, participant: "628222222222@c.us", push: "Sari Rekaan", body: "halo grup" }));
  const chat = semua("SELECT * FROM cermin_chat")[0];
  assert.equal(chat.jid, grup);
  assert.equal(chat.grup, 1);
  assert.equal(chat.nama, null); // PushName milik peserta, bukan nama grup
  const b = semua("SELECT * FROM cermin_pesan")[0];
  assert.equal(b.peserta_nomor, "628222222222");
  assert.equal(b.peserta_nama, "Sari Rekaan");
  assert.equal(b.pengirim, "pelanggan");
  // id grup berformat panjang dengan sufiks peserta tetap menghasilkan id polos
  assert.equal(C.idPolos(`false_${grup}_3EB0GRP1_628222222222@c.us`), "3EB0GRP1");
  assert.equal(C.idPolos(`true_${PEL}_3EB0ABC`), "3EB0ABC");
});

test("status, saluran, reaksi, dan pesan protokol dilewati", async () => {
  assert.equal(await C.simpanPesan(pesan({ dari: "status@broadcast", body: "status" })), "lewat");
  assert.equal(await C.simpanPesan(pesan({ dari: "120363111@newsletter", body: "saluran" })), "lewat");
  assert.equal(await C.simpanPesan(pesan({ id: "3EB0R1", proto: { reactionMessage: { text: "👍", key: {} } } })), "lewat");
  assert.equal(await C.simpanPesan(pesan({ id: "3EB0P1", proto: { protocolMessage: { type: 0, key: { ID: "3EB0AAA1" } } } })), "lewat");
  assert.equal(semua("SELECT * FROM cermin_pesan").length, 0);
  assert.equal(semua("SELECT * FROM cermin_chat").length, 0);
});

test("media: hanya jenis, nama berkas, keterangan; tidak ada unduhan", async () => {
  let dipanggil = 0;
  globalThis.fetch = async () => { dipanggil++; throw new Error("tidak boleh ada fetch"); };
  try {
    const url = "https://media.palsu.invalid/rahasia.jpg";
    await C.simpanPesan(pesan({ id: "3EB0M1", proto: { imageMessage: { caption: "foto rekaan", url } }, extra: { hasMedia: true, media: { url, mimetype: "image/jpeg" } } }));
    await C.simpanPesan(pesan({ id: "3EB0M2", proto: { documentWithCaptionMessage: { message: { documentMessage: { fileName: "tiket.pdf", caption: "tiket" } } } }, extra: { hasMedia: true, media: { url, mimetype: "application/pdf" } } }));
    await C.simpanPesan(pesan({ id: "3EB0M3", proto: { ephemeralMessage: { message: { audioMessage: { ptt: true } } } } }));
    await C.simpanPesan(pesan({ id: "3EB0M4", proto: { stickerMessage: {} } }));
    await C.simpanPesan(pesan({ id: "3EB0M5", proto: { locationMessage: { name: "Tempat Rekaan" } } }));
    await C.simpanPesan(pesan({ id: "3EB0M6", proto: { contactMessage: { displayName: "Kontak Rekaan" } } }));
    await C.simpanPesan(pesan({ id: "3EB0M7", proto: { viewOnceMessageV2: { message: { videoMessage: { caption: "video" } } } } }));
  } finally { globalThis.fetch = realFetch; }
  assert.equal(dipanggil, 0);
  const b = Object.fromEntries(semua("SELECT * FROM cermin_pesan").map((r) => [r.id, r]));
  assert.deepEqual([b["3EB0M1"].jenis, b["3EB0M1"].teks], ["gambar", "foto rekaan"]);
  assert.deepEqual([b["3EB0M2"].jenis, b["3EB0M2"].nama_berkas, b["3EB0M2"].teks], ["dokumen", "tiket.pdf", "tiket"]);
  assert.equal(b["3EB0M3"].jenis, "suara");
  assert.equal(b["3EB0M4"].jenis, "stiker");
  assert.deepEqual([b["3EB0M5"].jenis, b["3EB0M5"].teks], ["lokasi", "Tempat Rekaan"]);
  assert.equal(b["3EB0M6"].jenis, "kontak");
  assert.equal(b["3EB0M7"].jenis, "video");
  assert.ok(!JSON.stringify(semua("SELECT * FROM cermin_pesan")).includes("media.palsu"));
});

test("penanda pengirim: api jadi bot, app dan kosong jadi admin, masuk jadi pelanggan", async () => {
  await C.simpanPesan(pesan({ id: "3EB0S1", fromMe: true, source: "api", body: "dari bot" }));
  await C.simpanPesan(pesan({ id: "3EB0S2", fromMe: true, source: "app", body: "dari hp" }));
  await C.simpanPesan(pesan({ id: "3EB0S3", fromMe: true, body: "tanpa source" }));
  await C.simpanPesan(pesan({ id: "3EB0S4", body: "dari pelanggan" }));
  const p = Object.fromEntries(semua("SELECT id, pengirim, jid FROM cermin_pesan").map((r) => [r.id, r]));
  assert.equal(p["3EB0S1"].pengirim, "bot");
  assert.equal(p["3EB0S2"].pengirim, "admin");
  assert.equal(p["3EB0S3"].pengirim, "admin");
  assert.equal(p["3EB0S4"].pengirim, "pelanggan");
  assert.equal(new Set(Object.values(p).map((r) => r.jid)).size, 1); // keluar dan masuk ke chat yang sama
});

// ---------- Pengecualian nomor owner ----------
test("nomor owner dikecualikan: pribadi (masuk dan keluar), bentuk 08..., dan peserta grup", async () => {
  assert.equal(await C.simpanPesan(pesan({ dari: OM, body: "dari om" })), "kecuali");
  assert.equal(await C.simpanPesan(pesan({ id: "3EB0O2", dari: OM, fromMe: true, source: "api", body: "ke om" })), "kecuali");
  assert.equal(await C.simpanPesan(pesan({ id: "3EB0O3", dari: "081938938800@c.us", body: "bentuk lokal" })), "kecuali");
  const grup = "120363000000000002@g.us";
  assert.equal(await C.simpanPesan(pesan({ id: "3EB0O4", dari: grup, participant: OM, body: "om di grup" })), "kecuali");
  assert.equal(semua("SELECT * FROM cermin_pesan").length, 0);
  assert.equal(await C.simpanPesan(pesan({ id: "3EB0O5", dari: grup, participant: "628333333333@c.us", body: "peserta lain" })), "baru");
  assert.equal(semua("SELECT * FROM cermin_pesan").length, 1);
});

test("nomor owner lewat LID juga dikecualikan; LID tak terjemah tidak disimpan", async () => {
  const peta = { "111111@lid": "6281938938800@c.us", "222222@lid": "628444444444@c.us" };
  C.aturPencariLid(async (lid) => peta[lid] || null);
  assert.equal(await C.simpanPesan(pesan({ dari: "111111@lid", body: "om lewat lid" })), "kecuali");
  assert.equal(await C.simpanPesan(pesan({ id: "3EB0L2", dari: "999999@lid", body: "lid asing" })), "tunda");
  const grup = "120363000000000003@g.us";
  assert.equal(await C.simpanPesan(pesan({ id: "3EB0L3", dari: grup, participant: "111111@lid", body: "om lid di grup" })), "kecuali");
  assert.equal(await C.simpanPesan(pesan({ id: "3EB0L4", dari: grup, participant: "888888@lid", body: "peserta lid asing" })), "tunda");
  assert.equal(semua("SELECT * FROM cermin_pesan").length, 0);
  // LID yang bisa diterjemahkan ke nomor biasa disimpan di chat @c.us dan dicache
  assert.equal(await C.simpanPesan(pesan({ id: "3EB0L5", dari: "222222@lid", body: "lid biasa" })), "baru");
  assert.equal(semua("SELECT jid FROM cermin_pesan")[0].jid, "628444444444@c.us");
  assert.equal(semua("SELECT nomor FROM cermin_lid WHERE lid = '222222@lid'")[0].nomor, "628444444444");
  C.aturPencariLid(async () => { throw new Error("tidak boleh dipanggil lagi"); });
  assert.equal(await C.simpanPesan(pesan({ id: "3EB0L6", dari: "222222@lid", body: "lagi" })), "baru"); // dari cache
});

test("CERMIN_KECUALI dari env, beberapa nomor", async () => {
  process.env.CERMIN_KECUALI = "628555555555, 08160001112";
  assert.equal(await C.simpanPesan(pesan({ dari: "628555555555@c.us", body: "a" })), "kecuali");
  assert.equal(await C.simpanPesan(pesan({ id: "3EB0K2", dari: "628160001112@c.us", body: "b" })), "kecuali");
  assert.equal(await C.simpanPesan(pesan({ id: "3EB0K3", dari: OM, body: "c" })), "baru"); // bawaan diganti oleh env
});

// ---------- Retensi ----------
test("retensi menghapus pesan lama lalu chat kosong", async () => {
  const sekarang = TS + 200 * 86400;
  await C.simpanPesan(pesan({ id: "3EB0T1", ts: TS, body: "lama" }));
  await C.simpanPesan(pesan({ id: "3EB0T2", dari: "628666666666@c.us", ts: TS, body: "lama saja" }));
  await C.simpanPesan(pesan({ id: "3EB0T3", ts: sekarang - 86400, body: "baru" }));
  C.tandaiDilihat("andi", "628666666666@c.us");
  const r = C.hapusLama(180, sekarang);
  assert.deepEqual(r, { pesan: 2, chat: 1 });
  assert.deepEqual(semua("SELECT teks FROM cermin_pesan").map((x) => x.teks), ["baru"]);
  const chat = semua("SELECT * FROM cermin_chat");
  assert.equal(chat.length, 1);
  assert.equal(chat[0].jumlah, 1);
  assert.equal(chat[0].terakhir_at, sekarang - 86400);
  assert.equal(semua("SELECT * FROM cermin_dilihat").length, 0);
  const ms = C.msKeRetensi(Date.UTC(2026, 10, 24, 10, 0, 0)); // 17.00 WIB, 03.00 WIB berikutnya 10 jam lagi
  assert.equal(ms, 10 * 3600_000);
});

// ---------- Pembungkus WAHA dan penarik ----------
test("pembungkus WAHA menolak POST dan jalur send", async () => {
  let dipanggil = 0;
  globalThis.fetch = async () => { dipanggil++; return new Response("[]"); };
  try {
    await assert.rejects(T.wahaFetch("/api/kantor/chats", { method: "POST" }));
    await assert.rejects(T.wahaFetch("/api/kantor/chats", { method: "DELETE" }));
    await assert.rejects(T.wahaFetch("/api/sendText"));
    await assert.rejects(T.wahaFetch("/api/kantor/sendText", { method: "GET" }));
    await assert.rejects(T.wahaFetch("/api/send/text"));
    assert.equal(dipanggil, 0);
    await T.wahaFetch("/api/kantor/chats", { params: { limit: 5 } });
    assert.equal(dipanggil, 1);
  } finally { globalThis.fetch = realFetch; }
});

test("penarik celah: hanya GET dengan kunci, tarik chat yang lebih baru, idempoten", async () => {
  await C.simpanPesan(pesan({ id: "3EB0D1", ts: TS, body: "sudah ada" }));
  await C.simpanPesan(pesan({ id: "3EB0D9", dari: "628777777777@c.us", ts: TS, body: "chat lain, tidak berubah" }));
  const panggilan = [];
  const baruTs = Math.floor(Date.now() / 1000) - 60;
  globalThis.fetch = async (url, opsi) => {
    const u = new URL(url);
    panggilan.push({ jalur: u.pathname, query: Object.fromEntries(u.searchParams), metode: opsi.method, kunci: opsi.headers["X-Api-Key"] });
    if (u.pathname.endsWith("/chats/overview")) return new Response(JSON.stringify([
      { id: PEL, name: "Budi Rekaan", lastMessage: { timestamp: baruTs } },
      { id: "628777777777@c.us", name: "Tidak Berubah", lastMessage: { timestamp: TS } },
      { id: "status@broadcast", lastMessage: { timestamp: baruTs } },
      { id: "6281938938800@c.us", name: "Owner", lastMessage: { timestamp: baruTs } },
    ]));
    if (u.pathname.includes("/messages")) return new Response(JSON.stringify([pesan({ id: "3EB0D2", ts: baruTs, body: "celah terisi" }), pesan({ id: "3EB0D1", ts: TS, body: "sudah ada" })]));
    return new Response("[]");
  };
  try {
    const h = await T.tarikCelah({ jeda: 0 });
    assert.deepEqual(h, { chat: 1, pesan: 1 });
    const h2 = await T.tarikCelah({ jeda: 0 });
    assert.equal(h2.pesan, 0);
  } finally { globalThis.fetch = realFetch; }
  assert.ok(panggilan.every((c) => c.metode === "GET" && c.kunci === "kunci-waha-palsu" && !c.jalur.includes("/send")));
  assert.ok(!panggilan.some((c) => c.jalur.includes("6281938938800")), "chat owner tidak boleh ditarik");
  const msg = panggilan.find((c) => c.jalur.includes("/messages"));
  assert.equal(msg.query.downloadMedia, "false");
  assert.equal(msg.query.limit, "100");
  assert.equal(Number(msg.query["filter.timestamp.gte"]), TS - 600);
  assert.ok(!panggilan.some((c) => c.jalur.includes("777777777")));
  assert.equal(semua("SELECT * FROM cermin_pesan").length, 3);
  assert.equal(semua("SELECT asal FROM cermin_pesan WHERE id = '3EB0D2'")[0].asal, "tarik");
});

// ---------- Halaman dan hak akses ----------
async function portBebas() { return new Promise((ok) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); }); }

test("halaman: admin biasa 404, superadmin bisa membuka dan membuka chat dicatat", async () => {
  db.prepare("INSERT INTO admins(username, password_hash, role) VALUES (?, ?, ?)").run("andi", hashPassword("sandi-super-1"), "superadmin");
  db.prepare("INSERT INTO admins(username, password_hash, role) VALUES (?, ?, ?)").run("rini", hashPassword("sandi-biasa-1"), "admin");
  await C.simpanPesan(pesan({ id: "3EB0H1", body: "halo <b>rekaan</b> & uji" }));
  await C.simpanPesan(pesan({ id: "3EB0H2", fromMe: true, source: "api", body: "balasan bot" }));
  const port = await portBebas();
  const anak = spawn(process.execPath, ["src/server.js"], {
    cwd: path.join(import.meta.dirname, ".."), stdio: "ignore",
    env: { ...process.env, PORT: String(port), CERMIN_HMAC: "", WAHA_KANTOR_KEY: "" },
  });
  try {
    const dasar = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100; i++) { try { if ((await realFetch(`${dasar}/sehat`)).ok) break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    const masuk = async (u, p) => {
      const r = await realFetch(`${dasar}/login`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: u, password: p }) });
      return r.headers.get("set-cookie").split(";")[0];
    };
    const ambil = (jalur, cookie) => realFetch(`${dasar}${jalur}`, { headers: { cookie }, redirect: "manual" });
    const rini = await masuk("rini", "sandi-biasa-1");
    const andi = await masuk("andi", "sandi-super-1");

    assert.equal((await ambil("/cermin", rini)).status, 404);
    assert.equal((await ambil(`/cermin/${encodeURIComponent(PEL)}`, rini)).status, 404);
    const menuBiasa = await (await ambil("/", rini)).text();
    assert.ok(!menuBiasa.includes("Cermin WA"));
    assert.equal((await ambil("/cermin", "")).status, 303); // belum masuk

    const daftar = await ambil("/cermin", andi);
    assert.equal(daftar.status, 200);
    assert.equal(daftar.headers.get("cache-control"), "no-store");
    const htmlDaftar = await daftar.text();
    assert.ok(htmlDaftar.includes("Cermin WA") && htmlDaftar.includes("Budi Rekaan"));
    const cari = await (await ambil("/cermin?q=balasan+bot&dari=bot", andi)).text();
    assert.ok(cari.includes("Budi Rekaan"));
    const kosong = await (await ambil("/cermin?q=tidak-ada-sama-sekali", andi)).text();
    assert.ok(!kosong.includes("Budi Rekaan"));
    assert.ok(htmlDaftar.includes('class="cm-baru"')); // belum pernah dibuka

    const chat = await ambil(`/cermin/${encodeURIComponent(PEL)}`, andi);
    assert.equal(chat.status, 200);
    assert.equal(chat.headers.get("cache-control"), "no-store");
    const html = await chat.text();
    assert.ok(html.includes("halo &lt;b&gt;rekaan&lt;/b&gt; &amp; uji") && !html.includes("<b>rekaan</b>"));
    assert.ok(html.includes("cm-gel bot") && html.includes("cm-gel pelanggan"));
    assert.ok(!/<form[^>]*method="post"[^>]*action="\/cermin/i.test(html) && !html.includes("<textarea"));
    assert.equal((await ambil("/cermin/tidak-valid", andi)).status, 404);
    assert.equal((await ambil("/cermin/628999999999%40c.us", andi)).status, 404);
    const log = db.prepare("SELECT admin, detail FROM log WHERE aksi = 'buka_cermin'").all().map((l) => ({ ...l }));
    assert.deepEqual(log, [{ admin: "andi", detail: PEL }]);
    assert.equal(semua("SELECT * FROM cermin_dilihat WHERE admin = 'andi'").length, 1);
    const sesudah = await (await ambil("/cermin", andi)).text();
    assert.ok(!sesudah.includes('class="cm-baru"')); // sudah dilihat
    const post = await realFetch(`${dasar}/cermin`, { method: "POST", headers: { cookie: andi }, redirect: "manual" });
    assert.equal(post.status, 404);
  } finally { anak.kill(); }
});
