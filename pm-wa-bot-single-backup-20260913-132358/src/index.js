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
      out += `❌ ${m.id_mesin} — ${m.nama_mesin}\n`;
    }
  }
  return `🔴 *DAFTAR PM BELUM SELESAI*\n📅 Periode: ${currentPeriod()}\n${out}\nTotal: ${rows.length} mesin`;
}

function parseCommand(text) {
  const parts = text.trim().split(/\s+/);
  const lower = parts.map(v => v.toLowerCase());

  if (lower[0] !== "pm") return null;
  if (lower[1] === "done" && parts.length >= 3) {
    // Semua kata setelah "pm done" adalah ID mesin.
    // Ini penting untuk ID TCR seperti "TCR PLUIT MEGA MALL 1".
    return { type: "done", id: parts.slice(2).join(" ") };
  }
  if (lower[1] === "list") return { type: "list" };
  if (lower[1] === "status") return { type: "status" };
  if (lower[1] === "help") return { type: "help" };
  if (lower[1] === "info" && parts.length >= 3) {
    return { type: "info", id: parts.slice(2).join(" ") };
  }
  return { type: "unknown" };
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
        await sock.sendMessage(m.key.remoteJid, {
          text: "❌ Anda tidak memiliki akses untuk mengubah data PM."
        });
        continue;
      }

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

      if (cmd.type === "done") {
        const result = completePm(cmd.id, jid, jidToNumber(jid));

        if (!result.ok && result.reason === "NOT_FOUND") {
          await sock.sendMessage(m.key.remoteJid, {
            text: `❌ ID mesin *${normalizeId(cmd.id)}* tidak ditemukan.`
          });
          continue;
        }

        if (!result.ok && result.reason === "NOT_ACTIVE") {
          await sock.sendMessage(m.key.remoteJid, {
            text: `⚠️ *${result.machine.id_mesin}* tidak ada di daftar PM periode *${result.period}*.\n\nMesin mungkin sudah di-PM atau memang tidak masuk jadwal periode ini.`
          });
          continue;
        }

        const mInfo = result.machine;
        await sock.sendMessage(m.key.remoteJid, {
          text: `✅ *PM DONE*\n\n🏦 ${mInfo.bank}\n🔧 ${mInfo.id_mesin}\n📍 ${mInfo.nama_mesin}\n👤 Oleh: ${jidToNumber(jid)}\n📅 Periode: ${result.period}\n\n🗑️ Mesin telah dihapus dari daftar PM periode ini.`
        });
      }
    }
  });

  // Setiap hari 00:00 WIB.
  cron.schedule("0 0 * * *", () => {
    sendReminder(sock).catch(console.error);
  }, { timezone: TZ });
}

connect().catch(console.error);
