import { chromium } from "playwright";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const source = `file://${resolve(root, "lead-magnet-source.html")}`;
const pdfPath = resolve(root, "lead-magnet.pdf");
const previewPath = resolve(root, "lead-magnet-preview.png");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 }, deviceScaleFactor: 1 });
await page.goto(source, { waitUntil: "networkidle" });
await page.pdf({
  path: pdfPath,
  format: "Letter",
  printBackground: true,
  preferCSSPageSize: true,
});
await page.screenshot({ path: previewPath, fullPage: false });
await browser.close();

console.log(`wrote ${pdfPath}`);
console.log(`wrote ${previewPath}`);
