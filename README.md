# dprochatbot

Database pelanggan event D'Production dan blast WhatsApp dari nomor kantor.

Isinya:

- Database kontak per event dan kategori (untuk sekarang KUWERA Fun Run 5K 2026, kategori Lari). Kolomnya sama dengan formulir pendaftaran: nama, NIK tersamar, WA, email, tanggal lahir, jenis kelamin, golongan darah, alamat, kota, provinsi, kode pos, jersey, kontak darurat, komunitas, dan status keikutsertaan.
- Filter per kategori, event, status, kota, dan jersey, lalu unduh CSV.
- Blast WhatsApp dengan poster ke satu segmen, misalnya semua peserta event kategori Lari yang sudah lunas.
- Akun admin sendiri, terpisah dari admin KUWERA.

## Cara kerja

- Data KUWERA disalin tiap 10 menit lewat akun database `dprochatbot_ro` yang hanya bisa membaca. NIK tidak disalin utuh; yang disimpan versi tersamar (`3573********0001`) dan hash-nya untuk mengenali orang yang sama di event berikutnya.
- Database dashboard ini SQLite di `data/dprochatbot.db`, terpisah dari database KUWERA.
- Blast tidak mengirim sendiri. Tiap pesan ditulis ke outbox bot WA kantor (`kuwera-wa-bot`) dengan jeda acak 45 sampai 90 detik, hanya pukul 08.00 sampai 20.00 WIB, dan paling banyak `BLAST_PER_HARI` pesan sehari supaya nomor kantor aman.
- Setiap pesan blast diakhiri ajakan membalas STOP. Bot mencatat balasan STOP (dan MULAI untuk berlangganan lagi) di `berhenti.jsonl`, dan nomor itu tidak dikirimi blast lagi.

## Pasang di VPS

Salin repo ke `/root/dprochatbot`, buat `.env` dari `.env.example` (isi sandi `dprochatbot_ro`), jalankan compose, lalu buat akun pertama:

```sh
docker exec dprochatbot node tools/admin.js <username> <sandi> superadmin
```

Alamat: https://dprochatbot.187.53.129.205.sslip.io

## Menambah event baru

Event lain bisa ditambahkan dengan modul sinkron seperti `src/sync-kuwera.js`: isi `events` (kode, nama, kategori, tanggal) lalu `contacts` dan `ikut`. Kontak dikenali lewat hash NIK, jadi orang yang ikut dua event tetap satu baris dengan dua riwayat event.
