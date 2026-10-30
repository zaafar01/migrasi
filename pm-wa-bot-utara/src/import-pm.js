import "dotenv/config";
import fs from "node:fs";
import db from "./db.js";

const file = process.argv[2] || "data/pm_active.csv";
const period = process.env.PM_PERIOD;

if (!period) {
  console.error("PM_PERIOD belum diisi di .env");
  process.exit(1);
}

if (!fs.existsSync(file)) {
  console.error(`File tidak ditemukan: ${file}`);
  process.exit(1);
}

const lines = fs.readFileSync(file, "utf8")
  .split(/\r?\n/)
  .map(v => v.trim())
  .filter(v => v && !v.startsWith("#"));

const ids = lines[0]?.toLowerCase() === "id_mesin"
  ? lines.slice(1)
  : lines;

const insertPeriod = db.prepare(
  "INSERT OR IGNORE INTO pm_periods(period, created_at) VALUES (?, ?)"
);
const insert = db.prepare(
  "INSERT OR IGNORE INTO pm_active(period, id_mesin, added_at) VALUES (?, ?, ?)"
);
const find = db.prepare(
  "SELECT id_mesin, status FROM machines WHERE id_mesin = ?"
);

let added = 0;
let skipped = 0;

const tx = db.transaction(() => {
  insertPeriod.run(period, new Date().toISOString());

  for (const raw of ids) {
    const id = raw.replace(/^["']|["']$/g, "").trim().replace(/\s+/g, " ").toUpperCase();
    const machine = find.get(id);

    if (!machine || machine.status !== "AKTIF") {
      console.log(`SKIP: ${id} (tidak ditemukan / nonaktif)`);
      skipped++;
      continue;
    }

    insert.run(period, id, new Date().toISOString());
    added++;
  }
});

tx();
console.log(`Selesai. Ditambahkan/terdaftar: ${added}. Dilewati: ${skipped}. Periode: ${period}`);
