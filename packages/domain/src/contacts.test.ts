import { describe, expect, it } from "vitest";
import {
  hashEmail,
  normalizeName,
  normalizeProfileUrl,
  parseConnectionsCsv,
  suggestions,
  type SuggestionCandidate,
} from "./contacts";
import type { Attendee, ImportedContact } from "./types";

// sha256("jane@example.com"), computed outside the code under test.
const JANE_HASH = "8c87b489ce35cf2e2f39f80e282cb2e804932a56a213983eeeb428407d43b52d";

const NOTES = [
  "Notes:",
  '"When exporting your connection data, you may notice that some of the email addresses are missing. You will only see email addresses for connections who have allowed their connections to see or download their email address using this setting https://www.linkedin.com/psettings/privacy/email. You can learn more here https://www.linkedin.com/help/linkedin/answer/261"',
  "",
].join("\r\n");

const HEADER = "First Name,Last Name,URL,Email Address,Company,Position,Connected On";

describe("parseConnectionsCsv", () => {
  it("finds the header after LinkedIn's notes and reduces each row", async () => {
    const csv = [
      "﻿" + NOTES,
      HEADER,
      'Jane,Doe,https://www.linkedin.com/in/Jane-Doe-1234/, Jane@Example.com ,"Acme, Inc.",Engineer,01 Jan 2024',
      "Sam,Lee,https://www.linkedin.com/in/sam-lee,,Initech,Manager,02 Feb 2024",
      "",
    ].join("\r\n");
    const result = await parseConnectionsCsv(csv);
    expect(result).toEqual({
      ok: true,
      contacts: [
        { profileUrl: "linkedin.com/in/jane-doe-1234", name: "jane doe", emailSha256: JANE_HASH },
        { profileUrl: "linkedin.com/in/sam-lee", name: "sam lee" },
      ],
    });
  });

  it("keeps nothing but the URL, the name and the email hash", async () => {
    const csv = `${HEADER}\nJane,Doe,https://www.linkedin.com/in/jane,jane@example.com,"Secret Corp, LLC","Head of ""Stealth""",01 Jan 2024\n`;
    const result = await parseConnectionsCsv(csv);
    const text = JSON.stringify(result);
    for (const dropped of ["Secret Corp", "Stealth", "01 Jan 2024", "jane@example.com"]) {
      expect(text).not.toContain(dropped);
    }
    expect(result.ok && Object.keys(result.contacts[0]!).sort()).toEqual(["emailSha256", "name", "profileUrl"]);
  });

  it("handles a quoted field with a line break inside, LF line endings and columns in another order", async () => {
    const csv = [
      "Notes:",
      '"a note, with a comma"',
      "",
      "URL,Last Name,First Name,Position",
      'https://linkedin.com/in/ann,"Smith","Ann","Lead,\nPlatform"',
      "https://linkedin.com/in/bo,Ng,Bo,Dev",
    ].join("\n");
    const result = await parseConnectionsCsv(csv);
    expect(result).toEqual({
      ok: true,
      contacts: [
        { profileUrl: "linkedin.com/in/ann", name: "ann smith" },
        { profileUrl: "linkedin.com/in/bo", name: "bo ng" },
      ],
    });
  });

  it("drops a row that can match no one (no URL, no email)", async () => {
    const result = await parseConnectionsCsv(`${HEADER}\nNo,Link,,,Co,Pos,01 Jan 2024\n`);
    expect(result).toEqual({ ok: true, contacts: [] });
  });

  it("a file without the header is refused, not read as empty", async () => {
    expect(await parseConnectionsCsv("Name,Email\nJane,jane@example.com\n")).toEqual({ ok: false, error: "no-header" });
    expect(await parseConnectionsCsv("")).toEqual({ ok: false, error: "no-header" });
  });
});

describe("normalizeProfileUrl", () => {
  it.each([
    ["https://www.linkedin.com/in/jane-doe-1234/", "linkedin.com/in/jane-doe-1234"],
    ["http://linkedin.com/in/Jane-Doe-1234", "linkedin.com/in/jane-doe-1234"],
    ["https://www.linkedin.com/in/jane-doe-1234?trk=people-guest", "linkedin.com/in/jane-doe-1234"],
    ["https://de.linkedin.com/in/jane-doe-1234/#about", "linkedin.com/in/jane-doe-1234"],
    ["www.linkedin.com/in/jane-doe-1234", "linkedin.com/in/jane-doe-1234"],
    ["https://www.linkedin.com/in/jane-doe-1234/details/experience/", "linkedin.com/in/jane-doe-1234"],
    ["https://www.linkedin.com/in/jos%C3%A9-garc%C3%ADa", "linkedin.com/in/josé-garcía"],
    ["https://www.linkedin.com/in/JOS%c3%89-garc%c3%8da", "linkedin.com/in/josé-garcía"],
    ["https://www.linkedin.com/in/josé-garcía", "linkedin.com/in/josé-garcía"],
  ])("%s", (input, expected) => {
    expect(normalizeProfileUrl(input)).toBe(expected);
  });

  it.each([
    "",
    "https://www.linkedin.com/company/acme",
    "https://evil-linkedin.com/in/jane",
    "https://linkedin.com.evil.test/in/jane",
    "not a url at all",
  ])("rejects %j", (input) => {
    expect(normalizeProfileUrl(input)).toBeUndefined();
  });
});

