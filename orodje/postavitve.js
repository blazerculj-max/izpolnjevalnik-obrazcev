// postavitve.js
// Ročne postavitve rubrik za obrazce, kjer samodejna postavitev (izpeljana
// iz geometrije PDF-ja) ne da preglednega obrazca - predvsem tabele z več
// osebami in kritji, ki se na papirju berejo po stolpcih.
//
// Postavitev navaja polja po IMENIH iz PDF-ja. Gradnja (zgradi-orodje.cjs)
// preveri, da vsa navedena imena v obrazcu obstajajo: nova izdaja obrazca s
// preimenovanimi polji se pokaže kot napaka pri gradnji, ne kot tiho
// pokvarjen obrazec. Polja rubrike, ki jih postavitev ne navede, orodje
// pokaže pod njo, tako da se nobeno ne izgubi.
//
// Gradniki:
//   izbira  - eno polje z več okenci (shema.izbire) z lastnim vprašanjem
//   osebe   - oštevilčene kartice (1. otrok, 2. otrok ...); prva je odprta,
//             ostale odpre gumb "Dodaj" (naziv v tožilniku: nazivDodaj)
//   tabela  - vrstice so kritja, stolpci osebe (kot na papirju)
//   namig   - kratko besedilo
// Vsak blok ima lahko pogoj: prikaže se le pri izbrani možnosti izbire.
// Polja skritih pogojnih blokov se ne izvozijo.
//
// Celica: { polje, oznaka, sirina (stolpcev), gumbi: [...], enota,
//           neobvezno }. Celica z gumbi namesto tipkanja ponudi možnosti
// (Spol M/Ž, Paket A-E, DPZP DA/NE); v PDF se zapiše ista vrednost.

