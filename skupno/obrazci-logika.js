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
        if (!tekoci) tekoci = { y: k.y, od: k.x, do: k.x + k.w, deli: [k.besedilo] };
        else {
          tekoci.do = k.x + k.w;
          tekoci.deli.push(k.besedilo);
        }
      }
      if (tekoci) odseki.push(tekoci);
    }
    return odseki.map((o) => ({
      y: o.y,
      od: o.od,
      do: o.do,
      besedilo: o.deli.join(" ").replace(/\s+/g, " ").trim(),
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
        o.besedilo.length > 2 &&
        !GLAVE.test(o.besedilo)
    );

    const zdruzi = (izbrani) =>
      izbrani
        .sort((a, b) => b.y - a.y)
        .map((o) => o.besedilo)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    const istiStolpec = (kandidati, izhodiscni) =>
      kandidati.filter((o) => Math.abs(o.od - izhodiscni.od) < 25);

    const levo = vPasu.filter((o) => o.do <= r.x + 2);
    const desno = vPasu.filter((o) => o.od >= r.x + r.width - 2);
    const zLeve = levo.length
      ? zdruzi(istiStolpec(levo, levo.reduce((a, b) => (b.do > a.do ? b : a))))
      : "";
    const zDesne = desno.length
      ? zdruzi(istiStolpec(desno, desno.reduce((a, b) => (b.od < a.od ? b : a))))
      : "";

    // Katera stran ima besedilo natanko v vrstici kvadratka? Oznaka polja stoji
    // v isti vrstici; navpični napis ob robu obrazca je vedno malo zamaknjen.
    const cy = r.y + r.height / 2;
    const najblizje = (o) =>
      o.length ? Math.min(...o.map((x) => Math.abs(x.y - cy))) : Infinity;

    if (!zLeve) return zDesne || null;
    if (!zDesne) return zLeve;
    return najblizje(desno) < najblizje(levo) ? zDesne : zLeve;
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
        najdeni.push({
          naziv: t.replace(/\*/g, "").trim(),
          stran: s.stran,
          x: ((o.od + o.do) / 2 / mere.sirina) * 100,
          y: ((mere.visina - o.y + 24) / mere.visina) * 100,
          potrebujeSifro: /šifra|sifra/i.test(t),
          zaProdajnika: /prodajnik|zastopnik|posrednik/i.test(t),
        });
      }
    });
    return najdeni;
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

  /** Besedilo tik desno od okenca - njegova oznaka ("m", "fizična oseba"). */
  function oznakaDesno(kosi, r) {
    const cy = r.y + r.height / 2;
    const desni = kosi
      .filter((k) => Math.abs(k.y - cy) < 6 && k.x >= r.x + r.width - 2)
      .sort((a, b) => a.x - b.x)[0];
    if (!desni) return null;
    const vrzel = desni.x - (r.x + r.width);
    return vrzel <= NAJVEC_VRZEL_OZNAKE ? desni.besedilo : null;
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

  /** Oznaka ene možnosti: besedilo ob okencu, sicer glava stolpca, sicer vrednost. */
  function oznakaMoznosti(kosi, okence) {
    const r = okence.pravokotnik;
    return (
      oznakaDesno(kosi, r) ||
      najdiGlavoStolpca(kosi, r.x + r.width / 2, r.y + r.height / 2) ||
      String(okence.vklop || "").toUpperCase()
    );
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
        oznaka: oznakaMoznosti(kosi, o),
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
    imeJeNeuporabno,
  };
});
