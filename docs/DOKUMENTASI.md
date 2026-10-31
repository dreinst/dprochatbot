# Dokumentasi dprochatbot

Kondisi produksi di dokumen ini diambil dari VPS pada 1 November 2026 pukul 01.03 WIB. Bagian kode mengikuti commit `eda8c8c`.

## Ringkasan

`dprochatbot` adalah dashboard admin D'Production untuk menyatukan data peserta event, menyaringnya, mengunduhnya sebagai CSV atau kontak `.vcf`, dan membuat blast WhatsApp.

Repo ini tidak berisi logika chatbot dan tidak terhubung langsung ke WhatsApp. Balasan otomatis dan pengiriman pesan ditangani `kuwera-wa-bot` (folder `wa-bot` di repo `kuwera5k`), yang memakai WAHA dengan engine GOWS.

## Engine WhatsApp

Engine yang dipakai adalah GOWS, implementasi Go di dalam WAHA (WhatsApp HTTP API). Ini koneksi tidak resmi lewat protokol WhatsApp Web, jadi bukan WhatsApp Business Cloud API dari Meta.

| Container | Image | Engine | Dipakai oleh |
|---|---|---|---|
| `waha` | `devlikeapro/waha:latest` | GOWS, tier CORE, versi 2026.9.2 | `kuwera-wa-bot`, sesi `superadmin`, status `WORKING` |
| `waha-kantor` | `devlikeapro/waha:latest` | GOWS | Notifikasi website D'Production lewat `http://waha-kantor:3000` |
| `waha-owner` | `devlikeapro/waha:latest` | WEBJS | Tidak diperiksa |

Jalur blast dari dashboard ini hanya melewati container `waha`. Nilai engine untuk `waha` dibaca langsung dari API sesi. Untuk `waha-kantor` dan `waha-owner`, nilainya berasal dari env `WHATSAPP_DEFAULT_ENGINE`.

`wa-bot/waha-sock.js` membungkus API WAHA supaya bot tetap memakai antarmuka bergaya Baileys. Sesi dan tautan QR dipegang WAHA, sedangkan pesan masuk tiba lewat webhook bertanda tangan HMAC sha512. File yang sama bisa membaca payload WEBJS maupun GOWS.

## Teknologi

| Bagian | Yang dipakai |
|---|---|
| Runtime | Node.js 24, modul ES |
| Server web | `node:http`, tanpa framework |
| Tampilan | HTML dirender di server, CSS menyatu di `src/server.js`, gaya Produksia |
| Database sendiri | SQLite lewat `node:sqlite`, mode WAL |
| Sumber data | PostgreSQL KUWERA dan Pet Blessing lewat paket `pg` |
| Autentikasi | Sandi scrypt, cookie sesi bertanda tangan HMAC SHA-256 |
| Deploy | Docker Compose di VPS dreinst, Traefik untuk HTTPS |
| Pengujian | Belum ada tes otomatis |

## Struktur repo

```text
dprochatbot/
├── src/
│   ├── server.js            Routing, halaman HTML, CSS, CSV, jadwal latar
│   ├── db.js                Koneksi SQLite, skema, migrasi kolom, log aktivitas
│   ├── auth.js              Login, cookie sesi, batas percobaan
│   ├── blast.js             Segmen penerima, antrean, tulis outbox bot
│   ├── kontak.js            Pembuatan berkas .vcf
│   ├── sync-kuwera.js       Sinkron KUWERA, sinkron STOP, hapus data hilang
│   └── sync-petblessing.js  Sinkron Pet Blessing dan Pawrade
├── tools/admin.js           Buat akun admin atau ganti sandi lewat terminal
├── sql/petblessing-ro.sql   Akun baca dprochatbot_ro di Pet Blessing
├── docs/DOKUMENTASI.md      Dokumen ini
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── package.json
```

## Arsitektur

