import http from "node:http";
import { db, catat, setting } from "./db.js";
import { currentAdmin, hashPassword, login, loginAllowed, logoutAll, logoutCookie } from "./auth.js";
import { buatBlast, hentikanBlast, penerima, tickBlast, PENUTUP } from "./blast.js";
import { syncBerhenti, syncKuwera } from "./sync-kuwera.js";
import { syncPetBlessing } from "./sync-petblessing.js";

// Dashboard database pelanggan event D'Production + blast WhatsApp. Satu berkas server tanpa framework.
const PORT = Number(process.env.PORT || 3000);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const wib = (iso) => (iso ? new Date(iso.endsWith("Z") ? iso : iso.replace(" ", "T") + "Z").toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-");

const IKON = { "/": "database", "/blast": "campaign", "/akun": "manage_accounts" };
function page(title, admin, body, aktif = "/") {
  if (!admin) return `<!doctype html><html lang="id"><head>${HEAD(title)}</head><body class="polos"><div class="aurora"></div>${body}</body></html>`;
  const menu = [["/", "Database"], ["/blast", "Blast WhatsApp"], ...(admin.role === "superadmin" ? [["/akun", "Akun"]] : [])]
    .map(([href, label]) => `<a href="${href}" class="menu ${href === aktif ? "menu-aktif" : ""}"><span class="ms">${IKON[href]}</span>${label}</a>`).join("");
  const sinkron = [["KUWERA", setting("sync_kuwera_at")], ["Pet Blessing", setting("sync_petblessing_at")]]
    .map(([n, t]) => `<div class="sinkron"><span class="titik ${t ? "hijau" : ""}"></span>${n}<span class="mono">${t ? wib(t) : "belum"}</span></div>`).join("");
  return `<!doctype html><html lang="id"><head>${HEAD(title)}</head><body><div class="aurora"></div>
<aside id="samping" class="kaca samping"><div class="merek"><span class="ubin-ikon">D</span><div><b>D'Pro Chatbot</b><small>Database pelanggan event</small></div></div>
<nav><span class="teks-label">Menu</span>${menu}</nav><div class="kaki-samping"><span class="teks-label">Sinkron terakhir</span>${sinkron}</div></aside>
<div class="isi"><header class="kaca atas"><button class="tombol-menu" onclick="document.body.classList.toggle('buka')" aria-label="Buka menu"><span class="ms">menu</span></button>
<form action="/" class="cari"><span class="ms">search</span><input name="q" type="search" placeholder="Cari nama, HP, email, komunitas, asal..."></form>
<div class="pengguna"><span class="avatar">${esc(admin.username.slice(0, 2).toUpperCase())}</span><span class="nama-pengguna">${esc(admin.username)}<small>${esc(admin.role)}</small></span>
<form method="post" action="/logout"><button class="tombol tombol-garis tombol-kecil">Keluar</button></form></div></header>
<main>${body}</main></div><div class="tirai" onclick="document.body.classList.remove('buka')"></div></body></html>`;
}
const HEAD = (title) => `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} | D'Pro Chatbot</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,300..500,0,0&display=block">
<style>${CSS}</style>`;
// Gaya mengikuti Produksia ("Precision Ledger"): kanvas terang, kartu putih, navy sebagai warna utama, oranye sebagai aksen.
const CSS = `
*{box-sizing:border-box}html,body{margin:0}body{background:#f8fafc;color:#1e293b;font:14px/20px "Helvetica Neue",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;position:relative;isolation:isolate;overflow-x:hidden}
.aurora{position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none;background-image:radial-gradient(rgba(11,33,65,.055) .7px,transparent .7px);background-size:22px 22px}
.aurora:before,.aurora:after{content:"";position:absolute;border-radius:9999px}
.aurora:before{width:64vw;height:64vw;left:-20vw;top:-30vw;background:radial-gradient(closest-side,rgba(23,65,122,.18),rgba(23,65,122,.06) 55%,rgba(23,65,122,0))}
.aurora:after{width:52vw;height:52vw;right:-18vw;top:4vh;background:radial-gradient(closest-side,rgba(248,110,24,.11),rgba(248,110,24,.035) 55%,rgba(248,110,24,0))}
.ms{font-family:"Material Symbols Outlined";font-size:20px;line-height:1;display:inline-block;vertical-align:middle;font-weight:normal;font-style:normal;letter-spacing:normal;text-transform:none;white-space:nowrap;direction:ltr;-webkit-font-smoothing:antialiased}
.kaca{background:rgba(255,255,255,.82);backdrop-filter:blur(14px) saturate(1.2);-webkit-backdrop-filter:blur(14px) saturate(1.2)}
.samping{position:fixed;left:0;top:0;bottom:0;width:256px;border-right:1px solid rgba(226,232,240,.6);display:flex;flex-direction:column;z-index:50;transition:transform .2s}
.merek{height:64px;padding:0 20px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #f1f5f9}.merek b{display:block;color:#0b2141;font-size:15px}.merek small{font-size:9px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#94a3b8}
.ubin-ikon{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;color:#fff;font-weight:700;background:linear-gradient(135deg,#17417a,#0b2141);box-shadow:0 4px 10px -4px rgba(11,33,65,.6),inset 0 1px 0 rgba(255,255,255,.18);position:relative}
.ubin-ikon:after{content:"";position:absolute;right:-3px;bottom:-3px;width:10px;height:10px;border-radius:3px;background:#f86e18}
nav{padding:16px 12px;display:flex;flex-direction:column;gap:2px;flex:1}.teks-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;padding:0 12px 6px}
.menu{display:flex;align-items:center;gap:12px;padding:8px 12px;border-radius:8px;color:#475569;text-decoration:none;font-weight:500;transition:all .15s}.menu .ms{color:#94a3b8}
.menu:hover{background:#f8fafc;color:#0f172a;transform:translateX(2px)}
.menu-aktif,.menu-aktif:hover{color:#fff;background:linear-gradient(135deg,#17417a,#0b2141);box-shadow:0 8px 18px -10px rgba(11,33,65,.7),inset 0 1px 0 rgba(255,255,255,.12);transform:none}.menu-aktif .ms{color:#fff}
.kaki-samping{padding:12px;display:flex;flex-direction:column;gap:6px}.sinkron{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f8fafc;border-radius:8px;font-size:12px;font-weight:500;color:#475569}
.sinkron .mono{margin-left:auto;font-size:10px;color:#94a3b8}.titik{width:8px;height:8px;border-radius:9999px;background:#cbd5e1}.titik.hijau{background:#10b981}
.isi{padding-left:256px;min-height:100vh;display:flex;flex-direction:column}
.atas{position:sticky;top:0;z-index:30;height:64px;border-bottom:1px solid rgba(226,232,240,.6);padding:0 32px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.cari{position:relative;flex:1;max-width:480px}.cari .ms{position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:18px;color:#94a3b8}
.cari input{width:100%;height:36px;padding:0 12px 0 36px;background:#f1f5f9;border:1px solid transparent;border-radius:8px;font:inherit;color:#0f172a}.cari input:focus{outline:none;background:#fff;border-color:#cbd5e1}
.pengguna{display:flex;align-items:center;gap:10px}.avatar{width:32px;height:32px;border-radius:9999px;background:linear-gradient(135deg,#17417a,#0b2141);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center}
.nama-pengguna{font-size:13px;font-weight:600;color:#0f172a;display:flex;flex-direction:column;line-height:16px}.nama-pengguna small{font-size:11px;color:#64748b;font-weight:500}
.tombol-menu{display:none;border:1px solid #e2e8f0;background:#fff;border-radius:8px;padding:5px;color:#475569;cursor:pointer}
main{width:100%;max-width:1280px;margin:0 auto;padding:28px 32px;display:flex;flex-direction:column;gap:24px;min-width:0}
.judul-halaman{font-size:24px;line-height:30px;font-weight:700;letter-spacing:-.01em;color:#0f172a;margin:0}.subjudul-halaman{font-size:13px;color:#64748b;margin:2px 0 0}
.kepala-halaman{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px}
.kartu{background:linear-gradient(180deg,#fff 0%,#fcfdff 100%);border:1px solid rgba(11,33,65,.09);border-radius:16px;padding:22px;box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 1px 2px rgba(11,33,65,.05),0 10px 28px -18px rgba(11,33,65,.22)}
.kartu-tabel{padding:0;overflow:hidden}.kepala-kartu{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding-bottom:16px;margin-bottom:16px;border-bottom:1px solid #f1f5f9}
.kartu-tabel .kepala-kartu{padding:20px 22px 16px;margin:0}.judul-kartu{font-size:15px;font-weight:700;color:#0f172a;margin:0}.subjudul-kartu{font-size:12px;color:#64748b;margin:2px 0 0}
.statistik{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px}
.kartu-statistik{position:relative;overflow:hidden}.kartu-statistik:before{content:"";position:absolute;inset:0 0 auto 0;height:3px;background:linear-gradient(90deg,#0b2141,#17417a 55%,#f86e18);opacity:.75}
.kartu-statistik .angka{font-size:26px;line-height:32px;font-weight:700;color:#0b2141;margin-top:8px;font-variant-numeric:tabular-nums}.kartu-statistik .redup{font-size:12px;color:#64748b}
.tombol{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 16px;border-radius:8px;font:600 12px/1 inherit;font-family:inherit;white-space:nowrap;cursor:pointer;text-decoration:none;border:0;transition:background .15s}
.tombol .ms{font-size:18px}.tombol-utama{color:#fff;background:linear-gradient(180deg,#17417a 0%,#0b2141 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,.16),0 1px 2px rgba(11,33,65,.2)}.tombol-utama:hover{background:linear-gradient(180deg,#1d4f92 0%,#0f2c56 100%)}
.tombol-aksen{color:#fff;background:linear-gradient(180deg,#ff7f2e 0%,#ea5f0c 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,.28),0 1px 2px rgba(217,90,12,.3)}.tombol-aksen:hover{background:linear-gradient(180deg,#ff8a40 0%,#d95a0c 100%)}
.tombol-garis{background:#fff;color:#334155;border:1px solid #e2e8f0}.tombol-garis:hover{background:#f8fafc;border-color:#cbd5e1}.tombol-bahaya{background:#fff1f2;color:#e11d48;border:1px solid #fecdd3}.tombol-kecil{height:32px;padding:0 12px}
.saring{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.isian{height:36px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;padding:0 12px;font:inherit;font-size:14px;color:#0f172a}.isian:focus{outline:none;border-color:#17417a;box-shadow:0 0 0 3px rgba(23,65,122,.2)}
select.isian{padding-right:30px;appearance:none;background:#fff url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>") no-repeat right 8px center}
textarea.isian{height:auto;padding:10px 12px;resize:vertical}.lebar{width:100%}
.bidang{display:flex;flex-direction:column;gap:4px;margin-bottom:14px}.label{font-size:13px;font-weight:600;color:#1e293b}.petunjuk{font-size:12px;color:#64748b}
.grid-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0 16px}
.bungkus-tabel{overflow-x:auto}.tabel{width:100%;border-collapse:collapse;text-align:left;font-size:13px;color:#334155}
.tabel thead tr{background:rgba(248,250,252,.7);color:#64748b;border-bottom:1px solid #e2e8f0}.tabel th{padding:10px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}
.tabel td{padding:10px 12px;vertical-align:top;border-bottom:1px solid #f1f5f9}.tabel th:first-child,.tabel td:first-child{padding-left:22px}.tabel th:last-child,.tabel td:last-child{padding-right:22px}
.tabel tbody tr:hover{background:rgba(248,250,252,.6)}.tabel .kosong{padding:32px;text-align:center;color:#94a3b8}.tabel .nama{font-weight:600;color:#0f172a;white-space:nowrap}.nowrap{white-space:nowrap}
.mono{font-variant-numeric:tabular-nums;font-size:12px;letter-spacing:-.01em}.redup{color:#64748b}.kecil{font-size:12px}
.lencana{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;border:1px solid;white-space:nowrap}
.l-emerald{background:#ecfdf5;color:#047857;border-color:#a7f3d0}.l-amber{background:#fffbeb;color:#b45309;border-color:#fde68a}.l-rose{background:#fff1f2;color:#be123c;border-color:#fecdd3}
.l-slate{background:#f1f5f9;color:#475569;border-color:#e2e8f0}.l-blue{background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe}
.ikut{display:flex;flex-direction:column;gap:4px}.ikut div{display:flex;gap:6px;align-items:center;white-space:nowrap}
.pesan{padding:12px 16px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;font-size:13px}.pesan.galat{background:#fff1f2;border-color:#fecdd3;color:#9f1239}
.halaman{display:flex;justify-content:space-between;align-items:center;padding:14px 22px;font-size:12px;color:#64748b}.halaman a{color:#17417a;font-weight:600;text-decoration:none}
.polos{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}.masuk{width:100%;max-width:380px}.masuk .merek{border:0;padding:0;height:auto;margin-bottom:20px}
.tirai{display:none}
@media (max-width:860px){.samping{transform:translateX(-100%);width:280px}.buka .samping{transform:none}.buka .tirai{display:block;position:fixed;inset:0;background:rgba(15,23,42,.4);z-index:40}
.isi{padding-left:0}.atas{padding:0 16px}.tombol-menu{display:inline-flex}.nama-pengguna{display:none}main{padding:20px 16px}}
`;

const send = (res, status, html, headers = {}) => { res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...headers }); res.end(html); };
const json = (res, status, obj) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
const redirect = (res, to, headers = {}) => { res.writeHead(303, { Location: to, ...headers }); res.end(); };
async function readBody(req, limit = 8 * 1024 * 1024) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw new Error("terlalu besar"); chunks.push(c); }
  return Buffer.concat(chunks).toString();
}
const form = (s) => Object.fromEntries(new URLSearchParams(s));

