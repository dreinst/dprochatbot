-- Akun baca dprochatbot di database Pet Blessing (container petblessing-db). Hanya kolom nama, HP, umat, asal,
-- tanda data uji, dan waktu daftar; tanpa donasi, bukti transfer, dan data hewan. Sandi diisi saat dijalankan.
-- Jalankan: sed "s/SANDI_DIISI/<sandi>/" petblessing-ro.sql | docker exec -i petblessing-db psql -U petblessing -d petblessing
\set ON_ERROR_STOP on
create role dprochatbot_ro login password 'SANDI_DIISI' connection limit 3;
alter role dprochatbot_ro set default_transaction_read_only = on;
grant usage on schema api to dprochatbot_ro;
grant select (id, name, phone, is_parishioner, parish_origin, is_test, submitted_at) on api.owners to dprochatbot_ro;
grant select (id, name, phone, is_parishioner, parish_origin, submitted_at) on api.pawrade_owners to dprochatbot_ro;
create policy dprochatbot_select_owners on api.owners for select to dprochatbot_ro using (true);
create policy dprochatbot_select_pawrade on api.pawrade_owners for select to dprochatbot_ro using (true);
