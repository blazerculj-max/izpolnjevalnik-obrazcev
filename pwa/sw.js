// sw.js
// Service worker: ob prvem obisku shrani orodje, da se nameščena aplikacija
// odpre tudi brez povezave. Brez njega iOS nameščene spletne aplikacije
// offline ne zažene.
//
// RAZLICICA vstavi gradnja iz vsebine orodja. Ko se orodje spremeni, se
// spremeni tudi ime predpomnilnika - sicer bi uporabniki za vedno ostali na
// stari različici.

const RAZLICICA = "__RAZLICICA__";
// Korena ("./") namenoma ne shranjujemo posebej - to je ista (velika)
// datoteka kot index.html in bi zasedla dvakrat toliko prostora. Odprtje
// korena postreže index.html (obravnava fetch spodaj).
const DATOTEKE = [
  "./index.html",
  "./manifest.webmanifest",
  "./ikona-180.png",
  "./ikona-192.png",
  "./ikona-512.png",
];

self.addEventListener("install", (e) => {
  // cache: "reload" gre mimo brskalnikovega predpomnilnika: sicer bi nova
  // različica service workerja lahko shranila še staro orodje.
  e.waitUntil(
    caches
      .open(RAZLICICA)
      .then((p) => p.addAll(DATOTEKE.map((d) => new Request(d, { cache: "reload" }))))
      .then(() => self.skipWaiting())
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

  // Odprtje orodja vedno postreže shranjena kopija, brez čakanja na omrežje:
  // ob slabem signalu bi sicer čakali na iztek povezave, na Wi-Fi z vstopno
  // stranjo (hotel, bolnišnica) pa bi se namesto orodja odprla ta stran.
  // Novo različico prinese posodobitev service workerja (lučka v glavi).
  const pot = new URL(zahteva.url).pathname;
  if (zahteva.mode === "navigate" && (pot.endsWith("/") || pot.endsWith("/index.html"))) {
    e.respondWith(
      caches.match("./index.html").then((shranjeno) => shranjeno || fetch(zahteva))
    );
    return;
  }

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
