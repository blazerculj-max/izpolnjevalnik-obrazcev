# Kje končajo podatki, ki jih vpišeš v Izpolnjevalnik obrazcev

Ta dokument odgovarja na eno vprašanje: **ali se podatki stranke, vpisani v
orodje, kje shranijo?** Odgovor je ne — in spodaj je za vsako trditev
napisano, kako jo lahko kdorkoli sam preveri.

| | |
|---|---|
| Preverjena različica | `eccc0030609b` (SHA-256 spodaj) |
| Datum preizkusa | 28. 9. 2026 |
| Preizkušeno v | Chrome 152 na macOS |
| Preverjal | strojno, z ukazi in poizvedbami, ki so navedeni ob vsaki trditvi |

---

## 0. Spletna in odklopljena različica sta ista datoteka

To ni podobnost, ampak istovetnost — obe imata isto zgoščeno vrednost:

```bash
shasum -a 256 public/orodje-obrazci.html dist/index.html
```

```
eccc0030609b7de1e6724b1475bd47946e989343ca14fb22818ff181702e2fe3  public/orodje-obrazci.html
eccc0030609b7de1e6724b1475bd47946e989343ca14fb22818ff181702e2fe3  dist/index.html
```

`public/orodje-obrazci.html` je datoteka, ki jo preneseš za delo brez
povezave. `dist/index.html` je datoteka, ki gre na splet. **Sta ista datoteka**,
zato vse, kar je napisano spodaj, velja za obe. Razlika je samo v tem, da
odklopljena različica nima niti strežnika, s katerega bi se naložila.

---

## 1. Po vpisu podatkov naprava ne hrani ničesar

Preizkus: odpre se obrazec *Zahtevek za priključitev …*, vanj se vpiše osem
polj z označenimi vrednostmi (`PRESKUS-VNOS-0` … `PRESKUS-VNOS-7`) in še šest
vnosov ob podpisih (`PRESKUS-PODPISNIK`). Nato se pregleda vsa mesta, kamor
brskalnik sploh lahko kaj shrani:

| Mesto | Izid |
|---|---|
| piškotki | prazno |
| `localStorage` | `{}` |
| `sessionStorage` | `{}` |
| `IndexedDB` | ni nobene baze |
| predpomnilnik (Cache Storage) | 1 predpomnilnik, 5 datotek, 6,5 MB — **preiskan v celoti, nobene vpisane vrednosti** |

Preveri sam — v brskalniku odpri konzolo (Chrome: ⌥⌘J, Safari: ⌥⌘C) in prilepi:

```js
const r = { piskotki: document.cookie || "(prazno)",
            localStorage: Object.fromEntries(Object.entries(localStorage)),
            sessionStorage: Object.fromEntries(Object.entries(sessionStorage)) };
r.indexedDB = (await indexedDB.databases()).map(b => b.name);
r.vPredpomnilniku = [];
for (const k of await caches.keys()) {
  const c = await caches.open(k);
  for (const zahteva of await c.keys()) {
    const t = await (await c.match(zahteva)).text();
    if (t.includes("PRESKUS-VNOS")) r.vPredpomnilniku.push(zahteva.url);
  }
}
r;
```

Predpomnilnik vsebuje samo orodje samo (da se odpre brez povezave), nikoli
vpisanih podatkov. Ime predpomnilnika je zgoščena vrednost orodja
(`veccc0030609b`), zato ob novi različici stara odpade.

## 2. Ob osvežitvi izgine vse

Po osvežitvi strani (F5) je izid:

| | |
|---|---|
| vpisanih polj | 0 |
| vpisane vrednosti kjerkoli v dokumentu | ne |
| `localStorage`, `sessionStorage`, piškotki | prazni |
| izbran obrazec | ni več izbran, orodje se odpre na seznamu |

Osvežitev torej ni »čiščenje«, ampak samo dejstvo: podatki živijo v pomnilniku
odprtega zavihka in z njim izginejo. Enako se zgodi ob zaprtju zavihka.

Gumb **Počisti vse** naredi isto brez osvežitve: pobriše polja, odgovore,
podpise, vpisana imena in šifro ter sprosti pripravljen PDF.

## 3. Podatki ne morejo oditi z naprave — to uveljavi brskalnik

Stran nosi `Content-Security-Policy` z `connect-src 'none'` in
`form-action 'none'`. To ni obljuba v kodi, ampak pravilo, ki ga izvaja
brskalnik in ga stran sama ne more preklicati.

Preizkušenih je bilo vseh pet običajnih poti, po katerih bi podatki lahko
odtekli. Vse so bile blokirane; spodaj so dobesedna sporočila brskalnika:

