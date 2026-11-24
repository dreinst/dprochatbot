import { jadwalkanRetensi, nyalakanListener } from "./cermin.js";
import { tarikCelah } from "./cermin-tarik.js";

// Satu pintu penyalaan cermin dari server.js: listener webhook, retensi harian, dan penarik celah (saat start lalu tiap 30 menit).
export function nyalakanCermin() {
  nyalakanListener();
  jadwalkanRetensi();
  if (!process.env.WAHA_KANTOR_KEY) return console.log("cermin: WAHA_KANTOR_KEY kosong, penarik celah tidak dijalankan");
  const celah = async () => {
    try { const h = await tarikCelah(); console.log(`cermin: penarik celah ${h.chat} chat, ${h.pesan} pesan baru`); }
    catch (e) { console.error(`cermin: penarik celah gagal (${e?.message || "galat"})`); }
  };
  setTimeout(celah, 5_000);
  setInterval(celah, 30 * 60_000);
}