describe("normalizeName", () => {
  it("folds case, accents and whitespace", () => {
    expect(normalizeName("  José   GARCÍA ")).toBe("jose garcia");
    expect(normalizeName("Zoë\tO'Brien")).toBe("zoe o'brien");
  });

  it("does nothing fuzzier: a middle name or a credential is a different name", () => {
    expect(normalizeName("Jane Q Doe")).not.toBe(normalizeName("Jane Doe"));
    expect(normalizeName("Jane Doe, PhD")).not.toBe(normalizeName("Jane Doe"));
  });
});

describe("hashEmail", () => {
  it("is SHA-256 hex of the trimmed, lowercased email", async () => {
    expect(await hashEmail("  JANE@example.COM ")).toBe(JANE_HASH);
  });
});

describe("suggestions", () => {
  const attendee = (id: string, extra: Partial<Attendee> = {}): Attendee => ({
    id,
    handle: id,
    handlePlaceholder: false,
    displayName: id,
    visibility: "connections",
    ...extra,
  });
  const contact = (extra: Partial<ImportedContact>): ImportedContact => ({ name: "", ...extra });
  const jane = attendee("jane", {
    linkedinProfileUrl: "https://www.linkedin.com/in/jane-doe-1234/",
    verifiedName: "Jane Doe",
  });

  it("profile URL and verified name together suggest", () => {
    const found = suggestions(
      [contact({ profileUrl: "linkedin.com/in/jane-doe-1234", name: "jane doe" })],
      [{ attendee: jane }],
    );
    expect(found).toEqual([{ attendee: jane, reason: "profile-and-name" }]);
  });

  it("the name matches through accents and case", () => {
    const jose = attendee("jose", { linkedinProfileUrl: "linkedin.com/in/jose", verifiedName: "José García" });
    const found = suggestions([contact({ profileUrl: "linkedin.com/in/jose", name: "jose garcia" })], [{ attendee: jose }]);
    expect(found).toHaveLength(1);
  });

  it("a claimed URL alone suggests no one", () => {
    const claimer = attendee("claimer", {
      linkedinProfileUrl: "https://www.linkedin.com/in/jane-doe-1234/",
      verifiedName: "Mallory Moe",
    });
    const unverified = attendee("unverified", { linkedinProfileUrl: "https://www.linkedin.com/in/jane-doe-1234/" });
    const found = suggestions(
      [contact({ profileUrl: "linkedin.com/in/jane-doe-1234", name: "jane doe" })],
      [{ attendee: claimer }, { attendee: unverified }],
    );
    expect(found).toEqual([]);
  });

  it("a matching name without the URL suggests no one", () => {
    const found = suggestions(
      [contact({ profileUrl: "linkedin.com/in/someone-else", name: "jane doe" })],
      [{ attendee: jane }],
    );
    expect(found).toEqual([]);
  });

  it("the URL and name must come from the same contact", () => {
    const found = suggestions(
      [
        contact({ profileUrl: "linkedin.com/in/jane-doe-1234", name: "not jane" }),
        contact({ profileUrl: "linkedin.com/in/other", name: "jane doe" }),
      ],
      [{ attendee: jane }],
    );
    expect(found).toEqual([]);
  });

  it("a verified email hash suggests on its own", () => {
    const candidate: SuggestionCandidate = { attendee: attendee("e"), verifiedEmailSha256s: [JANE_HASH] };
    expect(suggestions([contact({ emailSha256: JANE_HASH })], [candidate])).toEqual([
      { attendee: candidate.attendee, reason: "email" },
    ]);
  });

  it("any of the attendee's verified identity emails suggests", () => {
    const candidate: SuggestionCandidate = { attendee: attendee("two"), verifiedEmailSha256s: ["other-hash", JANE_HASH] };
    expect(suggestions([contact({ emailSha256: JANE_HASH })], [candidate])).toEqual([
      { attendee: candidate.attendee, reason: "email" },
    ]);
  });

  it("an attendee matched both ways is suggested once, for the email", () => {
    const found = suggestions(
      [contact({ profileUrl: "linkedin.com/in/jane-doe-1234", name: "jane doe", emailSha256: JANE_HASH })],
      [{ attendee: jane, verifiedEmailSha256s: [JANE_HASH] }],
    );
    expect(found).toEqual([{ attendee: jane, reason: "email" }]);
  });

  it("never suggests me or someone I am already connected to", () => {
    const found = suggestions(
      [contact({ profileUrl: "linkedin.com/in/jane-doe-1234", name: "jane doe" })],
      [{ attendee: jane }],
      new Set(["jane"]),
    );
    expect(found).toEqual([]);
  });
});
