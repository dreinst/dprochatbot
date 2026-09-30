import http from "node:http";
import { db, catat, setting } from "./db.js";
import { currentAdmin, hashPassword, login, loginAllowed, logoutAll, logoutCookie } from "./auth.js";
import { buatBlast, hentikanBlast, penerima, tickBlast, PENUTUP } from "./blast.js";
import { syncBerhenti, syncKuwera } from "./sync-kuwera.js";

// Dashboard database pelanggan event D'Production + blast WhatsApp. Satu berkas server tanpa framework.
const PORT = Number(process.env.PORT || 3000);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const STATUS = ["lunas", "menunggu", "kedaluwarsa", "batal"];
const JERSEY = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];
const wib = (iso) => (iso ? new Date(iso.endsWith("Z") ? iso : iso.replace(" ", "T") + "Z").toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-");

function page(title, admin, body) {
  const nav = admin ? `<nav><b>D'Pro Chatbot</b>
    <a href="/">Database</a><a href="/blast">Blast WhatsApp</a>${admin.role === "superadmin" ? '<a href="/akun">Akun</a>' : ""}
    <span class="sp"></span><span>${esc(admin.username)} (${esc(admin.role)})</span>
    <form method="post" action="/logout"><button>Keluar</button></form></nav>` : "";
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} | D'Pro Chatbot</title><style>
*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,sans-serif;background:#0e1a14;color:#e8f0ea}
nav{display:flex;gap:16px;align-items:center;padding:12px 24px;background:#132a1f;border-bottom:1px solid #24483a;flex-wrap:wrap}
nav a{color:#ffd24a;text-decoration:none}.sp{flex:1}main{padding:24px;max-width:1400px;margin:auto}
h1{font-size:26px;margin:0 0 16px}h2{font-size:18px;margin:0 0 12px}
.card{background:#152a20;border:1px solid #24483a;border-radius:14px;padding:16px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.stat b{font-size:26px;display:block;color:#ffd24a}
input,select,textarea,button{font:inherit;border-radius:10px;border:1px solid #2f5a48;background:#0f2019;color:#e8f0ea;padding:8px 10px}
button,.btn{background:#ffd24a;color:#0e1a14;border:0;font-weight:600;cursor:pointer;text-decoration:none;padding:8px 14px;border-radius:10px;display:inline-block}
button.ghost{background:transparent;color:#ffd24a;border:1px solid #ffd24a}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:6px 8px;border-top:1px solid #24483a;vertical-align:top}
th{color:#9fbdaf;font-weight:600;border:0}.muted{color:#9fbdaf}.ok{color:#a6e36a}.warn{color:#ffb44a}.wrap{overflow-x:auto}
form.filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center}label{display:block;margin:10px 0 4px;color:#9fbdaf}
.msg{padding:10px 14px;border-radius:10px;background:#3a3312;color:#ffd24a;margin-bottom:12px}
</style></head><body>${nav}<main>${body}</main></body></html>`;
}

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
  if (q.jersey) { where.push("c.jersey = ?"); args.push(q.jersey); }
  if (q.stop === "ya") where.push("c.berhenti_at IS NOT NULL");
  if (q.q) { where.push("(c.nama LIKE ? OR c.hp LIKE ? OR c.email LIKE ? OR c.komunitas LIKE ?)"); const t = `%${q.q}%`; args.push(t, t, t, t); }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", args };
}
const ikutOf = (id) => db.prepare("SELECT e.nama, e.kategori, i.status, i.kode_tiket FROM ikut i JOIN events e ON e.id = i.event_id WHERE i.contact_id = ? ORDER BY i.daftar_at").all(id);
const options = (list, cur, label) => `<option value="">${label}</option>` + list.map((v) => `<option ${v === cur ? "selected" : ""} value="${esc(v)}">${esc(v)}</option>`).join("");
const opsiEvent = (cur) => `<option value="">Semua event</option>` + db.prepare("SELECT kode, nama FROM events ORDER BY tanggal DESC").all().map((e) => `<option ${e.kode === cur ? "selected" : ""} value="${esc(e.kode)}">${esc(e.nama)}</option>`).join("");
const kategoriList = () => db.prepare("SELECT DISTINCT kategori FROM events ORDER BY kategori").all().map((r) => r.kategori);

function dashboard(admin, q) {
  const f = filterQuery(q);
  const halaman = Math.max(1, Number(q.hal) || 1), per = 100;
  const total = db.prepare(`SELECT count(*) AS n FROM contacts c ${f.sql}`).get(...f.args).n;
  const rows = db.prepare(`SELECT * FROM contacts c ${f.sql} ORDER BY c.nama LIMIT ? OFFSET ?`).all(...f.args, per, (halaman - 1) * per);
  const perKategori = db.prepare(`SELECT e.kategori, count(DISTINCT i.contact_id) AS n FROM ikut i JOIN events e ON e.id = i.event_id GROUP BY e.kategori`).all();
  const semua = db.prepare("SELECT count(*) AS n, sum(berhenti_at IS NOT NULL) AS stop, count(DISTINCT hp) AS nomor FROM contacts").get();
  const kota = db.prepare("SELECT DISTINCT kota FROM contacts WHERE kota IS NOT NULL ORDER BY kota").all().map((r) => r.kota);
  const qs = (extra) => new URLSearchParams({ ...q, ...extra }).toString();
  return page("Database", admin, `<h1>Database pelanggan event</h1>
  <div class="grid">
    <div class="card stat"><b>${semua.n}</b>kontak (${semua.nomor} nomor WA)</div>
    ${perKategori.map((k) => `<div class="card stat"><b>${k.n}</b>kategori ${esc(k.kategori)}</div>`).join("")}
    <div class="card stat"><b>${semua.stop || 0}</b>membalas STOP (tidak di-blast)</div>
  </div>
  <p class="muted">Sinkron terakhir dari KUWERA: ${wib(setting("sync_kuwera_at"))} (otomatis tiap 10 menit)
    <form method="post" action="/sync" style="display:inline"><button class="ghost">Sinkron sekarang</button></form></p>
  <div class="card"><form class="filters" method="get">
    <input name="q" placeholder="Cari nama, HP, email, komunitas" value="${esc(q.q)}">
    <select name="kategori">${options(kategoriList(), q.kategori, "Semua kategori")}</select>
    <select name="event">${opsiEvent(q.event)}</select>
    <select name="status">${options(STATUS, q.status, "Semua status")}</select>
    <select name="kota">${options(kota, q.kota, "Semua kota")}</select>
    <select name="jersey">${options(JERSEY, q.jersey, "Semua jersey")}</select>
    <select name="stop"><option value="">Semua</option><option ${q.stop === "ya" ? "selected" : ""} value="ya">Hanya yang STOP</option></select>
    <button>Terapkan</button><a class="btn" href="/export.csv?${qs({})}">Unduh CSV</a>
  </form></div>
  <p class="muted">${total} kontak cocok. Halaman ${halaman} dari ${Math.max(1, Math.ceil(total / per))}.</p>
  <div class="card wrap"><table><thead><tr><th>Nama</th><th>NIK</th><th>WA</th><th>Email</th><th>Tgl lahir</th><th>JK</th><th>Gol. darah</th>
    <th>Alamat</th><th>Kota</th><th>Provinsi</th><th>Jersey</th><th>Kontak darurat</th><th>Komunitas</th><th>Event dan status</th></tr></thead><tbody>
  ${rows.map((c) => `<tr><td><b>${esc(c.nama)}</b>${c.berhenti_at ? ' <span class="warn">STOP</span>' : ""}</td><td>${esc(c.nik_samar || "-")}</td>
    <td>${esc(c.hp || "-")}</td><td>${esc(c.email || "-")}</td><td>${esc(c.tgl_lahir || "-")}</td><td>${esc(c.gender || "-")}</td><td>${esc(c.gol_darah || "-")}</td>
    <td>${esc(c.alamat || "-")}</td><td>${esc(c.kota || "-")}</td><td>${esc(c.provinsi || "-")}</td><td>${esc(c.jersey || "-")}</td>
    <td>${esc(c.darurat_nama || "-")}${c.darurat_hp ? `<br><span class="muted">${esc(c.darurat_hp)}</span>` : ""}</td><td>${esc(c.komunitas || "-")}</td>
    <td>${ikutOf(c.id).map((i) => `${esc(i.nama)}: <span class="${i.status === "lunas" ? "ok" : "muted"}">${esc(i.status)}</span>`).join("<br>")}</td></tr>`).join("")}
  </tbody></table></div>
  <p>${halaman > 1 ? `<a href="?${qs({ hal: halaman - 1 })}">Sebelumnya</a> ` : ""}${halaman * per < total ? `<a href="?${qs({ hal: halaman + 1 })}">Berikutnya</a>` : ""}</p>`);
}

function csv(q) {
  const f = filterQuery(q);
  const head = ["Nama", "NIK (tersamar)", "WA", "Email", "Tanggal lahir", "Jenis kelamin", "Golongan darah", "Alamat", "Kota", "Provinsi", "Kode pos", "Jersey", "Kontak darurat", "HP kontak darurat", "Komunitas", "Event dan status", "STOP"];
  const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  const lines = db.prepare(`SELECT * FROM contacts c ${f.sql} ORDER BY c.nama`).all(...f.args).map((c) => [c.nama, c.nik_samar, c.hp, c.email, c.tgl_lahir, c.gender, c.gol_darah,
    c.alamat, c.kota, c.provinsi, c.kode_pos, c.jersey, c.darurat_nama, c.darurat_hp, c.komunitas, ikutOf(c.id).map((i) => `${i.nama}: ${i.status}`).join("; "), c.berhenti_at ? "ya" : ""].map(cell).join(","));
  return "﻿" + [head.map(cell).join(","), ...lines].join("\n");
}

function blastPage(admin, msg = "") {
  const list = db.prepare(`SELECT b.*, (SELECT count(*) FROM blast_penerima p WHERE p.blast_id = b.id) AS total,
    (SELECT count(*) FROM blast_penerima p WHERE p.blast_id = b.id AND p.status = 'terkirim') AS terkirim FROM blasts b ORDER BY b.id DESC LIMIT 30`).all();
  return page("Blast WhatsApp", admin, `<h1>Blast WhatsApp</h1>${msg ? `<p class="msg">${esc(msg)}</p>` : ""}
  <div class="card"><h2>Buat blast baru</h2>
  <p class="muted">Dikirim dari nomor kantor lewat bot, satu pesan tiap 45 sampai 90 detik, pukul 08.00 sampai 20.00 WIB, maksimal ${Number(process.env.BLAST_PER_HARI || 200)} pesan per hari.
  Kontak yang membalas STOP tidak dikirimi. Tulis {nama} untuk menyapa dengan nama depan penerima. Kalimat berikut ditambahkan otomatis di akhir pesan:<br><i>${esc(PENUTUP.trim())}</i></p>
  <form id="fb"><label>Judul (untuk catatan)</label><input name="judul" required style="width:100%" placeholder="misalnya Poster Malang Night Run 2027">
  <div class="grid"><div><label>Kategori</label><select name="kategori">${options(kategoriList(), "", "Semua kategori")}</select></div>
  <div><label>Event</label><select name="event">${opsiEvent("")}</select></div>
  <div><label>Status keikutsertaan</label><select name="status"><option value="">Semua status</option>${STATUS.map((s) => `<option>${s}</option>`).join("")}</select></div></div>
  <label>Pesan</label><textarea name="pesan" rows="6" required style="width:100%" placeholder="Halo Kak {nama}, ..."></textarea>
  <label>Poster (opsional, JPG/PNG maks 5 MB)</label><input type="file" name="poster" accept="image/jpeg,image/png,image/webp">
  <p id="hitung" class="muted"></p><button type="submit">Kirim blast</button></form></div>
  <div class="card wrap"><h2>Riwayat blast</h2><table><thead><tr><th>#</th><th>Judul</th><th>Segmen</th><th>Progres</th><th>Status</th><th>Dibuat</th><th></th></tr></thead><tbody>
  ${list.map((b) => { const s = JSON.parse(b.segmen); return `<tr><td>${b.id}</td><td>${esc(b.judul)}</td><td>${esc([s.kategori, s.event, ...(s.status || [])].filter(Boolean).join(", ") || "semua")}</td>
    <td>${b.terkirim} dari ${b.total}</td><td>${esc(b.status)}</td><td>${wib(b.created_at)} oleh ${esc(b.dibuat_oleh)}</td>
    <td>${b.status === "berjalan" ? `<form method="post" action="/blast/${b.id}/hentikan"><button class="ghost">Hentikan</button></form>` : ""}</td></tr>`; }).join("")}
  </tbody></table></div>
  <script>
  const f=document.getElementById('fb'),h=document.getElementById('hitung');
  const seg=()=>({kategori:f.kategori.value,event:f.event.value,status:f.status.value?[f.status.value]:[]});
  async function hitung(){const r=await fetch('/api/hitung',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(seg())});const d=await r.json();h.textContent=d.n+' nomor WA akan menerima blast ini (sekitar '+Math.ceil(d.n*67/3600)+' jam pengiriman).';}
  ['kategori','event','status'].forEach(n=>f[n].addEventListener('change',hitung));hitung();
  f.addEventListener('submit',async e=>{e.preventDefault();
    let poster=null,posterNama=null;const file=f.poster.files[0];
    if(file){poster=await new Promise(ok=>{const rd=new FileReader();rd.onload=()=>ok(rd.result.split(',')[1]);rd.readAsDataURL(file)});posterNama=file.name}
    if(!confirm('Kirim blast ini? '+h.textContent))return;
    const r=await fetch('/api/blast',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({judul:f.judul.value,pesan:f.pesan.value,poster,posterNama,segmen:seg()})});
    const d=await r.json();if(!r.ok)return alert(d.error||'Gagal');location.href='/blast?msg='+encodeURIComponent('Blast #'+d.id+' mulai dikirim.');});
  </script>`);
}

function akunPage(admin, msg = "") {
  const list = db.prepare("SELECT username, role, created_at FROM admins ORDER BY id").all();
  const log = db.prepare("SELECT * FROM log ORDER BY id DESC LIMIT 40").all();
  return page("Akun", admin, `<h1>Akun admin</h1>${msg ? `<p class="msg">${esc(msg)}</p>` : ""}
  <div class="card"><table><thead><tr><th>Username</th><th>Peran</th><th>Dibuat</th></tr></thead><tbody>
  ${list.map((a) => `<tr><td>${esc(a.username)}</td><td>${esc(a.role)}</td><td>${wib(a.created_at)}</td></tr>`).join("")}</tbody></table></div>
  <div class="card"><h2>Tambah akun atau ganti sandi</h2><form method="post" action="/akun" class="filters">
  <input name="username" placeholder="username" required><input name="password" type="password" placeholder="sandi minimal 8 karakter" required>
  <select name="role"><option value="admin">admin</option><option value="superadmin">superadmin</option></select><button>Simpan</button></form></div>
  <div class="card wrap"><h2>Aktivitas</h2><table><tbody>${log.map((l) => `<tr><td>${wib(l.waktu)}</td><td>${esc(l.admin)}</td><td>${esc(l.aksi)}</td><td class="muted">${esc(l.detail || "")}</td></tr>`).join("")}</tbody></table></div>`);
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
        if (!loginAllowed(ip)) return send(res, 429, page("Masuk", null, '<p class="msg">Terlalu banyak percobaan, coba lagi 15 menit lagi.</p>'));
        const f = form(await readBody(req, 10_000));
        const cookie = login(f.username || "", f.password || "", ip);
        return cookie ? redirect(res, "/", { "Set-Cookie": cookie }) : redirect(res, "/login?salah=1");
      }
      return send(res, 200, page("Masuk", null, `<div class="card" style="max-width:360px;margin:60px auto"><h1>D'Pro Chatbot</h1>
        ${q.salah ? '<p class="msg">Username atau sandi salah.</p>' : ""}<form method="post"><label>Username</label><input name="username" required autofocus style="width:100%">
        <label>Sandi</label><input name="password" type="password" required style="width:100%"><p><button style="width:100%">Masuk</button></p></form></div>`));
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
    if (url.pathname === "/sync" && req.method === "POST") { await syncKuwera(); syncBerhenti(); catat(admin.username, "sinkron_manual"); return redirect(res, "/"); }
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
    send(res, 404, page("Tidak ditemukan", admin, "<h1>Halaman tidak ditemukan</h1>"));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: "terjadi kesalahan" });
  }
});

server.listen(PORT, () => console.log(`dprochatbot di port ${PORT}`));
// Pekerjaan latar: sinkron KUWERA tiap 10 menit, catatan STOP tiap menit, blast tiap 5 detik (jeda antarpesan diatur di blast.js).
const aman = (nama, fn) => async () => { try { await fn(); } catch (e) { console.error(`${nama} gagal:`, e.message); } };
aman("sinkron KUWERA", syncKuwera)();
setInterval(aman("sinkron KUWERA", syncKuwera), 10 * 60_000);
setInterval(aman("sinkron STOP", syncBerhenti), 60_000);
setInterval(aman("blast", tickBlast), 5_000);