```text
 Postgres KUWERA ───────┐ baca tiap 10 menit
                        ▼
 Postgres Pet Blessing ──► dprochatbot ◄──── admin (HTTPS lewat Traefik)
                           SQLite /data
                              │     ▲
             tulis JSON outbox│     │baca berhenti.jsonl tiap menit
                              ▼     │
                         folder bersama /bot-data
                              │     ▲
                              ▼     │catat STOP dan MULAI
                          kuwera-wa-bot
                              │     ▲
                     API HTTP │     │ webhook HMAC
                              ▼     │
                       WAHA (engine GOWS)
                              │
                              ▼
                          WhatsApp
```

Dashboard dan bot hanya bertukar data lewat tiga folder bersama:

| Folder di bot | Isi |
|---|---|
| `data/outbox` | Pesan yang akan dikirim bot |
| `data/media` | Poster blast |
| `data/blast-stop` | Catatan balasan STOP dan MULAI |

## Alur kerja

### Sinkron data

Saat server menyala dan setiap 10 menit, KUWERA lalu Pet Blessing disalin ke SQLite. Penyalinan juga bisa dipicu tombol Sinkron sekarang dan saat mengunduh `.vcf`.

1. Baris peserta dibaca lewat akun `dprochatbot_ro`. Data uji tidak ikut.
2. Nomor HP dinormalkan ke format `62...`.
3. Kontak dan keikutsertaan disimpan dengan upsert dalam satu transaksi.
4. Pendaftaran yang sudah hilang di sumber ikut dihapus, begitu juga kontak yang tidak punya pendaftaran lagi. Penghapusan dilewati kalau sumber mengembalikan nol baris.
5. Waktu sukses dicatat dan tampil di sidebar.

NIK tidak disalin utuh. Yang disimpan adalah versi tersamar seperti `3573********0001`, sedangkan hash SHA-256 NIK menjadi bagian kunci kontak.

| Sumber | Kunci kontak |
|---|---|
| KUWERA dengan NIK 16 digit | `nik:<sha256>` |
| KUWERA tanpa NIK valid | `hp:<nomor>:<nama huruf kecil>` |
| Pet Blessing dan Pawrade | `hp:<nomor>:<nama huruf kecil>` |

Pemetaan status KUWERA:

| Status sumber | Status di dashboard |
|---|---|
| `PAID` | `lunas` |
| `PENDING`, `DRAFT` | `menunggu` |
| `EXPIRED` | `kedaluwarsa` |
| `FAILED`, `REFUNDED` | `batal` |

Peserta Pet Blessing dan Pawrade selalu berstatus `terdaftar`.

### Blast WhatsApp

1. Admin mengisi judul, segmen (kategori, event, status), pesan, dan poster opsional. Dashboard menghitung jumlah nomor dan perkiraan durasi.
2. `buatBlast` menyimpan poster maksimal 5 MB ke `media`, lalu membuat satu baris `blast_penerima` untuk tiap nomor unik.
3. `tickBlast` berjalan tiap 5 detik dan memproses satu penerima bila semua syarat terpenuhi.
4. `{nama}` diganti nama depan, ajakan STOP ditambahkan di akhir pesan, lalu JSON ditulis ke outbox secara atomik (`.tmp`, lalu `rename`).
5. Bot membaca outbox dan mengirimnya lewat WAHA.

Syarat pengiriman:

- Jeda acak 45 sampai 90 detik antarpesan.
- Hanya pukul 08.00 sampai sebelum 20.00 WIB.
- Paling banyak `BLAST_PER_HARI` pesan per hari (bawaan 200).
- Nomor yang membalas STOP dilewati.
- Hanya satu blast berjalan pada satu waktu, mulai dari ID terkecil.

Format berkas outbox:

```json
{
  "jid": "628xxxxxxxxxx@s.whatsapp.net",
  "text": "Isi pesan",
  "image": "blast-1760000000000.jpg",
  "topik": "blast #1"
}
```

### STOP dan MULAI

Bot mengenali balasan `stop`, `berhenti`, `unsubscribe`, `mulai`, dan `start`. `mulai` dan `start` hanya berlaku untuk nomor yang pernah STOP. Setiap aksi ditambahkan ke `berhenti.jsonl`.

