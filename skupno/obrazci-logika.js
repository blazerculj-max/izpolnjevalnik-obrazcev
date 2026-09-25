// obrazci-logika.js
// Čista logika branja obrazcev: iz besedila s koordinatami in seznama polj
// izlušči oznake polj, vrstice z odgovori in mesta za podpis.
//
// Namenoma brez odvisnosti (ne fs, ne pdf-lib, ne pdfjs), da jo lahko
// uporabita oba: strežnik asistenta in samostojno orodje v brskalniku.
//
// Vhod:
//   strani = [{ stran, kosi: [{besedilo, x, y, w}] }]   (y raste navzgor, kot v PDF)
//   polja  = [{ ime, tip, stran, pravokotnik:{x,y,width,height} }]

(function (koren, tovarna) {
  if (typeof module === "object" && module.exports) module.exports = tovarna();
  else koren.ObrazciLogika = tovarna();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const VRZEL_STOLPCA = 16; // pt vodoravne vrzeli, ki loči dva stolpca
  // Nekateri obrazci pišejo šumnike kot ločene koščke ("mese" + "č" + "na"),
  // ki se skoraj dotikajo. Pod to vrzeljo gre torej za isto besedo in vmes ne
  // sodi presledek; pravi presledki v teh obrazcih merijo vsaj 1,6 pt.
  const VRZEL_PRESLEDKA = 1;
  const NAJVEC_ODMIK_GLAVE = 200; // glava stolpca stoji nad celo tabelo
  const NAJVEC_ODMIK_STOLPCA = 13; // pt razlike v x, da je glava nad tem poljem
  const PRIVZETI_PAS = 22; // pt navzgor/navzdol, če polje nima soseda
  const NAJVISJI_PAS = 30; // pt - višje od tega vrstica obrazca ne seže
  const GLAVE = /^(da|ne|potrebe|zahteve|opis|kritje|st|št)$/i;
  // Besedilo je oznaka okenca le, če stoji tik ob njem. Izmerjeno: pri
  // Ponudbi so oznake 1,5-4 pt od okenca, pri Opredelitvi pa je najbližje
  // besedilo desno že naslednji stolpec (9,8-29,3 pt).
  const NAJVEC_VRZEL_OZNAKE = 7;
  // Nekateri obrazci pišejo naslove razdelkov v ozkem stolpcu ob levem robu,
  // drugi pa ne - pri teh se telo začne kar na skrajni levi. Meje zato ni
  // mogoče določiti s fiksno številko; izračunamo jo za vsako stran posebej.
  const NAJMANJSA_VRZEL_ROBA = 18; // pt med robnim stolpcem in telesom
  const NAJVEC_DELEZ_ROBA = 0.25; // več kot toliko besedila ni rob, ampak telo
  const NAJVEC_ODMIK_SEKCIJE = 130; // pt navzgor do naslova razdelka

  /**
   * Kose besedila združi v odseke: enaka višina IN brez večje vodoravne vrzeli.
   * Tako "Telefonski nasvet…" (levi stolpec) in "Zavarovanje Zdravstveni nasvet"
   * (desni stolpec) ostaneta ločena, čeprav sta v isti vrstici.
   */
  function razdeliNaOdseke(kosi) {
    const poVrsticah = new Map();
    for (const k of kosi) {
      const kljuc = Math.round(k.y / 3); // ~3pt toleranca
      if (!poVrsticah.has(kljuc)) poVrsticah.set(kljuc, []);
      poVrsticah.get(kljuc).push(k);
    }

    const odseki = [];
    for (const vrstica of poVrsticah.values()) {
      vrstica.sort((a, b) => a.x - b.x);
      let tekoci = null;
      for (const k of vrstica) {
        if (tekoci && k.x - tekoci.do > VRZEL_STOLPCA) {
          odseki.push(tekoci);
          tekoci = null;
        }
        if (!tekoci) {
          tekoci = {
            y: k.y,
            od: k.x,
            do: k.x + k.w,
            besedilo: k.besedilo,
            pisava: k.pisava,
            visina: k.visina,
          };
        } else {
          const locilo = k.x - tekoci.do >= VRZEL_PRESLEDKA ? " " : "";
          tekoci.besedilo += locilo + k.besedilo;
          tekoci.do = k.x + k.w;
        }
      }
      if (tekoci) odseki.push(tekoci);
    }
    return odseki.map((o) => ({
      y: o.y,
      od: o.od,
      do: o.do,
      pisava: o.pisava,
      visina: o.visina,
      besedilo: o.besedilo.replace(/\s+/g, " ").trim(),
    }));
  }

  /** Glava stolpca nad poljem (npr. "DA" ali "NE"). */
  function najdiGlavoStolpca(kosi, cx, cy) {
    const kandidati = kosi
      .filter((k) => {
        const sredina = k.x + k.w / 2;
        const nad = k.y - cy;
        return (
          Math.abs(sredina - cx) < NAJVEC_ODMIK_STOLPCA &&
          nad > 3 &&
          nad < NAJVEC_ODMIK_GLAVE &&
          /^(da|ne)$/i.test(k.besedilo)
        );
      })
      .sort((a, b) => a.y - b.y);
    return kandidati.length ? kandidati[0].besedilo.toUpperCase() : null;
  }

  /**
   * Navpični pas vrstice: do polovice razdalje do sosednjega polja.
   * Vrstice določajo VSA polja na strani, ne le tista v istem stolpcu -
   * tabela ima skupne vrstice čez več stolpcev.
   */
  function pasVrstice(polje, vsaPolja) {
    const r = polje.pravokotnik;
    const cy = r.y + r.height / 2;
    const sosednje = vsaPolja
      .filter((p) => p !== polje && p.stran === polje.stran && p.pravokotnik)
      .map((p) => p.pravokotnik.y + p.pravokotnik.height / 2)
      .filter((y) => Math.abs(y - cy) > 2);

    const nad = sosednje.filter((y) => y > cy).sort((a, b) => a - b)[0];
    const pod = sosednje.filter((y) => y < cy).sort((a, b) => b - a)[0];
    return {
      zgoraj: Math.min(
        nad === undefined ? cy + PRIVZETI_PAS : (cy + nad) / 2 + 3,
        cy + NAJVISJI_PAS
      ),
      spodaj: Math.max(
        pod === undefined ? cy - PRIVZETI_PAS : (cy + pod) / 2 - 3,
        cy - NAJVISJI_PAS
      ),
    };
  }

  /**
   * Besedilo, ki opisuje vrstico tega polja.
   * @param {number|null} mejaStolpca - x meje med stolpcema strani; napis iz
   *   levega stolpca ne pripada polju v desnem (glej dolociStolpce).
   */
  function najdiOznakoVrstice(odseki, polje, vsaPolja, stran, mejaStolpca) {
    const r = polje.pravokotnik;
    const pas = pasVrstice(polje, vsaPolja);
    // Besedilo robnega stolpca je naslov razdelka, ne oznaka polja.
    const rob = stran ? robSekcije(stran) : null;
    const vPasu = odseki.filter(
      (o) =>
        (rob === null || o.od >= rob) &&
        o.y >= pas.spodaj &&
        o.y <= pas.zgoraj &&
        // Dvočrkovni napisi so lahko povsem pravi ("IZ", "NA" v tabeli
        // sprememb); zavrnemo le samo ločila.
        o.besedilo.length >= 2 &&
        /[a-zčšž0-9]/i.test(o.besedilo) &&
        !GLAVE.test(o.besedilo)
    );

    const zdruzi = (izbrani) =>
      izbrani
        .sort((a, b) => b.y - a.y)
        .map((o) => o.besedilo)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

    /**
     * Oznaka polja je besedilo, ki mu je NAJBLIŽE - vodoravno in navpično
     * hkrati. Same "najbližje vrstice" ne zadoščajo: v tabeli Opredelitve je
     * trditev res v isti vrstici, a 192 pt stran, ime produkta pa 90 pt stran
     * in eno vrstico više. Navpično razdaljo zato tehtamo trikrat.
     *
     * Leva stran ima majhno prednost, ker napis na obrazcih praviloma stoji
     * PRED poljem.
     */
    const TEZA_NAVPICNO = 3;
    const PREDNOST_LEVE = 0.8;
    const cy = r.y + r.height / 2;

    const oceni = (o, vrzel) => vrzel + TEZA_NAVPICNO * Math.abs(o.y - cy);

    const izberi = (kandidati, vrzelDo, utez) => {
      if (!kandidati.length) return null;
      const sidro = kandidati.reduce((a, b) =>
        oceni(b, vrzelDo(b)) < oceni(a, vrzelDo(a)) ? b : a
      );
      // Večvrstične oznake nadaljujemo po istem stolpcu, a le po SOSEDNJIH
      // vrsticah: sicer se pripne še naslov razdelka nad poljem ("1. Podatki
      // o zavarovani osebi*" stoji 22 pt nad napisom "ime in priimek").
      const vStolpcu = vPasu
        .filter((o) => Math.abs(o.od - sidro.od) < 25)
        .sort((a, b) => b.y - a.y);
      const i = vStolpcu.indexOf(sidro);
      const stolpec = [sidro];
      for (let j = i - 1; j >= 0; j--) {
        if (vStolpcu[j].y - stolpec[stolpec.length - 1].y > 14) break;
        stolpec.push(vStolpcu[j]);
      }
      for (let j = i + 1; j < vStolpcu.length; j++) {
        if (stolpec[stolpec.length - 1].y - vStolpcu[j].y > 14) break;
        stolpec.push(vStolpcu[j]);
      }
      let besedilo = zdruzi(stolpec);

      // Stolpčna oznaka ("IZ", "NA" v tabeli sprememb) sama zase ne pove,
      // česa se sprememba tiče; predenjo postavimo začetek vrstice.
      if (besedilo.length <= 2) {
        const vVrstici = kandidati.filter((o) => Math.abs(o.y - sidro.y) < 3);
        const zacetek = vVrstici.reduce((a, b) => (b.od < a.od ? b : a), sidro);
        if (zacetek !== sidro && zacetek.besedilo.length > 3) {
          besedilo = zacetek.besedilo + " — " + besedilo;
        }
      }
      return {
        besedilo,
        od: sidro.od,
        vrzel: vrzelDo(sidro),
        ocena: oceni(sidro, vrzelDo(sidro)) * utez,
      };
    };

    const levo = izberi(
      // Napis se sme malo zaliti v polje: "ime in priimek" sega 5 pt čezenj,
      // ker okvir na obrazcu zajema napis in vpisni prostor skupaj.
      vPasu.filter((o) => o.od < r.x && o.do <= r.x + 15),
      (o) => Math.max(0, r.x - o.do),
      PREDNOST_LEVE
    );
    // Desno besedilo omejimo z naslednjim poljem v isti vrstici: kar stoji za
    // njim, je njegova oznaka, ne naša. Brez tega "Datum" pobere pojasnilo
    // polja KZZ, ki stoji tik za njim.
    const mejaDesno = vsaPolja
      .filter(
        (d) =>
          d !== polje &&
          d.stran === polje.stran &&
          d.pravokotnik &&
          d.pravokotnik.x > r.x + r.width &&
          Math.abs(d.pravokotnik.y + d.pravokotnik.height / 2 - cy) < 10
      )
      .reduce((n, d) => Math.min(n, d.pravokotnik.x), Infinity);

    // Napis, ki se prekriva z drugim poljem, je njegov, ne naš: pojasnilo
    // "kzz št. (obvezen podatek ...)" leži nad poljem KZZ, a se začne tik za
    // poljem Datum.
    const jeTujNapis = (o) =>
      vsaPolja.some(
        (d) =>
          d !== polje &&
          d.stran === polje.stran &&
          d.pravokotnik &&
          Math.abs(d.pravokotnik.y + d.pravokotnik.height / 2 - cy) < 10 &&
          d.pravokotnik.x < o.do &&
          d.pravokotnik.x + d.pravokotnik.width > o.od
      );

    const desno = izberi(
      vPasu.filter(
        (o) =>
          o.od >= r.x + r.width - 2 &&
          o.od < mejaDesno &&
          !jeTujNapis(o) &&
          // Enota za poljem ("LET", "EUR") ni oznaka polja.
          !/^(LET|EUR|KG|CM|MM|%)\b/.test(o.besedilo)
      ),
      (o) => o.od - (r.x + r.width),
      1
    );

    if (!levo) return desno ? desno.besedilo : null;
    if (!desno) return levo.besedilo;

    // V tabeli Opredelitve stoji ime produkta med obema stolpcema okenc in je
    // okencu v stolpcu POTREBE celo bližje (29 pt) od trditve (48 pt). Zgolj
    // razdalja ju torej ne loči. Loči pa ju dolžina: cela poved na levi je
    // trditev, kratek napis pa je lahko le naslov razdelka.
    // Prednost leve strani velja le znotraj istega stolpca. Okence "Ostalo"
    // med prilogami stoji v desnem stolpcu, levo od njega v isti vrstici pa
    // je cela poved, ki pripada okencu levega stolpca; ta si je torej ne sme
    // vzeti kar zato, ker je poved. Na razdaljo se še vedno lahko potegujeta.
    const levoJeTuj =
      mejaStolpca != null && r.x >= mejaStolpca && levo.od < mejaStolpca;

    // V tabeli Opredelitve stoji ime produkta med obema stolpcema okenc in je
    // okencu v stolpcu POTREBE celo bližje (29 pt) od trditve (48 pt). Zgolj
    // razdalja ju torej ne loči. Loči pa ju dolžina: cela poved na levi je
    // trditev, kratek napis pa je lahko le naslov razdelka.
    if (!levoJeTuj && levo.besedilo.length > 25 && levo.vrzel < 200) {
      return levo.besedilo;
    }

    // Napis stoji pred poljem. Kadar je levi kandidat blizu, je to on - tudi
    // če je desni za las bližje: pri "datum_rojstva" stoji desno beseda
    // "kraj", ki je oznaka NASLEDNJEGA polja (razlika v oceni je bila 15
    // proti 16,8). Besedilo robnega stolpca je iz kandidatov že izločeno.
    if (!levoJeTuj && levo.vrzel <= 60) return levo.besedilo;

    return desno.ocena < levo.ocena ? desno.besedilo : levo.besedilo;

  }

  /**
   * Vsakemu polju pripiše oznako iz besedila ob njem in glavo stolpca.
   * @returns {Map<string,{oznaka:string|null, glava:string|null}>}
   */
  function oznaciPolja(strani, polja, meje) {
    const oznake = new Map();
    for (const polje of polja) {
      const stran = strani[polje.stran - 1];
      if (!stran || !polje.pravokotnik) continue;
      const r = polje.pravokotnik;
      const odseki = stran.odseki || razdeliNaOdseke(stran.kosi);
      stran.odseki = odseki;
      oznake.set(polje.ime, {
        oznaka: najdiOznakoVrstice(
          odseki,
          polje,
          polja,
          stran,
          meje ? meje.get(polje.stran) : null
        ),
        desno: polje.tip === "TextField" ? najdiDesnoPripombo(odseki, polje) : null,
        glava:
          polje.tip === "CheckBox"
            ? najdiGlavoStolpca(stran.kosi, r.x + r.width / 2, r.y + r.height / 2)
            : null,
      });
    }
    return oznake;
  }

  /**
   * Mesta za podpise iz napisov na obrazcu ("PODPIS ZAVAROVALCA").
   * Upoštevamo samo kratke napise - dolgi odstavki, ki omenjajo podpis, niso
   * mesta za podpis. Vrne položaje v odstotkih strani (izhodišče zgoraj levo).
   */
  function najdiMestaPodpisov(strani, mereStrani) {
    const najdeni = [];
    strani.forEach((s) => {
      const mere = mereStrani[s.stran - 1];
      if (!mere) return;
      const odseki = s.odseki || razdeliNaOdseke(s.kosi);
      s.odseki = odseki;
      for (const o of odseki) {
        const t = o.besedilo;
        if (!/\bpodpis\b/i.test(t)) continue;
        if (t.length > 46) continue; // odstavek, ne napis polja
        if (/\bs podpisom\b|podpisane|podpisani/i.test(t)) continue;

        const okvir = najdiOkvirNapisa(s.okvirji, o);
        najdeni.push({
          naziv: t.replace(/\*/g, "").trim(),
          stran: s.stran,
          potrebujeSifro: /šifra|sifra/i.test(t),
          zaProdajnika: /prodajnik|zastopnik|posrednik/i.test(t),
          ...mestoVOkviru(o, okvir, mere),
        });
      }
    });
    return najdeni;
  }

  /** Najtesnejši narisan okvir, ki obdaja ta napis (celica tabele). */
  function najdiOkvirNapisa(okvirji, napis) {
    if (!Array.isArray(okvirji)) return null;
    return (
      okvirji
        .filter(
          (r) =>
            r.sirina > 40 &&
            r.visina > 15 &&
            r.sirina < 560 &&
            r.visina < 200 &&
            r.x <= napis.od + 2 &&
            r.x + r.sirina >= napis.do - 2 &&
            r.y <= napis.y + 2 &&
            r.y + r.visina >= napis.y + 6
        )
        .sort((a, b) => a.sirina * a.visina - b.sirina * b.visina)[0] || null
    );
  }

  /**
   * Kam v okvir postaviti podpis in šifro.
   * Podpis gre POD napis, na sredino preostanka okvira; šifra pa kar ob napis,
   * v isto vrstico - tam jo obrazec pričakuje ("ŠIFRA IN PODPIS PRODAJNIKA").
   * Brez najdenega okvira ostane staro ravnanje: malo pod napisom.
   */
  function mestoVOkviru(napis, okvir, mere) {
    const vOdstotkihX = (x) => (x / mere.sirina) * 100;
    const vOdstotkihY = (y) => ((mere.visina - y) / mere.visina) * 100;

    if (!okvir) {
      return {
        x: vOdstotkihX((napis.od + napis.do) / 2),
        y: vOdstotkihY(napis.y - 24),
        okvir: null,
        sifra: null,
        najvecSirina: 22,
        najvecVisina: null,
      };
    }

    const rob = 4;
    const prostor = napis.y - okvir.y - rob; // višina pod napisom, v točkah
    return {
      x: vOdstotkihX(okvir.x + okvir.sirina / 2),
      y: vOdstotkihY(okvir.y + Math.max(prostor, 6) / 2),
      okvir: {
        x: vOdstotkihX(okvir.x),
        y: vOdstotkihY(okvir.y + okvir.visina),
        sirina: (okvir.sirina / mere.sirina) * 100,
        visina: (okvir.visina / mere.visina) * 100,
      },
      // Šifra gre tik za napis, v njegovo vrstico.
      sifra: {
        x: vOdstotkihX(Math.min(napis.do + 6, okvir.x + okvir.sirina - 30)),
        y: vOdstotkihY(napis.y),
      },
      najvecSirina: ((okvir.sirina - 2 * rob) / mere.sirina) * 100,
      najvecVisina: (Math.max(prostor, 6) / mere.visina) * 100,
    };
  }

  /** Stolpci potrditvenih polj: navpične kolone z isto glavo (DA / NE). */
  function najdiStolpce(kandidati) {
    const stolpci = [];
    for (const p of kandidati) {
      const sredina = p.pravokotnik.x + p.pravokotnik.width / 2;
      const obstojec = stolpci.find(
        (s) => s.stran === p.stran && Math.abs(s.x - sredina) < 5 && s.glava === p.glava
      );
      if (obstojec) obstojec.polja.push(p);
      else
        stolpci.push({
          stran: p.stran,
          x: sredina,
          glava: p.glava,
          sirina: p.pravokotnik.width,
          visina: p.pravokotnik.height,
          polja: [p],
        });
    }
    return stolpci.sort((a, b) => a.stran - b.stran || a.x - b.x);
  }

  /** Dva stolpca (DA in NE) skupaj tvorita en odgovor; med tabelama je vrzel. */
  function zdruziStolpceVTabele(stolpci) {
    const tabele = [];
    for (const s of stolpci) {
      const zadnja = tabele[tabele.length - 1];
      if (zadnja && zadnja.stran === s.stran && s.x - zadnja.x_do < 60) {
        zadnja.stolpci.push(s);
        zadnja.x_do = s.x;
      } else tabele.push({ stran: s.stran, x_do: s.x, stolpci: [s] });
    }
    return tabele;
  }

  /**
   * Potrditvena polja v isti vrstici obrazca so en sam odgovor.
   * Kadar obrazec za kakšen odgovor NIMA polja, mesto okenca izračunamo iz
   * stolpca in vrstice, da ga je mogoče narisati ob izvozu.
   */
  function zdruziVVrstice(polja) {
    const kandidati = polja.filter(
      (p) => p.tip === "CheckBox" && p.glava && p.polozaj && p.pravokotnik
    );
    const tabele = zdruziStolpceVTabele(najdiStolpce(kandidati));

    const skupine = [];
    for (const p of kandidati) {
      const obstojeca = skupine.find(
        (s) => s.stran === p.stran && Math.abs(s.y - p.polozaj.y) < 0.6
      );
      if (obstojeca) obstojeca.polja.push(p);
      else skupine.push({ stran: p.stran, y: p.polozaj.y, polja: [p] });
    }

    return skupine
      .filter((s) => s.polja.length >= 2)
      .map((s, i) => {
        const opisi = [
          ...new Set(s.polja.map((p) => p.oznaka_iz_pdf).filter(Boolean)),
        ].sort((a, b) => b.length - a.length);
        const yTock = s.polja[0].pravokotnik.y;

        const poOdgovoru = new Map();
        for (const tabela of tabele) {
          if (tabela.stran !== s.stran) continue;
          const vTejVrstici = s.polja.filter((p) =>
            tabela.stolpci.some((st) => st.polja.includes(p))
          );
          if (vTejVrstici.length === 0) continue;

          for (const stolpec of tabela.stolpci) {
            if (!poOdgovoru.has(stolpec.glava)) {
              poOdgovoru.set(stolpec.glava, { polja: [], oznake: [] });
            }
            const cilj = poOdgovoru.get(stolpec.glava);
            const pravo = vTejVrstici.find((p) => stolpec.polja.includes(p));
            if (pravo) cilj.polja.push(pravo.ime);
            else
              cilj.oznake.push({
                stran: s.stran,
                x: stolpec.x - stolpec.sirina / 2,
                y: yTock,
                sirina: stolpec.sirina,
                visina: stolpec.visina,
              });
          }
        }

        return {
          id: "vrstica" + i,
          stran: s.stran,
          y: s.y,
          oznaka: opisi[0] || s.polja[0].ime,
          dodatno: opisi[1] || null,
          odgovori: [...poOdgovoru.entries()]
            .map(([odgovor, v]) => ({ odgovor, polja: v.polja, oznake: v.oznake }))
            .sort((a, b) => (a.odgovor === "DA" ? -1 : b.odgovor === "DA" ? 1 : 0)),
        };
      })
      .sort((a, b) => a.stran - b.stran || a.y - b.y);
  }

  /**
   * Oznaka enega okenca: besedilo tik desno od njega, omejeno z NASLEDNJIM
   * okencem iste vrstice. Brez te meje bi pri tesno postavljenih možnostih
   * ("m" in "ž" sta narazen 13 pt) oznaka požrla tudi sosednjo.
   *
   * Koščke lepimo po istem pravilu kot odseke: pod 1 pt gre za isto besedo
   * (nekateri obrazci šumnike pišejo ločeno), nad tem je presledek.
   */
  function oznakaOkenca(kosi, r, mejaDesno) {
    const cy = r.y + r.height / 2;
    const vrsta = kosi
      .filter(
        (k) =>
          Math.abs(k.y - cy) < 6 && k.x >= r.x + r.width - 2 && k.x < mejaDesno
      )
      .sort((a, b) => a.x - b.x);
    if (!vrsta.length) return null;
    if (vrsta[0].x - (r.x + r.width) > NAJVEC_VRZEL_OZNAKE) return null;

    let besedilo = vrsta[0].besedilo;
    let konec = vrsta[0].x + vrsta[0].w;
    for (let i = 1; i < vrsta.length; i++) {
      // Oznaka je ENA vrstica besedila: naslednja vrstica iste celice
      // (npr. "številka računa - plačilnega IBAN") vanjo ne sodi.
      if (Math.abs(vrsta[i].y - vrsta[0].y) > 2) continue;
      const vrzel = vrsta[i].x - konec;
      if (vrzel > VRZEL_STOLPCA) break; // že drug stolpec
      besedilo += (vrzel >= VRZEL_PRESLEDKA ? " " : "") + vrsta[i].besedilo;
      konec = vrsta[i].x + vrsta[i].w;
    }
    return besedilo;
  }

  /** Oznaka možnosti: besedilo ob okencu, sicer glava stolpca, sicer vrednost. */
  function oznakaMoznosti(stran, okence, vsaOkenca) {
    const r = okence.pravokotnik;
    const cy = r.y + r.height / 2;
    // Meja je najbližje okence iste vrstice na desni.
    const mejaDesno = vsaOkenca
      .filter(
        (o) =>
          o !== okence &&
          o.pravokotnik &&
          Math.abs(o.pravokotnik.y + o.pravokotnik.height / 2 - cy) < 6 &&
          o.pravokotnik.x > r.x
      )
      .reduce((n, o) => Math.min(n, o.pravokotnik.x), Infinity);

    return (
      oznakaOkenca(stran.kosi, r, mejaDesno) ||
      najdiGlavoStolpca(stran.kosi, r.x + r.width / 2, cy) ||
      String(okence.vklop || "").toUpperCase()
    );
  }

  /**
   * Naslov razdelka ob levem robu strani ("Zavarovalec", "Zavarovanec").
   * Po njem ločimo sicer enaka vprašanja, ki se na obrazcu ponovijo za več oseb.
   */
  function sekcijaOb(stran, y) {
    const rob = robSekcije(stran);
    if (rob === null) return null;
    const kosi = stran.kosi;
    // Naslov razdelka je samostojna beseda ali dve z veliko začetnico
    // ("Zavarovalec", "Prejemnik računa"). Tako izločimo drobce stavkov,
    // ki po naključju stojijo ob robu ("(izpolniti le, če", "plačevanja").
    const JE_NASLOV = /^[A-ZČŠŽ][a-zčšž]+(\s[a-zčšž]+)?$/;
    const obRobu = kosi.filter((k) => k.x < rob).sort((a, b) => b.y - a.y);
    const najden = obRobu
      .filter(
        (k) => k.y >= y - 6 && k.y - y < NAJVEC_ODMIK_SEKCIJE && JE_NASLOV.test(k.besedilo)
      )
      .sort((a, b) => a.y - b.y)[0];
    if (!najden) return null;

    // Naslov ob robu je pogosto prelomljen čez več vrstic ("Vprašalnik o" /
    // "zdravstvenem" / "stanju"), zato nadaljevanja pripnemo nazaj.
    const deli = [najden.besedilo];
    let zadnji = najden;
    for (const k of obRobu) {
      if (k.y >= zadnji.y || zadnji.y - k.y > 12) continue;
      if (!/^[a-zčšž]/.test(k.besedilo) || deli.length >= 4) break;
      deli.push(k.besedilo);
      zadnji = k;
    }
    return pocisti(deli.join(" "));
  }

  /** Napis z obrazca: odveč presledki pred ločili in velika začetnica. */
  function pocistiNapis(niz) {
    const t = pocisti(niz)
      .replace(/\s+([.,;:!?])/g, "$1")
      .replace(/\s*\/\s*/g, " / ");
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  }

  /**
   * Prikazna oznaka polja. Napis z obrazca je skoraj vedno boljši od imena
   * polja ("datum začetka" proti "Začetek1"), a le kadar je kratek - dolgi
   * napisi so pojasnila in sodijo pod polje, ne v naslov.
   */
  function izberiOznako(ime, izPdf) {
    const napis = pocistiNapis(izPdf);
    // "Datum rojstva1" -> "Datum rojstva", "Iz-4" -> "Iz"
    let cisto = pocisti(ime).replace(/[\s\-_]*\d+$/, "").replace(/[\s\-_]+$/, "");
    // "ime_priimek_zdravnik" je strojno ime, ne napis - ločila razvežemo.
    if (jeStrojnoIme(ime)) cisto = pocistiNapis(cisto.replace(/[_\-]+/g, " "));
    if (!napis) return cisto || pocisti(ime);
    if (imeJeNeuporabno(ime)) return napis;
    // Strojno ime je zapisal človek, ki je obrazec pripravil, zato je napis
    // pred njim - razen kadar je napis le ena ali dve besedi, ime pa veliko
    // bolj določno: "Datum" je za "ime_priimek_podpis_predstavnika_
    // zavarovalnice" pobran iz sosednje vrstice podpisne tabele.
    if (jeStrojnoIme(ime)) {
      return stevBesed(napis) <= 2 && stevBesed(cisto) >= 4 ? cisto : napis;
    }
    // Ime polja je pogosto le začetek vprašanja ("ali je bila"), napis na
    // obrazcu pa celo vprašanje. Takrat je napis pravi, čeprav je dolg.
    if (imeJeZacetekNapisa(cisto, napis)) return napis;
    return napisJeOznaka(napis) ? napis : cisto || pocisti(ime);
  }

  /** Število besed (ločila niso beseda). */
  function stevBesed(niz) {
    return String(niz || "")
      .split(/[\s_\-./]+/)
      .filter((b) => /[a-zčšž0-9]/i.test(b)).length;
  }

  /** "ime_priimek_zdravnik", "podpis__zavarovane-osebe" - ime iz urejevalnika. */
  function jeStrojnoIme(ime) {
    const t = String(ime || "");
    return t.includes("_") && !/\s/.test(t);
  }

  /** Je ime polja le prve nekaj besed napisa? ("ali je bila" / cel stavek) */
  const NAJVEC_ZNAKOV_ODREZANEGA = 120;
  function imeJeZacetekNapisa(ime, napis) {
    if (!napis || napis.length > NAJVEC_ZNAKOV_ODREZANEGA) return false;
    const besede = (s) =>
      String(s)
        .toLowerCase()
        .split(/[\s_\-./]+/)
        .filter((b) => /[a-zčšž0-9]/i.test(b));
    const bi = besede(ime);
    const bn = besede(napis);
    // Ena sama beseda še ni odrezan stavek; dva enako dolga napisa pa nista
    // začetek in nadaljevanje istega.
    if (bi.length < 2 || bi.length >= bn.length) return false;
    return bi.every((b, i) => b === bn[i]);
  }

  /**
   * Je to res napis polja ali le kos stavka, med katerim polje stoji?
   * Obrazci s tekočim besedilom ("Podpisani/a* rojen/a dne ___") dajo ob polju
   * drobce povedi; take raje zavrnemo in obdržimo ime polja, ki je pri teh
   * obrazcih povedno ("Datum rojstva").
   */
  function napisJeOznaka(napis) {
    if (napis.length > 50) return false;
    if (napis.includes("*")) return false; // opomba k obveznemu polju

    // Štejemo samo besede; ločila ("/", "—") niso beseda.
    const besede = napis.split(/\s+/).filter((b) => /[a-zčšž0-9]/i.test(b));
    if (besede.length > 5) return false;
    // "S I 5 6" je razsut natis predpone IBAN, ne napis polja.
    if (besede.filter((b) => b.length === 1).length > besede.length / 2) return false;
    const odprtih = (napis.match(/\(/g) || []).length;
    const zaprtih = (napis.match(/\)/g) || []).length;
    return odprtih === zaprtih;
  }

  /**
   * Kar stoji tik DESNO od besedilnega polja: enota ("LET", "EUR") in
   * morebitna pripomba, ki sledi ("Trajanje zavarovanj je 4 leta.").
   */
  function najdiDesnoPripombo(odseki, polje) {
    const r = polje.pravokotnik;
    if (!r) return null;
    const cy = r.y + r.height / 2;
    const desni = odseki
      .filter(
        (o) =>
          Math.abs(o.y - cy) < 8 &&
          o.od >= r.x + r.width - 2 &&
          o.od - (r.x + r.width) < 24
      )
      .sort((a, b) => a.od - b.od)[0];
    if (!desni) return null;

    // Desno od polja stoji ali enota ali - pogosteje - oznaka NASLEDNJEGA
    // polja. Ločimo ju tako, da priznamo le znane enote; vse drugo pustimo
    // tistemu polju, ki mu pripada.
    const ujem = desni.besedilo.match(/^(LET|EUR|KG|CM|MM|%)\b\s*(.*)$/);
    if (!ujem) return null;
    return { enota: ujem[1], pripomba: pocisti(ujem[2]) || null };
  }

  // Napisi ob robu strani so prelomljeni čez več vrstic, včasih sredi besede
  // in brez vezaja. Samodejno tega ni mogoče zanesljivo ugotoviti: odlomek
  // "zavaro" se v telesu Opredelitve pojavi enkrat (torej bi veljal za besedo),
  // beseda "Seznanitev" v Ponudbi pa prav tako enkrat - pravilo, ki bi zlepilo
  // prvo, bi pokvarilo drugo. Zato popravke naštejemo; seznam je kratek in ga
  // je ob novem obrazcu lahko dopolniti.
  const PRELOMLJENE_BESEDE = [
    [/zavaro valca/gi, "zavarovalca"],
    [/zavaro valčevih/gi, "zavarovalčevih"],
    [/poda nih/gi, "podanih"],
  ];

  function zlepiPrelomljene(niz) {
    return PRELOMLJENE_BESEDE.reduce((t, [vzorec, cela]) => t.replace(vzorec, cela), niz);
  }

  /**
   * Meja robnega stolpca na tej strani ali null, če ga stran nima.
   * Robni stolpec prepoznamo po vrzeli do telesa in po tem, da vsebuje le
   * majhen del besedila: pri Opredelitvi 14 -> 37 pt (16 od 185 koščkov),
   * pri obrazcu Zahtevek pa je najbližji naslednji rob 27 pt in v pasu je
   * skoraj četrtina besedila - tam torej robnega stolpca ni.
   */
  function robSekcije(stran) {
    if (stran.__rob !== undefined) return stran.__rob;
    const kosi = stran.kosi;
    let rob = null;

    if (kosi.length) {
      const mediana = [...kosi.map((k) => k.x)].sort((a, b) => a - b)[
        Math.floor(kosi.length / 2)
      ];
      // Levi robovi besedila v levi polovici strani, brez ponovitev.
      const robovi = [...new Set(kosi.map((k) => Math.round(k.x)))]
        .filter((x) => x <= mediana)
        .sort((a, b) => a - b);

      // Robni stolpec od telesa loči največja vrzel med temi robovi.
      // Ob enako velikih vrzelih vzamemo NAJBOLJ DESNO: pri Opredelitvi sta
      // dve po 19 pt (18->37 in 38->57), prava meja pa je tista ob telesu -
      // sicer bi robni stolpec prerezali na pol in izgubili pol naslova.
      let najvecja = 0;
      let mejaPri = null;
      for (let i = 1; i < robovi.length; i++) {
        const vrzel = robovi[i] - robovi[i - 1];
        if (vrzel >= najvecja) {
          najvecja = vrzel;
          mejaPri = robovi[i - 1] + vrzel / 2;
        }
      }

      const vPasu = kosi.filter((k) => k.x < mejaPri).length;
      if (
        najvecja >= NAJMANJSA_VRZEL_ROBA &&
        vPasu / kosi.length <= NAJVEC_DELEZ_ROBA
      ) {
        rob = mejaPri;
      }
    }

    stran.__rob = rob;
    return rob;
  }

  /**
   * Je besedilo v oklepaju navodilo (in ne del naslova)?
   * Pozor: "izpolni" ne ujame besede "izpolnjevanje", zato gre koren brez
   * končnice. Dolg oklepaj za kratkim naslovom je navodilo tudi brez teh
   * besed ("13. Podpis (ime in priimek se mora izpisati z velikimi ...)").
   */
  function jeNavodiloVOklepaju(vsebina) {
    const t = String(vsebina || "").trim();
    return /izpoln|obvezn|le,? *če|velja|navedite/i.test(t) || t.length > 20;
  }

  /** Odveč ločila in presledki ob oznakah iz PDF-ja. */
  function pocisti(niz) {
    return zlepiPrelomljene(String(niz || ""))
      .replace(/\s+/g, " ")
      .replace(/^[\s:.,;*-]+|[\s:.,;*-]+$/g, "")
      .trim();
  }

  /** Ali dve oznaki povesta isto? ("Spol" in "spol :") */
  function jeIsto(a, b) {
    const o = (x) =>
      String(x || "")
        .toLowerCase()
        .replace(/[^a-zčšž0-9]+/g, "");
    return o(a) === o(b);
  }

  /**
   * Potrditveno polje, katerega okenca imajo RAZLIČNE vklopne vrednosti, ni
   * kljukica, ampak izbira: "Spol" med m in ž, "Oseba" med fizično in pravno,
   * vrstica v Opredelitvi med DA in NE. Zato zanj ponudimo eno vprašanje z
   * gumbom za vsako možnost.
   *
   * Polji, ki stojita v isti vrstici in imata enake možnosti, sta en sam
   * odgovor (v Opredelitvi stolpca POTREBE in ZAHTEVE).
   */
  function zdruziVIzbire(polja, strani) {
    const izbirna = polja.filter(
      (p) =>
        p.tip === "CheckBox" &&
        Array.isArray(p.okenca) &&
        new Set(p.okenca.map((o) => o.vklop)).size >= 2
    );

    const skupine = [];
    for (const polje of izbirna) {
      const stran = strani[polje.stran - 1];
      const kosi = stran ? stran.kosi : [];
      const okenca = [...polje.okenca].sort(
        (a, b) => a.pravokotnik.x - b.pravokotnik.x
      );
      const moznosti = okenca.map((o) => ({
        vklop: o.vklop,
        oznaka: oznakaMoznosti(stran, o, okenca),
        polozaj: o.polozaj,
      }));

      // Vprašanje: ime polja, kadar kaj pove ("Spol", "Zavarovalna vsota").
      // Pri obrazcih z imeni tipa "Checkbox7" vzamemo besedilo vrstice.
      const izVrstice = pocisti(polje.oznaka_iz_pdf);
      const jeMoznost = moznosti.some((m) => jeIsto(m.oznaka, izVrstice));
      const imeJePovedno = !imeJeNeuporabno(polje.ime);
      // "Spol1" in "Spol2" sta isti vprašanji za drugo osebo - zaporedna
      // številka pove le to, kar že pove naslov razdelka.
      const imeBrezStevilke = pocisti(polje.ime).replace(/\s*\d+$/, "");
      const vprasanje =
        imeJePovedno || !izVrstice || jeMoznost ? imeBrezStevilke : izVrstice;

      // Pojasnilo dodamo le, če je cel stavek - kratki drobci ob polju so
      // pogosto oznaka SOSEDNJEGA polja in bi zavajali.
      const pojasnilo =
        izVrstice && !jeMoznost && !jeIsto(izVrstice, vprasanje) && izVrstice.length > 20
          ? izVrstice
          : null;

      const kljuc = moznosti.map((m) => m.oznaka).join("|");
      const y = polje.polozaj ? polje.polozaj.y : 0;
      const obstojeca = skupine.find(
        (s) => s.stran === polje.stran && Math.abs(s.y - y) < 0.6 && s.kljuc === kljuc
      );
      if (obstojeca) {
        obstojeca.polja.push(polje.ime);
        // Drugi stolpec iste vrstice pove, za kateri produkt gre.
        if (!obstojeca.dodatno && izVrstice && !jeIsto(izVrstice, obstojeca.oznaka)) {
          obstojeca.dodatno = izVrstice;
        }
        continue;
      }
      skupine.push({
        stran: polje.stran,
        y,
        kljuc,
        polja: [polje.ime],
        oznaka: vprasanje,
        dodatno: pojasnilo,
        razdelek: (() => {
          const r = sekcijaOb(stran, okenca[0].pravokotnik.y);
          // Razdelek, ki le ponovi vprašanje, ne pove ničesar.
          if (!r || jeIsto(r, vprasanje)) return null;
          return jeIsto(r.split(" ")[0], vprasanje.split(" ")[0]) ? null : r;
        })(),
        moznosti,
      });
    }

    return skupine
      .map((s, i) => ({
        id: "izbira" + i,
        stran: s.stran,
        y: s.y,
        oznaka: s.oznaka,
        dodatno: s.dodatno || null,
        razdelek: s.razdelek,
        polja: s.polja,
        moznosti: s.moznosti.map((m) => ({ vklop: m.vklop, oznaka: m.oznaka })),
      }))
      .sort((a, b) => a.stran - b.stran || a.y - b.y);
  }

  /**
   * Razdelki obrazca, kot jih oznanja sam obrazec: naslovi ob levem robu
   * ("Zavarovalec", "Zavarovanec", "Zavarovanje Operacije", "Vprašalnik o
   * zdravstvenem stanju"). Skupaj z njimi poberemo navodilo, ki spada zraven
   * ("izpolniti le, če zavarovalec in zavarovanec nista ista oseba").
   *
   * Vrne položaje v odstotkih strani, da jih vmesnik primerja s polji.
   */
  function najdiRazdelke(strani, mereStrani) {
    const izhod = [];
    strani.forEach((s) => {
      const mere = mereStrani[s.stran - 1];
      if (!mere) return;

      // Naslov je ob robu pogosto prelomljen čez več vrstic - vrstice, ki si
      // tesno sledijo, spadajo skupaj.
      const rob = robSekcije(s);
      const bloki = [];
      (rob === null ? [] : s.kosi)
        .filter((k) => k.x < rob)
        .sort((a, b) => b.y - a.y)
        .forEach((k) => {
          const zadnji = bloki[bloki.length - 1];
          if (zadnji && zadnji.dno - k.y <= 12) {
            zadnji.vrstice.push(k);
            zadnji.dno = k.y;
          } else bloki.push({ vrh: k.y, dno: k.y, vrstice: [k] });
        });

      // Nekateri obrazci razdelkov ne pišejo ob robu, ampak kot oštevilčene
      // naslove v telesu ("2. SPREMEMBA PLAČEVANJA PREMIJE").
      const odseki = s.odseki || (s.odseki = razdeliNaOdseke(s.kosi));
      for (const o of odseki) {
        if (!/^\d+\s*\.\s*[A-ZČŠŽ]/.test(o.besedilo)) continue;
        const oklepaj = o.besedilo.indexOf("(");
        const vOklepaju =
          oklepaj > 0 ? o.besedilo.slice(oklepaj).replace(/[()]/g, "") : "";
        const jeNavodilo = jeNavodiloVOklepaju(vOklepaju);
        const naslov = pocisti(
          jeNavodilo ? o.besedilo.slice(0, oklepaj) : o.besedilo
        );
        // Naslov je kratek; oštevilčena vprašanja ("1. IMATE OZIROMA VAM JE
        // BILA ...?") so povedi in ne razdelki.
        // Naslov je kratek; oštevilčene povedi v deklaraciji merijo 69 znakov
        // in več, pravi naslovi pa do 55 ("2. Izjava o davčnem rezidentstvu
        // skladno s FATCA in CRS").
        // Vprašaj iščemo v CELEM odseku: pri "3. IMATE ... STORITEV (PREGLED,
        // ...)?" stoji za oklepajem, ki ga odrežemo, in bi vprašanje obveljalo
        // za naslov razdelka.
        if (naslov.length > 60 || o.besedilo.includes("?")) continue;
        izhod.push({
          stran: s.stran,
          y: ((mere.visina - o.y) / mere.visina) * 100,
          naslov,
          opomba: jeNavodilo ? pocisti(vOklepaju) : null,
        });
      }

      for (const b of bloki) {
        const celo = pocisti(b.vrstice.map((v) => v.besedilo).join(" "));
        // Naslov razdelka se začne z veliko črko ali rimsko številko; tako
        // izpustimo oznake polj ob robu ("kraj in datum") in številko obrazca.
        if (!/^([IVX]+\.|[A-ZČŠŽ])/.test(celo) || celo.length < 4) continue;

        // Oklepaj je opomba le, kadar je navodilo. Drugod je del naslova
        // ("Opredelitev vaših (zavarovalčevih) potreb in zahtev").
        const oklepaj = celo.indexOf("(");
        const vOklepaju = oklepaj > 0 ? celo.slice(oklepaj).replace(/[()]/g, "") : "";
        const jeNavodilo = /izpolni|obvezn|le,? *če|velja/i.test(vOklepaju);
        const naslov = pocisti(jeNavodilo ? celo.slice(0, oklepaj) : celo);
        let opomba = jeNavodilo ? pocisti(vOklepaju) : null;

        // Navodilo je lahko tudi v telesu strani, ob začetku razdelka.
        if (!opomba) {
          const n = s.kosi.find(
            (k) =>
              k.x >= rob &&
              Math.abs(k.y - b.vrh) < 14 &&
              /^(izpolni|obvezn)/i.test(k.besedilo)
          );
          if (n) opomba = pocisti(n.besedilo);
        }

        izhod.push({
          stran: s.stran,
          y: ((mere.visina - b.vrh) / mere.visina) * 100,
          naslov,
          opomba: opomba || null,
        });
      }
    });
    return izhod.sort((a, b) => a.stran - b.stran || a.y - b.y);
  }

  // --- podrazdelki -------------------------------------------------------
  // Znotraj oštevilčenega razdelka obrazec sklope loči z manjšimi naslovi
  // ("Osebni dokument", "Naslov stalnega prebivališča", "Podatki o poškodbi:").
  // Od oznak polj jih ne loči ne lega ne velika začetnica - loči jih PISAVA:
  // naslovi so pisani z drugo, višjo pisavo kot oznake. To je edini znak, ki
  // drži na vseh preizkušenih obrazcih.
  const NAJMANJSI_PRIRASTEK_PISAVE = 0.8; // pt nad telesno pisavo
  const NAJVECJI_KOLICNIK_PISAVE = 2.2; // več je naslov obrazca, ne razdelka
  const DOPUST_ROBA_PODRAZDELKA = 3; // pt: naslov stoji levo od oznak polj
  const NAJVEC_ZNAKOV_PODRAZDELKA = 50;

  /** Najpogostejša višina pisave na strani - to je telo, ne naslovi. */
  function telesnaVisinaPisave(kosi) {
    const stevec = new Map();
    for (const k of kosi) {
      if (!k.visina) continue;
      const kljuc = k.visina.toFixed(1);
      stevec.set(kljuc, (stevec.get(kljuc) || 0) + 1);
    }
    let najboljsi = null;
    for (const [v, n] of stevec) {
      if (!najboljsi || n > najboljsi[1]) najboljsi = [Number(v), n];
    }
    return najboljsi ? najboljsi[0] : null;
  }

  /**
   * Naslovi sklopov znotraj razdelka. Vsakemu pripišemo tudi stolpec, ker
   * naslov v desnem stolpcu ("Naslov stalnega prebivališča") velja samo za
   * polja svojega stolpca.
   *
   * @param {Array} polja - polja s .pravokotnik in .stolpec (glej dolociStolpce)
   * @param {Map} meje - stran -> x meje med stolpcema
   */
  function najdiPodrazdelke(strani, mereStrani, polja, meje) {
    const izhod = [];
    strani.forEach((s) => {
      const mere = mereStrani[s.stran - 1];
      if (!mere) return;
      const telo = telesnaVisinaPisave(s.kosi);
      if (!telo) return;

      const naStrani = polja.filter((p) => p.stran === s.stran && p.pravokotnik);
      if (!naStrani.length) return;
      const meja = meje.get(s.stran);
      const stolpecOdseka = (o) => (meja != null && o.od >= meja ? 1 : 0);

      const odseki = s.odseki || (s.odseki = razdeliNaOdseke(s.kosi));

      // Levi rob vsakega stolpca: naslovi stojijo nanj, oznake polj so
      // zamaknjene nekaj točk desno.
      const robStolpca = new Map();
      odseki.forEach((o) => {
        const c = stolpecOdseka(o);
        if (!robStolpca.has(c) || o.od < robStolpca.get(c)) robStolpca.set(c, o.od);
      });

      for (const o of odseki) {
        if (!o.visina || o.visina < telo + NAJMANJSI_PRIRASTEK_PISAVE) continue;
        if (o.visina > telo * NAJVECJI_KOLICNIK_PISAVE) continue; // naslov obrazca
        const c = stolpecOdseka(o);
        if (o.od > robStolpca.get(c) + DOPUST_ROBA_PODRAZDELKA) continue;

        const naslov = pocisti(o.besedilo);
        if (naslov.length < 3 || naslov.length > NAJVEC_ZNAKOV_PODRAZDELKA) continue;
        if (naslov.includes("?")) continue;
        if (!/^([IVX]+\.|\d+\.|[A-ZČŠŽ])/.test(naslov)) continue;

        // Besedilo, ki leži V polju ali ob njem, je vsebina, ne naslov.
        const vPolju = naStrani.some((p) => {
          const r = p.pravokotnik;
          return (
            o.y > r.y - 2 &&
            o.y < r.y + r.height + 2 &&
            o.do > r.x &&
            o.od < r.x + r.width
          );
        });
        if (vPolju) continue;

        izhod.push({
          stran: s.stran,
          stolpec: c,
          y: ((mere.visina - o.y) / mere.visina) * 100,
          naslov: naslov.replace(/\s*:\s*$/, ""),
        });
      }
    });
    return izhod.sort((a, b) => a.stran - b.stran || a.y - b.y);
  }

  // Nekateri obrazci nimajo prave preslikave v Unicode in vrnejo kar bajte
  // kodne strani Windows-1250. Ti pristanejo v območju nadzornih znakov
  // U+0080..U+009F, kjer pravega besedila nikoli ni - zato jih smemo
  // preslikati nazaj. Brez tega se "dolžnik" izpiše kot "dol?nik".
  const WIN1250 = {
    0x80: "€", 0x82: "‚", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡",
    0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Ś", 0x8d: "Ť", 0x8e: "Ž",
    0x8f: "Ź", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•",
    0x96: "–", 0x97: "—", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "ś",
    0x9d: "ť", 0x9e: "ž", 0x9f: "ź",
  };

  /** Popravi znake, ki jih je PDF vrnil kot bajte Windows-1250. */
  function popraviZnake(niz) {
    if (!niz) return niz;
    return String(niz).replace(/[\u0080-\u009F]/g, (z) => WIN1250[z.charCodeAt(0)] || "");
  }

  // Obrazec je lahko postavljen v dva stolpca (levo osebni podatki, desno
  // naslovi). Brati ga je treba po stolpcih; branje po vrsticah skače sem in
  // tja in polja si ne sledijo tako kot na papirju.
  const NAJMANJSA_VRZEL_STOLPCA = 20; // pt prazne navpične proge med stolpcema
  const NAJMANJ_POLJ_V_STOLPCU = 3;

  /**
   * Razdeli polja strani v stolpce. Stolpca sta dva, kadar čez vso višino
   * strani teče prazna navpična proga, ki nobenega polja ne preseka.
   * Vsakemu polju pripiše .stolpec (0, 1, ...) in vrne mejo stolpcev po
   * straneh (Map stran -> x v točkah), da po istem rezu razvrstimo tudi
   * naslove razdelkov.
   */
  function dolociStolpce(polja) {
    const poStrani = new Map();
    const meje = new Map();
    polja.forEach((p) => {
      if (!p.pravokotnik) return;
      if (!poStrani.has(p.stran)) poStrani.set(p.stran, []);
      poStrani.get(p.stran).push(p);
    });

    for (const [stran, naStrani] of poStrani) {
      naStrani.forEach((p) => (p.stolpec = 0));
      const odseki = naStrani
        .map((p) => [p.pravokotnik.x, p.pravokotnik.x + p.pravokotnik.width])
        .sort((a, b) => a[0] - b[0]);

      // Poiščemo najširšo vrzel med vodoravnimi obsegi polj.
      let konec = odseki[0][1];
      let najvecja = 0;
      let meja = null;
      for (const [od, do_] of odseki) {
        if (od - konec > najvecja) {
          najvecja = od - konec;
          meja = konec + (od - konec) / 2;
        }
        konec = Math.max(konec, do_);
      }
      if (najvecja < NAJMANJSA_VRZEL_STOLPCA) continue;

      const levo = naStrani.filter((p) => p.pravokotnik.x < meja);
      const desno = naStrani.filter((p) => p.pravokotnik.x >= meja);
      if (levo.length < NAJMANJ_POLJ_V_STOLPCU || desno.length < NAJMANJ_POLJ_V_STOLPCU) {
        continue;
      }
      desno.forEach((p) => (p.stolpec = 1));
      meje.set(stran, meja);
    }
    return meje;
  }

  /** Ali je ime polja neuporabno ("Checkbox7") in naj raje vzamemo besedilo? */
  function imeJeNeuporabno(ime) {
    // "4", "5", "6" so v prilogah imena okenc - povedo prav toliko kot
    // "Checkbox7".
    return (
      /^(check ?box|text ?field|polje|field)\s*\d*$/i.test(ime) ||
      /^\d+$/.test(String(ime || "").trim())
    );
  }

  return {
    razdeliNaOdseke,
    najdiGlavoStolpca,
    najdiOznakoVrstice,
    oznaciPolja,
    najdiMestaPodpisov,
    zdruziVVrstice,
    zdruziVIzbire,
    najdiRazdelke,
    najdiPodrazdelke,
    dolociStolpce,
    popraviZnake,
    izberiOznako,
    pocistiNapis,
    imeJeNeuporabno,
  };
});
