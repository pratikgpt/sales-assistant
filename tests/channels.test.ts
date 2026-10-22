import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseWhatsApp } from "@/lib/channels/whatsapp";
import { parseInstagram } from "@/lib/channels/instagram";
import { addressedTo, stripQuoted } from "@/lib/channels/email";
import { verifyMetaSignature } from "@/lib/channels/types";
import { verifyEvidence, type Extraction } from "@/lib/assistant";

describe("webhook signatures", () => {
  const body = JSON.stringify({ hello: "world" });
  const sig = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
  it("accepts a correctly signed body", () => expect(verifyMetaSignature(body, sig, "s3cret")).toBe(true));
  it("accepts a signature from any of the app's configured secrets", () => {
    expect(verifyMetaSignature(body, sig, undefined, "other", "s3cret")).toBe(true);
  });
  it("rejects a tampered body, wrong secret or missing header", () => {
    expect(verifyMetaSignature(body + " ", sig, "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, sig, "other")).toBe(false);
    expect(verifyMetaSignature(body, null, "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, sig, undefined)).toBe(false);
    expect(verifyMetaSignature(body, sig)).toBe(false);
  });
});

describe("WhatsApp webhook parsing", () => {
  it("extracts text messages with the sender's profile name, and delivery statuses", () => {
    const { messages, statuses } = parseWhatsApp({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: {
        contacts: [{ wa_id: "919800000000", profile: { name: "Ravi" } }],
        messages: [{ id: "wamid.1", from: "919800000000", type: "text", text: { body: "Hi, we need a dashboard" } }],
        statuses: [{ id: "wamid.out", status: "failed", errors: [{ message: "Re-engagement message" }] }],
      } }] }],
    });
    expect(messages).toEqual([{ channel: "whatsapp", external_id: "wamid.1", sender: { id: "919800000000", name: "Ravi", handle: "+919800000000" }, text: "Hi, we need a dashboard" }]);
    expect(statuses).toEqual([{ external_id: "wamid.out", status: "failed", error: "Re-engagement message" }]);
  });
  it("labels non-text messages instead of dropping them", () => {
    const { messages } = parseWhatsApp({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [{ id: "w2", from: "1", type: "image" }] } }] }] });
    expect(messages[0].text).toMatch(/image message/);
  });
});

describe("Instagram webhook parsing", () => {
  it("keeps customer messages and skips echoes of our own replies", () => {
    const out = parseInstagram({ object: "instagram", entry: [{ id: "biz", messaging: [
      { sender: { id: "cust" }, recipient: { id: "biz" }, message: { mid: "m1", text: "Do you do forecasting?" } },
      { sender: { id: "biz" }, recipient: { id: "cust" }, message: { mid: "m2", text: "Yes!", is_echo: true } },
    ] }] });
    expect(out).toEqual([{ channel: "instagram", external_id: "m1", sender: { id: "cust" }, text: "Do you do forecasting?" }]);
  });
});

describe("email", () => {
  const box = (...addrs: string[]) => ({ value: addrs.map((address) => ({ address, name: "" })), html: "", text: "" });
  it("only accepts mail sent exactly to the dedicated address", () => {
    expect(addressedTo({ to: box("Me+Sales@gmail.com") }, "me+sales@gmail.com")).toBe(true);
    expect(addressedTo({ to: box("me@gmail.com"), cc: box("me+sales@gmail.com") }, "me+sales@gmail.com")).toBe(true);
    expect(addressedTo({ to: box("me@gmail.com") }, "me+sales@gmail.com")).toBe(false);
    expect(addressedTo({ to: box("notme+sales@gmail.com") }, "me+sales@gmail.com")).toBe(false);
    expect(addressedTo({}, "me+sales@gmail.com")).toBe(false);
  });

  it("drops quoted history from replies", () => {
    expect(stripQuoted("Tuesday works.\n\nOn Mon, 26 Oct 2026 at 10:00, Quillfield wrote:\n> Which time suits you?")).toBe("Tuesday works.");
  });
});

describe("evidence verification", () => {
  const history = [{ id: "m1", author: "customer" as const, text: "We're Acme Retail and have about $10k for a Power BI dashboard." }];
  const base: Extraction = {
    fields: { company: null, service: null, budget_usd: null, timeline_months: null },
    contact_name: null, slot_choice: null, confirmation: null, wants_other_times: false, override_attempt: null, customer_question: null,
  };
  it("keeps values whose quote is in the cited customer message", () => {
    const ex = { ...base, fields: { ...base.fields, company: { value: "Acme Retail", quote: "We're Acme Retail", message_id: "m1" } } };
    expect(verifyEvidence(ex, history, ["dashboards"]).fields.company?.value).toBe("Acme Retail");
  });
  it("rejects invented quotes and unknown services", () => {
    const ex = { ...base, fields: { ...base.fields,
      budget_usd: { value: 50000, quote: "budget is $50k", message_id: "m1" },
      service: { value: "web_design", quote: "Power BI dashboard", message_id: "m1" },
    } };
    const r = verifyEvidence(ex, history, ["dashboards"]);
    expect(r.fields).toEqual({});
    expect(r.rejected).toHaveLength(2);
  });
});
