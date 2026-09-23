// zgradi-dmg.cjs
// Zapakira orodje v .dmg, kakršnega je na Macu navada prenesti: `npm run dmg`.
//
// V sliki je DOKUMENT (HTML), ne aplikacija - in prav to je bistvo. Aplikacijo
// brez Applovega podpisa in notarizacije macOS ob prenosu zavrne, dokumenta pa
// ne: HTML se odpre z dvoklikom kot vsaka druga datoteka. Tako gre orodje med
// ljudi brez razvijalskega računa in brez opozoril.
//
// Slika je stisnjena in samo za branje; orodje na disk ničesar ne piše, zato
// lahko teče kar iz priklopljene slike ali pa ga uporabnik povleče na namizje.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const os = require("os");

const KOREN = path.join(__dirname, "..");
const ORODJE = path.join(KOREN, "public", "orodje-obrazci.html");
const IME = "Izpolnjevalnik obrazcev";
const IZHOD = path.join(KOREN, "dist", `${IME}.dmg`);

const BERI_ME = `${IME}
${"=".repeat(IME.length)}

Izpolnjevanje PDF obrazcev s podpisom stranke - brez interneta in brez
namestitve.

Kako začneš
-----------
1. Dvoklikni "${IME}.html".
2. Odpre se v brskalniku. Izberi obrazec in ga izpolni.

Datoteko lahko povlečeš na namizje ali v mapo Dokumenti in jo od tam
uporabljaš naprej. Deluje tudi brez povezave - vse je v njej.

Zasebnost
---------
Izpolnjen obrazec se NE pošlje nikamor. Bere in izpolnjuje ga tvoj brskalnik;
stran nima dovoljenja za nobeno omrežno povezavo. Izvožen PDF se shrani tja,
kamor ga shraniš sam.

Narisan podpis je slika, ne kvalificiran elektronski podpis po eIDAS.

Preden ga uporabiš za resnične stranke, uporabo uskladi s pooblaščeno osebo
za varstvo podatkov pri zavarovalnici.
`;

function zgradi() {
  if (!fs.existsSync(ORODJE)) {
    throw new Error("Najprej poženi `npm run orodje`.");
  }

  const pripravljalnica = fs.mkdtempSync(path.join(os.tmpdir(), "dmg-"));
  try {
    fs.copyFileSync(ORODJE, path.join(pripravljalnica, `${IME}.html`));
    fs.writeFileSync(path.join(pripravljalnica, "Preberi me.txt"), BERI_ME);

    fs.mkdirSync(path.dirname(IZHOD), { recursive: true });
    fs.rmSync(IZHOD, { force: true });

    execFileSync(
      "hdiutil",
      [
        "create",
        "-volname", IME,
        "-srcfolder", pripravljalnica,
        "-format", "UDZO", // stisnjeno, samo za branje
        "-quiet",
        IZHOD,
      ],
      { stdio: ["ignore", "inherit", "inherit"] }
    );
  } finally {
    fs.rmSync(pripravljalnica, { recursive: true, force: true });
  }

  const mb = (fs.statSync(IZHOD).size / 1048576).toFixed(1);
  console.log(`✅ ${path.relative(KOREN, IZHOD)} (${mb} MB)`);
  console.log("   Pošlji jo komurkoli — dvoklik na sliko, nato dvoklik na HTML.");
}

try {
  zgradi();
} catch (e) {
  console.error("❌ " + e.message);
  process.exit(1);
}
