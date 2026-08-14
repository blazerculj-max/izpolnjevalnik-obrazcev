// streznik.cjs
// Drobcen strežnik za predogled mape dist/ pred objavo: `npm run predogled`.
//
// Potreben je zato, ker se seznam obrazcev nalaga s `fetch` — ta pri odpiranju
// datoteke z dvoklikom (file://) ne deluje. Tako vidiš točno to, kar bo
// videl obiskovalec strani na GitHub Pages.

const http = require("http");
const fs = require("fs");
const path = require("path");

const DIST = path.join(__dirname, "..", "dist");
const VRATA = Number(process.env.PORT) || 4173;

const TIPI = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

if (!fs.existsSync(DIST)) {
  console.error("❌ Mape dist/ ni. Najprej poženi `npm run zgradi`.");
  process.exit(1);
}

http
  .createServer((req, res) => {
    const relativna = decodeURIComponent(req.url.split("?")[0]);
    const pot = path.join(DIST, relativna === "/" ? "index.html" : relativna);

    // Nihče naj ne pobegne iz dist/ z ../
    if (!pot.startsWith(DIST) || !fs.existsSync(pot) || fs.statSync(pot).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Ni najdeno");
      return;
    }

    res.writeHead(200, {
      "Content-Type": TIPI[path.extname(pot).toLowerCase()] || "application/octet-stream",
    });
    res.end(fs.readFileSync(pot));
  })
  .listen(VRATA, () => {
    console.log(`Predogled: http://localhost:${VRATA}`);
    console.log("Ustaviš s Ctrl+C.");
  });
