import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("splits plain fields and rows", () => {
    expect(parseCsv("a,b\nc,d\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("CRLF and LF alike, with or without a final line break", () => {
    expect(parseCsv("a,b\r\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("quoted commas, quoted line breaks (CRLF too) and doubled quotes", () => {
    expect(parseCsv('"Doe, Jane","line one\r\nline two","say ""hi"""\n')).toEqual([
      ["Doe, Jane", "line one\r\nline two", 'say "hi"'],
    ]);
  });

  it("drops a byte order mark", () => {
    expect(parseCsv("﻿First Name,Last Name\n")).toEqual([["First Name", "Last Name"]]);
  });

  it("keeps empty fields and blank lines as rows", () => {
    expect(parseCsv("a,,c\n\nd")).toEqual([["a", "", "c"], [""], ["d"]]);
  });

  it("an unterminated quote runs to the end instead of failing", () => {
    expect(parseCsv('a,"b\nc')).toEqual([["a", "b\nc"]]);
  });
});
