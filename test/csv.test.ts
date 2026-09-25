import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/util/csv.js";

describe("parseCsv", () => {
  it("parses a simple header + rows", () => {
    const rows = parseCsv("a,b,c\n1,2,3\n4,5,6\n");
    expect(rows).toEqual([
      { a: "1", b: "2", c: "3" },
      { a: "4", b: "5", c: "6" },
    ]);
  });

  it("handles quoted fields with commas and escaped quotes", () => {
    const rows = parseCsv('name,label\n"Lyon, 3e","dit ""le bon coin"""\n');
    expect(rows).toEqual([{ name: "Lyon, 3e", label: 'dit "le bon coin"' }]);
  });

  it("handles CRLF line endings and trailing blank line", () => {
    const rows = parseCsv("a,b\r\n1,2\r\n\r\n");
    expect(rows).toEqual([{ a: "1", b: "2" }]);
  });

  it("fills missing trailing fields with empty strings", () => {
    const rows = parseCsv("a,b,c\n1,2\n");
    expect(rows).toEqual([{ a: "1", b: "2", c: "" }]);
  });

  it("returns [] for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });
});
