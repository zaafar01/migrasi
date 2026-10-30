import "dotenv/config";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  Browsers
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import pino from "pino";
import cron from "node-cron";
import db from "./db.js";

const TZ = process.env.TZ || "Asia/Jakarta";
const PM_GROUP_ID = (process.env.PM_GROUP_ID || "")
  .split(",")
  .map(id => id.trim())
  .filter(Boolean);
const ADMINS = new Set(
  (process.env.ADMIN_NUMBERS || "")
    .split(",")
    .map(v => v.trim().replace(/\D/g, ""))
    .filter(Boolean)
);
const pendingImports = new Map();

function normalizeId(value) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function jidToNumber(jid = "") {
  return jid.split(":")[0].split("@")[0].replace(/\D/g, "");
}

function currentPeriod() {
  return process.env.PM_PERIOD || new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit"
  }).format(new Date()).slice(0, 7);
}

function getMachine(id) {
  return db.prepare("SELECT * FROM machines WHERE id_mesin = ?").get(normalizeId(id));
}

function isAuthorized(jid) {
  return ADMINS.has(jidToNumber(jid));
}

function completePm(id, adminJid, adminName) {
  const machine = getMachine(id);
  if (!machine) return { ok: false, reason: "NOT_FOUND" };

  const period = currentPeriod();
  const active = db.prepare(
    "SELECT 1 FROM pm_active WHERE period = ? AND id_mesin = ?"
  ).get(period, machine.id_mesin);

  if (!active) return { ok: false, reason: "NOT_ACTIVE", machine, period };

  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      "DELETE FROM pm_active WHERE period = ? AND id_mesin = ?"
    ).run(period, machine.id_mesin);

    db.prepare(`
      INSERT INTO pm_history
      (period,id_mesin,bank,area,jenis,nama_mesin,admin_jid,admin_name,completed_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      period,
      machine.id_mesin,
      machine.bank,
      machine.area || "",
      machine.jenis,
      machine.nama_mesin,
      adminJid,
      adminName || "",
      now
    );
  });

  tx();
  return { ok: true, machine, period };
}

function listActive(period = currentPeriod()) {
  return db.prepare(`
    SELECT m.*
    FROM pm_active p
    JOIN machines m ON m.id_mesin = p.id_mesin
    WHERE p.period = ?
    ORDER BY m.bank, m.area, m.jenis, m.id_mesin
  `).all(period);
}

function formatMachineList(rows) {
  if (!rows.length) return "✅ Tidak ada mesin yang tersisa di daftar PM periode ini.";
  const groups = new Map();

  for (const m of rows) {
    const key = `${m.bank}${m.area ? " - " + m.area : ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }

  let out = "";
  for (const [group, machines] of groups) {
    out += `\n🏦 *${group}*\n`;
    for (const m of machines) {
      out += `- ${m.id_mesin} — ${m.nama_mesin}\n`;
    }
  }
  return `🔴 *DAFTAR PM BELUM SELESAI*\n📅 Periode: ${currentPeriod()}\n${out}\nTotal: ${rows.length} mesin`;
}

function parseCommand(text) {
  const parts = text.trim().split(/\s+/);
  const lower = parts.map(v => v.toLowerCase());

  if (lower[0] !== "pm") return null;

  if (lower[1] === "import") {
    return { type: "import" };
  }

  if (lower[1] === "confirm") {
    return { type: "confirm" };
  }

  if (lower[1] === "cancel") {
    return { type: "cancel" };
  }

  if (lower[1] === "done" && parts.length >= 3) {
    const ids = parts.slice(2);

    if (ids.length > 10) {
      return { type: "done_limit" };
    }

    return { type: "done", ids };
  }

  if (lower[1] === "list") {
    return { type: "list" };
  }

  if (lower[1] === "status") {
    return { type: "status" };
  }

  if (lower[1] === "help") {
    return { type: "help" };
  }

  if (lower[1] === "info" && parts.length >= 3) {
    return { type: "info", id: parts.slice(2).join(" ") };
  }

  return { type: "unknown" };
}

