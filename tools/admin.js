// Buat akun admin atau ganti sandinya: node tools/admin.js <username> <sandi> [superadmin|admin]
import { db } from "../src/db.js";
import { hashPassword } from "../src/auth.js";

const [username, password, role = "admin"] = process.argv.slice(2);
if (!/^[a-z0-9._-]{3,32}$/.test(username || "") || !password || password.length < 8 || !["superadmin", "admin"].includes(role)) {
  console.error("Pakai: node tools/admin.js <username huruf kecil> <sandi minimal 8 karakter> [superadmin|admin]");
  process.exit(1);
}
db.prepare(`INSERT INTO admins(username, password_hash, role) VALUES (?, ?, ?)
  ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, role = excluded.role, session_version = session_version + 1`)
  .run(username, hashPassword(password), role);
console.log(`Akun ${username} (${role}) siap.`);
