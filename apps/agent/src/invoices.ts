// Reads invoices. Everything returned from here is untrusted text. Confined to one folder, because
// an injected instruction could otherwise make the executor read .env or ./keys.
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const ALLOWED = new Set([".pdf", ".txt"]);

export const listInvoices = (dir: string) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((f) => f.isFile() && ALLOWED.has(extname(f.name).toLowerCase()))
    .map((f) => f.name)
    .sort();

/** Accepts a name inside `dir` or a path to one. Anything outside it is refused. */
export async function readInvoice(dir: string, path: string): Promise<string> {
  const root = realpathSync(dir);
  const found = [resolve(root, path), resolve(path)].find(existsSync);
  const real = found && realpathSync(found);
  if (!real || !real.startsWith(root + sep) || !ALLOWED.has(extname(real).toLowerCase())) {
    throw new Error(`Not an invoice in ${dir}: ${path}`);
  }
  return extname(real).toLowerCase() === ".pdf"
    ? pdfText(readFileSync(real))
    : readFileSync(real, "utf8");
}

async function pdfText(bytes: Buffer): Promise<string> {
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const pdf = await task.promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const { items } = await (await pdf.getPage(n)).getTextContent();
    pages.push(items.map((i) => ("str" in i ? i.str + (i.hasEOL ? "\n" : " ") : "")).join(""));
  }
  await task.destroy();
  return pages.join("\n");
}
