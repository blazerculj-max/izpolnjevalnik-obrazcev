// zgradi-stran.cjs
// Iz zgrajenega orodja sestavi mapo `dist/`, ki gre na GitHub Pages.
//
//   dist/index.html      samostojno orodje (ista datoteka tudi za prenos)
//   dist/obrazci/*.pdf   prazni uradni obrazci za neposreden prenos
//   dist/manifest.webmanifest, dist/sw.js, dist/ikona-*.png
//                        da je stran mogoče namestiti kot aplikacijo (PWA)
//
// Obrazce, ki jih orodje ponuja v seznamu, ima vgrajene v sebi (glej
// scripts/zgradi-orodje.cjs) - te kopije so tu samo zato, da je prazen
// obrazec mogoče prenesti tudi brez orodja.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PDFDocument } = require("pdf-lib");

const KOREN = path.join(__dirname, "..");
const ORODJE = path.join(KOREN, "public", "orodje-obrazci.html");
const OBRAZCI = path.join(KOREN, "data", "obrazci");
const DIST = path.join(KOREN, "dist");
const PWA = path.join(KOREN, "pwa");

async function kazaloObrazcev() {
  if (!fs.existsSync(OBRAZCI)) return [];
  const datoteke = fs
    .readdirSync(OBRAZCI)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort((a, b) => a.localeCompare(b, "sl"));

  const izhod = [];
  for (const d of datoteke) {
    const bajti = fs.readFileSync(path.join(OBRAZCI, d));
    try {
      const doc = await PDFDocument.load(bajti, { ignoreEncryption: true });
      const polja = doc.getForm().getFields();
      if (polja.length === 0) {
        console.warn(`⚠️  ${d}: brez vnosnih polj (ni »aktiven« obrazec) — preskočen.`);
        continue;
      }
      izhod.push({
        datoteka: d,
        ime: d.replace(/\.pdf$/i, "").replace(/[-_]/g, " "),
        strani: doc.getPageCount(),
        stevilo_polj: polja.length,
      });
    } catch (e) {
      console.warn(`⚠️  ${d}: ${e.message} — preskočen.`);
    }
  }
  return izhod;
}

async function zgradi() {
  if (!fs.existsSync(ORODJE)) {
    throw new Error("Najprej poženi `npm run orodje`.");
  }

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIST, "obrazci"), { recursive: true });

  fs.copyFileSync(ORODJE, path.join(DIST, "index.html"));

  const obrazci = await kazaloObrazcev();
  for (const o of obrazci) {
    fs.copyFileSync(path.join(OBRAZCI, o.datoteka), path.join(DIST, "obrazci", o.datoteka));
  }

  // Manifest, ikone in service worker gredo v koren, da so poti v manifestu
  // preproste in da service worker pokriva celo stran.
  const razlicica =
    "v" +
    crypto
      .createHash("sha256")
      .update(fs.readFileSync(ORODJE))
      .digest("hex")
      .slice(0, 12);
  for (const d of fs.readdirSync(PWA)) {
    const vsebina = fs.readFileSync(path.join(PWA, d));
    // Ime predpomnilnika veže na vsebino orodja: ob novi različici se stari
    // predpomnilnik zavrže, sicer bi uporabnik obtičal na stari datoteki.
    fs.writeFileSync(
      path.join(DIST, d),
      d === "sw.js" ? String(vsebina).replace("__RAZLICICA__", razlicica) : vsebina
    );
  }

  // Brez tega bi Pages mapo pognal skozi Jekyll in datoteke z močnimi
  // znaki v imenu bi lahko izpadle.
  fs.writeFileSync(path.join(DIST, ".nojekyll"), "");

  console.log(`✅ dist/ — ${obrazci.length} obrazcev, različica ${razlicica}`);
  obrazci.forEach((o) => console.log(`   · ${o.ime} (${o.strani} str., ${o.stevilo_polj} polj)`));
}

zgradi().catch((e) => {
  console.error("❌ " + e.message);
  process.exit(1);
});
