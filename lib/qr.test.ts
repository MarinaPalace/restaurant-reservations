import { describe, expect, it } from "vitest";
import { qrDataUri, qrDataUris } from "@/lib/qr";
import { absoluteUrl, passKeyTargetUrl } from "@/lib/pass-key-links";

function decode(dataUri: string) {
  const [header, base64] = dataUri.split(",");
  expect(header).toBe("data:image/svg+xml;base64");
  return Buffer.from(base64, "base64").toString("utf8");
}

describe("qrDataUri", () => {
  it("produces an inline SVG data URI", async () => {
    const uri = await qrDataUri("https://vista.test/booking?k=VDM-K7QP3-M2XR4");

    expect(uri).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(decode(uri!)).toContain("<svg");
  });

  /**
   * Regression, and the whole reason the code was invisible twice.
   *
   * An SVG with only a `viewBox` has no intrinsic size. Loaded through an
   * `<img>` it collapses to nothing, and the card printed an empty square with
   * no error anywhere to explain it.
   */
  it("carries explicit width and height, not just a viewBox", async () => {
    const svg = decode((await qrDataUri("https://vista.test/booking"))!);
    const openingTag = svg.slice(0, svg.indexOf(">") + 1);

    expect(openingTag).toContain("width=");
    expect(openingTag).toContain("height=");
    expect(openingTag).toContain("viewBox=");
  });

  it("encodes different addresses differently", async () => {
    const first = await qrDataUri("https://vista.test/booking?k=VDM-AAAAA-11111");
    const second = await qrDataUri("https://vista.test/booking?k=VDM-BBBBB-22222");

    expect(first).not.toBe(second);
  });

  it("returns nothing for an empty value rather than an empty image", async () => {
    expect(await qrDataUri("")).toBeNull();
  });

  it("draws a batch keyed by id, skipping nothing it could draw", async () => {
    const codes = await qrDataUris([
      { id: "a", value: "https://vista.test/booking?k=1" },
      { id: "b", value: "https://vista.test/premium/2" },
    ]);

    expect(Object.keys(codes).sort()).toEqual(["a", "b"]);
    expect(codes.a).not.toBe(codes.b);
  });
});

describe("passKeyTargetUrl", () => {
  const urls = { bookingUrl: "vista.test/booking", invitationUrl: "vista.test/premium" };

  it("sends an in-house key to the booking step with the key attached", () => {
    expect(passKeyTargetUrl({ code: "K7QP3M2XR4", kind: "standard" }, urls)).toBe(
      "vista.test/booking?k=VDM-K7QP3-M2XR4",
    );
  });

  it("sends an invitation key straight to its own page", () => {
    expect(passKeyTargetUrl({ code: "K7QP3M2XR4", kind: "premium" }, urls)).toBe(
      "vista.test/premium/VDM-K7QP3-M2XR4",
    );
  });

  it("treats a key with no kind as an in-house one", () => {
    expect(passKeyTargetUrl({ code: "K7QP3M2XR4", kind: undefined }, urls)).toContain("/booking?k=");
  });
});

describe("absoluteUrl", () => {
  it("leaves an address that already has a scheme alone", () => {
    expect(absoluteUrl("https://vista.test/booking")).toBe("https://vista.test/booking");
    expect(absoluteUrl("http://localhost:3000/booking")).toBe("http://localhost:3000/booking");
  });

  it("adds https to a bare host, so a QR encodes something scannable", () => {
    expect(absoluteUrl("vista.test/booking")).toBe("https://vista.test/booking");
  });
});
