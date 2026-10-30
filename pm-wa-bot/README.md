# PM WA Bot — Starter

Bot WhatsApp untuk tracking Preventive Maintenance (PM) mesin CRM/TCR.

## Fitur starter
- 8 nomor admin bisa menjalankan command.
- `pm done ID_MESIN` menghapus mesin dari daftar PM periode berjalan.
- Riwayat PM menyimpan admin dan waktu.
- `pm list`, `pm status`, `pm info`, `pm help`.
- Reminder otomatis setiap 00:00 WIB.
- Master mesin terpisah dari daftar PM bulanan.
- Jadwal PM tiap bank tidak dipaksakan oleh bot; kamu yang menentukan daftar mesin tiap periode melalui `data/pm_active.csv`.

## Penting
Baileys adalah library tidak resmi untuk berinteraksi dengan WhatsApp Web. Gunakan secara wajar dan patuhi ketentuan WhatsApp.

## Persiapan di PC Windows
1. Install Node.js 20 atau lebih baru.
2. Buka CMD/PowerShell di folder project.
3. Jalankan:
   npm install
4. Salin `.env.example` menjadi `.env`.
5. Isi `ADMIN_NUMBERS` dengan 8 nomor tim.
6. Isi `REMINDER_CHAT_JID` dengan ID grup tujuan reminder (bisa dikosongkan saat tes).
7. Jalankan:
   node src/init.js
8. Jalankan:
   npm start
9. QR akan muncul di terminal. Scan menggunakan WhatsApp nomor bot.

## Mengisi PM periode baru
1. Ubah `PM_PERIOD=YYYY-MM` di `.env`.
2. Edit `data/pm_active.csv` sehingga hanya berisi ID mesin yang wajib PM pada periode itu.
3. Jalankan:
   npm run import-pm

Contoh:
id_mesin
ZZA1
Z6E3
TCR PLUIT MEGA MALL 1

## Catatan
Dataset `machines.csv` di paket ini adalah data contoh yang kamu kirim sejauh ini. Sebelum dipakai produksi, kita perlu validasi seluruh master data dan melengkapi nomor admin serta grup reminder.
