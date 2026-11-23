import assert from "node:assert/strict";
import test from "node:test";
import { parseFileFragment } from "../src/platform/extension-file.ts";

function parse(value: string) {
  return parseFileFragment(`#?file=${encodeURIComponent(value)}`);
}

test("encodes each segment of absolute local paths and preserves Windows drive letters", () => {
  const filename = "%E8%B3%87%E6%96%99%20%26%20%231%2B%25.pdf";
  assert.equal(parse("/home/user/資料 & #1+%.pdf")?.href, `file:///home/user/${filename}`);
  assert.equal(parse("C:\\Users\\user\\資料 & #1+%.pdf")?.href, `file:///C:/Users/user/${filename}`);
  assert.equal(parse("d:/PDFs/report.pdf")?.href, "file:///d:/PDFs/report.pdf");
  assert.equal(parse("/home/user/trailing-space.pdf ")?.href, "file:///home/user/trailing-space.pdf%20");
  assert.equal(parse("/folder/..//home/user/a.pdf")?.href, "file:///home/user/a.pdf");
});

test("canonicalizes local file URLs and preserves HTTP(S) queries", () => {
  const file = "file:///home/user/a%20%26%20b.pdf";
  for (const prefix of ["file:///", "file:/", "file://localhost/"]) {
    assert.equal(parse(`${prefix}home/user/a%20%26%20b.pdf`)?.href, file);
  }
  assert.equal(parse("file:C:/Users/user/a.pdf")?.href, "file:///C:/Users/user/a.pdf");
  const https = "https://example.com/report?name=a%26b&version=2#page=3";
  const http = "http://example.com:8080/report?name=a+b&version=2";
  for (const url of [https, http]) assert.equal(parse(url)?.href, url);
  assert.equal(parseFileFragment("#?view=fit&file=/home/user/a.pdf")?.href, "file:///home/user/a.pdf");
});

test("ignores fragments without a nonempty file parameter", () => {
  for (const hash of ["", "#page=2", "#?view=fit", "#?file", "#?file="]) {
    assert.equal(parseFileFragment(hash), undefined, hash);
  }
});

test("rejects invalid PDF specifications", () => {
  for (const value of [
    " ", "./a.pdf", "a.pdf", "C:a.pdf", "\\a.pdf", "//host/a.pdf", "\\\\host\\share\\a.pdf",
    "file:relative.pdf", "file://", "file://host/a.pdf", "file:////host/a.pdf", "file:///folder/..//host/a.pdf",
    "https:example.com/a.pdf", "https:///example.com/a.pdf", "https://\t/example.com/a.pdf", "https://",
    "https://example.com\\a.pdf", "http://user@example.com/a.pdf",
    "https://user:password@example.com/a.pdf", "ftp://example.com/a.pdf", "javascript:alert(1)",
  ]) {
    assert.equal(parse(value), null, value);
  }
});
