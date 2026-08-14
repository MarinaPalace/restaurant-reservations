import { describe, expect, it } from "vitest";
import {
  buildContactLink,
  describeContactProblem,
  isValidEmail,
  isValidPhone,
  normalizeContact,
  normalizePhone,
} from "@/lib/contact";

describe("email validation", () => {
  it("accepts ordinary addresses", () => {
    expect(isValidEmail("guest@example.com")).toBe(true);
    expect(isValidEmail("  first.last+tag@sub.example.co.uk  ")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    expect(isValidEmail("guest@")).toBe(false);
    expect(isValidEmail("guest.example.com")).toBe(false);
    expect(isValidEmail("guest@example")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("phone handling", () => {
  it("keeps a leading + and strips formatting", () => {
    expect(normalizePhone("+359 88 123 4567")).toBe("+359881234567");
    expect(normalizePhone("(088) 123-4567")).toBe("0881234567");
  });

  it("accepts plausible international numbers", () => {
    expect(isValidPhone("+359 88 123 4567")).toBe(true);
    expect(isValidPhone("0881234567")).toBe(true);
  });

  it("rejects numbers that are too short or too long", () => {
    expect(isValidPhone("12345")).toBe(false);
    expect(isValidPhone("+1234567890123456789")).toBe(false);
    expect(isValidPhone("")).toBe(false);
  });
});

describe("contact validation", () => {
  it("requires a contact", () => {
    expect(describeContactProblem(undefined)).toContain("email address or a phone number");
  });

  it("checks the chosen method only", () => {
    expect(describeContactProblem({ method: "email", email: "guest@example.com" })).toBeNull();
    expect(describeContactProblem({ method: "email", email: "nope" })).toContain("valid email");
    expect(describeContactProblem({ method: "phone", phone: "+359881234567" })).toBeNull();
    expect(describeContactProblem({ method: "phone", phone: "123" })).toContain("valid phone");
  });

  it("does not fault a missing phone when email was chosen", () => {
    expect(describeContactProblem({ method: "email", email: "guest@example.com", phone: "" })).toBeNull();
  });
});

describe("contact normalisation", () => {
  it("drops the fields that do not belong to the chosen method", () => {
    expect(
      normalizeContact({ method: "email", email: "  GUEST@Example.COM ", phone: "+359881234567" }),
    ).toEqual({ method: "email", email: "guest@example.com" });

    expect(normalizeContact({ method: "phone", phone: "+359 88 123 4567", email: "x@y.com" })).toEqual({
      method: "phone",
      phone: "+359881234567",
      messagingApp: "phone",
    });
  });
});

describe("staff contact links", () => {
  it("builds a mailto link for an email", () => {
    expect(buildContactLink({ method: "email", email: "guest@example.com" })).toBe("mailto:guest@example.com");
  });

  it("builds the right deep link per messaging app", () => {
    const phone = "+359881234567";

    expect(buildContactLink({ method: "phone", phone, messagingApp: "whatsapp" })).toBe(
      "https://wa.me/359881234567",
    );
    expect(buildContactLink({ method: "phone", phone, messagingApp: "telegram" })).toBe(
      "https://t.me/+359881234567",
    );
    expect(buildContactLink({ method: "phone", phone, messagingApp: "viber" })).toBe(
      "viber://chat?number=%2B359881234567",
    );
    expect(buildContactLink({ method: "phone", phone, messagingApp: "phone" })).toBe("tel:+359881234567");
  });

  it("falls back to a plain call link when no app was chosen", () => {
    expect(buildContactLink({ method: "phone", phone: "+359881234567" })).toBe("tel:+359881234567");
  });

  it("returns nothing when there is no contact to link to", () => {
    expect(buildContactLink(null)).toBeNull();
    expect(buildContactLink({ method: "phone", phone: "" })).toBeNull();
  });
});
