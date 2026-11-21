import test from "node:test";
import assert from "node:assert/strict";
import { createContactService, validateContact, mailConfig } from "./contact.js";

test("contact messages are validated and cleaned", () => {
  assert.throws(() => validateContact({ name: "", email: "a@b.co", message: "hello there!" }), /name/);
  assert.throws(() => validateContact({ name: "Ann", email: "not-an-email", message: "hello there!" }), /valid email/);
  assert.throws(() => validateContact({ name: "Ann", email: "ann@example.com", message: "hi" }), /message/);
  const ok = validateContact({ name: " Ann\nSmith ", email: " Ann@Example.com ", topic: "Bug report", message: "Chart\r\ndoes not load\u0007" });
  assert.deepEqual(ok, { name: "Ann Smith", email: "ann@example.com", topic: "Bug report", message: "Chart\ndoes not load" });
  assert.equal(validateContact({ name: "A", email: "a@b.co", topic: "<script>", message: "0123456789" }).topic, "General question");
});

test("mail is only configured when every server setting is present", () => {
  assert.equal(mailConfig({}), null);
  const config = mailConfig({ CONTACT_TO: "owner@example.com", SMTP_HOST: "smtp.example.com", SMTP_USER: "u@example.com", SMTP_PASS: "x", SMTP_PORT: "587" });
  assert.equal(config.to, "owner@example.com");
  assert.equal(config.transport.secure, false);
});

test("a message is saved and emailed to the owner with Reply-To set to the visitor", async () => {
  const sent = [];
  const service = createContactService({ file: ":memory:", config: { to: "owner@example.com", from: "site@example.com" },
    transport: { sendMail: async mail => { sent.push(mail); } }, now: () => 1_700_000_000_000 });
  const { id } = await service.submit({ name: "Ann", email: "ann@example.com", topic: "Account", message: "Please help with my account." });
  assert.equal(id, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "owner@example.com");
  assert.deepEqual(sent[0].replyTo, { name: "Ann", address: "ann@example.com" });
  assert.match(sent[0].subject, /Account/);
  assert.match(sent[0].text, /Please help with my account/);
  service.close();
});

test("a mail failure never loses the message", async () => {
  const service = createContactService({ file: ":memory:", config: { to: "o@example.com", from: "s@example.com" },
    transport: { sendMail: async () => { throw new Error("smtp down"); } } });
  const { id } = await service.submit({ name: "Bob", email: "bob@example.com", message: "Saved even without mail." });
  assert.equal(id, 1);
  service.close();
});
