-- Izin baca dprochatbot di database DriveTech (server Postgres yang sama dengan KUWERA, akun dprochatbot_ro sudah ada).
-- Hanya nama, HP, dan waktu daftar tenant serta Jalan Sehat; tanpa detail usaha, bukti bayar, dan token.
-- Jalankan: docker exec -i uvx3zbwvek7pig9oiwyzgivg psql -U drivetech_app -d drivetech < drivetech-ro.sql
\set ON_ERROR_STOP on
grant connect on database drivetech to dprochatbot_ro;
grant usage on schema public to dprochatbot_ro;
grant select (id, name, phone, created_at) on public.tenants to dprochatbot_ro;
grant select (id, kode, nama, phone, status, created_at) on public.jalan_sehat_pesanan to dprochatbot_ro;
grant select (id, nama, phone, created_at) on public.jalan_sehat_peserta to dprochatbot_ro;