// Filter database (dipakai dashboard dan CSV).
function filterQuery(q) {
  const where = [], args = [];
  if (q.kategori) { where.push("c.id IN (SELECT i.contact_id FROM ikut i JOIN events e ON e.id = i.event_id WHERE e.kategori = ?)"); args.push(q.kategori); }
  if (q.event) { where.push("c.id IN (SELECT i.contact_id FROM ikut i JOIN events e ON e.id = i.event_id WHERE e.kode = ?)"); args.push(q.event); }
  if (q.status) { where.push("c.id IN (SELECT contact_id FROM ikut WHERE status = ?)"); args.push(q.status); }
  if (q.kota) { where.push("c.kota = ?"); args.push(q.kota); }
  if (q.umat) { where.push("c.umat = ?"); args.push(q.umat); }
  if (q.stop === "ya") where.push("c.berhenti_at IS NOT NULL");
  if (q.q) { where.push("(c.nama LIKE ? OR c.hp LIKE ? OR c.email LIKE ? OR c.komunitas LIKE ? OR c.asal LIKE ?)"); const t = `%${q.q}%`; args.push(t, t, t, t, t); }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", args };
}
const ikutOf = (id) => db.prepare("SELECT e.nama, e.kategori, i.status FROM ikut i JOIN events e ON e.id = i.event_id WHERE i.contact_id = ? ORDER BY e.tanggal, i.daftar_at").all(id);
const options = (list, cur, label) => `<option value="">${label}</option>` + list.map((v) => `<option ${v === cur ? "selected" : ""} value="${esc(v)}">${esc(v)}</option>`).join("");
const opsiEvent = (cur) => `<option value="">Semua event</option>` + db.prepare("SELECT kode, nama FROM events ORDER BY tanggal DESC").all().map((e) => `<option ${e.kode === cur ? "selected" : ""} value="${esc(e.kode)}">${esc(e.nama)}</option>`).join("");
const kategoriList = () => db.prepare("SELECT DISTINCT kategori FROM events ORDER BY kategori").all().map((r) => r.kategori);
const WARNA = { lunas: "l-emerald", menunggu: "l-amber", kedaluwarsa: "l-slate", batal: "l-rose", terdaftar: "l-blue" };
const UMAT = { ya: "Ya", bukan: "Bukan" };
const JK = { L: "Laki-laki", P: "Perempuan" };
const tglId = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "-");

