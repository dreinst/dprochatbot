# Panduan dprochatbot

Panduan singkat untuk memasang dan memakai dashboard. Detail teknis ada di `docs/DOKUMENTASI.md`.

## Instalasi

### Yang harus sudah ada di VPS

- Docker dan Docker Compose
- Jaringan Docker `coolify` dan `petblessing-db_internal`
- `kuwera-wa-bot` di `/root/kuwera-wa-bot`, tersambung ke WAHA engine GOWS
- Sertifikat `/data/coolify/ssl/coolify-ca.crt`
- Akun baca `dprochatbot_ro` di database KUWERA dan Pet Blessing

Akun Pet Blessing dibuat dengan perintah ini:

```sh
sed "s/SANDI_DIISI/<sandi>/" sql/petblessing-ro.sql | docker exec -i petblessing-db psql -U petblessing -d petblessing
```

### Langkah pasang

1. Salin repo ke `/root/dprochatbot`.
2. Buat file konfigurasi, lalu isi sandi kedua database:

   ```sh
   cd /root/dprochatbot
   cp .env.example .env
   ```

3. Jalankan aplikasi:

   ```sh
   docker compose up -d --build
   ```

4. Buat akun pertama:

   ```sh
   docker exec dprochatbot node tools/admin.js <username> <sandi> superadmin
   ```

5. Buka https://dprochatbot.187.53.129.205.sslip.io dan login.

Username memakai huruf kecil 3 sampai 32 karakter, sandi minimal 8 karakter.

### Syarat sebelum blast

Pastikan `PRIBADI` di `.env` `kuwera-wa-bot` tidak bernilai `1`. Selama nilainya `1`, semua blast tertahan di `data/outbox-ditahan` walaupun dashboard menulis `terkirim`.

Sesudah mengubahnya, jalankan ulang bot:

```sh
cd /root/kuwera-wa-bot && docker compose up -d
```

### Memperbarui aplikasi

Salin versi terbaru ke `/root/dprochatbot`, lalu jalankan `docker compose up -d --build`. Isi folder `data` tetap tersimpan.

## Penggunaan

### Mencari dan mengunduh data

1. Buka menu Database.
2. Pilih kategori, event, status, kota, atau umat. Hasilnya langsung tersaring.
3. Klik Unduh CSV untuk mengunduh hasil saringan.

Data diperbarui otomatis tiap 10 menit. Waktu sinkron terakhir tampil di sidebar.

### Menyimpan kontak ke HP kantor

1. Klik Unduh kontak (.vcf).
2. Buka berkasnya di HP kantor.
3. Pilih simpan semua.

### Mengirim blast

1. Buka menu Blast WhatsApp.
2. Isi judul, lalu pilih kategori, event, dan status.
3. Tulis pesan. `{nama}` akan diganti nama depan penerima.
4. Tambahkan poster bila perlu (JPG, PNG, atau WebP, maksimal 5 MB).
5. Cek jumlah penerima, lalu klik Kirim blast.

Ajakan membalas STOP ditambahkan otomatis di akhir pesan, jadi tidak perlu ditulis. Untuk membatalkan pengiriman, klik Hentikan di Riwayat blast. Pesan yang sudah masuk outbox tidak ikut ditarik.

### Mengelola akun

Superadmin bisa menambah akun atau mengganti sandi di menu Akun. Isi username yang sudah ada untuk mengganti sandinya.

## Supaya tetap ringan

- Biarkan sinkron otomatis berjalan. Tombol Sinkron sekarang hanya perlu dipakai kalau butuh data yang baru masuk.
- Saring data sebelum mengunduh CSV. Unduh `.vcf` hanya saat perlu, karena setiap unduhan menjalankan sinkron penuh.
- Pakai GOWS untuk sesi WhatsApp. GOWS tidak menjalankan browser seperti WEBJS, sehingga memakai lebih sedikit RAM.
- Matikan container WAHA yang tidak dipakai.
- Kompres poster mendekati 1 MB supaya folder `media` tidak cepat penuh.
- Bagi daftar besar per segmen. Dengan batas 200 pesan sehari, 200 penerima butuh sekitar 3,7 jam.
- Naikkan `BLAST_PER_HARI` hanya kalau perlu, karena volume lebih tinggi menambah risiko nomor dibatasi.

## Pencadangan

Hentikan container dulu supaya data SQLite utuh:

```sh
cd /root/dprochatbot
docker compose stop
tar -czf cadangan-$(date +%Y%m%d).tar.gz data
docker compose start
```

## Jika ada masalah

| Gejala | Yang dicek |
|---|---|
| Waktu sinkron di sidebar tidak bergerak | `docker logs --since 1h dprochatbot` |
| Log berisi `EAI_AGAIN petblessing-db` | Container `petblessing-db` mati. Nyalakan kembali |
| Sinkron sekarang atau unduh `.vcf` error | Salah satu database sumber tidak terjangkau |
| Blast `terkirim` tapi pesan tidak sampai | Nilai `PRIBADI`, lalu isi `data/outbox-ditahan` di bot |
| Blast tidak bergerak | Sekarang di luar 08.00 sampai 20.00 WIB, atau batas harian tercapai |
| Terlalu banyak percobaan login | Tunggu 15 menit |
