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
    imeJeNeuporabno,
  };
});