Dashboard membaca berkas itu tiap menit, dan aksi terakhir per nomor yang berlaku. Status ini mengisi `contacts.berhenti_at`, jadi kontak yang baru masuk dengan nomor yang sama tetap terkena STOP.

### Unduh kontak

`/kontak.vcf` menjalankan sinkron dulu, lalu membuat satu kartu per nomor HP berdasarkan pendaftaran terbaru. Nama kontak memakai label event di depan, misalnya `PB Hanin Inaland`. Label diatur di `src/kontak.js`: `KUWERA`, `PB`, dan `PAWRADE`.

## Halaman dan endpoint

| Metode | Jalur | Akses | Fungsi |
|---|---|---|---|
| GET | `/sehat` | Publik | Pemeriksaan kesehatan |
| GET, POST | `/login` | Publik | Masuk |
| POST | `/logout` | Admin | Keluar dan batalkan semua sesi akun itu |
| GET | `/` | Admin | Database kontak, statistik, saringan |
| GET | `/export.csv` | Admin | Unduh CSV sesuai saringan |
| GET | `/kontak.vcf` | Admin | Sinkron, lalu unduh kontak |
| POST | `/sync` | Admin | Sinkron manual |
| GET | `/blast` | Admin | Form dan riwayat blast |
| POST | `/api/hitung` | Admin | Hitung penerima satu segmen |
| POST | `/api/blast` | Admin | Buat blast |
| POST | `/blast/:id/hentikan` | Admin | Hentikan blast |
| GET, POST | `/akun` | Superadmin | Kelola akun, lihat aktivitas |

Saringan dashboard: `q`, `kategori`, `event`, `status`, `kota`, `umat`, `stop`, `hal`.

## Skema database

File: `/data/dprochatbot.db`. Skema dibuat saat aplikasi menyala, dan perubahan kolom dijalankan di `src/db.js`.

| Tabel | Isi | Kolom penting |
|---|---|---|
| `contacts` | Satu kontak | `kunci` (unik), `nama`, `hp`, `email`, `nik_samar`, `tgl_lahir`, `gender`, `gol_darah`, `alamat`, `provinsi`, `kota`, `komunitas`, `umat`, `asal`, `berhenti_at` |
| `events` | Daftar event | `kode` (unik), `nama`, `kategori`, `tanggal`, `sumber` |
| `ikut` | Keikutsertaan kontak di event | `contact_id`, `event_id`, `ref`, `status`, `daftar_at`, `nomor` |
| `blasts` | Kampanye blast | `judul`, `pesan`, `poster`, `segmen` (JSON), `status`, `dibuat_oleh` |
| `blast_penerima` | Antrean per nomor | `blast_id`, `hp`, `nama`, `status`, `waktu` |
| `admins` | Akun dashboard | `username`, `password_hash`, `role`, `session_version` |
| `log` | Jejak aktivitas | `waktu`, `admin`, `aksi`, `detail` |
| `settings` | Pengaturan | `session_secret`, `sync_kuwera_at`, `sync_petblessing_at` |

Status blast: `berjalan`, `selesai`, `dihentikan`. Status penerima: `antre`, `terkirim`, `dilewati`.

## Keamanan

- Admin login dengan scrypt. Sesi berlaku 12 jam, cookie `HttpOnly`, `Secure`, `SameSite=Lax`.
- Login dibatasi 10 percobaan per IP per 15 menit. Penghitungnya ada di memori, jadi hilang saat restart.
- Mengganti sandi atau keluar menaikkan `session_version`, sehingga sesi lama tidak berlaku.
- POST dari origin lain ditolak.
- Keluaran HTML di-escape, dan sel CSV yang diawali `=`, `+`, `-`, `@` diberi tanda kutip tunggal.
- Akun sumber data hanya bisa membaca. Di Pet Blessing, akses dibatasi per kolom lewat `sql/petblessing-ro.sql`.
- Setiap unduhan dan aksi admin dicatat di tabel `log`.

## Konfigurasi