function dashboard(admin, q) {
  const f = filterQuery(q);
  const halaman = Math.max(1, Number(q.hal) || 1), per = 100;
  const total = db.prepare(`SELECT count(*) AS n FROM contacts c ${f.sql}`).get(...f.args).n;
  const rows = db.prepare(`SELECT * FROM contacts c ${f.sql} ORDER BY c.nama COLLATE NOCASE LIMIT ? OFFSET ?`).all(...f.args, per, (halaman - 1) * per);
  const perKategori = db.prepare(`SELECT e.kategori, count(DISTINCT i.contact_id) AS n, count(DISTINCT e.id) AS ev FROM ikut i JOIN events e ON e.id = i.event_id GROUP BY e.kategori ORDER BY e.kategori`).all();
  const semua = db.prepare("SELECT count(*) AS n, sum(berhenti_at IS NOT NULL) AS stop, count(DISTINCT hp) AS nomor FROM contacts").get();
  const kota = db.prepare("SELECT DISTINCT kota FROM contacts WHERE kota IS NOT NULL ORDER BY kota").all().map((r) => r.kota);
  const statusList = db.prepare("SELECT DISTINCT status FROM ikut ORDER BY status").all().map((r) => r.status);
  const qs = (extra) => new URLSearchParams({ ...q, ...extra }).toString();
  const sel = (name, html) => `<select class="isian" name="${name}" onchange="this.form.submit()">${html}</select>`;
  return page("Database", admin, `<div class="kepala-halaman"><div><h1 class="judul-halaman">Database pelanggan event</h1>
    <p class="subjudul-halaman">Peserta semua event D'Production, dikelompokkan per kategori untuk blast WhatsApp. Diperbarui otomatis tiap 10 menit.</p></div>
    <form method="post" action="/sync"><button class="tombol tombol-garis"><span class="ms">sync</span>Sinkron sekarang</button></form></div>
  <div class="statistik">
    <div class="kartu kartu-statistik"><span class="teks-label" style="padding:0">Semua kontak</span><div class="angka">${semua.n}</div><div class="redup">${semua.nomor} nomor WhatsApp</div></div>
    ${perKategori.map((k) => `<div class="kartu kartu-statistik"><span class="teks-label" style="padding:0">Kategori ${esc(k.kategori)}</span><div class="angka">${k.n}</div><div class="redup">${k.ev} event</div></div>`).join("")}
    <div class="kartu kartu-statistik"><span class="teks-label" style="padding:0">Membalas STOP</span><div class="angka">${semua.stop || 0}</div><div class="redup">tidak dikirimi blast</div></div>
  </div>
  <div class="kartu kartu-tabel"><div class="kepala-kartu"><div><h2 class="judul-kartu">Daftar kontak</h2><p class="subjudul-kartu">${total} kontak cocok dengan saringan</p></div>
    <form class="saring" method="get">
      <input class="isian" name="q" placeholder="Cari..." value="${esc(q.q)}" style="width:180px">
      ${sel("kategori", options(kategoriList(), q.kategori, "Semua kategori"))}${sel("event", opsiEvent(q.event))}
      ${sel("status", options(statusList, q.status, "Semua status"))}${sel("kota", options(kota, q.kota, "Semua kota"))}
      ${sel("umat", `<option value="">Umat dan bukan</option><option ${q.umat === "ya" ? "selected" : ""} value="ya">Umat</option><option ${q.umat === "bukan" ? "selected" : ""} value="bukan">Bukan umat</option>`)}
      ${sel("stop", `<option value="">Semua kontak</option><option ${q.stop === "ya" ? "selected" : ""} value="ya">Hanya yang STOP</option>`)}
      <a class="tombol tombol-aksen" href="/export.csv?${qs({})}"><span class="ms">download</span>Unduh CSV</a>
    </form></div>
  <div class="bungkus-tabel"><table class="tabel"><thead><tr><th>Nama</th><th>NIK</th><th>WhatsApp</th><th>Email</th><th>Tgl lahir</th><th>JK</th><th>Gol. darah</th>
    <th>Alamat</th><th>Kota</th><th>Provinsi</th><th>Komunitas</th><th>Umat</th><th>Asal</th><th>Event dan status</th></tr></thead><tbody>
  ${rows.length ? rows.map((c) => `<tr><td class="nama">${esc(c.nama)}${c.berhenti_at ? ' <span class="lencana l-rose">STOP</span>' : ""}</td>
    <td class="mono nowrap">${esc(c.nik_samar || "-")}</td><td class="mono nowrap">${esc(c.hp || "-")}</td><td>${esc(c.email || "-")}</td>
    <td class="nowrap">${tglId(c.tgl_lahir)}</td><td class="nowrap">${esc(JK[c.gender] || "-")}</td><td>${esc(c.gol_darah || "-")}</td>
    <td style="min-width:200px">${esc(c.alamat || "-")}</td><td class="nowrap">${esc(c.kota || "-")}</td><td class="nowrap">${esc(c.provinsi || "-")}</td>
    <td>${esc(c.komunitas || "-")}</td><td>${esc(UMAT[c.umat] || "-")}</td><td>${esc(c.asal || "-")}</td>
    <td><div class="ikut">${ikutOf(c.id).map((i) => `<div>${esc(i.nama)} <span class="lencana ${WARNA[i.status] || "l-slate"}">${esc(i.status)}</span></div>`).join("")}</div></td></tr>`).join("")
    : '<tr><td class="kosong" colspan="14">Belum ada kontak yang cocok.</td></tr>'}
  </tbody></table></div>
  <div class="halaman"><span>Halaman ${halaman} dari ${Math.max(1, Math.ceil(total / per))}</span><span>${halaman > 1 ? `<a href="?${qs({ hal: halaman - 1 })}">Sebelumnya</a>` : ""}
    ${halaman * per < total ? `<a href="?${qs({ hal: halaman + 1 })}">Berikutnya</a>` : ""}</span></div></div>`, "/");
}

