
CREATE TABLE IF NOT EXISTS machines (
  id_mesin TEXT PRIMARY KEY,
  bank TEXT NOT NULL,
  area TEXT,
  jenis TEXT NOT NULL,
  nama_mesin TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'AKTIF',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pm_periods (
  period TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pm_active (
  period TEXT NOT NULL,
  id_mesin TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (period, id_mesin),
  FOREIGN KEY (id_mesin) REFERENCES machines(id_mesin)
);

CREATE TABLE IF NOT EXISTS pm_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT NOT NULL,
  id_mesin TEXT NOT NULL,
  bank TEXT NOT NULL,
  area TEXT,
  jenis TEXT NOT NULL,
  nama_mesin TEXT NOT NULL,
  admin_jid TEXT NOT NULL,
  admin_name TEXT,
  completed_at TEXT NOT NULL
);
