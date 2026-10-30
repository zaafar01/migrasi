import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve("data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "pm.db"));
db.pragma("journal_mode = WAL");

const schema = fs.readFileSync(new URL("../data/schema.sql", import.meta.url), "utf8");
db.exec(schema);

export default db;