function csv(q) {
  const f = filterQuery(q);
  const head = ["Nama", "NIK (tersamar)", "WhatsApp", "Email", "Tanggal lahir", "Jenis kelamin", "Golongan darah", "Alamat", "Kota", "Provinsi", "Komunitas", "Umat", "Asal", "Event dan status", "STOP"];
  const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  const lines = db.prepare(`SELECT * FROM contacts c ${f.sql} ORDER BY c.nama COLLATE NOCASE`).all(...f.args).map((c) => [c.nama, c.nik_samar, c.hp, c.email, c.tgl_lahir, JK[c.gender] || "", c.gol_darah,
    c.alamat, c.kota, c.provinsi, c.komunitas, UMAT[c.umat] || "", c.asal, ikutOf(c.id).map((i) => `${i.nama}: ${i.status}`).join("; "), c.berhenti_at ? "ya" : ""].map(cell).join(","));
  return "﻿" + [head.map(cell).join(","), ...lines].join("\n");
}

function blastPage(admin, msg = "") {
  const list = db.prepare(`SELECT b.*, (SELECT count(*) FROM blast_penerima p WHERE p.blast_id = b.id) AS total,
    (SELECT count(*) FROM blast_penerima p WHERE p.blast_id = b.id AND p.status = 'terkirim') AS terkirim FROM blasts b ORDER BY b.id DESC LIMIT 30`).all();
  const statusList = db.prepare("SELECT DISTINCT status FROM ikut ORDER BY status").all().map((r) => r.status);
  const warnaBlast = { berjalan: "l-blue", selesai: "l-emerald", dihentikan: "l-slate" };
  return page("Blast WhatsApp", admin, `<div class="kepala-halaman"><div><h1 class="judul-halaman">Blast WhatsApp</h1>
    <p class="subjudul-halaman">Kirim poster dan info event ke satu segmen kontak lewat nomor kantor.</p></div></div>
  ${msg ? `<p class="pesan">${esc(msg)}</p>` : ""}
  <div class="kartu"><div class="kepala-kartu"><div><h2 class="judul-kartu">Buat blast baru</h2>
    <p class="subjudul-kartu">Satu pesan tiap 45 sampai 90 detik, pukul 08.00 sampai 20.00 WIB, maksimal ${Number(process.env.BLAST_PER_HARI || 200)} pesan per hari. Kontak yang membalas STOP tidak dikirimi.</p></div></div>
  <form id="fb">
    <div class="bidang"><label class="label">Judul (untuk catatan)</label><input class="isian lebar" name="judul" required placeholder="misalnya Poster Malang Night Run 2027"></div>
    <div class="grid-form">
      <div class="bidang"><label class="label">Kategori</label><select class="isian" name="kategori">${options(kategoriList(), "", "Semua kategori")}</select></div>
      <div class="bidang"><label class="label">Event</label><select class="isian" name="event">${opsiEvent("")}</select></div>
      <div class="bidang"><label class="label">Status</label><select class="isian" name="status"><option value="">Semua status</option>${statusList.map((s) => `<option>${esc(s)}</option>`).join("")}</select></div>
    </div>
    <div class="bidang"><label class="label">Pesan</label><textarea class="isian lebar" name="pesan" rows="6" required placeholder="Halo Kak {nama}, ..."></textarea>
      <span class="petunjuk">Tulis {nama} untuk menyapa dengan nama depan penerima. Di akhir pesan otomatis ditambahkan: ${esc(PENUTUP.trim())}</span></div>
    <div class="bidang"><label class="label">Poster (opsional)</label><input type="file" name="poster" accept="image/jpeg,image/png,image/webp"><span class="petunjuk">JPG, PNG, atau WebP, maksimal 5 MB</span></div>
    <p id="hitung" class="pesan"></p><button type="submit" class="tombol tombol-aksen"><span class="ms">send</span>Kirim blast</button>
  </form></div>
  <div class="kartu kartu-tabel"><div class="kepala-kartu"><div><h2 class="judul-kartu">Riwayat blast</h2></div></div>
  <div class="bungkus-tabel"><table class="tabel"><thead><tr><th>#</th><th>Judul</th><th>Segmen</th><th>Progres</th><th>Status</th><th>Dibuat</th><th></th></tr></thead><tbody>
  ${list.length ? list.map((b) => { const s = JSON.parse(b.segmen); return `<tr><td class="mono">${b.id}</td><td class="nama">${esc(b.judul)}</td><td>${esc([s.kategori, s.event, ...(s.status || [])].filter(Boolean).join(", ") || "semua")}</td>
    <td class="mono">${b.terkirim} dari ${b.total}</td><td><span class="lencana ${warnaBlast[b.status] || "l-slate"}">${esc(b.status)}</span></td><td class="nowrap">${wib(b.created_at)} <span class="redup">oleh ${esc(b.dibuat_oleh)}</span></td>
    <td>${b.status === "berjalan" ? `<form method="post" action="/blast/${b.id}/hentikan"><button class="tombol tombol-bahaya tombol-kecil">Hentikan</button></form>` : ""}</td></tr>`; }).join("")
    : '<tr><td class="kosong" colspan="7">Belum ada blast.</td></tr>'}
  </tbody></table></div></div>
  <script>
  const f=document.getElementById('fb'),h=document.getElementById('hitung');
  const seg=()=>({kategori:f.kategori.value,event:f.event.value,status:f.status.value?[f.status.value]:[]});
  async function hitung(){const r=await fetch('/api/hitung',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(seg())});const d=await r.json();h.textContent=d.n+' nomor WhatsApp akan menerima blast ini (sekitar '+Math.ceil(d.n*67/3600)+' jam pengiriman).';}
  ['kategori','event','status'].forEach(n=>f[n].addEventListener('change',hitung));hitung();
  f.addEventListener('submit',async e=>{e.preventDefault();
    let poster=null,posterNama=null;const file=f.poster.files[0];
    if(file){poster=await new Promise(ok=>{const rd=new FileReader();rd.onload=()=>ok(rd.result.split(',')[1]);rd.readAsDataURL(file)});posterNama=file.name}
    if(!confirm('Kirim blast ini? '+h.textContent))return;
    const r=await fetch('/api/blast',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({judul:f.judul.value,pesan:f.pesan.value,poster,posterNama,segmen:seg()})});
    const d=await r.json();if(!r.ok)return alert(d.error||'Gagal');location.href='/blast?msg='+encodeURIComponent('Blast #'+d.id+' mulai dikirim.');});
  </script>`, "/blast");
}

