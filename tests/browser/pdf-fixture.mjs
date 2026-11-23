// A small, deterministic PDF with extractable text, colored pixels and two links.
export function samplePdf(count = 4, padding = 0) {
  const firstPage = 4;
  const firstStream = firstPage + count;
  const internalLink = firstStream + count;
  const externalLink = internalLink + 1;
  const kids = Array.from({ length: count }, (_, index) => `${firstPage + index} 0 R`);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${count} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  for (let index = 0; index < count; index++) {
    const annotations = index === 0 ? `/Annots [${internalLink} 0 R ${externalLink} 0 R]` : "";
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 480]
      /Resources << /Font << /F1 3 0 R >> >> /Contents ${firstStream + index} 0 R ${annotations} >>`);
  }
  for (let index = 0; index < count; index++) {
    const label = index === 2 ? "Find the needle on page 3" : `Selectable text on page ${index + 1}`;
    const stream = [
      "0.2 0.4 0.6 rg 18 420 100 40 re f",
      "0 g BT /F1 22 Tf 22 365 Td",
      `(${label}) Tj ET`,
    ].join("\n");
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  const destination = firstPage + Math.min(2, count - 1);
  objects.push(`<< /Type /Annot /Subtype /Link /Rect [20 322 150 344] /Border [0 0 0] /Dest [${destination} 0 R /Fit] >>`);
  objects.push("<< /Type /Annot /Subtype /Link /Rect [20 285 150 310] /Border [0 0 0] /A << /S /URI /URI (https://example.com/) >> >>");

  let pdf = "%PDF-1.7\n";
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  if (padding) pdf += `%${" ".repeat(padding)}\n`;
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}
