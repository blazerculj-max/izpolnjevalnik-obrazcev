// zgradi-orodje.cjs
// Iz orodje/predloga.html zgradi ENO samostojno datoteko HTML, ki deluje
// brez strežnika in brez interneta: `npm run orodje`.
//
// Vanjo vgradimo pdf-lib, fontkit, pdf.js, pisavo DejaVu in skupno logiko.
// Dve stvari, brez katerih to ne bi delovalo ob odpiranju z dvoklikom (file://):
//
//  1. Zunanjih modulov brskalnik s file:// ne sme naložiti, zato pdf.js
//     vgradimo kot VGNEZDEN modul - ta se izvede brez prenosa. Oba paketa
//     pdf.js si ob zagonu sama nastavita globalThis.pdfjsLib in
//     globalThis.pdfjsWorker, zato sta dosegljiva tudi brez uvoza.
//  2. Delavca (Web Worker) prav tako ni mogoče naložiti, zato vgradimo tudi
//     pdf.worker.min.mjs - ker pdf.js najde globalThis.pdfjsWorker, ga
//     požene kar na glavni niti in delavca ne prenaša.

const fs = require("fs");
const path = require("path");

const KOREN = path.join(__dirname, "..");
const IZHOD = path.join(KOREN, "public", "orodje-obrazci.html");

const beri = (...deli) => fs.readFileSync(path.join(KOREN, ...deli), "utf8");

/** Vsebina vgnezdene skripte ne sme vsebovati `</script`. */
function varnoZaHtml(koda) {
  return koda.replace(/<\/script/gi, "<\\/script");
}

/** Binarno datoteko vgradimo kot base64 in jo v brskalniku razpakiramo. */
function vgrajeniBajti(pot, ime) {
  const b64 = fs.readFileSync(pot).toString("base64");
  return `window.${ime}=(function(n){var s=atob(n),u=new Uint8Array(s.length);
for(var i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u;})("${b64}");`;
}

function klasicna(koda) {
  return `<script>\n${varnoZaHtml(koda)}\n</script>`;
}

function modul(koda) {
  return `<script type="module">\n${varnoZaHtml(koda)}\n</script>`;
}

function zgradi() {
  const pdfjs = beri("node_modules", "pdfjs-dist", "legacy", "build", "pdf.min.mjs");
  const delavec = beri(
    "node_modules",
    "pdfjs-dist",
    "legacy",
    "build",
    "pdf.worker.min.mjs"
  );

  const skripte = [
    // Knjižnici sta UMD in se ob nalaganju zapišeta v window.
    klasicna(beri("node_modules", "pdf-lib", "dist", "pdf-lib.min.js")),
    klasicna(beri("node_modules", "@pdf-lib", "fontkit", "dist", "fontkit.umd.min.js")),
    // Ista logika kot v asistentu - UMD se zapiše v window.
    klasicna(beri("skupno", "obrazci-logika.js")),
    klasicna(beri("skupno", "obrazci-pdf.js")),
    // Pisava s šumniki (DejaVu Sans Condensed, licenca dovoljuje vgradnjo).
    klasicna(
      vgrajeniBajti(
        path.join(
          KOREN,
          "node_modules",
          "dejavu-fonts-ttf",
          "ttf",
          "DejaVuSansCondensed.ttf"
        ),
        "PISAVA_BAJTI"
      )
    ),
    // Delavec si sam nastavi globalThis.pdfjsWorker; pdf.js ga zato ne prenaša.
    modul(delavec),
    modul(pdfjs),
    // Vmesnik gre nazadnje: moduli se izvedejo po vrsti in po razčlenjenem DOM.
    modul(beri("orodje", "orodje.js")),
  ].join("\n");

  const slog = beri("public", "slog.css") + "\n" + beri("orodje", "slog-dodatek.css");

  const html = beri("orodje", "predloga.html")
    .replace("/*{{SLOG}}*/", () => slog)
    .replace("<!--{{SKRIPTE}}-->", () => skripte);

  fs.mkdirSync(path.dirname(IZHOD), { recursive: true });
  fs.writeFileSync(IZHOD, html);

  const mb = (fs.statSync(IZHOD).size / 1048576).toFixed(1);
  console.log(`✅ ${path.relative(KOREN, IZHOD)} (${mb} MB)`);
  console.log("   Datoteko lahko pošlješ komurkoli — odpre se z dvoklikom.");
}

zgradi();