| Variabel | Bawaan | Fungsi |
|---|---|---|
| `KUWERA_DATABASE_URL` | Kosong | Koneksi baca KUWERA. Kalau kosong, sinkronnya dilewati |
| `PETBLESSING_DATABASE_URL` | Kosong | Koneksi baca Pet Blessing. Kalau kosong, sinkronnya dilewati |
| `BLAST_PER_HARI` | `200` | Batas pesan harian |
| `PORT` | `3000` | Port server |
| `DB_FILE` | `/data/dprochatbot.db` | Lokasi SQLite |
| `BOT_DATA` | `/bot-data` | Folder bersama bot |
| `BERHENTI_FILE` | `/bot-data/blast-stop/berhenti.jsonl` | Catatan STOP |
| `KUWERA_DB_CA_FILE` | Kosong | Sertifikat CA Postgres KUWERA |
| `KUWERA_DB_SERVERNAME` | Kosong | Nama server TLS Postgres KUWERA |

## Deploy dan operasional

Lokasi di VPS: `/root/dprochatbot`. Alamat: https://dprochatbot.187.53.129.205.sslip.io

```sh
docker compose up -d --build
docker exec dprochatbot node tools/admin.js <username> <sandi> superadmin
```

Container dibatasi memori 256 MB, tersambung ke jaringan `coolify` dan `petblessing-db_internal`, dan diperiksa lewat `/sehat` tiap 60 detik.

Untuk menambah event, buat modul sinkron seperti `src/sync-petblessing.js`, panggil dari `src/server.js` di jadwal latar, `/sync`, dan `/kontak.vcf`, tambahkan label di `src/kontak.js`, lalu tambahkan waktu sinkronnya di sidebar.

## Kondisi produksi

| Item | Nilai |
|---|---|
| Kontak | 281 |
| Event | 3 (`kuwera-2026`, `petblessing-2026`, `pawrade-2026`) |
| Blast yang pernah dibuat | 0 |
| Akun admin | 1 superadmin |
| Sinkron KUWERA terakhir | 1 November 2026, 00.59 WIB |
| Sinkron Pet Blessing terakhir | 29 Oktober 2026, 01.59 WIB |
| `kuwera-wa-bot` | Mode nomor pribadi, `PRIBADI=1` |

## Masalah yang diketahui

### Sinkron Pet Blessing gagal

Container `petblessing-db` dan `petblessing-api` berhenti, dan log dashboard berisi `getaddrinfo EAI_AGAIN petblessing-db`. Data Pet Blessing dan Pawrade berhenti di 29 Oktober.

Menurut kode, `/sync` dan `/kontak.vcf` memakai `Promise.all` tanpa penanganan galat per sumber, jadi keduanya mengembalikan error 500 selama database itu mati. Perilaku ini belum diuji lewat browser. Dashboard dan CSV tetap memakai data terakhir.

### Blast tertahan saat `PRIBADI=1`

Di mode ini bot memindahkan semua berkas blast ke `data/outbox-ditahan`. Dashboard tetap mencatat penerima sebagai `terkirim`, karena status itu berarti berkas sudah masuk outbox. Status tersebut belum membuktikan pesan sampai ke WhatsApp.

### Satu orang bisa punya dua kontak

Kontak KUWERA dengan NIK memakai kunci `nik:`, sedangkan Pet Blessing memakai kunci `hp:`. Orang yang sama di kedua sumber tidak tergabung. Blast tetap aman karena penerima dikelompokkan per nomor HP.

### Hitungan dashboard bisa berbeda dari blast

Saringan event dan status di dashboard dicek terpisah. Kontak yang lunas di event A dan terdaftar di event B akan muncul pada saringan event B plus status lunas. Segmen blast mengecek keduanya pada pendaftaran yang sama, sehingga jumlahnya bisa lebih kecil.

### Hal lain

- Semua container WAHA memakai tag `latest`, jadi versinya bisa berubah saat image ditarik ulang.
- GOWS adalah koneksi tidak resmi, jadi nomor tetap berisiko dibatasi WhatsApp. Catatan di kode bot menyebut nomor kantor pernah dibatasi.
