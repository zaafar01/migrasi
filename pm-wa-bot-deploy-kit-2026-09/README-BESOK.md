# PM WA Bot — Deployment Kit 2026-09

Tujuan:
- 2 bot WhatsApp: BOT UTARA dan BOT PESISIR.
- Tetap berada di 1 grup WhatsApp yang sama.
- User UTARA hanya dilayani BOT UTARA.
- User PESISIR hanya dilayani BOT PESISIR.
- Bot yang bukan jatahnya DIAM, tidak membalas "tidak memiliki akses".
- Database, sesi WhatsApp, history, dan PM aktif dipisahkan.
- Reminder 00:00 WIB dipisahkan berdasarkan bot.
- Bank Jakarta sengaja belum dimasukkan karena status PM belum jelas.

## Data
- Pesisir: 56 mesin unik.
- Utara: 78 mesin unik.
- Total dari data operasional kit: 134.
- HTC0017623 hanya ada di PESISIR untuk menghindari duplikasi.

## Command
pm help
pm list
pm status
pm info <ID>
pm done <ID>

`pm done` hanya menghapus mesin dari PM aktif periode berjalan; master machine tetap ada dan completion masuk history.

## Struktur VPS yang dituju

/opt/pm-wa-bot/
  utara/
  pesisir/

Setiap instance punya:
- .env sendiri
- data/pm.db sendiri
- auth_info/ sendiri
- log/ sendiri
- PM2 process sendiri

## Besok saat VPS sudah siap

1. Install Ubuntu 22.04/24.04.
2. Install Node.js 20+ dan PM2.
3. Clone/update repo aplikasi.
4. Buat dua folder instance.
5. Masukkan data CSV sesuai area.
6. Buat .env UTARA dan PESISIR.
7. Jalankan init + import PM masing-masing.
8. Start dua process dengan PM2.
9. Scan/link WhatsApp masing-masing bot.
10. Tes authorization, pm done, pm list, dan reminder.

## Catatan penting
Jangan upload:
- .env
- auth_info/
- pm.db
- session/credential WhatsApp

ke GitHub.

Kit ini berisi data operasional dan template deployment. Kode aplikasi tetap berasal dari repo pm-wa-bot-v1 yang akan kita modifikasi menjadi dua instance.
