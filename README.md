# Izpolnjevalnik obrazcev

Izpolnjevanje PDF obrazcev s podpisom stranke — **v celoti v brskalniku**.
Brez namestitve, brez prijave, brez strežnika, ki bi karkoli obdeloval.

👉 **[Odpri orodje](https://UPORABNIK.github.io/izpolnjevalnik-obrazcev/)**
*(povezavo popravi, ko je repozitorij objavljen)*

## Kaj zna

- prebere **aktiven** PDF obrazec (AcroForm) in iz njegovih polj sam sestavi
  spletni obrazec — ročnega postavljanja polj ni;
- polja poimenuje po besedilu, ki v PDF-ju stoji ob njih, ne po neuporabnih
  imenih tipa `Checkbox7`;
- **izbire prepozna kot izbire**: kjer je na papirju več kvadratkov, v PDF-ju
  pa eno polje (»Spol« m / ž, »Oseba« fizična / pravna, vrstice DA / NE),
  ponudi eno vprašanje z gumbom za vsako možnost;
- vsako možnost poimenuje po besedilu **tik desno od okenca**, vprašanja za
  več oseb pa loči po naslovu razdelka (*Zavarovalec* / *Zavarovanec*);
- okenca v isti vrstici obravnava kot **en odgovor**: klikneš DA ali NE enkrat,
  označita pa se okence v stolpcu POTREBE in v stolpcu ZAHTEVE;
- **podpis** s prstom, peresom ali sledilno ploščico, ki ga povlečeš na pravo
  mesto na strani in mu z drsnikom nastaviš velikost;
- polja **razvrsti po razdelkih obrazca** ("Zavarovalec", "Zavarovanje
  Operacije") in prikaže navodila, ki jih obrazec zapiše zraven
  ("izpolniti le, če zavarovalec in zavarovanec nista ista oseba");
- izvozi PDF z **zaklenjenimi polji**, pripravljen za tisk in pošiljanje;
- šumniki so pravilni — vgrajena je pisava DejaVu Sans (privzeta pisava PDF
  obrazcev ne pozna črke »č«).

## Zasebnost

**Obrazec, ki ga izpolniš, se ne pošlje nikamor.** Stran je statična: PDF
prebere, izpolni in shrani tvoj brskalnik. Ni strežnika, ki bi kaj videl, ni
baze in ni beleženja.

To ni le zasnova, ampak pravilo, ki ga uveljavi brskalnik. Ker so knjižnice,
pisava in obrazci vgrajeni v samo datoteko, stran nima česa nalagati — zato
nosi `Content-Security-Policy` s **`connect-src 'none'`** in `form-action 'none'`.
Brskalnik ji torej prepove **sleherno** omrežno povezavo in oddajo obrazca.
Preverjeno je, da so blokirani vsi običajni kanali: `fetch`, slika kot
sledilni piksel, `navigator.sendBeacon` in WebSocket.

Kar stran hrani na napravi:

| | |
|---|---|
| piškotki | jih ni |
| `sessionStorage` | prazen |
| `localStorage` | samo **šifra prodajnika**, če jo vpišeš (tvoj podatek, ne strankin) |
| podatki stranke | samo v pomnilniku odprtega zavihka |

Polja imajo izklopljena `autocomplete`, `autocorrect` in `spellcheck`, da si
jih brskalnik ne zapomni za samodejno izpolnjevanje. Gumb **Počisti vse**
pobriše polja, odgovore, podpise in pripravljen PDF; ta se sprosti tudi ob
zaprtju zavihka.

### Kje tveganje v resnici ostane

Orodje konča pri izvoženem PDF-ju — od tam naprej je odvisno od tebe:

1. **Pot, po kateri PDF pošlješ.** Navadna e-pošta je najpogostejši način, da
   podatki stranke pristanejo tam, kamor ne sodijo. Uporabi kanal, ki ga
   dovoljuje zavarovalnica.
2. **Kopije na napravi.** Mapa Prenosi, sinhronizacija z iCloud Drive in
   varnostne kopije. Izvožen PDF po pošiljanju pobriši; varnostne kopije naj
   bodo šifrirane.
3. **Sama naprava.** Vklopljen FileVault na Macu in koda na iPadu rešita
   največ — izgubljena ali ukradena naprava je najverjetnejši incident.

### Preden greš z resnično stranko

Upravljavec osebnih podatkov je zavarovalnica, ne ti. Notranja pravila o
informacijski varnosti so praviloma strožja od GDPR, zato uporabo tega orodja
za podatke strank **vnaprej** uskladi s pooblaščeno osebo za varstvo podatkov.
Zgornji opis je napisan tako, da ga lahko preberejo in ocenijo.

V repozitoriju so samo **prazni uradni obrazci**. Izpolnjenih obrazcev s
podatki strank sem ne dodajaj — Git pomni vse in izbris jih iz zgodovine ne
odstrani.

> **Pravna opomba:** narisan podpis je slika, ne kvalificiran elektronski podpis
> po eIDAS. Za natisnjen in ročno podpisan dokument je to v redu; za pravno
> zavezujoč elektronski podpis potrebuješ overjeno rešitev.

## Delo brez povezave

Gumb **Prenesi za brez povezave** shrani celo orodje kot **eno datoteko HTML**
(~4,1 MB). Odpre se z dvoklikom in deluje brez interneta.

**Obrazci so vgrajeni v to isto datoteko**, zato je seznam na voljo tudi na
povsem odklopljeni napravi — ni je treba nikamor priklopiti in nič ni treba
prenašati zraven. Poljuben drug obrazec preprosto povlečeš nanjo.

## Dodajanje obrazca

1. PDF daj v `data/obrazci/` (mora biti »aktiven«, torej z vnosnimi polji).
2. Poženi `npm run zgradi` — obrazec se vgradi v orodje.
3. Commitaj v `main`.

Seznam se sestavi sam iz datotek, zato ga ni treba nikjer vzdrževati. Če je
repozitorij objavljen, GitHub Actions stran zgradi in objavi ob commitu.

## Zagon

Strežnika ni in ga ne rabiš — orodje je ena datoteka:

```bash
npm start
```

To jo zgradi na novo in odpre. Enak učinek ima dvoklik na
`public/orodje-obrazci.html` v Finderju; datoteko lahko premakneš kamorkoli,
tudi na namizje ali ključek, in bo delovala naprej.

## Razvoj

```bash
npm install
npm run orodje      # samo zgradi datoteko
npm run zgradi      # zgradi tudi mapo dist/ za GitHub Pages
npm run predogled   # http://localhost:4173 - predogled različice za Pages
```

Predogled rabiš le, če pripravljaš objavo na Pages — za vsakdanjo rabo je
dovolj `npm start`.

### Kje je kaj

| Pot | Kaj je |
|---|---|
| `skupno/obrazci-logika.js` | oznake polj, vrstice z DA/NE, mesta podpisov |
| `skupno/obrazci-pdf.js` | branje sheme in izpolnjevanje nad pdf-lib |
| `orodje/orodje.js` | vmesnik v brskalniku |
| `orodje/predloga.html` | ogrodje strani |
| `scripts/zgradi-orodje.cjs` | vgradi knjižnice in pisavo v eno datoteko |
| `scripts/zgradi-stran.cjs` | sestavi `dist/` za GitHub Pages |
| `data/obrazci/` | prazni uradni obrazci |

Mapi `skupno/` in `orodje/` sta **prekopirani iz projekta zavarovalni-asistent**,
kjer isto logiko uporablja tudi strežniška različica. Popravke delaj tam in jih
prenesi z `npm run objavi`; sprememba neposredno tukaj bo ob naslednjem prenosu
povožena.

### Safari in ReadableStream

pdf.js od 5.7 v `getTextContent()` uporablja `for await (const t of stream)`.
WebKit asinhrone iteracije po `ReadableStream` ne podpira, zato bi v Safariju
na Macu in iPadu branje obrazca odpovedalo z
`undefined is not a function (near '...t of e...')`. Manjkajočo zmožnost doda
polnilo v `orodje/predloga.html`; v brskalnikih, ki jo imajo, se ne izvede.

Različice knjižnic so v `package.json` **pribite na točno številko**. Prav tiha
posodobitev pdf.js s 5.4 na 5.7 je to napako prinesla, zato naj se zgodi le
takrat, ko jo kdo namerno naredi in preizkusi.

### Kako to sploh deluje brez strežnika

Vse knjižnice (pdf-lib, fontkit, pdf.js) in pisava so vgrajene v samo datoteko.
Ker brskalnik pri odpiranju z dvoklikom (`file://`) ne sme naložiti nobene
zunanje datoteke, sta ključni dve stvari:

- pdf.js je vgrajen kot **vgnezden modul** — tak se izvede brez prenosa;
- vgrajen je tudi `pdf.worker.min.mjs`, ki si sam nastavi `globalThis.pdfjsWorker`,
  zato pdf.js delavca ne prenaša, ampak ga požene kar na glavni niti.

## Licenca

Koda: MIT. Obrazci so last izdajatelja (Zavarovalnica Triglav, d.d.) in so tu
zgolj v izvirni, prazni obliki. To ni uradno orodje zavarovalnice.
