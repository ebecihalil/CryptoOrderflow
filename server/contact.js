// Contact Us: visitors send a message with their own email address. Every
// message is saved on the server and, when mail is configured, emailed to the
// site owner with Reply-To set to the visitor, so a normal "Reply" answers them.
// The owner's address is never shown on the site or sent to the browser.
//
// Mail settings (server environment only, never in the repository):
//   CONTACT_TO   address that receives the messages
//   SMTP_HOST, SMTP_PORT (465 = TLS, 587 = STARTTLS), SMTP_USER, SMTP_PASS
//   CONTACT_FROM optional sender (defaults to SMTP_USER)
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import nodemailer from "nodemailer";

const EMAIL = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,190}\.[a-z]{2,24}$/i;
export const CONTACT_TOPICS = ["General question", "Feedback / feature idea", "Bug report", "Account", "Partnership", "Other"];

/** Clean and validate a submission; throws {status: 400} with a readable message. */
export function validateContact(body = {}) {
  const text = (value, max) => typeof value === "string" ? value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, max) : "";
  const name = text(body.name, 80).replace(/\n/g, " ");
  const email = text(body.email, 254).toLowerCase();
  const topic = CONTACT_TOPICS.includes(body.topic) ? body.topic : "General question";
  const message = text(body.message, 5000);
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
  if (!name) fail("Please enter your name.");
  if (!EMAIL.test(email)) fail("Please enter a valid email address so we can reply.");
  if (message.length < 10) fail("Please write a message (at least 10 characters).");
  return { name, email, topic, message };
}

export function mailConfig(env = process.env) {
  const { CONTACT_TO: to, SMTP_HOST: host, SMTP_USER: user, SMTP_PASS: pass } = env;
  if (!to || !host || !user || !pass) return null;
  const port = Number(env.SMTP_PORT) || 465;
  return { to, from: env.CONTACT_FROM || user, transport: { host, port, secure: port === 465, auth: { user, pass } } };
}

export function createContactService({
  file = process.env.CONTACT_DB || fileURLToPath(new URL("../.cache/contact.sqlite", import.meta.url)),
  config = mailConfig(), transport = config ? nodemailer.createTransport(config.transport) : null, now = Date.now,
} = {}) {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS contact_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      name TEXT NOT NULL, email TEXT NOT NULL, topic TEXT NOT NULL, message TEXT NOT NULL,
      account_email TEXT, emailed INTEGER NOT NULL DEFAULT 0
    );
  `);
  const insert = db.prepare("INSERT INTO contact_messages (created_at, name, email, topic, message, account_email) VALUES (?, ?, ?, ?, ?, ?)");
  const markSent = db.prepare("UPDATE contact_messages SET emailed = 1 WHERE id = ?");
  return {
    mailEnabled: !!transport,
    async submit(body, { accountEmail = null } = {}) {
      const entry = validateContact(body);
      const { lastInsertRowid } = insert.run(now(), entry.name, entry.email, entry.topic, entry.message, accountEmail);
      const id = Number(lastInsertRowid);
      if (transport && config) {
        try {
          await transport.sendMail({
            to: config.to, from: `"Crypto Order Flow" <${config.from}>`,
            replyTo: { name: entry.name, address: entry.email },
            subject: `[Crypto Order Flow] ${entry.topic} — ${entry.name}`,
            text: `${entry.message}\n\n— ${entry.name} <${entry.email}>${accountEmail ? `\nSigned-in account: ${accountEmail}` : ""}\nMessage #${id} · ${new Date(now()).toISOString()}\n\nReply to this email to answer ${entry.name}.`,
          });
          markSent.run(id);
        } catch (error) {
          // The message is still saved; the owner can read it on the server.
          console.warn("Contact email could not be sent:", error.message);
        }
      }
      return { id };
    },
    close() { db.close(); },
  };
}