(function (koren, tovarna) {
  const api = tovarna();
  if (typeof module === "object" && module.exports) module.exports = api;
  else koren.POSTAVITVE_OBRAZCEV = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const ZAHTEVEK = "Zahtevek-za-priključitev-ali-spremembo-dodatnih-zavarovanj.pdf";

  const SPOL = ["M", "Ž"];
  const DA_NE = ["DA", "NE"];

  const obrazci = {
    [ZAHTEVEK]: [
      {
        razdelek: "10.b",
        naslov: "10.b Dodatno nezgodno zavarovanje otrok — priključitev ali sprememba",
        bloki: [
          {
            vrsta: "izbira",
            polje: "Rubrika7-b",
            vprasanje: "Vrsta",
            oznake: { Izbira1: "Priključitev", Izbira2: "Sprememba" },
          },
          {
            vrsta: "izbira",
            polje: "Rubrika-7b-izbira",
            vprasanje: "Kritje",
            oznake: { Izbira1: "Izbira paketa", Izbira2: "Samostojna izbira kritij" },
          },
          {
            vrsta: "namig",
            pogoj: { polje: "Rubrika-7b-izbira", prazno: true },
            besedilo: "Izberi način kritja — pokažejo se polja za otroke.",
          },

          // --- Izbira paketa (4. stran obrazca) ---
          {
            vrsta: "osebe",
            pogoj: { polje: "Rubrika-7b-izbira", vklop: "Izbira1" },
            skupina: "7b-paket",
            naziv: "otrok",
            nazivDodaj: "otroka", // "Dodaj 2. otroka"
            stevilo: 4,
            vrstice: (n) => [
              [
                { polje: `Ime in priimek zavarovanca7b-${n}`, oznaka: "Ime in priimek", sirina: 2 },
                { polje: `Datum rojstva-7b-${n}`, oznaka: "Datum rojstva" },
                { polje: `Spol MŽ-7b-${n}`, oznaka: "Spol", gumbi: SPOL },
              ],
              [
                { polje: `Naslov zavarovanca-7b-${n}`, oznaka: "Naslov", sirina: 2 },
                { polje: `Davčna-zavarovanca-7b-${n}`, oznaka: "Davčna številka" },
              ],
              [
                // Četrta vrstica obrazca polja za paket nima.
                {
                  polje: `Paket-7b-${n}`,
                  oznaka: "Paket",
                  gumbi: ["A", "B", "C", "D", "E"],
                  neobvezno: n === 4,
                },
                { polje: `Zavarovalna premija 7b-${n}`, oznaka: "Zavarovalna premija", enota: "EUR" },
                { polje: `DPZP2-7b-${n}-DA/NE`, oznaka: "DPZP 8,5 %", gumbi: DA_NE },
              ],
              { podnaslov: "Zakoniti zastopnik" },
              [
                { polje: `Ime in priimek zak-zas-7b-${n}`, oznaka: "Ime in priimek", sirina: 2 },
                { polje: `Naslov  zak-zas-7b-${n}`, oznaka: "Naslov", sirina: 2 },
                { polje: `Davčna- zak-zas-7b-${n}`, oznaka: "Davčna številka" },
              ],
            ],
          },

          // --- Samostojna izbira posameznega kritja (5. stran obrazca) ---
          {
            vrsta: "osebe",
            pogoj: { polje: "Rubrika-7b-izbira", vklop: "Izbira2" },
            skupina: "7b-sam",
            naziv: "otrok",
            nazivDodaj: "otroka", // "Dodaj 2. otroka"
            stevilo: 4,
            vrstice: (n) => [
              [
                { polje: `priimek-ime${n}-7b`, oznaka: "Ime in priimek", sirina: 2 },
                { polje: `datum-rojstva${n}-7b`, oznaka: "Datum rojstva" },
                { polje: `spol${n}-7b`, oznaka: "Spol", gumbi: SPOL },
              ],
              [
                { polje: `naslov${n}-7b`, oznaka: "Naslov", sirina: 2 },
                { polje: `davčna${n}-7b`, oznaka: "Davčna številka" },
              ],
              { podnaslov: "Zakoniti zastopnik" },
              [
                { polje: `priimek-ime${n}-7b-${n}`, oznaka: "Ime in priimek", sirina: 2 },
                { polje: `naslov${n}-7b-${n}`, oznaka: "Naslov", sirina: 2 },
                { polje: `davčna${n}-7b-${n}`, oznaka: "Davčna številka" },
              ],
            ],
          },
          {
            vrsta: "tabela",
            pogoj: { polje: "Rubrika-7b-izbira", vklop: "Izbira2" },
            skupina: "7b-sam",
            naslov: "Kritja — zavarovalna vsota v EUR",
            stevilo: 4,
            glava: (n) => `${n}. otrok`,
            vrstice: [
              { oznaka: "SMN — nezgodna smrt", polje: (n) => `SMN${n}-7b` },
              { oznaka: "TPO — težje poškodbe", polje: (n) => `INV${n}-7b` },
              { oznaka: "DNO — dnevno nadomestilo", polje: (n) => `DNO${n}-7b` },
              { oznaka: "NBD — bolnišnični dan", polje: (n) => `NBD${n}-7b` },
              { oznaka: "ZOP — zlomi, izpahi, opekline", polje: (n) => `ZIO${n}-7b` },
              { oznaka: "Renta TP30R — doba izplačevanja (let)", polje: (n) => `Doba izplačevanja let${n}-7b` },
              { oznaka: "Renta TP30R — višina mesečne rente", polje: (n) => `Višina mesečne rente${n}-7b` },
              { oznaka: "DPZP 8,5 %", polje: (n) => `Davek-7b-${n}-DA/NE`, gumbi: DA_NE },
            ],
          },
        ],
      },
    ],
  };

  /** Rubrike z ročno postavitvijo za dani obrazec (po imenu datoteke). */
  function zaObrazec(datoteka) {
    return obrazci[String(datoteka || "")] || [];
  }

  /** Celice ene osebe, razgrnjene v konkretna imena polj. */
  function vrsticeOsebe(blok, n) {
    return blok.vrstice(n);
  }

  /**
   * Vsa polja, ki jih rubrika navaja: [{ ime, neobvezno }]. Uporabi ga
   * vmesnik (katera polja pokrije postavitev) in gradnja (ali obstajajo).
   */
  function imenaPolj(rubrika) {
    const izhod = [];
    const dodaj = (ime, neobvezno) => izhod.push({ ime, neobvezno: Boolean(neobvezno) });
    for (const b of rubrika.bloki) {
      if (b.vrsta === "izbira") dodaj(b.polje, b.neobvezno);
      if (b.vrsta === "osebe") {
        for (let n = 1; n <= b.stevilo; n++) {
          for (const vrsta of vrsticeOsebe(b, n)) {
            if (!Array.isArray(vrsta)) continue;
            vrsta.forEach((c) => dodaj(c.polje, c.neobvezno));
          }
        }
      }
      if (b.vrsta === "tabela") {
        for (const v of b.vrstice) {
          for (let n = 1; n <= b.stevilo; n++) dodaj(v.polje(n), v.neobvezno);
        }
      }
    }
    return izhod;
  }

  return { zaObrazec, imenaPolj, vrsticeOsebe, obrazci };
});