function parsePmImport(text) {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const result = {
    machines: [],
    newMachines: [],
    duplicates: [],
    unknown: [],
    headers: []
  };

  const seen = new Set();

  let currentArea = null;
  let currentBank = null;
  let currentJenis = "CRM";

  const bankNames = new Set([
    "BCA",
    "BDI",
    "BSI",
    "BTN",
    "BRI",
    "BNI",
    "BPRKS",
    "DANAMON",
    "MANDIRI",
    "SINARMAS",
    "OCBC"
  ]);

  const subAreas = new Set([
    "FREE YORK",
    "GADING",
    "CILINCING",
    "SUNTER PAEMANGAN",
    "SUNTER PADEMANGAN",
    "TIMUR"
  ]);

  const findById = db.prepare(`
    SELECT *
    FROM machines
    WHERE UPPER(id_mesin) = ?
    LIMIT 1
  `);

  const findTcrByName = db.prepare(`
    SELECT *
    FROM machines
    WHERE jenis = 'TCR'
      AND bank = ?
      AND area = ?
      AND UPPER(TRIM(nama_mesin)) = ?
    LIMIT 1
  `);

  for (const line of lines) {
    const upper = line.toUpperCase().trim();

    if (upper === "UTARA" || upper === "PESISIR") {
      currentArea = upper;
      currentBank = null;
      currentJenis = "CRM";
      result.headers.push(line);
      continue;
    }

    if (bankNames.has(upper)) {
      currentBank = upper;
      currentJenis = "CRM";
      result.headers.push(line);
      continue;
    }

    if (upper === "TCR") {
      currentJenis = "TCR";
      result.headers.push(line);
      continue;
    }

    if (subAreas.has(upper)) {
      result.headers.push(line);
      continue;
    }

    if (!currentArea || !currentBank) {
      result.unknown.push({
        raw: line,
        reason: "Bank/area belum diketahui"
      });
      continue;
    }

    if (currentJenis === "TCR") {
      const tcrName = upper;

      const existingTcr = findTcrByName.get(
        currentBank,
        currentArea,
        tcrName
      );

      if (existingTcr) {
        if (seen.has(existingTcr.id_mesin)) {
          result.duplicates.push(existingTcr);
          continue;
        }

        seen.add(existingTcr.id_mesin);

        result.machines.push({
          ...existingTcr,
          raw: line
        });

        continue;
      }

      const internalId =
        `TCR-${currentBank}-${currentArea}-${upper
          .replace(/[^A-Z0-9]+/g, "-")
          .replace(/^-|-$/g, "")}`;

      if (seen.has(internalId)) {
        result.duplicates.push({
          id_mesin: internalId,
          bank: currentBank,
          area: currentArea,
          jenis: "TCR",
          nama_mesin: line
        });
        continue;
      }

      const newTcr = {
        id_mesin: internalId,
        bank: currentBank,
        area: currentArea,
        jenis: "TCR",
        nama_mesin: line,
        status: "AKTIF",
        raw: line,
        isNew: true
      };

      seen.add(internalId);
      result.newMachines.push(newTcr);

      continue;
    }

    const wsidMatch = line.match(/^([A-Z0-9]+)\s+(.+)$/i);

    if (wsidMatch) {
      const possibleId = normalizeId(wsidMatch[1]);
      const possibleName = wsidMatch[2].trim();

      const machine = findById.get(possibleId);

      if (machine) {
        if (seen.has(machine.id_mesin)) {
          result.duplicates.push(machine);
          continue;
        }

        seen.add(machine.id_mesin);

        result.machines.push({
          ...machine,
          raw: line
        });

        continue;
      }

      if (possibleId.length >= 4) {
        const key = `NEW:${possibleId}`;

        const newMachine = {
          id_mesin: possibleId,
          bank: currentBank,
          area: currentArea,
          jenis: "CRM",
          nama_mesin: possibleName,
          status: "AKTIF",
          raw: line,
          isNew: true
        };

        if (seen.has(key)) {
          result.duplicates.push(newMachine);
          continue;
        }

        seen.add(key);
        result.newMachines.push(newMachine);

        continue;
      }
    }

    result.unknown.push({
      raw: line,
      reason: "Format tidak dikenali"
    });
  }

  return result;
}


function helpText() {
   return `🤖 *BOT PM MESIN*

Command tim:
• pm done ID_MESIN
• pm list
• pm status
• pm info ID_MESIN
• pm help

Contoh:
pm done ZZA1
pm done TCR PLUIT MEGA MALL 1

Setiap PM DONE akan menghapus mesin dari daftar PM periode berjalan dan menyimpan riwayatnya.`;
}