| Poskus | Izid |
|---|---|
| `fetch()` na tuj naslov | `Connecting to 'https://primer-streznik.test/?x=PRESKUS-VNOS' violates the following Content Security Policy directive: "connect-src 'none'". The action has been blocked.` |
| slika kot sledilni piksel | `Loading the image 'https://primer-streznik.test/p.gif?x=PRESKUS-VNOS' violates the following Content Security Policy directive: "img-src 'self' data: blob:". The action has been blocked.` |
| `navigator.sendBeacon()` | `Connecting to 'https://primer-streznik.test/b' violates the following Content Security Policy directive: "connect-src 'none'". The action has been blocked.` |
| WebSocket | `Connecting to 'wss://primer-streznik.test/' violates the following Content Security Policy directive: "connect-src 'none'". The action has been blocked.` |
| oddaja obrazca (POST) | `Sending form data to 'https://primer-streznik.test/' violates the following Content Security Policy directive: "form-action 'none'". The request has been blocked.` |

V dnevniku omrežja ni bilo **nobene** zahteve proti preizkusnemu naslovu.

> Opomba k `sendBeacon`: ta funkcija vrne `true`, ker zahtevo samo uvrsti v
> vrsto. Brskalnik jo nato zavrne — kar je vidno v sporočilu zgoraj in v tem,
> da v dnevniku omrežja zahteve ni.

Preveri sam — prilepi v konzolo in poglej sporočila, ki se izpišejo:

```js
fetch("https://primer-streznik.test/?x=PRESKUS").catch(() => {});
new Image().src = "https://primer-streznik.test/p.gif?x=PRESKUS";
navigator.sendBeacon("https://primer-streznik.test/b", "PRESKUS");
new WebSocket("wss://primer-streznik.test");
```

## 4. V kodi ni ničesar, kar bi shranjevalo

V celotni datoteki — vključno z vgrajenimi knjižnicami (pdf-lib, pdf.js,
fontkit) in vgrajenimi obrazci — se beseda `localStorage` pojavi **dvakrat**:
enkrat kot klic, enkrat v komentarju ob njem. Ta edini klic **briše**:

```
3477:    localStorage.removeItem("sifra-prodajnika");
3479:    /* v zasebnem oknu localStorage ni na voljo; takrat ni kaj brisati */
```

Prejšnje različice so si šifro prodajnika zapomnile, da je ni bilo treba
vtipkati pri vsakem obrazcu. Zdaj se ne shrani več, staro vrednost pa orodje
ob zagonu samo pobriše, da na že uporabljenih napravah ne obleži.

Preveri sam:

```bash
grep -c localStorage    public/orodje-obrazci.html   # 2 (klic + komentar)
grep -c sessionStorage  public/orodje-obrazci.html   # 0
grep -c document.cookie public/orodje-obrazci.html   # 0
grep -c indexedDB       public/orodje-obrazci.html   # 0
```

## 5. Odklopljena različica ima eno mesto shranjevanja manj

Service worker (ta skrbi, da se nameščena aplikacija odpre brez povezave) se
registrira **samo na `http`/`https`**:

```
3485:  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
3487:      navigator.serviceWorker.register("sw.js").catch(() => {
```

Ko datoteko odpreš z dvoklikom (`file://`), se torej ne registrira in
predpomnilnika sploh ni. Vse ostalo je isto, ker je — kot pove točka 0 — ista
datoteka.

---

## Kje tveganje v resnici ostane

Da bo dokument pošten, tudi to:

1. **Izvožen PDF.** Ko ga shraniš, je to datoteka na disku. Orodje nanj nima
   več vpliva. Po pošiljanju ga pobriši; pazi na mapo Prenosi, sinhronizacijo
   z iCloud Drive in varnostne kopije.
2. **Pot, po kateri PDF pošlješ.** Navadna e-pošta je najpogostejši način, da
   podatki stranke pristanejo tam, kamor ne sodijo. Uporabi kanal, ki ga
   dovoljuje zavarovalnica.
3. **Sama naprava.** Vklopljen FileVault na Macu in koda na iPadu rešita
   največ — izgubljena ali ukradena naprava je najverjetnejši incident.
4. **Brskalnik in operacijski sistem.** Obnovitev seje, odlaganje pomnilnika na
   disk in podobno so stvari, na katere stran nima vpliva. Ta dokument govori
   o tem, česa stran ne naredi, ne o tem, kaj vse počne naprava.
5. **Preizkus je bil opravljen v Chromu 152 na macOS.** Pravilo
   `Content-Security-Policy` uveljavlja vsak sodoben brskalnik enako, a če
   potrebuješ dokazilo za Safari na iPadu, ponovi korake iz točk 1–3 tam;
   trajajo nekaj minut.

## Preden greš z resnično stranko

Upravljavec osebnih podatkov je zavarovalnica, ne posameznik. Notranja pravila
o informacijski varnosti so praviloma strožja od GDPR, zato uporabo tega
orodja za podatke strank **vnaprej** uskladi s pooblaščeno osebo za varstvo
podatkov. Ta dokument je napisan tako, da ga lahko prebere in preveri.

V repozitoriju so samo **prazni uradni obrazci**. Izpolnjenih obrazcev s
podatki strank sem ne dodajaj — Git pomni vse in izbris iz zgodovine jih ne
odstrani.

> **Pravna opomba:** narisan podpis je slika, ne kvalificiran elektronski
> podpis po eIDAS. Za natisnjen in ročno podpisan dokument je to v redu; za
> pravno zavezujoč elektronski podpis potrebuješ overjeno rešitev.
