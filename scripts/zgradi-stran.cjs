// zgradi-stran.cjs
// Iz zgrajenega orodja sestavi mapo `dist/`, ki gre na GitHub Pages.
//
//   dist/index.html      samostojno orodje (ista datoteka tudi za prenos)
//   dist/obrazci/*.pdf   prazni uradni obrazci za neposreden prenos
//
// Obrazce, ki jih orodje ponuja v seznamu, ima vgrajene v sebi (glej
// scripts/zgradi-orodje.cjs) - te kopije so tu samo zato, da je prazen
// obrazec mogoče prenesti tudi brez orodja.

const fs = require("fs");
const path = require("path");
const { PDFDocument } = require("pdf-lib");

const KOREN = path.join(__dirname, "..");
const ORODJE = path.join(KOREN, "public", "orodje-obrazci.html");
const OBRAZCI = path.join(KOREN, "data", "obrazci");
const DIST = path.join(KOREN, "dist");

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

  // Brez tega bi Pages mapo pognal skozi Jekyll in datoteke z močnimi
  // znaki v imenu bi lahko izpadle.
  fs.writeFileSync(path.join(DIST, ".nojekyll"), "");

  console.log(`✅ dist/ — ${obrazci.length} obrazcev`);
  obrazci.forEach((o) => console.log(`   · ${o.ime} (${o.strani} str., ${o.stevilo_polj} polj)`));
}

zgradi().catch((e) => {
  console.error("❌ " + e.message);
  process.exit(1);
});