function akunPage(admin, msg = "") {
  const list = db.prepare("SELECT username, role, created_at FROM admins ORDER BY id").all();
  const log = db.prepare("SELECT * FROM log ORDER BY id DESC LIMIT 40").all();
  return page("Akun", admin, `<div class="kepala-halaman"><div><h1 class="judul-halaman">Akun admin</h1><p class="subjudul-halaman">Akun dashboard ini terpisah dari admin KUWERA dan Pet Blessing.</p></div></div>
  ${msg ? `<p class="pesan">${esc(msg)}</p>` : ""}
  <div class="kartu kartu-tabel"><div class="kepala-kartu"><h2 class="judul-kartu">Daftar akun</h2></div><div class="bungkus-tabel"><table class="tabel"><thead><tr><th>Username</th><th>Peran</th><th>Dibuat</th></tr></thead><tbody>
  ${list.map((a) => `<tr><td class="nama">${esc(a.username)}</td><td><span class="lencana ${a.role === "superadmin" ? "l-blue" : "l-slate"}">${esc(a.role)}</span></td><td>${wib(a.created_at)}</td></tr>`).join("")}</tbody></table></div></div>
  <div class="kartu"><div class="kepala-kartu"><div><h2 class="judul-kartu">Tambah akun atau ganti sandi</h2><p class="subjudul-kartu">Isi username yang sudah ada untuk mengganti sandinya.</p></div></div>
  <form method="post" action="/akun" class="saring"><input class="isian" name="username" placeholder="username" required><input class="isian" name="password" type="password" placeholder="sandi minimal 8 karakter" required>
  <select class="isian" name="role"><option value="admin">admin</option><option value="superadmin">superadmin</option></select><button class="tombol tombol-utama">Simpan</button></form></div>
  <div class="kartu kartu-tabel"><div class="kepala-kartu"><h2 class="judul-kartu">Aktivitas</h2></div><div class="bungkus-tabel"><table class="tabel"><tbody>
  ${log.map((l) => `<tr><td class="nowrap">${wib(l.waktu)}</td><td class="nama">${esc(l.admin)}</td><td>${esc(l.aksi)}</td><td class="redup">${esc(l.detail || "")}</td></tr>`).join("")}</tbody></table></div></div>`, "/akun");
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const q = Object.fromEntries(url.searchParams);
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress;
    if (url.pathname === "/sehat") return json(res, 200, { ok: true });
    // Permintaan POST hanya dari halaman ini sendiri (perlindungan CSRF sederhana, cookie juga SameSite=Lax).
    if (req.method === "POST" && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: "asal permintaan tidak dikenal" });

    if (url.pathname === "/login") {
      if (req.method === "POST") {
        if (!loginAllowed(ip)) return send(res, 429, page("Masuk", null, '<div class="kartu masuk"><p class="pesan galat">Terlalu banyak percobaan, coba lagi 15 menit lagi.</p></div>'));
        const f = form(await readBody(req, 10_000));
        const cookie = login(f.username || "", f.password || "", ip);
        return cookie ? redirect(res, "/", { "Set-Cookie": cookie }) : redirect(res, "/login?salah=1");
      }
      return send(res, 200, page("Masuk", null, `<div class="kartu masuk"><div class="merek"><span class="ubin-ikon">D</span><div><b>D'Pro Chatbot</b><small>Database pelanggan event</small></div></div>
        ${q.salah ? '<p class="pesan galat">Username atau sandi salah.</p>' : ""}<form method="post"><div class="bidang"><label class="label">Username</label><input class="isian lebar" name="username" required autofocus></div>
        <div class="bidang"><label class="label">Sandi</label><input class="isian lebar" name="password" type="password" required></div><button class="tombol tombol-utama lebar">Masuk</button></form></div>`));
    }
    const admin = currentAdmin(req);
    if (!admin) return url.pathname.startsWith("/api/") ? json(res, 401, { error: "masuk dulu" }) : redirect(res, "/login");

    if (url.pathname === "/logout" && req.method === "POST") { logoutAll(admin.id); catat(admin.username, "logout"); return redirect(res, "/login", { "Set-Cookie": logoutCookie }); }
    if (url.pathname === "/" && req.method === "GET") return send(res, 200, dashboard(admin, q));
    if (url.pathname === "/export.csv") {
      catat(admin.username, "unduh_csv", url.search);
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="database-pelanggan-${new Date().toISOString().slice(0, 10)}.csv"` });
      return res.end(csv(q));
    }
    if (url.pathname === "/sync" && req.method === "POST") { await Promise.all([syncKuwera(), syncPetBlessing()]); syncBerhenti(); catat(admin.username, "sinkron_manual"); return redirect(res, "/"); }
    if (url.pathname === "/blast" && req.method === "GET") return send(res, 200, blastPage(admin, q.msg));
    if (url.pathname === "/api/hitung" && req.method === "POST") {
      const s = JSON.parse(await readBody(req, 10_000) || "{}");
      return json(res, 200, { n: penerima(s).length });
    }
    if (url.pathname === "/api/blast" && req.method === "POST") {
      const b = JSON.parse(await readBody(req));
      if (!b.judul?.trim() || !b.pesan?.trim()) return json(res, 400, { error: "Judul dan pesan wajib diisi" });
      try { return json(res, 200, { id: buatBlast({ ...b, judul: b.judul.trim().slice(0, 120), pesan: b.pesan.trim().slice(0, 3000) }, admin.username) }); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    const m = url.pathname.match(/^\/blast\/(\d+)\/hentikan$/);
    if (m && req.method === "POST") { hentikanBlast(Number(m[1]), admin.username); return redirect(res, "/blast?msg=" + encodeURIComponent(`Blast #${m[1]} dihentikan.`)); }
    if (url.pathname === "/akun" && admin.role === "superadmin") {
      if (req.method === "POST") {
        const f = form(await readBody(req, 10_000));
        if (!/^[a-z0-9._-]{3,32}$/.test(f.username || "") || (f.password || "").length < 8) return send(res, 400, akunPage(admin, "Username huruf kecil 3 sampai 32 karakter, sandi minimal 8 karakter."));
        db.prepare(`INSERT INTO admins(username, password_hash, role) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash,
          role = excluded.role, session_version = session_version + 1`).run(f.username, hashPassword(f.password), f.role === "superadmin" ? "superadmin" : "admin");
        catat(admin.username, "simpan_akun", f.username);
        return send(res, 200, akunPage(admin, `Akun ${f.username} disimpan.`));
      }
      return send(res, 200, akunPage(admin));
    }
    send(res, 404, page("Tidak ditemukan", admin, '<h1 class="judul-halaman">Halaman tidak ditemukan</h1>', ""));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: "terjadi kesalahan" });
  }
});

server.listen(PORT, () => console.log(`dprochatbot di port ${PORT}`));
// Pekerjaan latar: sinkron KUWERA dan Pet Blessing tiap 10 menit, catatan STOP tiap menit, blast tiap 5 detik (jeda antarpesan diatur di blast.js).
const aman = (nama, fn) => async () => { try { await fn(); } catch (e) { console.error(`${nama} gagal:`, e.message); } };
const sinkronEvent = async () => { await aman("sinkron KUWERA", syncKuwera)(); await aman("sinkron Pet Blessing", syncPetBlessing)(); syncBerhenti(); };
sinkronEvent();
setInterval(sinkronEvent, 10 * 60_000);
setInterval(aman("sinkron STOP", syncBerhenti), 60_000);
setInterval(aman("blast", tickBlast), 5_000);
