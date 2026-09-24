// sw.js
// Service worker: ob prvem obisku shrani orodje, da se nameščena aplikacija
// odpre tudi brez povezave. Brez njega iOS nameščene spletne aplikacije
// offline ne zažene.
//
// RAZLICICA vstavi gradnja iz vsebine orodja. Ko se orodje spremeni, se
// spremeni tudi ime predpomnilnika - sicer bi uporabniki za vedno ostali na
// stari različici.

const RAZLICICA = "__RAZLICICA__";
// Korena ("./") namenoma ne shranjujemo posebej - to je ista 4,5 MB datoteka
// kot index.html in bi zasedla dvakrat toliko prostora. Ob odprtju brez
// povezave jo postreže zasilna pot v obravnavi fetch spodaj.
const DATOTEKE = [
  "./index.html",
  "./manifest.webmanifest",
  "./ikona-180.png",
  "./ikona-192.png",
  "./ikona-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(RAZLICICA).then((p) => p.addAll(DATOTEKE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((imena) => Promise.all(imena.filter((i) => i !== RAZLICICA).map((i) => caches.delete(i))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const zahteva = e.request;
  if (zahteva.method !== "GET") return;

  e.respondWith(
    caches.match(zahteva, { ignoreSearch: true }).then((zadetek) => {
      if (zadetek) return zadetek;
      return fetch(zahteva).catch(() => {
        // Brez povezave naj se vsaka pot odpre v orodju samem.
        if (zahteva.mode === "navigate") return caches.match("./index.html");
        throw new Error("ni v predpomnilniku");
      });
    })
  );
});