async function sendReminder(sock) {
  const rows = listActive();
  const jid = process.env.REMINDER_CHAT_JID?.trim();
  if (!jid) {
    console.log("[REMINDER] REMINDER_CHAT_JID belum diisi.");
    return;
  }
  if (!rows.length) {
    await sock.sendMessage(jid, {
      text: `✅ *REMINDER PM*\n\nSemua mesin pada periode ${currentPeriod()} sudah selesai PM.`
    });
    return;
  }
  await sock.sendMessage(jid, { text: formatMachineList(rows) });
}

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");

  const sock = makeWASocket({
    auth: state,
    browser: Browsers.windows("PM Bot"),
    logger: pino({ level: "silent" })
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) qrcode.generate(qr, { small: true });

    if (connection === "open") {
      console.log("✅ WhatsApp bot tersambung.");
    }

    if (connection === "close") {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const reconnect = code !== DisconnectReason.loggedOut;
      console.log("WhatsApp terputus. Reconnect:", reconnect);
      if (reconnect) setTimeout(connect, 3000);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
	console.log("[MESSAGE EVENT]", type, messages.length);

    if (type !== "notify") return;

    for (const m of messages) {
      console.log("[RAW MESSAGE]", JSON.stringify(m, null, 2));

        if (!m.message) continue;
	if (
	  PM_GROUP_ID.length > 0 &&
	  !PM_GROUP_ID.includes(m.key.remoteJid)
	  ) {
             continue;
	  }
      const jid =
	m.key.participantAlt ||
	m.key.participant ||
	m.key.remoteJid;

      const text =
        m.message.conversation ||
        m.message.extendedTextMessage?.text ||
        "";

	console.log("[MESSAGE]", {
  	from: m.key.remoteJid,
  	participant: m.key.participant,
  	text
      });

      const importKey = `${m.key.remoteJid}:${jidToNumber(jid)}`;

      // ===== TERIMA LIST PM =====

      if (pendingImports.has(importKey) && text.trim()) {
        const pending = pendingImports.get(importKey);

        if (pending.status === "waiting") {
          const parsed = parsePmImport(text);

          if (
            !parsed.machines.length &&
            !parsed.newMachines.length &&
            !parsed.unknown.length
          ) {
            await sock.sendMessage(m.key.remoteJid, {
              text:
                `⚠️ *LIST PM TIDAK TERBACA*\n\n` +
                `Bot belum menemukan ID mesin dari pesan tersebut.\n\n` +
                `Pastikan formatnya seperti:\n` +
                `BCA\n` +
                `Z057 Nama Lokasi\n` +
                `Z0CT Nama Lokasi`
            });

            continue;
          }

          pending.status = "preview";
          pending.data = parsed;

          pendingImports.set(importKey, pending);

          let preview = `📥 *PREVIEW IMPORT PM*\n`;
          preview += `📅 Periode: ${currentPeriod()}\n\n`;

          // Kelompokkan semua mesin berdasarkan bank
          // termasuk mesin lama dan mesin baru
          const groups = new Map();

          const allValidMachines = [
            ...parsed.machines,
            ...parsed.newMachines
          ];

          for (const machine of allValidMachines) {
            if (!groups.has(machine.bank)) {
              groups.set(machine.bank, []);
            }

            groups.get(machine.bank).push(machine);
          }

          for (const [bank, machines] of groups) {
            preview += `🏦 *${bank}:* ${machines.length}\n`;
          }

          preview +=
            `\n📦 *TOTAL VALID:* ${allValidMachines.length}` +
            `\n🆕 *MESIN BARU:* ${parsed.newMachines.length}`;

          if (parsed.duplicates.length) {
            preview += `\n⚠️ *DUPLIKAT:* ${parsed.duplicates.length}`;
          }

          if (parsed.unknown.length) {
            preview += `\n❌ *TIDAK DITEMUKAN:* ${parsed.unknown.length}`;

            preview += `\n\n*ID TIDAK DITEMUKAN:*`;
            for (const item of parsed.unknown.slice(0, 20)) {
              preview += `\n- ${item.raw}`;
            }

            if (parsed.unknown.length > 20) {
              preview += `\n- ... dan ${parsed.unknown.length - 20} lainnya`;
            }
          }

          preview +=
            `\n\n⚠️ Data belum masuk database.` +
            `\n\nKetik *pm confirm* untuk menyimpan.` +
            `\nKetik *pm cancel* untuk membatalkan.`;

          await sock.sendMessage(m.key.remoteJid, {
            text: preview
          });

          continue;
        }
      }

      // ===== COMMAND =====

      const cmd = parseCommand(text);
      if (!cmd) continue;

      console.log("[AUTH DEBUG]", {
  	jid,
  	remoteJid: m.key.remoteJid,
  	participant: m.key.participant,
  	senderPn: m.key.senderPn,
  	senderLid: m.key.senderLid,
  	number: jidToNumber(jid),
  	admins: [...ADMINS]
	});


      if (!isAuthorized(jid) && !m.key.fromMe) {
        continue;
      }

      // ===== PM IMPORT =====

      if (cmd.type === "import") {
        const key = `${m.key.remoteJid}:${jidToNumber(jid)}`;

        pendingImports.set(key, {
          status: "waiting",
          createdAt: Date.now()
        });

        await sock.sendMessage(m.key.remoteJid, {
          text:
            `📥 *MODE IMPORT PM AKTIF*\n\n` +
            `Silakan kirim/paste daftar PM bulan ini di pesan berikutnya.\n\n` +
            `Bot akan membuat preview terlebih dahulu.\n` +
            `Database belum akan berubah.\n\n` +
            `Ketik *pm cancel* untuk membatalkan.`
        });

        continue;
      }

      if (cmd.type === "cancel") {
        const key = `${m.key.remoteJid}:${jidToNumber(jid)}`;

        if (!pendingImports.has(key)) {
          await sock.sendMessage(m.key.remoteJid, {
            text: "ℹ️ Tidak ada import PM yang sedang berjalan."
          });
          continue;
        }

        pendingImports.delete(key);

        await sock.sendMessage(m.key.remoteJid, {
          text: "❌ *IMPORT PM DIBATALKAN*"
        });

        continue;
	
       }
      if (cmd.type === "confirm") {
        const key = `${m.key.remoteJid}:${jidToNumber(jid)}`;
        const pending = pendingImports.get(key);

        if (!pending || pending.status !== "preview") {
          await sock.sendMessage(m.key.remoteJid, {
            text:
              "ℹ️ Tidak ada preview import PM yang menunggu konfirmasi.\n\n" +
              "Gunakan *pm import* terlebih dahulu."
          });
          continue;
        }

        const parsed = pending.data;
        const period = currentPeriod();

        const totalValid =
          parsed.machines.length +
          parsed.newMachines.length;

        if (!totalValid) {
          await sock.sendMessage(m.key.remoteJid, {
            text: "❌ Tidak ada mesin valid yang bisa diimport."
          });
          continue;
        }

        let added = 0;
        let alreadyActive = 0;
        let newMachinesAdded = 0;

        const now = new Date().toISOString();

        const insertPeriod = db.prepare(
          "INSERT OR IGNORE INTO pm_periods(period, created_at) VALUES (?, ?)"
        );

        const insertMachine = db.prepare(`
          INSERT OR IGNORE INTO machines
          (
            id_mesin,
            bank,
            area,
            jenis,
            nama_mesin,
            status,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertActive = db.prepare(
          "INSERT OR IGNORE INTO pm_active(period, id_mesin, added_at) VALUES (?, ?, ?)"
        );

        const checkActive = db.prepare(
          "SELECT 1 FROM pm_active WHERE period = ? AND id_mesin = ?"
        );

        const checkHistory = db.prepare(
          "SELECT 1 FROM pm_history WHERE period = ? AND id_mesin = ?"
        );

        const tx = db.transaction(() => {
          // Pastikan periode sudah ada
          insertPeriod.run(period, now);

          // ==========================================
          // 1. SIMPAN MESIN BARU KE MASTER
          // ==========================================

          for (const machine of parsed.newMachines) {
            insertMachine.run(
              machine.id_mesin,
              machine.bank,
              machine.area,
              machine.jenis,
              machine.nama_mesin,
              machine.status || "AKTIF",
              now,
              now
            );

            newMachinesAdded++;
          }

          // ==========================================
          // 2. MASUKKAN MESIN LAMA KE PM AKTIF
          // ==========================================

          for (const machine of parsed.machines) {
            const exists = checkActive.get(
              period,
              machine.id_mesin
            );

            if (exists) {
              alreadyActive++;
              continue;
            }

            const done = checkHistory.get(
              period,
              machine.id_mesin
            );

            if (done) {
              continue;
            }

            insertActive.run(
              period,
              machine.id_mesin,
              now
            );

            added++;
          }

          // ==========================================
          // 3. MASUKKAN MESIN BARU KE PM AKTIF
          // ==========================================

          for (const machine of parsed.newMachines) {
            const exists = checkActive.get(
              period,
              machine.id_mesin
            );

            if (exists) {
              alreadyActive++;
              continue;
            }

            const done = checkHistory.get(
              period,
              machine.id_mesin
            );

            if (done) {
              continue;
            }

            insertActive.run(
              period,
              machine.id_mesin,
              now
            );

            added++;
          }
        });

        tx();

        pendingImports.delete(key);

        await sock.sendMessage(m.key.remoteJid, {
          text:
            `✅ *IMPORT PM BERHASIL*\n\n` +
            `📅 Periode: ${period}\n` +
            `📦 Ditambahkan ke PM: ${added} mesin\n` +
            `🆕 Mesin baru ke master: ${newMachinesAdded}\n` +
            `⚠️ Sudah ada: ${alreadyActive} mesin\n` +
            `❌ Tidak terbaca: ${parsed.unknown.length}\n` +
            `🔁 Duplikat dari list: ${parsed.duplicates.length}\n\n` +
            `Gunakan *pm list* untuk melihat daftar PM aktif.`
        });

        continue;
      }

      // ===== END PM IMPORT =====


      if (cmd.type === "help") {
	await sock.sendMessage(m.key.remoteJid, { text: helpText() });
        continue;
      }

      if (cmd.type === "list") {
        await sock.sendMessage(m.key.remoteJid, {
          text: formatMachineList(listActive())
        });
        continue;
      }

      if (cmd.type === "status") {
        const period = currentPeriod();
        const active = listActive(period).length;
        const total = db.prepare(`
          SELECT COUNT(*) AS n FROM pm_active WHERE period = ?
        `).get(period).n;
        const done = db.prepare(`
          SELECT COUNT(*) AS n FROM pm_history WHERE period = ?
        `).get(period).n;
        await sock.sendMessage(m.key.remoteJid, {
          text: `📊 *STATUS PM ${period}*\n\n❌ Belum PM: ${active}\n✅ Sudah PM: ${done}\n📦 Total masuk periode: ${active + done}`
        });
        continue;
      }

      if (cmd.type === "info") {
        const machine = getMachine(cmd.id);
        await sock.sendMessage(m.key.remoteJid, {
          text: machine
            ? `🔧 *INFO MESIN*\n🏦 Bank: ${machine.bank}\n📍 Area: ${machine.area || "-"}\n⚙️ Jenis: ${machine.jenis}\n🆔 ID: ${machine.id_mesin}\n📌 Lokasi: ${machine.nama_mesin}\n📋 Status master: ${machine.status}`
            : "❌ ID mesin tidak ditemukan."
        });
        continue;
      }

      if (cmd.type === "done_limit") {
        await sock.sendMessage(m.key.remoteJid, {
          text: `⚠️ *MAKSIMAL 10 MESIN*\n\nGunakan maksimal 10 ID mesin dalam satu command.\n\nContoh:\npm done Z057 Z0CT Z2JY Z30E Z4EY Z70H Z70J Z70T Z70V Z70Y`
        });
        continue;
      }

      if (cmd.type === "done") {
        const success = [];
        const notFound = [];
        const notActive = [];

        for (const id of cmd.ids) {
          const result = completePm(id, jid, jidToNumber(jid));

          if (!result.ok && result.reason === "NOT_FOUND") {
            notFound.push(normalizeId(id));
            continue;
          }

          if (!result.ok && result.reason === "NOT_ACTIVE") {
            notActive.push(result.machine.id_mesin);
            continue;
          }

          if (result.ok) {
            success.push(result.machine);
          }
        }

        let text = `✅ *PM DONE*\n\n`;

        if (success.length) {
          text += `*BERHASIL (${success.length})*\n`;
          for (const machine of success) {
            text += `- ${machine.id_mesin} — ${machine.nama_mesin}\n`;
          }
        }

        if (notFound.length) {
          text += `\n❌ *ID TIDAK DITEMUKAN (${notFound.length})*\n`;
          for (const id of notFound) {
            text += `- ${id}\n`;
          }
        }

        if (notActive.length) {
          text += `\n⚠️ *SUDAH PM / TIDAK AKTIF (${notActive.length})*\n`;
          for (const id of notActive) {
            text += `- ${id}\n`;
          }
        }

        text += `\n📊 *Total:* ${success.length} berhasil`;

        await sock.sendMessage(m.key.remoteJid, { text });
      }
    }
  });

  // Setiap hari 00:00 WIB.
  cron.schedule("0 0 * * *", () => {
    sendReminder(sock).catch(console.error);
  }, { timezone: TZ });
}

connect().catch(console.error);
