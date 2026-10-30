import fs from "node:fs";
import db from "./db.js";

const csv = fs.readFileSync("data/machines.csv", "utf8").trim().split(/\r?\n/);
const header = csv.shift().split(",");

function parseCsvLine(line) {
  // Dataset contoh ini tidak memakai koma di field; parser sederhana cukup untuk starter.
  return line.split(",");
}

const insert = db.prepare(`
  INSERT INTO machines
  (id_mesin,bank,area,jenis,nama_mesin,status,created_at,updated_at)
  VALUES (?,?,?,?,?,?,?,?)
  ON CONFLICT(id_mesin) DO UPDATE SET
    bank=excluded.bank,
    area=excluded.area,
    jenis=excluded.jenis,
    nama_mesin=excluded.nama_mesin,
    status=excluded.status,
    updated_at=excluded.updated_at
`);

let count = 0;
const tx = db.transaction(() => {
  for (const line of csv) {
    if (!line.trim()) continue;
    const [bank, area, jenis, id, nama, status] = parseCsvLine(line);
    insert.run(
      id.trim().toUpperCase(),
      bank.trim(),
      area.trim(),
      jenis.trim(),
      nama.trim(),
      status.trim(),
      new Date().toISOString(),
      new Date().toISOString()
    );
    count++;
  }
});

tx();
console.log(`Master mesin selesai diimport: ${count} baris.`);
