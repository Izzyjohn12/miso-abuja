// Render the MISO monogram into the PNG sizes a web app manifest needs.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sharp = (await import(pathToFileURL(
  "C:/Users/Israel Agaji/Documents/Qoder/2026-10-25/36877ee0/mobile/node_modules/sharp/dist/index.mjs"
).href)).default;

const ROOT = "C:/Users/Israel Agaji/Documents/Qoder/2026-10-25/36877ee0";
const SRC = path.join(ROOT, "assets/img/logo.svg");
const OUT = path.join(ROOT, "assets/img/app");
const BG = "#0b0a09";

await fs.mkdir(OUT, { recursive: true });
const svg = await fs.readFile(SRC);

// Opaque square: the logo's own rounded black tile sits on matching black so
// Android's icon mask never shows transparent corners.
await sharp(svg, { density: 384 }).resize(512, 512).flatten({ background: BG })
  .png({ compressionLevel: 9 }).toFile(path.join(OUT, "icon-512.png"));
await sharp(svg, { density: 384 }).resize(192, 192).flatten({ background: BG })
  .png({ compressionLevel: 9 }).toFile(path.join(OUT, "icon-192.png"));

// Maskable: keep all art inside the central 80% safe circle.
const art = await sharp(svg, { density: 512 }).resize(330, 330).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 3, background: BG } })
  .composite([{ input: art, left: 91, top: 91 }])
  .png({ compressionLevel: 9 }).toFile(path.join(OUT, "maskable-512.png"));

// iOS applies its own rounded mask; inset the monogram slightly.
const touch = await sharp(svg, { density: 384 }).resize(158, 158).png().toBuffer();
await sharp({ create: { width: 180, height: 180, channels: 3, background: BG } })
  .composite([{ input: touch, left: 11, top: 11 }])
  .png({ compressionLevel: 9 }).toFile(path.join(OUT, "apple-touch-icon.png"));

const files = await fs.readdir(OUT);
for (const name of files.sort()) {
  const stat = await fs.stat(path.join(OUT, name));
  console.log(name, stat.size, "bytes");
}
