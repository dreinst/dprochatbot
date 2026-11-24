import { ambilChat, daftarChat, pesanChat, tandaiDilihat } from "./cermin.js";
export { nyalakanCermin } from "./cermin-mulai.js";

// Halaman cermin chat WhatsApp kantor (hanya superadmin, hanya baca). Dirender di server seperti halaman lain di server.js;
// page, esc, send, dan catat dioper dari server.js supaya berkas ini tidak mengimpor balik server.js.
const NOSTORE = { "Cache-Control": "no-store" };
const PER_HALAMAN = 50;
const AWAL = 200;
const WIB = "Asia/Jakarta";
const tglKunci = (d) => d.toLocaleDateString("en-CA", { timeZone: WIB });
const jam = (t) => new Date(t * 1000).toLocaleTimeString("id-ID", { timeZone: WIB, hour: "2-digit", minute: "2-digit" });
const hariPanjang = (t) => new Date(t * 1000).toLocaleDateString("id-ID", { timeZone: WIB, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const waktuDaftar = (t) => {
  if (!t) return "";
  const d = new Date(t * 1000);
  return tglKunci(d) === tglKunci(new Date()) ? jam(t) : d.toLocaleDateString("id-ID", { timeZone: WIB, day: "numeric", month: "short" });
};
const waktuLengkap = (t) => new Date(t * 1000).toLocaleString("id-ID", { timeZone: WIB, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const JENIS = { gambar: ["image", "Gambar"], video: ["videocam", "Video"], suara: ["mic", "Pesan suara"], dokumen: ["description", "Dokumen"], stiker: ["emoji_emotions", "Stiker"],
  lokasi: ["location_on", "Lokasi"], kontak: ["contacts", "Kontak"], lainnya: ["chat_bubble", "Pesan lain"] };
const LABEL = { pelanggan: "Pelanggan", bot: "Bot", admin: "Admin" };
const nomorTampil = (jid) => (jid.endsWith("@c.us") ? `+${jid.split("@")[0]}` : "Grup");
const namaChat = (c) => c.nama || (c.grup ? "Grup tanpa nama" : nomorTampil(c.jid));

const CSS = `<style>
.cm-info{display:flex;gap:10px;align-items:flex-start;padding:12px 16px;border-radius:12px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;font-size:13px}.cm-info .ms{font-size:18px;color:#b45309}
.cm-saring{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.cm-saring .isian{min-width:0}.cm-chip{display:inline-flex;align-items:center;height:32px;padding:0 14px;border-radius:9999px;border:1px solid #e2e8f0;background:#fff;color:#475569;font-size:12px;font-weight:600;text-decoration:none}
.cm-chip.aktif{background:linear-gradient(180deg,#17417a 0%,#0b2141 100%);color:#fff;border-color:#0b2141}
.cm-daftar{display:flex;flex-direction:column}.cm-chat{display:flex;align-items:center;gap:12px;padding:12px 22px;border-top:1px solid #f1f5f9;text-decoration:none;color:inherit;min-width:0}.cm-chat:hover{background:rgba(248,250,252,.8)}
.cm-avatar{flex:none;width:40px;height:40px;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#17417a,#0b2141);color:#fff;font-weight:700;font-size:14px}.cm-avatar.grup{background:linear-gradient(135deg,#f86e18,#d95a0c)}
.cm-tengah{flex:1;min-width:0}.cm-nama{display:flex;align-items:baseline;gap:8px;min-width:0}.cm-nama b{color:#0f172a;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cm-nama small{color:#94a3b8;font-size:11px;white-space:nowrap}
.cm-cuplikan{color:#64748b;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px}.cm-cuplikan i{font-style:normal;font-weight:600;color:#475569}
.cm-kanan{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-size:11px;color:#94a3b8}.cm-baru{min-width:20px;height:20px;padding:0 6px;border-radius:9999px;background:#f86e18;color:#fff;font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center}
.cm-kosong{padding:40px 22px;text-align:center;color:#94a3b8}
.cm-kepala{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.cm-kepala .cm-tengah{min-width:160px}.cm-kembali{display:inline-flex;align-items:center;gap:4px;color:#17417a;font-weight:600;font-size:13px;text-decoration:none}
.cm-isi{display:flex;flex-direction:column;gap:6px;padding:18px 22px 24px;background:#f1f5f9;border-radius:0 0 16px 16px;min-width:0}
.cm-hari{align-self:center;margin:10px 0 4px;padding:3px 12px;border-radius:9999px;background:#e2e8f0;color:#475569;font-size:11px;font-weight:600}
.cm-baris{display:flex;min-width:0}.cm-baris.kanan{justify-content:flex-end}
.cm-gel{max-width:min(78%,560px);min-width:0;padding:8px 12px 6px;border-radius:14px;border:1px solid #e2e8f0;background:#fff;color:#1e293b;box-shadow:0 1px 1px rgba(11,33,65,.05)}
.cm-baris.kiri .cm-gel{border-top-left-radius:4px}.cm-baris.kanan .cm-gel{border-top-right-radius:4px}
.cm-gel.bot{background:#e0ecff;border-color:#bfd4fb}.cm-gel.admin{background:#ffeedd;border-color:#fbd2a8}
.cm-label{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:2px}.cm-gel.bot .cm-label{color:#1d4ed8}.cm-gel.admin .cm-label{color:#c2410c}
.cm-peserta{font-size:12px;font-weight:700;color:#17417a;margin-bottom:2px;overflow-wrap:anywhere}.cm-peserta span{font-weight:500;color:#94a3b8;margin-left:4px}
.cm-balas{border-left:3px solid #94a3b8;background:rgba(15,23,42,.05);border-radius:6px;padding:4px 8px;margin-bottom:4px;font-size:12px;color:#475569;overflow-wrap:anywhere}
.cm-media{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#334155;overflow-wrap:anywhere}.cm-media .ms{font-size:18px;color:#64748b}
.cm-teks{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;font-size:14px;line-height:20px}.cm-media+.cm-teks{margin-top:4px}
.cm-gel.dihapus .cm-teks{color:#64748b}.cm-gel.dihapus{border-style:dashed}
.cm-meta{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:6px;margin-top:3px;font-size:10px;color:#94a3b8}.cm-meta .lencana{font-size:10px;padding:0 6px}
.cm-lebih{align-self:center;margin-bottom:6px}
@media (max-width:860px){.cm-chat{padding:12px 16px}.cm-isi{padding:14px 12px 20px}.cm-gel{max-width:88%}.cm-kepala .tombol{display:none}}
</style>`;

const ringkas = (s, n = 90) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

function halamanDaftar({ admin, q, page, esc }) {
  const tipe = ["pribadi", "grup"].includes(q.tipe) ? q.tipe : "";
  const dari = ["pelanggan", "bot", "admin"].includes(q.dari) ? q.dari : "";
  const teks = String(q.q || "").slice(0, 100);
  const hal = Math.max(1, Number(q.hal) || 1);
  const { total, baris } = daftarChat(admin.username, { tipe, q: teks, dari, hal }, PER_HALAMAN);
  const qs = (extra) => { const p = new URLSearchParams(Object.entries({ tipe, dari, q: teks, ...extra }).filter(([, v]) => v)); return p.size ? `?${p}` : ""; };
  const chip = (nilai, label) => `<a class="cm-chip ${tipe === nilai ? "aktif" : ""}" href="/cermin${qs({ tipe: nilai, hal: "" })}">${label}</a>`;
  const item = (c) => {
    const awalan = c.akhir_pengirim === "bot" ? "Bot: " : c.akhir_pengirim === "admin" ? "Admin: " : "";
    const label = c.akhir_jenis === "teks" ? "" : `[${(JENIS[c.akhir_jenis] || JENIS.lainnya)[1]}] `;
    const isi = label + (c.akhir_teks ? ringkas(c.akhir_teks) : "");
    const huruf = c.grup ? '<span class="ms">groups</span>' : esc((namaChat(c).replace(/[^\p{L}\p{N}]/gu, "")[0] || "#").toUpperCase());
    return `<a class="cm-chat" href="/cermin/${encodeURIComponent(c.jid)}"><span class="cm-avatar ${c.grup ? "grup" : ""}">${huruf}</span>
      <div class="cm-tengah"><div class="cm-nama"><b>${esc(namaChat(c))}</b>${c.nama && !c.grup ? `<small>${esc(nomorTampil(c.jid))}</small>` : ""}</div>
      <div class="cm-cuplikan">${awalan ? `<i>${awalan}</i>` : ""}${esc(isi)}</div></div>
      <div class="cm-kanan"><span>${waktuDaftar(c.terakhir_at)}</span>${c.baru ? `<span class="cm-baru" title="${c.baru} pesan belum dilihat">${c.baru > 99 ? "99+" : c.baru}</span>` : ""}</div></a>`;
  };
  const hari = Number(process.env.CERMIN_HARI || 180);
  return page("Cermin WA", admin, `${CSS}<div class="kepala-halaman"><div><h1 class="judul-halaman">Cermin WhatsApp kantor</h1>
    <p class="subjudul-halaman">Salinan hanya baca semua chat di nomor kantor. Tidak ada tombol kirim atau balas di sini.</p></div></div>
  <div class="cm-info"><span class="ms">lock</span><span>Isi chat adalah data pribadi pelanggan, hanya untuk superadmin. Setiap chat yang dibuka tercatat di aktivitas akun. Pesan lebih dari ${hari} hari dihapus otomatis.</span></div>
  <div class="kartu kartu-tabel"><div class="kepala-kartu"><div><h2 class="judul-kartu">Daftar chat</h2><p class="subjudul-kartu">${total} chat cocok dengan saringan</p></div>
    <div class="cm-saring">${chip("", "Semua")}${chip("pribadi", "Pribadi")}${chip("grup", "Grup")}</div></div>
  <form class="cm-saring" method="get" action="/cermin" style="padding:0 22px 16px">
    <input type="hidden" name="tipe" value="${esc(tipe)}">
    <input class="isian" name="q" type="search" placeholder="Cari isi pesan, nama, atau nomor" value="${esc(teks)}" style="flex:1 1 220px">
    <select class="isian" name="dari" onchange="this.form.submit()"><option value="">Semua pengirim</option>${["pelanggan", "bot", "admin"].map((v) => `<option value="${v}" ${dari === v ? "selected" : ""}>Ada pesan dari ${LABEL[v].toLowerCase()}</option>`).join("")}</select>
    <button class="tombol tombol-utama"><span class="ms">search</span>Cari</button></form>
  <div class="cm-daftar">${baris.length ? baris.map(item).join("") : '<div class="cm-kosong">Belum ada chat yang cocok.</div>'}</div>
  <div class="halaman"><span>Halaman ${hal} dari ${Math.max(1, Math.ceil(total / PER_HALAMAN))}</span><span>${hal > 1 ? `<a href="/cermin${qs({ hal: hal - 1 })}">Sebelumnya</a> ` : ""}
    ${hal * PER_HALAMAN < total ? `<a href="/cermin${qs({ hal: hal + 1 })}">Berikutnya</a>` : ""}</span></div></div>`, "/cermin");
}

function halamanChat({ admin, chat, n, page, esc }) {
  const { lebih, baris } = pesanChat(chat.jid, n);
  const teksDari = new Map(baris.map((p) => [p.id, p]));
  let hariTerakhir = "";
  const gelembung = baris.map((p) => {
    const kunciHari = tglKunci(new Date(p.waktu * 1000));
    const pemisah = kunciHari !== hariTerakhir ? `<div class="cm-hari">${esc(hariPanjang(p.waktu))}</div>` : "";
    hariTerakhir = kunciHari;
    const kanan = p.pengirim !== "pelanggan";
    const [ikon, namaJenis] = JENIS[p.jenis] || [];
    const asal = p.balas_id ? teksDari.get(p.balas_id) : null;
    const balas = p.balas_id ? `<div class="cm-balas">${asal ? esc(ringkas(asal.teks || `[${(JENIS[asal.jenis] || JENIS.lainnya)[1]}]`, 120)) : "Membalas pesan sebelumnya"}</div>` : "";
    const peserta = chat.grup && !kanan ? `<div class="cm-peserta">${esc(p.peserta_nama || (p.peserta_nomor ? `+${p.peserta_nomor}` : "Peserta"))}${p.peserta_nama && p.peserta_nomor ? `<span>+${esc(p.peserta_nomor)}</span>` : ""}</div>` : "";
    const media = p.jenis !== "teks" ? `<div class="cm-media"><span class="ms">${ikon || "chat_bubble"}</span>${esc(namaJenis || "Pesan")}${p.nama_berkas ? ` · ${esc(p.nama_berkas)}` : ""}</div>` : "";
    return `${pemisah}<div class="cm-baris ${kanan ? "kanan" : "kiri"}"><div class="cm-gel ${p.pengirim} ${p.dihapus_at ? "dihapus" : ""}">
      ${kanan ? `<div class="cm-label">${LABEL[p.pengirim]}</div>` : peserta}${balas}${media}${p.teks ? `<div class="cm-teks">${esc(p.teks)}</div>` : ""}
      <div class="cm-meta">${p.diedit_at ? `<span title="${esc(waktuLengkap(p.diedit_at))}">diedit</span>` : ""}${p.dihapus_at ? `<span class="lencana l-rose" title="${esc(waktuLengkap(p.dihapus_at))}">dihapus</span>` : ""}<span>${jam(p.waktu)}</span></div></div></div>`;
  }).join("");
  const info = chat.grup ? "Grup" : esc(nomorTampil(chat.jid));
  return page(namaChat(chat), admin, `${CSS}<div class="kartu kartu-tabel"><div class="kepala-kartu"><div class="cm-kepala">
    <a class="cm-kembali" href="/cermin"><span class="ms">arrow_back</span>Semua chat</a>
    <span class="cm-avatar ${chat.grup ? "grup" : ""}">${chat.grup ? '<span class="ms">groups</span>' : esc((namaChat(chat).replace(/[^\p{L}\p{N}]/gu, "")[0] || "#").toUpperCase())}</span>
    <div class="cm-tengah"><h1 class="judul-kartu">${esc(namaChat(chat))}</h1><p class="subjudul-kartu">${info} · ${chat.jumlah} pesan tersimpan · terakhir ${esc(waktuLengkap(chat.terakhir_at))}</p></div></div>
    <span class="lencana l-slate"><span class="ms" style="font-size:14px">visibility</span>Hanya baca</span></div>
  <div class="cm-isi">${lebih ? `<a class="tombol tombol-garis tombol-kecil cm-lebih" href="?n=${n + AWAL}">Muat pesan lebih lama</a>` : ""}${gelembung || '<div class="cm-kosong">Belum ada pesan tersimpan.</div>'}</div></div>`, "/cermin");
}

// Dipanggil server.js untuk GET /cermin dan /cermin/<jid>, hanya setelah peran superadmin dipastikan.
export function rutCermin({ res, url, q, admin, page, esc, send, catat }) {
  const tidakAda = () => send(res, 404, page("Tidak ditemukan", admin, '<h1 class="judul-halaman">Halaman tidak ditemukan</h1>', ""));
  let sisa;
  try { sisa = decodeURIComponent(url.pathname.slice("/cermin".length)).replace(/^\//, ""); } catch { return tidakAda(); }
  if (!sisa) return send(res, 200, halamanDaftar({ admin, q, page, esc }), NOSTORE);
  if (!/^[0-9]{5,20}@c\.us$|^[0-9A-Za-z._-]{5,60}@g\.us$/.test(sisa)) return tidakAda();
  const chat = ambilChat(sisa);
  if (!chat) return tidakAda();
  const n = Math.min(5000, Math.max(AWAL, Number(q.n) || AWAL));
  const html = halamanChat({ admin, chat, n, page, esc });
  tandaiDilihat(admin.username, sisa);
  if (!q.n) catat(admin.username, "buka_cermin", sisa);
  return send(res, 200, html, NOSTORE);
}
