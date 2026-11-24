// Tarik riwayat chat WhatsApp kantor ke cermin: node tools/tarik-cermin.js --semua (penuh) atau tanpa argumen (hanya celah).
// Butuh WAHA_KANTOR_KEY dan WAHA_KANTOR_URL di environment. Hanya mencetak jumlah, bukan isi chat.
import { tarikCelah, tarikSemua } from "../src/cermin-tarik.js";

try {
  const penuh = process.argv.includes("--semua");
  const h = penuh ? await tarikSemua() : await tarikCelah();
  console.log(`${penuh ? "Penuh" : "Celah"}: ${h.chat} chat diproses, ${h.pesan} pesan baru.`);
} catch (e) {
  console.error(`Gagal menarik riwayat: ${e.message}`);
  process.exit(1);
}
