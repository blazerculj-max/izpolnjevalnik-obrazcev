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
  const ROB_SEKCIJE = 45; // pt od levega roba: tam obrazec piše naslove razdelkov
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
          tekoci = { y: k.y, od: k.x, do: k.x + k.w, besedilo: k.besedilo };
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

  /** Besedilo, ki opisuje vrstico tega polja. */
  function najdiOznakoVrstice(odseki, polje, vsaPolja) {
    const r = polje.pravokotnik;
    const pas = pasVrstice(polje, vsaPolja);
    const vPasu = odseki.filter(
      (o) =>
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

    const cy = r.y + r.height / 2;

    /**
     * Oznaka polja stoji v NJEGOVI vrstici, ne vrstico više: pas je namenoma
     * širok zaradi večvrstičnih trditev, zato bi sicer vanj padel naslov
     * razdelka nad poljem. Zato najprej poiščemo najbližjo vrstico besedila,
     * v njej pa odsek, ki je vodoravno najbliže polju - ne najdaljšega.
     */
    const izberi = (kandidati, razdalja) => {
      if (!kandidati.length) return null;
      const najblizjaVrstica = Math.min(...kandidati.map((o) => Math.abs(o.y - cy)));
      const vVrstici = kandidati.filter(
        (o) => Math.abs(o.y - cy) - najblizjaVrstica < 6
      );
      const sidro = vVrstici.reduce((a, b) => (razdalja(b) < razdalja(a) ? b : a));
      // Večvrstične oznake nadaljujemo po istem stolpcu, a le v tem pasu.
      const stolpec = kandidati.filter((o) => Math.abs(o.od - sidro.od) < 25);
      let besedilo = zdruzi(stolpec);

      // Stolpčna oznaka ("IZ", "NA" v tabeli sprememb) sama zase ne pove, česa
      // se sprememba tiče. Pred njo zato postavimo besedilo z začetka vrstice.
      if (besedilo.length <= 3) {
        const zacetek = vVrstici.reduce((a, b) => (b.od < a.od ? b : a));
        if (zacetek !== sidro && zacetek.besedilo.length > 3) {
          besedilo = zacetek.besedilo + " — " + besedilo;
        }
      }
      return { besedilo, razdalja: razdalja(sidro) };
    };

    const levo = izberi(
      vPasu.filter((o) => o.do <= r.x + 2),
      (o) => r.x - o.do
    );
    const desno = izberi(
      vPasu.filter((o) => o.od >= r.x + r.width - 2),
      (o) => o.od - (r.x + r.width)
    );

    // Na obrazcih oznaka skoraj vedno stoji PRED poljem; desno je pogosto že
    // enota ali oznaka sosednjega polja. Zato ima leva stran prednost.
    if (levo && levo.besedilo) return levo.besedilo;
    return desno && desno.besedilo ? desno.besedilo : null;
  }

  /**
   * Vsakemu polju pripiše oznako iz besedila ob njem in glavo stolpca.
   * @returns {Map<string,{oznaka:string|null, glava:string|null}>}
   */
  function oznaciPolja(strani, polja) {
    const oznake = new Map();
    for (const polje of polja) {
      const stran = strani[polje.stran - 1];
      if (!stran || !polje.pravokotnik) continue;
      const r = polje.pravokotnik;
      const odseki = stran.odseki || razdeliNaOdseke(stran.kosi);
      stran.odseki = odseki;
      oznake.set(polje.ime, {
        oznaka: najdiOznakoVrstice(odseki, polje, polja),
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
  function sekcijaOb(kosi, y) {
    // Naslov razdelka je samostojna beseda ali dve z veliko začetnico
    // ("Zavarovalec", "Prejemnik računa"). Tako izločimo drobce stavkov,
    // ki po naključju stojijo ob robu ("(izpolniti le, če", "plačevanja").
    const JE_NASLOV = /^[A-ZČŠŽ][a-zčšž]+(\s[a-zčšž]+)?$/;
    const obRobu = kosi.filter((k) => k.x < ROB_SEKCIJE).sort((a, b) => b.y - a.y);
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
    return deli.join(" ");
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
    const cisto = pocisti(ime).replace(/[\s\-_]*\d+$/, "").replace(/[\s\-_]+$/, "");
    if (!napis) return cisto || pocisti(ime);
    if (imeJeNeuporabno(ime)) return napis;
    return napisJeOznaka(napis) ? napis : cisto || pocisti(ime);
  }

  /**
   * Je to res napis polja ali le kos stavka, med katerim polje stoji?
   * Obrazci s tekočim besedilom ("Podpisani/a* rojen/a dne ___") dajo ob polju
   * drobce povedi; take raje zavrnemo in obdržimo ime polja, ki je pri teh
   * obrazcih povedno ("Datum rojstva").
   */
  function napisJeOznaka(napis) {
    if (napis.length > 40) return false;
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

  /** Odveč ločila in presledki ob oznakah iz PDF-ja. */
  function pocisti(niz) {
    return String(niz || "")
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
          const r = sekcijaOb(kosi, okenca[0].pravokotnik.y);
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
      const bloki = [];
      s.kosi
        .filter((k) => k.x < ROB_SEKCIJE)
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
        const jeNavodilo = /izpolni|obvezn|le,? *če|velja|navedite/i.test(vOklepaju);
        const naslov = pocisti(
          jeNavodilo ? o.besedilo.slice(0, oklepaj) : o.besedilo
        );
        // Naslov je kratek; oštevilčena vprašanja ("1. IMATE OZIROMA VAM JE
        // BILA ...?") so povedi in ne razdelki.
        if (naslov.length > 45 || naslov.endsWith("?")) continue;
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
              k.x >= ROB_SEKCIJE &&
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

  /** Ali je ime polja neuporabno ("Checkbox7") in naj raje vzamemo besedilo? */
  function imeJeNeuporabno(ime) {
    return /^(check ?box|text ?field|polje|field)\s*\d*$/i.test(ime);
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
    popraviZnake,
    izberiOznako,
    pocistiNapis,
    imeJeNeuporabno,
  };
});
