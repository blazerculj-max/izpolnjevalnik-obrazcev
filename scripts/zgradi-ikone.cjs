// zgradi-ikone.cjs
// Nariše ikone za nameščeno aplikacijo (PWA): `npm run ikone`.
//
// Brez zunanjih knjižnic - ikono narišemo v pomnilnik in zapišemo kot PNG.
// iOS v manifestu ne sprejme SVG, zato morajo biti PNG.
//
// Rišemo v štirikratni ločljivosti in nato povprečimo (nadvzorčenje), da so
// robovi gladki; brez tega bi bile stopnice na zaobljenem kvadratu očitne.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const IZHOD = path.join(__dirname, "..", "pwa");
const NADVZORCENJE = 4;

const MODRA = [20, 80, 140];
const BELA = [255, 255, 255];
const SVETLA = [199, 220, 242];
const ZELENA = [15, 122, 90];

// ---------------------------------------------------------------- oblike

/** Ali točka leži v zaobljenem pravokotniku? */
function vZaobljenem(x, y, l, z, s, v, r) {
  const dx = Math.max(l + r - x, 0, x - (l + s - r));
  const dy = Math.max(z + r - y, 0, y - (z + v - r));
  return dx * dx + dy * dy <= r * r;
}

/** Razdalja točke do daljice - za poteze sполкrožnimi konci. */
function doDaljice(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dolzina = dx * dx + dy * dy;
  const t = dolzina === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / dolzina));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

/**
 * Ikona: moder zaobljen kvadrat, v njem bel obrazec s črtami in zelena kljukica.
 * Vse mere so deleži stranice, da je ista risba uporabna v vsaki velikosti.
 */
function barvaTocke(x, y, s) {
  const del = (u) => u * s;

  // podlaga
  if (!vZaobljenem(x, y, 0, 0, s, s, del(0.22))) return null; // prosojno
  let barva = MODRA;

  // list obrazca (znotraj varnega območja za maskirane ikone)
  const lx = del(0.28), ly = del(0.2), ls = del(0.44), lv = del(0.6);
  if (vZaobljenem(x, y, lx, ly, ls, lv, del(0.04))) {
    barva = BELA;

    // besedilne črte
    for (let i = 0; i < 3; i++) {
      const cy = ly + del(0.12) + i * del(0.11);
      const sirina = i === 2 ? del(0.18) : del(0.28);
      if (
        x >= lx + del(0.08) &&
        x <= lx + del(0.08) + sirina &&
        Math.abs(y - cy) <= del(0.025)
      ) {
        barva = SVETLA;
      }
    }
  }

  // kljukica čez spodnji desni vogal
  const debelina = del(0.055);
  const a = doDaljice(x, y, del(0.56), del(0.68), del(0.65), del(0.77));
  const b = doDaljice(x, y, del(0.65), del(0.77), del(0.82), del(0.5));
  if (Math.min(a, b) <= debelina) barva = ZELENA;

  return barva;
}

// ------------------------------------------------------------------ PNG

function razpredelnicaCrc() {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
}
const CRC = razpredelnicaCrc();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function kos(vrsta, podatki) {
  const dolzina = Buffer.alloc(4);
  dolzina.writeUInt32BE(podatki.length);
  const telo = Buffer.concat([Buffer.from(vrsta, "ascii"), podatki]);
  const vsota = Buffer.alloc(4);
  vsota.writeUInt32BE(crc32(telo));
  return Buffer.concat([dolzina, telo, vsota]);
}

function pngIzRgba(sirina, visina, rgba) {
  const vrstice = Buffer.alloc((sirina * 4 + 1) * visina);
  for (let y = 0; y < visina; y++) {
    vrstice[y * (sirina * 4 + 1)] = 0; // filter: brez
    rgba.copy(vrstice, y * (sirina * 4 + 1) + 1, y * sirina * 4, (y + 1) * sirina * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(sirina, 0);
  ihdr.writeUInt32BE(visina, 4);
  ihdr[8] = 8; // 8 bitov na kanal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    kos("IHDR", ihdr),
    kos("IDAT", zlib.deflateSync(vrstice, { level: 9 })),
    kos("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- izris

function narisi(velikost) {
  const v = velikost * NADVZORCENJE;
  const s = v;
  const slika = Buffer.alloc(velikost * velikost * 4);

  for (let y = 0; y < velikost; y++) {
    for (let x = 0; x < velikost; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let py = 0; py < NADVZORCENJE; py++) {
        for (let px = 0; px < NADVZORCENJE; px++) {
          const barva = barvaTocke(
            (x * NADVZORCENJE + px + 0.5) * (s / v),
            (y * NADVZORCENJE + py + 0.5) * (s / v),
            s
          );
          if (barva) {
            r += barva[0];
            g += barva[1];
            b += barva[2];
            a += 255;
          }
        }
      }
      const n = NADVZORCENJE * NADVZORCENJE;
      const i = (y * velikost + x) * 4;
      // Barvo povprečimo po pokritih vzorcih, prosojnost pa po vseh.
      const pokriti = a / 255 || 1;
      slika[i] = Math.round(r / pokriti);
      slika[i + 1] = Math.round(g / pokriti);
      slika[i + 2] = Math.round(b / pokriti);
      slika[i + 3] = Math.round(a / n);
    }
  }
  return pngIzRgba(velikost, velikost, slika);
}

fs.mkdirSync(IZHOD, { recursive: true });
for (const velikost of [180, 192, 512]) {
  const pot = path.join(IZHOD, `ikona-${velikost}.png`);
  fs.writeFileSync(pot, narisi(velikost));
  console.log(`   · ${path.basename(pot)} (${(fs.statSync(pot).size / 1024).toFixed(1)} kB)`);
}
console.log("✅ ikone narisane");
