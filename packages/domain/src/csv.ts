/**
 * RFC 4180 rows from CSV text: fields separated by commas, rows by CRLF or LF,
 * a field in double quotes may hold commas, line breaks and `""` for a quote.
 * A leading byte order mark is dropped. Lenient where the RFC is strict: a
 * quote inside an unquoted field is kept as text, and an unterminated quoted
 * field runs to the end of the input, because a user's export should not be
 * rejected for one stray character.
 */
export function parseCsv(text: string): string[][] {
  const input = text.startsWith("﻿") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        field += ch;
      }
      i += 1;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\r" && input[i + 1] === "\n") {
      endRow();
      i += 1;
    } else if (ch === "\n" || ch === "\r") {
      endRow();
    } else {
      field += ch;
    }
    i += 1;
  }
  // A final line break ends the last row; only text after it starts another.
  if (field !== "" || row.length > 0 || quoted) endRow();
  return rows;
}
