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

  // Popravki posameznih polj samodejne postavitve (po imenih iz PDF-ja).
  // samoStevke: polje sprejme le števke, do omejitve iz PDF-ja; presledki in
  // začetni "SI56" ne porabijo mest.
  const SPREMEMBA = "Sprememba-podatkov-zdravstvenih-zavarovanj.pdf";
  const popravkiPolj = {
    [SPREMEMBA]: {
      TRR: {
        oznaka: "TRR za E-račun v spletno banko (SI56 + 15 številk)",
        samoStevke: true,
      },
      "TRR 2": {
        oznaka: "TRR za direktno obremenitev SDD (SI56 + 15 številk)",
        samoStevke: true,
      },
    },
  };

  // --- Samo testna (beta) stran ---
  // Napisi po besedilu na obrazcu; ime je polje iz PDF-ja, pri izbirah pa
  // prvo polje izbire (oznaka je tam vprašanje).
  //   pojasnilo: true  - pod poljem ostane pripomba z obrazca
  //   razdeli: [imena] - eno polje, ki števke razdeli v okenca na obrazcu
  //   skrij: true      - polje nima svojega vnosa (zajame ga razdeli)
  const OSEBI = { 1: "Prva zavarovana oseba", 2: "Druga zavarovana oseba" };
  const ZA = (oznaka) => ({ oznaka });

  const DOKUMENT = {
    dokument_vrsta: ZA("Vrsta osebnega dokumenta"),
    dokument_st: ZA("Številka osebnega dokumenta"),
  };
  const CRS = {
    tin: ZA("Tax Identification Number (TIN)"),
    ssn: ZA("Social Security Number (SSN)"),
  };
  const TRR_V_OKENCA = {
    trr_o: {
      oznaka: "Št. računa: SI56 + 15 številk",
      razdeli: ["trr_o", "trr_o1", "trr_o2", "trr_o3"],
      samoStevke: true,
    },
    trr_o1: { skrij: true },
    trr_o2: { skrij: true },
    trr_o3: { skrij: true },
  };

  const beta = {
    "Obrazec-Opredelitev zahtev in potreb stranke_aktivno.pdf": {
      "Telefonska številka": ZA("Telefonska številka"),
      "Datum rojstva/Matična št. pravne osebe": ZA("Datum rojstva / matična št. pravne osebe"),
    },

    "Ponudba-individualna-skupna.pdf": {
      "KZZ št": ZA("KZZ št. (obvezen podatek, če je zavarovalec hkrati tudi zavarovanec)"),
      "KZZ št1": ZA("KZZ št."),
      "KZZ št2": ZA("KZZ št."),
      "e-mail": { oznaka: "E-naslov", pojasnilo: true },
      "e-mail1": { oznaka: "E-naslov", pojasnilo: true },
      "Osnovna mesečna premija": ZA("Osnovna mesečna premija"),
      "Osnovna mesečna premija z DDV": ZA("Mesečna premija z davkom"),
      "Osnovna mesečna premija2": ZA("Osnovna mesečna premija"),
      Popust2: ZA("Popust skupaj"),
      "Osnovna mesečna premija2 popust": ZA("Mesečna premija s popustom"),
      "Osnovna mesečna premija2 davek": ZA("Mesečna premija s popustom in davkom"),
      Račun2: {
        oznaka: "Številka plačilnega računa — IBAN (SI56 + 15 številk)",
        samoStevke: true,
        najvec_znakov: 15,
      },
      Šifra: ZA("Šifra; OE / Agencija"),
      "Ime in Priimek": { oznaka: "Ime in priimek zavarovanca", pojasnilo: true },
      "Telesna teža": ZA("Telesna teža (kg)"),
      "Telesna višina": ZA("Telesna višina (cm)"),
      Poškodba: ZA(
        "1. Imate oziroma vam je bila v zadnjih petih letih ugotovljena kronična bolezen, stanje ali poškodba?"
      ),
      Bolezen: ZA(
        "2. Ste bili v preteklem letu zaradi bolezni, stanja ali poškodbe nesposobni za delo dlje od dveh tednov oziroma ali ste zaradi tega v tem trenutku nesposobni za delo?"
      ),
      Storitev: ZA(
        "3. Imate svetovano ali načrtovano zdravstveno storitev (pregled, zdravljenje, operacija, diagnostična preiskava, rehabilitacija)?"
      ),
    },

    "Prijava-nezgode-iz-zavarovanja-otrok-in-mladih.pdf": {
      ...TRR_V_OKENCA,
      StP: ZA("Številka police oz. polic"),
      Zavarovalec: ZA("Zavarovalec — ime in priimek / naziv pravne osebe"),
      DatumOD: ZA("Čas odsotnosti od pouka oz. vzgojno izobraževalne ustanove — od"),
      DatumDO: ZA("Čas odsotnosti od pouka oz. vzgojno izobraževalne ustanove — do"),
      "organ.UE": ZA("Organ, ki je dokument izdal"),
      datum: ZA("Datum"),
    },

    "Prijava-nezgode.pdf": {
      ...TRR_V_OKENCA,
      StP: ZA("Številka police oz. polic"),
      Zavarovalec2: ZA("Zavarovalec — ime in priimek / naziv pravne osebe"),
      kraj_prvega_pregleda: ZA("Kraj prvega pregleda"),
      naziv_zdr_ustanove: ZA("Naziv zdravstvene ustanove ob tem pregledu"),
      DatumOD: ZA(
        "Čas odsotnosti od dela zaradi nezgode (zaposleni) oziroma čas prehodne nesposobnosti za delo (upokojenci, brezposelni, ostali) — od"
      ),
      DatumDO: ZA(
        "Čas odsotnosti od dela zaradi nezgode (zaposleni) oziroma čas prehodne nesposobnosti za delo (upokojenci, brezposelni, ostali) — do"
      ),
      datum: ZA("Datum"),
    },

    "Prijava-zavarovalnega-primera-doživetje.pdf": {
      ...DOKUMENT,
      ...CRS,
      znesek_SSN: ZA("Stanje sredstev — znesek"),
      upravicenec_ime_priimek: ZA("Upravičenec za primer smrti — ime in priimek"),
      datum_rojstva_nakazilo: ZA("Upravičenec za primer smrti — datum rojstva"),
      st_zavarovanja: ZA("Preknjižba na zavarovanje — številka zavarovanja"),
      znesek_predujma: ZA("Preknjižba na zavarovanje — znesek"),
      odstotek: ZA("Preknjižba na zavarovanje — odstotek"),
    },

    "Prijava-zavarovalnega-primera-hujša-bolezen-poškodba.pdf": {
      ...DOKUMENT,
      ostalo: ZA("Ostalo (navedite)"),
    },

    [SPREMEMBA]: {
      ImePriimek1: ZA("Podpisani/-a (ime in priimek)"),
      "Datum rojstva1": ZA("Rojen/-a dne"),
      "Pogodba št": ZA("Zavarovalna pogodba oz. pogodbe št."),
      Produkt: ZA("Ime produkta oz. produktov"),
      "Iz-1": ZA("Ime / priimek — iz"),
      "Na-1": ZA("Ime / priimek — na"),
      "Iz-2": ZA("Stalni naslov — iz"),
      "Na-3": ZA("Stalni naslov — na"),
      "Iz-4": ZA("Začasni naslov za obveščanje — iz"),
      "Na-4": ZA("Začasni naslov za obveščanje — na"),
      dinamika: ZA("Dinamika plačevanja"),
      "Plačilni nalog (tiskano)": ZA("Plačilni nalog (papirna oblika, položnico želim prejeti po pošti)"),
      "Plačilni nalog (e-račun)": ZA("Plačilni nalog (položnico želim prejeti na E-naslov)"),
      Račun: ZA("Plačilni nalog (položnico želim prejeti kot E-račun v spletno banko)"),
      "Direktna obremenitev": ZA("Direktna obremenitev (SDD)"),
      ImePriimek2: ZA("Ime in priimek prejemnika računa"),
      "Datum rojstva2": ZA("Datum rojstva prejemnika računa"),
      Naslov: ZA("Naslov prejemnika računa"),
      "Davčna številka2": ZA("Davčna številka prejemnika računa"),
      Drugo: ZA("Drugo (navedite spremembe) — 1. vrstica"),
      Drugo2: ZA("Drugo (navedite spremembe) — 2. vrstica"),
      Telefon: ZA("Telefon"),
      "E-naslov2": ZA("E-naslov"),
      Kraj: ZA("Kraj"),
      Datum: ZA("Datum"),
    },

    "Zahtevek-za-finančne-spremembe.pdf": {
      ...DOKUMENT,
      ...CRS,
      davčna_št_podjetja: ZA("Davčna številka podjetja"),
      "Sprememba-premije1-1": ZA("Zavarovalna premija osnovnega zavarovanja — iz"),
      "Sprememba-premije1-2": ZA("Zavarovalna premija osnovnega zavarovanja — na"),
      "Sprememba-premije2-1": ZA("Zavarovalna vsota osnovnega zavarovanja — iz"),
      "Sprememba-premije2-2": ZA("Zavarovalna vsota osnovnega zavarovanja — na"),
      "namen spremembe-ostalo": ZA("Namen spremembe — drugo (navedite)"),
      "Status zavarovalca": ZA("Zaposlitveni status zavarovalca"),
      "Izbira_aktivni naložbeni paketi": ZA("Aktivni naložbeni paketi"),
      "Nova razdelitev zavarovalne premije": ZA(
        "Želim, da se nova razdelitev zavarovalne premije po skladih izvede"
      ),
      "Prenos sredstev med skladi": ZA("Želim, da se prenos sredstev med skladi izvede"),
    },

    [ZAHTEVEK]: {
      ...DOKUMENT,
      ...CRS,
      davčna_št_podjetja: ZA("Davčna številka podjetja"),
      "izključitev-1": ZA(
        "Izključitev povečanega obsega zavarovalnega kritja, izvedenega z akcijsko priključitvijo s 01."
      ),
      "izključitev-2": ZA(
        "Izključitev povečanega obsega zavarovalnega kritja, izvedenega z akcijsko priključitvijo s 01."
      ),
      "izključitev-1-datum": ZA("Akcijska priključitev s 01. — mesec in leto"),
      "izključitev-2-datum": ZA("Akcijska priključitev s 01. — mesec in leto"),
      "upravičenec za inv-dno-nbd-zio-ren-4-1": ZA("Upravičenec za INV, DNO, NBD, ZIO, rento"),
      "upravičenec za inv-dno-nbd-zio-ren-4-2": ZA("Upravičenec za INV, DNO, NBD, ZIO, rento"),
      Rubrika4: ZA("Vrsta spremembe"),
      Rubrika5: ZA("Vrsta spremembe"),
      "Rubrika6-a": ZA("Vrsta spremembe"),
      "Rubrika6-b": ZA("Vrsta spremembe"),
      "Rubrika6-c": ZA("Vrsta spremembe"),
      "Rubrika-8": ZA("Vrsta spremembe"),
      "Rubrika-9": ZA("Vrsta spremembe"),
      "Rubrika8.1": ZA("Prva zavarovana oseba — oblika zavarovanja"),
      "Rubrika8.2": ZA("Druga zavarovana oseba — oblika zavarovanja"),
      Individualno1: ZA("Prva zavarovana oseba — premija (individualno)"),
      Družinsko1: ZA("Prva zavarovana oseba — premija (družinsko)"),
      Individualno2: ZA("Druga zavarovana oseba — premija (individualno)"),
      Družinsko2: ZA("Druga zavarovana oseba — premija (družinsko)"),
      "Davek-8-DA/NE": ZA("DPZP 8,5 %"),
    },
  };

  // Ponavljajoče se vrstice Zahtevka (po osebi, kritju ali zaporedni številki).
  const zahtevek = beta[ZAHTEVEK];
  const finance = beta["Zahtevek-za-finančne-spremembe.pdf"];

  for (const o of [1, 2]) {
    const oseba = OSEBI[o];
    zahtevek[`DPZP2-4-${o}-1-DA/NE`] = ZA(`${oseba} — DPZP 8,5 %`);
    zahtevek[`DPZP2-6-a-${o}-DA/NE`] = ZA(`${oseba} — DPZP 8,5 %`);
    zahtevek[`sam-izbira-4-${o}`] = ZA(`${oseba} — mesečna nezgodna renta za invalidnost: stopnja`);
    zahtevek[`Check box-paket${o}`] = ZA(`${oseba} — trajna delovna nezmožnost: paket`);
    [
      [1, "30 ali več %"],
      [2, "50 ali več %"],
    ].forEach(([r, stopnja]) => {
      // Značka z možnostjo bi stopnjo le ponovila, zato moznost: null.
      const renta = (kaj) => ({ oznaka: `Mesečna renta (${stopnja}) — ${kaj}`, moznost: null });
      zahtevek[`višina mes rente-4-${o}-${r}`] = renta("višina rente");
      zahtevek[`doba izplačevanja-4-${o}-${r}`] = renta("doba izplačevanja (let)");
      zahtevek[`premija-mes rente-4-${o}-${r}`] = renta("premija");
    });
    [
      [1, "začasna"],
      [2, "trajna"],
    ].forEach(([r, vrsta]) => {
      const uvod = `${oseba} — ${vrsta} delovna nezmožnost`;
      zahtevek[`Zav.doba-5-${o}-${r}`] = ZA(`${uvod} — zavarovalna doba (let)`);
      zahtevek[`Zav.vsota-5-${o}-${r}`] = ZA(`${uvod} — zavarovalna vsota`);
      zahtevek[`Zav.premija-5-${o}-${r}`] = ZA(`${uvod} — zavarovalna premija`);
      zahtevek[`DPZP2-5-${o}-${r}-DA/NE`] = ZA(`${uvod} — DPZP 8,5 %`);
    });
  }
  for (const n of [1, 2, 3]) {
    zahtevek[`9-davčna${n}`] = ZA("Davčna številka");
    zahtevek[`7-a-premija-${n}`] = ZA("Davčna številka");
  }
  for (let n = 1; n <= 6; n++) {
    finance[`nova-raz-${n}`] = ZA(`${n}. sklad — delež premije`);
    finance[`nova-raz-sklad-${n}`] = ZA(`${n}. sklad — oznaka sklada`);
    finance[`prenos-sred-${n}`] = ZA(`${n}. prenos — delež sredstev`);
    finance[`prenos-sred-${n}-1`] = ZA(`${n}. prenos — iz sredstev sklada`);
    finance[`prenos-sred-${n}-2`] = ZA(`${n}. prenos — v sklad`);
  }

  /** Rubrike z ročno postavitvijo za dani obrazec (po imenu datoteke). */
  function zaObrazec(datoteka) {
    return obrazci[String(datoteka || "")] || [];
  }

  /** Popravki polj za dani obrazec: { imePolja: { oznaka, samoStevke, ... } }. */
  function popravkiZaObrazec(datoteka, jeBeta) {
    const ime = String(datoteka || "");
    return { ...(popravkiPolj[ime] || {}), ...(jeBeta ? beta[ime] || {} : {}) };
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

  return { zaObrazec, popravkiZaObrazec, imenaPolj, vrsticeOsebe, obrazci };
});
