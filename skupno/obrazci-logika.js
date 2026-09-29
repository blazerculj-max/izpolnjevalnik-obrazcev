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
  // Pikčasta ali podčrtana črta, ki na obrazcu nadomešča vnosno polje.
  const JE_CRTA = /^[.·•‧…_\-\s]{3,}$/;
  // Okence je v nekaterih obrazcih natisnjeno z znakovno pisavo; iz PDF-ja
  // pride kot znak za zasebno rabo. Ni besedilo, le slika okenca.
  const JE_ZNAK = /^[\uE000-\uF8FF\s]+$/;
  const NAJVEC_ODMIK_GLAVE = 200; // glava stolpca stoji nad celo tabelo
  const NAJVEC_ODMIK_STOLPCA = 13; // pt razlike v x, da je glava nad tem poljem
  const PRIVZETI_PAS = 22; // pt navzgor/navzdol, če polje nima soseda
  const NAJVISJI_PAS = 30; // pt - višje od tega vrstica obrazca ne seže
  const GLAVE = /^(da|ne|potrebe|zahteve|opis|kritje|st|št)$/i;
  // Besedilo je oznaka okenca le, če stoji tik ob njem. Izmerjeno: pri
  // Ponudbi so oznake 1,5-4 pt od okenca, pri Opredelitvi pa je najbližje
  // besedilo desno že naslednji stolpec (9,8-29,3 pt).
  // Izmerjeno: pri Ponudbi 1,5-4 pt, pri Zahtevku ("Priključitev",
  // "Izključitev", "Sprememba ...") do 10,3 pt. Da pri Opredelitvi kljub
  // širšemu oknu ne pobere sosednjega stolpca, poskrbi pravilo o besedilu,
  // ki ga vidita dve okenci hkrati (glej oznakaMoznosti).
  const NAJVEC_VRZEL_OZNAKE = 14;
  // Predlog sam po sebi ni napis polja; dopolni ga beseda za poljem.
  const JE_PREDLOG = /^(ob|od|do|v|na|pri|za|z|s|k|po)$/i;
  const NAJVEC_ZAMIK_NAPISA_V_POLJU = 8; // pt od levega roba polja
  const DOPUST_ROBA_NAPISA = 4; // pt - napis sme segati malo čez levi rob
  const DELEZ_VRHA_POLJA = 0.45; // napis stoji v zgornjem delu polja
  const NAJVEC_VRZEL_MED_BESEDAMA = 8; // pt med besedama iste oznake
  // Nekateri obrazci pišejo naslove razdelkov v ozkem stolpcu ob levem robu,
  // drugi pa ne - pri teh se telo začne kar na skrajni levi. Meje zato ni
  // mogoče določiti s fiksno številko; izračunamo jo za vsako stran posebej.
  const NAJMANJSA_VRZEL_ROBA = 18; // pt med robnim stolpcem in telesom
  const NAJVEC_ZNAKOV_NASLOVA = 60; // daljše je poved, ne naslov razdelka
  const NAJVECJI_ROBNI_STOLPEC = 45; // pt - dlje od leve roba ni več rob
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
        // Pikčasta črta ni besedilo, ampak prostor za vpis. Brez tega se
        // napisa dveh rubrik iste vrstice zlepita v enega ("naslov
        // stalnega bivališča: ..... , davčna številka: .....").
        if (JE_CRTA.test(k.besedilo) || JE_ZNAK.test(k.besedilo)) {
          if (tekoci) odseki.push(tekoci);
          tekoci = null;
          continue;
        }
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
            kosi: [k],
          };
        } else {
          const locilo = k.x - tekoci.do >= VRZEL_PRESLEDKA ? " " : "";
          tekoci.besedilo += locilo + k.besedilo;
          tekoci.do = k.x + k.w;
          tekoci.kosi.push(k);
        }
      }
      if (tekoci) odseki.push(tekoci);
    }
    return odseki.map((o) => sestaviOdsek(o.kosi));
  }

  /** Iz koščkov ene vrstice sestavi odsek (besedilo in obseg). */
  function sestaviOdsek(kosi) {
    let besedilo = kosi[0].besedilo;
    let konec = kosi[0].x + kosi[0].w;
    for (let i = 1; i < kosi.length; i++) {
      const locilo = kosi[i].x - konec >= VRZEL_PRESLEDKA ? " " : "";
      besedilo += locilo + kosi[i].besedilo;
      konec = kosi[i].x + kosi[i].w;
    }
    return {
      y: kosi[0].y,
      od: kosi[0].x,
      do: konec,
      pisava: kosi[0].pisava,
      visina: kosi[0].visina,
      kosi,
      besedilo: besedilo.replace(/\s+/g, " ").trim(),
    };
  }

  /**
   * Odseke prereže tam, kjer se začne vnosno polje. Brez tega se napis ene
   * celice zlepi z napisom sosednje - pri Zahtevku "za nadomestilo za" in
   * "zavarovalna vsota" stojita 4,4 pt narazen in postaneta en napis, zato
   * okence dobi tuj privesek, polje ob njem pa ostane brez imena.
   */
  function razreziNaPoljih(odseki, polja, celice) {
    const okvirji = polja
      .filter((p) => p.pravokotnik)
      .map((p) => p.pravokotnik);
    // Celice, ki jih obrazec nariše, povedo, kje se ena rubrika konča in
    // druga začne. Predolge in prekratke poti niso celice.
    const robovi = (celice || []).filter(
      (r) => r.sirina > 40 && r.sirina < 560 && r.visina > 8 && r.visina < 200
    );
    const izhod = [];
    for (const o of odseki) {
      const meje = [
        ...okvirji
          .filter(
            (r) => o.y >= r.y - 2 && o.y <= r.y + r.height + 2
          )
          .map((r) => r.x),
        ...robovi
          .filter((r) => o.y >= r.y && o.y <= r.y + r.visina)
          .flatMap((r) => [r.x, r.x + r.sirina]),
      ]
        .filter((x) => x > o.od + 1 && x < o.do - 1)
        .sort((a, b) => a - b);
      if (!meje.length || !o.kosi || o.kosi.length < 2) {
        izhod.push(o);
        continue;
      }
      let del = [];
      let i = 0;
      for (const k of o.kosi) {
        while (i < meje.length && k.x >= meje[i]) {
          if (del.length) izhod.push(sestaviOdsek(del));
          del = [];
          i++;
        }
        del.push(k);
      }
      if (del.length) izhod.push(sestaviOdsek(del));
    }
    return izhod;
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

    // Nekateri obrazci napis natisnejo V polje, v njegov zgornji levi kot
    // ("RENTA", "DOBA IZPLAČEVANJA(LET)", "PREMIJA"). Tak napis je polju
    // bliže od česarkoli levo ali desno in je zato njegov.
    const vPolju = vPasu.find(
      (o) =>
        o.od >= r.x - DOPUST_ROBA_NAPISA &&
        o.od <= r.x + NAJVEC_ZAMIK_NAPISA_V_POLJU &&
        o.do <= r.x + r.width + 2 &&
        o.y >= r.y + r.height * DELEZ_VRHA_POLJA &&
        o.y <= r.y + r.height + 1
    );
    if (vPolju && napisJeOznaka(pocistiNapis(vPolju.besedilo))) {
      return vPolju.besedilo;
    }

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
        // Vrstica z dvopičjem je uvod v seznam ("... / fizioterapevtskega
        // zdravljenja:"), ne prvi del napisa pod njo.
        if (/:\s*$/.test(vStolpcu[j].besedilo)) break;
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
        do: Math.max(...stolpec.map((o) => o.do)),
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

    // Napis, ki je le predlog ("ob", "v"), sam ne pove ničesar; dopolni ga
    // beseda, ki stoji za poljem ("ob ___ uri" -> "ob uri").
    const dopolniKratkega = (l, d) => {
      const golo = pocisti(l.besedilo);
      if (!d || !JE_PREDLOG.test(golo)) return l.besedilo;
      const prva = pocisti(d.besedilo).split(/[\s,]+/)[0];
      if (!prva || !/^[a-zčšž]/.test(prva)) return l.besedilo;
      return golo + " " + prva;
    };

    if (!levo) return desno ? desno.besedilo : null;
    if (!desno) return levo.besedilo;

    // Pri okencih stoji napis po navadi DESNO od njih. Vzamemo ga, kadar je
    // cela poved in za njim v tej vrstici ni več nobenega polja - takrat
    // namreč nismo v stolpcu tabele, ampak pred svojim besedilom. Tako dobi
    // vsaka od treh izjav o politični izpostavljenosti svojo trditev,
    // tabela Opredelitve (kjer za napisom stoji še okence stolpca ZAHTEVE)
    // pa obdrži trditev na levi.
    if (
      (polje.tip === "CheckBox" || polje.tip === "RadioGroup") &&
      desno.besedilo.length > 25 &&
      !poljeDesnoOd(vsaPolja, polje, desno.do, cy)
    ) {
      return desno.besedilo;
    }

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
    if (!levoJeTuj && levo.vrzel <= 60) return dopolniKratkega(levo, desno);

    // Napis stoji pred poljem. Kadar je levi kandidat blizu, je to on - tudi
    // če je desni za las bližje: pri "datum_rojstva" stoji desno beseda
    // "kraj", ki je oznaka NASLEDNJEGA polja (razlika v oceni je bila 15
    // proti 16,8). Besedilo robnega stolpca je iz kandidatov že izločeno.
    return desno.ocena < levo.ocena
      ? desno.besedilo
      : dopolniKratkega(levo, desno);

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
      if (!stran.odsekiPoPoljih) {
        stran.odseki = stran.odseki || razdeliNaOdseke(stran.kosi);
        stran.odsekiPoPoljih = razreziNaPoljih(
          stran.odseki,
          polja.filter((p) => p.stran === polje.stran),
          stran.okvirji
        );
      }
      const odseki = stran.odsekiPoPoljih;
      const osnovna = najdiOznakoVrstice(
        odseki,
        polje,
        polja,
        stran,
        meje ? meje.get(polje.stran) : null
      );
      const zUvodom = dopolniZUvodom(osnovna, polje, stran, polja);
      oznake.set(polje.ime, {
        oznaka: zUvodom,
        // Vprašanje nad poljem je napis, tudi kadar je dolg.
        izUvoda: zUvodom !== osnovna,
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
   * Številka, razrezana na več okenc (IBAN: SI56 in nato 4 + 4 + 4 + 3
   * števke), dobi napis z mestom, ki ga posamezno okence zajema. Brez tega
   * so vsa okenca videti enaka in ni jasno, kam gre kateri del.
   */
  const NAJMANJ_DELOV_STEVILKE = 3;
  const NAJVEC_ZNAKOV_DELA = 6;

  function oznaciRazdeljenoStevilko(polja) {
    const vrstice = new Map();
    polja.forEach((p) => {
      if (p.tip !== "TextField" || !p.pravokotnik) return;
      const cy = Math.round((p.pravokotnik.y + p.pravokotnik.height / 2) / 3);
      const kljuc = `${p.stran}|${cy}`;
      if (!vrstice.has(kljuc)) vrstice.set(kljuc, []);
      vrstice.get(kljuc).push(p);
    });

    vrstice.forEach((vrsta) => {
      vrsta.sort((a, b) => a.pravokotnik.x - b.pravokotnik.x);
      let zacetek = 0;
      while (zacetek < vrsta.length) {
        let konec = zacetek;
        while (
          konec < vrsta.length &&
          vrsta[konec].najvec_znakov > 0 &&
          vrsta[konec].najvec_znakov <= NAJVEC_ZNAKOV_DELA
        ) {
          konec++;
        }
        const deli = vrsta.slice(zacetek, konec);
        if (deli.length >= NAJMANJ_DELOV_STEVILKE) {
          const osnova = deli[0].oznaka;
          let mesto = 1;
          deli.forEach((d) => {
            const zadnje = mesto + d.najvec_znakov - 1;
            d.oznaka = `${osnova} (${mesto}.-${zadnje}. števka)`;
            mesto = zadnje + 1;
          });
        }
        zacetek = konec > zacetek ? konec : zacetek + 1;
      }
    });
  }

  /**
   * Polje brez napisa ali samo s predlogom ("od", "do") dobi vprašanje,
   * ki stoji nad njim: "Čas odsotnosti od dela ...: od __ do __" in
   * "Točen opis nezgodnega dogodka ...?" z okvirjem pod vprašanjem.
   */
  function dopolniZUvodom(oznaka, polje, stran, polja) {
    if (polje.tip !== "TextField") return oznaka;
    const t = String(oznaka || "").trim();
    const besede = t.split(/\s+/).filter(Boolean);
    const samPredlog = besede.length > 0 && besede.every((b) => JE_PREDLOG.test(b));
    if (t && !samPredlog) return oznaka;
    // "od __ do __" je ena vrstica z enim vprašanjem; da se dolg uvod ne
    // ponovi dvakrat, ga nosi prvo polje v vrstici, drugo pa ostane "do".
    if (samPredlog && polje.pravokotnik) {
      const cy = polje.pravokotnik.y + polje.pravokotnik.height / 2;
      const jeLevejse = (polja || []).some(
        (d) =>
          d !== polje &&
          d.stran === polje.stran &&
          d.pravokotnik &&
          d.pravokotnik.x < polje.pravokotnik.x &&
          Math.abs(d.pravokotnik.y + d.pravokotnik.height / 2 - cy) < 6
      );
      if (jeLevejse) return oznaka;
    }
    const uvod = uvodNadPoljem(stran, polje, polja);
    if (!uvod) return oznaka;
    return samPredlog ? `${uvod} ${besede[0].toLowerCase()}` : uvod;
  }

  /** Vprašanje ali uvod, ki stoji tik nad poljem in se konča z "?" ali ":". */
  function uvodNadPoljem(stran, polje, polja) {
    if (!stran || !polje.pravokotnik) return "";
    const odseki = stran.odseki || (stran.odseki = razdeliNaOdseke(stran.kosi));
    const r = polje.pravokotnik;
    // Napis nad visokim okvirjem ima osnovnico lahko malenkost NIŽE od
    // njegovega zgornjega roba, zato dopustimo nekaj točk razlike.
    const vrh = r.y + r.height - DOPUST_ROBA_NAPISA;
    const nad = odseki
      .filter(
        (o) =>
          o.y > vrh &&
          o.y - vrh < NAJVEC_ODMIK_VPRASANJA &&
          o.od < r.x + r.width &&
          o.do > r.x - NAJVEC_VRZEL_DO_POLJA
      )
      .sort((a, b) => a.y - b.y);
    if (!nad.length) return "";
    const vrstica = nad[0];
    // Kar stoji v isti vrstici kot kakšno drugo polje, je napis TISTEGA polja.
    const zasedena = (polja || []).some(
      (d) =>
        d !== polje &&
        d.stran === polje.stran &&
        d.pravokotnik &&
        Math.abs(d.pravokotnik.y + d.pravokotnik.height / 2 - vrstica.y) < 6
    );
    if (zasedena) return "";
    // Dvopičje preverimo na surovem besedilu - pocisti ga odreže.
    if (!/[?:]\s*$/.test(vrstica.besedilo)) return "";
    return pocisti(vrstica.besedilo);
  }

  /**
   * Mesta za podpise iz napisov na obrazcu ("PODPIS ZAVAROVALCA").
   * Upoštevamo samo kratke napise - dolgi odstavki, ki omenjajo podpis, niso
   * mesta za podpis. Vrne položaje v odstotkih strani (izhodišče zgoraj levo).
   */
  // "ime in priimek ter podpis zakonitega zastopnika" meri 47 znakov, zato je
  // meja za odstavek nekoliko višja od najdaljšega znanega napisa.
  const NAJVEC_ZNAKOV_PODPISA = 60;
  const VRZEL_VRSTICE_TABELE = 4; // pt - zaokroževanje y v vrstico tabele
  const NAJMANJSA_SIRINA_PODPISA = 25; // pt - ožje od tega ni celica za podpis

  /**
   * Napis mesta za podpis je pogosto prelomljen ("ime in priimek, šifra in
   * podpis" / "predstavnika zavarovalnice"). Nadaljevanje stoji tik pod njim,
   * v istem stolpcu in z malo začetnico.
   */
  function nadaljevanjeNapisa(odseki, napis) {
    const pod = odseki.find(
      (o) =>
        o !== napis &&
        napis.y - o.y > 2 &&
        napis.y - o.y < 12 &&
        Math.abs(o.od - napis.od) < 25 &&
        /^[a-zčšž]/.test(o.besedilo)
    );
    return pod || null;
  }

  /**
   * "Podpis" kot naslov stolpca v tabeli: podpisati se ne da v naslov, ampak
   * v vsako vrstico posebej. Vrstice preberemo iz polj tabele - na Zahtevku
   * ima stran 4 osem vrstic (štiri zavarovane osebe in njihovi zakoniti
   * zastopniki), stran 5 prav tako. Celice tega stolpca obrazec ne nariše in
   * zanje nima polj, zato jih sestavimo iz desnega roba vrstice in roba
   * strani.
   */
  function podpisiVVrsticah(napis, stran, polja, mere) {
    const naStrani = (polja || []).filter(
      (p) => p.stran === stran.stran && p.pravokotnik
    );
    if (!naStrani.length) return [];
    const odseki = stran.odseki || (stran.odseki = razdeliNaOdseke(stran.kosi));
    const desniRob = Math.max(...odseki.map((o) => o.do));
    if (!(desniRob > napis.do)) return [];

    const vrstice = new Map();
    naStrani.forEach((p) => {
      const r = p.pravokotnik;
      if (r.y + r.height > napis.y) return; // samo pod naslovom stolpca
      if (r.x >= napis.od) return; // samo levo od stolpca s podpisi
      const kljuc = Math.round(r.y / VRZEL_VRSTICE_TABELE);
      const v = vrstice.get(kljuc) || { y: r.y, visina: r.height, desno: 0, polj: 0 };
      v.y = Math.min(v.y, r.y);
      v.visina = Math.max(v.visina, r.height);
      v.desno = Math.max(v.desno, r.x + r.width);
      v.polj++;
      vrstice.set(kljuc, v);
    });

    const vse = [...vrstice.values()]
      .filter((v) => v.polj >= 2)
      .sort((a, b) => b.y - a.y);
    if (!vse.length) return [];

    // Tabela se konča, kjer vrstice nehajo teči druga za drugo.
    const vTabeli = [vse[0]];
    for (let i = 1; i < vse.length; i++) {
      const prej = vTabeli[vTabeli.length - 1];
      if (prej.y - (vse[i].y + vse[i].visina) > prej.visina) break;
      vTabeli.push(vse[i]);
    }

    // Stolpec s podpisi ima v vseh vrsticah isti levi rob: tam, kjer se
    // konča najdaljša vrstica. Vrstice zakonitega zastopnika imajo namreč
    // manj polj in bi sicer vsaka dobila svoj, preširok okvir.
    const od = Math.max(...vTabeli.map((v) => v.desno)) + 2;
    if (desniRob - od < NAJMANJSA_SIRINA_PODPISA) return [];

    return vTabeli
      .map((v) => {
        const sredina = (od + desniRob) / 2;
        // Vrstico poimenuje napis na njenem skrajnem levem robu
        // ("Zavarovana oseba", "Zakoniti zastopnik").
        const oznaka = odseki
          .filter((o) => o.y >= v.y && o.y <= v.y + v.visina && o.do < napis.od)
          .sort((a, b) => a.od - b.od)[0];
        return {
          naziv: pocisti("Podpis" + (oznaka ? " — " + oznaka.besedilo : "")),
          stran: stran.stran,
          potrebujeSifro: false,
          potrebujeIme: false,
          zaProdajnika: false,
          x: (sredina / mere.sirina) * 100,
          y: ((mere.visina - (v.y + v.visina / 2)) / mere.visina) * 100,
          okvir: {
            x: (od / mere.sirina) * 100,
            y: ((mere.visina - (v.y + v.visina)) / mere.visina) * 100,
            sirina: ((desniRob - od) / mere.sirina) * 100,
            visina: (v.visina / mere.visina) * 100,
          },
          sifra: null,
          ime: null,
          vrstice: null,
          zImenom: null,
          zImenomInSifro: null,
          najvecSirina: ((desniRob - od) / mere.sirina) * 100,
          najvecVisina: (v.visina / mere.visina) * 100,
        };
      });
  }

  function najdiMestaPodpisov(strani, mereStrani, polja) {
    const najdeni = [];
    strani.forEach((s) => {
      const mere = mereStrani[s.stran - 1];
      if (!mere) return;
      const odseki = s.odseki || razdeliNaOdseke(s.kosi);
      s.odseki = odseki;
      for (const o of odseki) {
        const t = o.besedilo;
        if (!/\bpodpis\b/i.test(t)) continue;
        if (t.length > NAJVEC_ZNAKOV_PODPISA) continue; // odstavek, ne napis polja
        if (/\bs podpisom\b|podpisane|podpisani/i.test(t)) continue;

        const okvir = najdiOkvirNapisa(s.okvirji, o);
        // Sam "Podpis" brez okvira je naslov stolpca tabele; mesta so v
        // njenih vrsticah.
        if (!okvir && /^podpis$/i.test(t.trim())) {
          const vVrsticah = podpisiVVrsticah(o, s, polja, mere);
          if (vVrsticah.length >= 2) {
            najdeni.push(...vVrsticah);
            continue;
          }
        }
        const nadaljevanje = nadaljevanjeNapisa(odseki, o);
        const naziv = popraviPomanjsaneVerzalke(
          pocisti(t + " " + (nadaljevanje ? nadaljevanje.besedilo : "")).replace(
            /\*/g,
            ""
          )
        );
        const potrebujeSifro = /šifra|sifra/i.test(t);
        najdeni.push({
          naziv,
          stran: s.stran,
          potrebujeSifro,
          // "ime in priimek ter podpis zavarovane osebe": v okvir sodi tudi
          // izpisano ime. Kjer napis zahteva oboje ("ime in priimek, šifra
          // in podpis"), gre šifra v vrstico tik pod ime.
          potrebujeIme: /ime in priimek/i.test(naziv),
          zaProdajnika: /prodajnik|zastopnik|posrednik/i.test(t),
          ...mestoVOkviru(o, okvir, mere, nadaljevanje ? nadaljevanje.y : o.y),
        });
      }
    });
    // Na isti strani sta lahko dve mesti z enakim nazivom (dve zavarovani
    // osebi v isti vrstici). Da ju je v seznamu mogoče ločiti, ju oštevilčimo
    // po vrsti z leve proti desni.
    const poNazivu = new Map();
    najdeni.forEach((p) => {
      const k = p.stran + "|" + p.naziv;
      if (!poNazivu.has(k)) poNazivu.set(k, []);
      poNazivu.get(k).push(p);
    });
    for (const skupina of poNazivu.values()) {
      if (skupina.length < 2) continue;
      skupina
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .forEach((p, i) => {
          p.naziv += ` (${i + 1}.)`;
        });
    }
    return najdeni;
  }

  /**
   * Nekateri obrazci pišejo z zmanjšanimi verzalkami, ki jih PDF vrne kot
   * velike črke sredi besede ("pooBlaŠčenca"). Kratice (ZDA, EUR) pustimo.
   */
  function popraviPomanjsaneVerzalke(niz) {
    return String(niz || "")
      .split(" ")
      .map((b) => (/^[a-zčšž].*[A-ZČŠŽ]/.test(b) ? b.toLowerCase() : b))
      .join(" ");
  }

  /**
   * Polja, ki ležijo v okviru za podpis, označi z .vPodpisu. To so vnosna
   * polja, ki jih obrazec predvidi za ime, šifro in podpis - v spletnem
   * obrazcu nimajo kaj početi, ker jih pokrije narisan podpis.
   */
  function oznaciPoljaVPodpisih(polja, podpisi) {
    const zOkvirjem = (podpisi || []).filter((p) => p.okvir);
    if (!zOkvirjem.length) return;
    polja.forEach((p) => {
      if (!p.polozaj) return;
      const cx = p.polozaj.x + p.polozaj.sirina / 2;
      const cy = p.polozaj.y + p.polozaj.visina / 2;
      p.vPodpisu = zOkvirjem.some(
        (q) =>
          q.stran === p.stran &&
          cx >= q.okvir.x &&
          cx <= q.okvir.x + q.okvir.sirina &&
          cy >= q.okvir.y &&
          cy <= q.okvir.y + q.okvir.visina
      );
    });
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
  function mestoVOkviru(napis, okvir, mere, dnoNapisa) {
    const vOdstotkihX = (x) => (x / mere.sirina) * 100;
    const vOdstotkihY = (y) => ((mere.visina - y) / mere.visina) * 100;

    if (!okvir) {
      return {
        x: vOdstotkihX((napis.od + napis.do) / 2),
        y: vOdstotkihY(napis.y - 24),
        okvir: null,
        sifra: null,
        ime: null,
        vrstice: null,
        zImenom: null,
        zImenomInSifro: null,
        najvecSirina: 22,
        najvecVisina: null,
      };
    }

    const rob = 4;
    const prostor = napis.y - okvir.y - rob; // višina pod napisom, v točkah

    // Kadar v okvir sodi tudi izpisano ime, si s podpisom deli prostor:
    // ime v vrstici tik pod napisom, podpis pod njim.
    const dno = dnoNapisa === undefined ? napis.y : dnoNapisa;
    // 10 pt pod zadnjo vrstico napisa: strešica na Ž se pri 9 pt že dotakne
    // napisa, kadar je ta prelomljen čez dve vrstici.
    const vrsticaImena = dno - 10;
    // Okvir lahko sprejme več vpisanih vrstic (ime, pod njim šifra).
    const VRSTICA = 8; // pt med vpisanima vrsticama
    const vrstice = [0, 1].map((i) => ({
      x: vOdstotkihX(okvir.x + rob),
      y: vOdstotkihY(vrsticaImena - i * VRSTICA),
    }));
    // Prostor, ki podpisu ostane pod n vpisanimi vrsticami. Pod 9 pt podpis
    // ni več berljiv, zato mu toliko pustimo, tudi če sega čez rob okvira -
    // pod njim je na obrazcu prazen prostor.
    const prostorPod = (n) => {
      const dnoPodpisa = okvir.y + 2; // pod podpisom rob ni potreben
      const visina = Math.max(vrsticaImena - (n - 1) * VRSTICA - 3 - dnoPodpisa, 9);
      return {
        y: vOdstotkihY(dnoPodpisa + visina / 2),
        najvecVisina: (visina / mere.visina) * 100,
      };
    };
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
      // Vpisane vrstice pod napisom, poravnane na levi rob okvira: prva je
      // ime in priimek, druga (kjer jo obrazec zahteva) šifra.
      vrstice,
      ime: vrstice[0],
      // Podpis, kadar je nad njim ena oz. dve vpisani vrstici.
      zImenom: prostorPod(1),
      zImenomInSifro: prostorPod(2),
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
  /** Ali v tej vrstici za danim x stoji še kakšno polje? (stolpec tabele) */
  function poljeDesnoOd(vsaPolja, polje, x, cy) {
    return vsaPolja.some(
      (d) =>
        d !== polje &&
        d.stran === polje.stran &&
        d.pravokotnik &&
        d.pravokotnik.x >= x &&
        Math.abs(d.pravokotnik.y + d.pravokotnik.height / 2 - cy) < 10
    );
  }

  /** Prvi kos besedila desno od okenca v isti vrstici (brez omejitve vrzeli). */
  function prviDesno(kosi, r, mejaDesno) {
    const cy = r.y + r.height / 2;
    return (
      kosi
        .filter(
          (k) =>
            Math.abs(k.y - cy) < 6 && k.x >= r.x + r.width - 2 && k.x < mejaDesno
        )
        .sort((a, b) => a.x - b.x)[0] || null
    );
  }

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
      // Besede oznake so skupaj (izmerjeno do 4 pt); večja vrzel pomeni, da
      // se je začelo nekaj drugega - pri Zahtevku stoji 14 pt za okencem
      // "Ne" cel odstavek o politični izpostavljenosti.
      if (vrzel > NAJVEC_VRZEL_MED_BESEDAMA) break;
      besedilo += (vrzel >= VRZEL_PRESLEDKA ? " " : "") + vrsta[i].besedilo;
      konec = vrsta[i].x + vrsta[i].w;
    }
    // "moški," in "ostalo (navedite): ......" sta na obrazcu del stavka;
    // kot napis gumba pa je pravilno le "moški" oziroma "ostalo (navedite)".
    return besedilo.replace(/[\s.·•‧…_:,;-]+$/, "").trim() || null;
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

    // Besedilo, ki ga v svoji vrstici vidi tudi katero DRUGO okence iste
    // izbire, ni oznaka možnosti, ampak vsebina sosednjega stolpca: pri
    // Opredelitvi stoji ime produkta desno od obeh okenc (POTREBE in
    // ZAHTEVE) in bi sicer postalo oznaka tistega, ki mu je bližje.
    const moj = prviDesno(stran.kosi, r, mejaDesno);
    const deljeno =
      moj &&
      vsaOkenca.some(
        (o) => o !== okence && o.pravokotnik && prviDesno(stran.kosi, o.pravokotnik, Infinity) === moj
      );

    const obOkencu = deljeno ? null : oznakaOkenca(stran.kosi, r, mejaDesno);
    if (obOkencu) return { oznaka: obOkencu, izGlave: false };

    const glava = najdiGlavoStolpca(stran.kosi, r.x + r.width / 2, cy);
    if (glava) return { oznaka: glava, izGlave: true };

    return { oznaka: String(okence.vklop || "").toUpperCase(), izGlave: false };
  }

  /**
   * Naslov razdelka ob levem robu strani ("Zavarovalec", "Zavarovanec").
   * Po njem ločimo sicer enaka vprašanja, ki se na obrazcu ponovijo za več oseb.
   */
  function sekcijaOb(stran, y) {
    const rob = robSekcije(stran);
    if (rob === null) return null;
    // Naslov razdelka je samostojna beseda ali dve z veliko začetnico
    // ("Zavarovalec", "Prejemnik računa"). Tako izločimo drobce stavkov,
    // ki po naključju stojijo ob robu ("(izpolniti le, če", "plačevanja").
    const JE_NASLOV = /^[A-ZČŠŽ][a-zčšž]+(\s[a-zčšž]+)?$/;
    const odseki = stran.odseki || (stran.odseki = razdeliNaOdseke(stran.kosi));
    const obRobu = odseki
      .filter((o) => o.od < rob)
      .map((o) => ({ y: o.y, besedilo: o.besedilo }))
      .sort((a, b) => b.y - a.y);
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
    // "uri, v kraju:" je rep prejšnje rubrike in začetek te; za napis polja
    // velja zadnji del, prejšnji pa pripada polju pred njim.
    const celo = pocisti(niz);
    const zaVejico = /^[a-zčšž]+,\s+/.test(celo)
      ? celo.slice(celo.indexOf(",") + 1)
      : celo;
    const t = pocisti(zaVejico)
      // Znak za valuto je natisnjen v celici in ni del napisa: "doba €
      // izplačevanja(let)" je "doba izplačevanja(let)".
      .replace(/(^|\s)€(\s|$)/g, "$1")
      .replace(/\s+([.,;:!?])/g, "$1")
      .replace(/\s*\/\s*/g, " / ");
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  }

  /**
   * Prikazna oznaka polja. Napis z obrazca je skoraj vedno boljši od imena
   * polja ("datum začetka" proti "Začetek1"), a le kadar je kratek - dolgi
   * napisi so pojasnila in sodijo pod polje, ne v naslov.
   */
  function izberiOznako(ime, izPdf, tip) {
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
    // Pri okencu je besedilo ob njem sama trditev ("Izključitev dodatnega
    // zavarovanja za primer brezposelnosti") in je pravilno, tudi kadar je
    // daljše od napisa nad vnosnim poljem.
    if (
      (tip === "CheckBox" || tip === "RadioGroup") &&
      napis.length <= NAJVEC_ZNAKOV_TRDITVE &&
      !napis.includes("*")
    ) {
      return napis;
    }
    // Vprašanje je vedno napis polja, tudi dolgo: "Ali je bil dogodek
    // prijavljen policiji in katera policijska postaja ga je obravnavala?"
    if (jeVprasanje(napis)) return napis;
    return napisJeOznaka(napis) ? napis : cisto || pocisti(ime);
  }

  /**
   * Cela poved z vprašajem - vprašanje obrazca, ki mu polje odgovarja.
   * Vprašanja v vprašalniku o zdravstvenem stanju merijo do 170 znakov in
   * povedo bistveno več kot ime polja ("Bolezen", "NE prom.nesreča").
   */
  const NAJVEC_ZNAKOV_VPRASANJA = 200;
  function jeVprasanje(napis) {
    const t = String(napis || "").trim();
    return t.endsWith("?") && t.length <= NAJVEC_ZNAKOV_VPRASANJA;
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
  const NAJVEC_ZNAKOV_TRDITVE = 200; // trditev ob okencu je lahko cela poved
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
    // Naštevanje je kratko, a ima veliko besed ("upravičenec za inv, dno,
    // nbd, zio, rento" jih ima sedem v 39 znakih); poved je daljša.
    const meja = napis.length <= 45 && napis.includes(",") ? 8 : 5;
    if (besede.length > meja) return false;
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
  /**
   * Je ta vrstica oštevilčen naslov razdelka ("2. SPREMEMBA PLAČEVANJA
   * PREMIJE")? Oštevilčena vprašanja v vprašalniku ("1. IMATE OZIROMA VAM
   * JE BILA ...?") to niso: so predolga in so vprašanja.
   */
  function jeStevilcenNaslov(besedilo) {
    const t = String(besedilo || "");
    if (!/^\d+\s*\.\s*[A-ZČŠŽ]/.test(t) || t.includes("?")) return false;
    const oklepaj = t.indexOf("(");
    const vOklepaju = oklepaj > 0 ? t.slice(oklepaj).replace(/[()]/g, "") : "";
    const naslov = pocisti(
      jeNavodiloVOklepaju(vOklepaju) ? t.slice(0, oklepaj) : t
    );
    return naslov.length > 0 && naslov.length <= NAJVEC_ZNAKOV_NASLOVA;
  }

  /**
   * Del odseka, ki še stoji v robnem stolpcu.
   * Režemo le tam, kjer se besedilo telesa RES začne - z vrzeljo za mejo.
   * Brez tega bi prerezali besedo, ki jo je pdf.js razbil na koščke in
   * sega čez mejo ("poda" + "nih").
   */
  const VRZEL_ZA_ROBOM = 3; // pt
  function obreziOdsek(odsek, meja) {
    const kosi = odsek.kosi || [];
    for (let i = 1; i < kosi.length; i++) {
      const vrzel = kosi[i].x - (kosi[i - 1].x + kosi[i - 1].w);
      if (kosi[i].x >= meja && vrzel >= VRZEL_ZA_ROBOM)
        return sestaviOdsek(kosi.slice(0, i));
    }
    return odsek;
  }

  function robSekcije(stran) {
    if (stran.__rob !== undefined) return stran.__rob;
    // Rob merimo po ZAČETKIH VRSTIC, ne po posameznih koščkih besedila.
    // pdf.js isto vrstico razreže različno v brskalniku in na strežniku
    // ("ASNI NASLOV ZA OBVE" je enkrat en košček, drugič štirje), zato bi
    // šteti koščke pomenilo, da vsako okolje najde drug rob in druge
    // razdelke. Začetki vrstic so v obeh okoljih isti.
    const odseki = stran.odseki || (stran.odseki = razdeliNaOdseke(stran.kosi));
    let rob = null;

    // Stran svoje razdelke oznani na en način: ali z oštevilčenimi naslovi
    // v telesu ali z naslovi ob robu. Kjer so oštevilčeni naslovi, je levi
    // stolpec stolpec oznak polj ("Podpisani/a", "IME/PRIIMEK"), ne
    // razdelkov, in ga ne smemo brati kot rob.
    const imaStevilcene = odseki.some((o) => jeStevilcenNaslov(o.besedilo));

    if (odseki.length && !imaStevilcene) {
      const zacetki = odseki.map((o) => o.od);
      const mediana = [...zacetki].sort((a, b) => a - b)[
        Math.floor(zacetki.length / 2)
      ];
      // Levi robovi vrstic v levi polovici strani, brez ponovitev.
      const robovi = [...new Set(zacetki.map((x) => Math.round(x)))]
        .filter((x) => x <= mediana)
        .sort((a, b) => a - b);

      // Robni stolpec od telesa loči največja vrzel med temi robovi.
      // Ob enako velikih vrzelih vzamemo NAJBOLJ DESNO: pri Opredelitvi sta
      // dve po 19 pt (18->37 in 38->57), prava meja pa je tista ob telesu -
      // sicer bi robni stolpec prerezali na pol in izgubili pol naslova.
      // Iščemo le vrzel, ki se začne ob SKRAJNEM levem robu: robni stolpec
      // je ozek, vrzeli globlje v telesu pa so lahko še večje (pri Ponudbi
      // 58 pt sredi strani) in bi meja pristala sredi obrazca.
      let najvecja = 0;
      let mejaPri = null;
      for (let i = 1; i < robovi.length; i++) {
        if (robovi[i - 1] > robovi[0] + NAJVECJI_ROBNI_STOLPEC) break;
        const vrzel = robovi[i] - robovi[i - 1];
        if (vrzel >= najvecja) {
          najvecja = vrzel;
          mejaPri = robovi[i - 1] + vrzel / 2;
        }
      }

      const vPasu = odseki.filter((o) => o.od < mejaPri).length;
      if (
        najvecja >= NAJMANJSA_VRZEL_ROBA &&
        vPasu / odseki.length <= NAJVEC_DELEZ_ROBA
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
    return (
      zlepiPrelomljene(String(niz || ""))
        // Okenca so v obrazcu natisnjena z znakovno pisavo (Wingdings) in
        // pridejo iz PDF-ja kot znaki za zasebno rabo; v napisu nimajo kaj
        // iskati.
        .replace(/[\uE000-\uF8FF]/g, " ")
    )
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
        (p.tip === "CheckBox" || p.tip === "RadioGroup") &&
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
      const moznosti = okenca.map((o) => {
        const najdeno = oznakaMoznosti(stran, o, okenca);
        return {
          vklop: o.vklop,
          oznaka: najdeno.oznaka,
          izGlave: najdeno.izGlave,
          polozaj: o.polozaj,
        };
      });
      // Možnosti, poimenovane po GLAVI stolpca (POTREBE / ZAHTEVE), pomenijo
      // tabelo: ista vrstica ima okenca v več stolpcih, odgovor pa je en
      // sam. Kjer je vsaka možnost poimenovana po besedilu tik ob okencu, je
      // to samostojno vprašanje in ga s sosedom ne smemo zliti.
      const izGlave = moznosti.every((m) => m.izGlave);

      // Vprašanje: ime polja, kadar kaj pove ("Spol", "Zavarovalna vsota").
      // Pri obrazcih z imeni tipa "Checkbox7" vzamemo besedilo vrstice.
      let izVrstice = pocisti(polje.oznaka_iz_pdf);
      // Kadar v vrstici okenc ni ničesar, stoji vprašanje NAD njimi
      // ("Soglašam, da ... " in pod tem da / ne).
      if (!izVrstice) izVrstice = vprasanjeNadOkenci(stran, okenca);
      const jeMoznost = moznosti.some((m) => jeIsto(m.oznaka, izVrstice));
      const imeJePovedno = !imeJeNeuporabno(polje.ime);
      // "Spol1" in "Spol2" sta isti vprašanji za drugo osebo - zaporedna
      // številka pove le to, kar že pove naslov razdelka.
      const imeBrezStevilke = pocisti(polje.ime).replace(/\s*\d+$/, "");
      // Strojno ime ("sam-izbira-4-1") ne pove nič; takrat naj govorijo
      // same možnosti, vprašanja pa ni.
      const imeJeStrojno = /^[a-zčšž0-9]+([_\-=.][a-zčšž0-9]*)+$/i.test(polje.ime);
      // Vprašanje z obrazca ("Ali se je nezgoda zgodila v prometni
      // nesreči?") pove več kot ime polja ("NE prom.nesreča").
      const vprasanje = jeVprasanje(izVrstice)
        ? izVrstice
        : imeJeStrojno
        ? !jeMoznost && izVrstice && stevBesed(izVrstice) >= 2 && napisJeOznaka(izVrstice)
          ? izVrstice
          : null
        : imeJePovedno || !izVrstice || jeMoznost
          ? imeBrezStevilke
          : izVrstice;

      // Pojasnilo dodamo le, če je cel stavek - kratki drobci ob polju so
      // pogosto oznaka SOSEDNJEGA polja in bi zavajali.
      const pojasnilo =
        izVrstice &&
        !jeMoznost &&
        vprasanje &&
        !jeIsto(izVrstice, vprasanje) &&
        izVrstice.length > 20
          ? izVrstice
          : null;

      const kljuc = moznosti.map((m) => m.oznaka).join("|");
      const y = polje.polozaj ? polje.polozaj.y : 0;
      // Dve enaki izbiri v isti vrstici sta en odgovor le, kadar sta v istem
      // stolpcu strani (POTREBE in ZAHTEVE pri Opredelitvi). Vprašanji v
      // levem in desnem stolpcu strani sta dve različni vprašanji - pri
      // Zahtevku stojita izjavi 1 in 2 o politični izpostavljenosti v isti
      // vrstici, a vsaka v svojem stolpcu.
      const obstojeca = skupine.find(
        (s) =>
          s.stran === polje.stran &&
          Math.abs(s.y - y) < 0.6 &&
          s.kljuc === kljuc &&
          s.stolpec === (polje.stolpec ?? 0) &&
          s.izGlave &&
          izGlave
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
        stolpec: polje.stolpec ?? 0,
        izGlave,
        polja: [polje.ime],
        oznaka: vprasanje,
        dodatno: pojasnilo,
        razdelek: (() => {
          const r = sekcijaOb(stran, okenca[0].pravokotnik.y);
          // Razdelek, ki le ponovi vprašanje, ne pove ničesar.
          if (!r || !vprasanje || jeIsto(r, vprasanje)) return null;
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
        // Naslov razdelka, iz katerega je izbira; pod imenom "razdelek" ga
        // pozneje povozi zaporedna številka razdelka (glej obrazci-pdf.js).
        razdelekNaslov: s.razdelek,
        polja: s.polja,
        // Položaj okenca potrebuje vmesnik, da ve, katera vrstica polj
        // pripada kateri možnosti.
        moznosti: s.moznosti.map((m) => ({
          vklop: m.vklop,
          oznaka: m.oznaka,
          polozaj: m.polozaj,
        })),
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
      // Tudi blok ob robu sestavimo iz CELIH VRSTIC, ne iz koščkov: sicer
      // "ZAČASNI NASLOV ZA OBVEŠČANJE" v brskalniku razpade na "ZA Č ASNI
      // NASLOV ZA OBVE" (glej robSekcije).
      const bloki = [];
      (rob === null ? [] : s.odseki || (s.odseki = razdeliNaOdseke(s.kosi)))
        .filter((o) => o.od < rob)
        // Vrstica naslova ob robu se lahko zlepi z besedilom telesa, kadar
        // ju loči le nekaj točk ("zavarovalca" + prva vrstica izjave).
        // Obdržimo samo tisto, kar leži v robnem stolpcu.
        .map((o) => (o.do <= rob ? o : obreziOdsek(o, rob)))
        .filter(Boolean)
        .sort((a, b) => b.y - a.y)
        .forEach((o) => {
          const zadnji = bloki[bloki.length - 1];
          if (zadnji && zadnji.dno - o.y <= 12) {
            zadnji.vrstice.push(o);
            zadnji.dno = o.y;
          } else bloki.push({ vrh: o.y, dno: o.y, vrstice: [o] });
        });

      // Nekateri obrazci razdelkov ne pišejo ob robu, ampak kot oštevilčene
      // naslove v telesu ("2. SPREMEMBA PLAČEVANJA PREMIJE").
      const odseki = s.odseki || (s.odseki = razdeliNaOdseke(s.kosi));
      // Naslov je lahko razbit na kose, ker med njimi stojijo okenca:
      // "5." | "Priključitev" | "Izključitev" | "Sprememba dodatnega
      // nezgodnega zavarovanja". Sam ostane le oštevilčeni začetek, zato ga
      // prepoznamo po pisavi naslova in nato poberemo celo vrstico.
      const telo = telesnaVisinaPisave(s.kosi);
      for (const o of odseki) {
        if (
          telo &&
          o.visina > telo + NAJMANJSI_PRIRASTEK_PISAVE &&
          /^\d+\s*\.\s*[a-zčšž]?\.?$/.test(o.besedilo)
        ) {
          const vrstica = odseki
            .filter((k) => Math.abs(k.y - o.y) < 3 && k.od > o.od)
            .sort((a, b) => a.od - b.od)
            .map((k) => pocisti(k.besedilo))
            .filter(Boolean);
          if (!vrstica.length) continue;
          // Oznaka razdelka obdrži piko ("5.", "7.a"); pocisti() jo odreže.
          const oznaka = o.besedilo.trim().replace(/\s+/g, "");
          const naslov = oznaka + " " + vrstica.join(" / ");
          if (naslov.length > NAJVEC_ZNAKOV_SESTAVLJENEGA) continue;
          izhod.push({
            stran: s.stran,
            y: ((mere.visina - o.y) / mere.visina) * 100,
            naslov,
            opomba: null,
          });
          continue;
        }
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
        if (naslov.length > NAJVEC_ZNAKOV_NASLOVA || o.besedilo.includes("?")) {
          continue;
        }
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
          const n = odseki.find(
            (o) =>
              o.od >= rob &&
              Math.abs(o.y - b.vrh) < 14 &&
              /^(izpolni|obvezn)/i.test(o.besedilo)
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
  const NAJVEC_ZNAKOV_PODRAZDELKA = 80;
  const NAJVEC_VRZEL_DO_POLJA = 200; // pt - dlje stoji polje druge rubrike
  const NAJVEC_ZAMIK_NASLOVA = 20; // pt - podnaslov je lahko zamaknjen
  const NAJMANJ_PREKRITJA_S_POLJEM = 0.6; // delež napisa, ki mora biti v polju
  const NAJVEC_ZNAKOV_PO_PISAVI = 50; // naslov, prepoznan po pisavi
  const NAJVEC_DELEZ_PISAVE_NASLOVA = 0.12; // redka pisava = naslovi
  const NAJMANJSI_KOLICNIK_ZA_OKENCEM = 1.9; // pisava naslova, ne trditve
  // Sestavljen naslov nosi tudi moznosti ("5. Prikljucitev / Izkljucitev /
  // Sprememba dodatnega zdravstvenega zavarovanja na potovanjih v tujini z
  // asistenco" meri 96 znakov), zato je meja zanj visja.
  const NAJVEC_ZNAKOV_SESTAVLJENEGA = 130;

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
      // Nekateri obrazci naslovov ne povečajo, ampak jih le okrepijo -
      // takrat je znak druga pisava, ki je na strani redka.
      const stevec = new Map();
      s.kosi.forEach((k) => {
        if (!k.pisava) return;
        stevec.set(k.pisava, (stevec.get(k.pisava) || 0) + 1);
      });
      const telesnaPisava = [...stevec.entries()].sort((a, b) => b[1] - a[1])[0];
      const jePisavaNaslova = (o) =>
        o.pisava &&
        telesnaPisava &&
        o.pisava !== telesnaPisava[0] &&
        (stevec.get(o.pisava) || 0) <= s.kosi.length * NAJVEC_DELEZ_PISAVE_NASLOVA;

      const naStrani = polja.filter((p) => p.stran === s.stran && p.pravokotnik);
      if (!naStrani.length) return;
      // Okenca so lahko raztresena čez več strani (polje se šteje po prvem),
      // zato jih za to stran poberemo posebej.
      const okencaStrani = [];
      polja.forEach((p) => {
        if (p.tip !== "CheckBox" && p.tip !== "RadioGroup") return;
        (p.okenca || []).forEach((o) => {
          if (o.stran === s.stran && o.pravokotnik) okencaStrani.push(o.pravokotnik);
        });
      });
      const meja = meje.get(s.stran);
      const stolpecOdseka = (o) => (meja != null && o.od >= meja ? 1 : 0);

      const odseki = s.odseki || (s.odseki = razdeliNaOdseke(s.kosi));

      // Pisave, s katerimi so na tej strani pisani oštevilčeni naslovi
      // razdelkov. Po njih prepoznamo tudi naslov sklopa, ki stoji za
      // okencem in torej ni na robu ("☐ Izbira paketa").
      const visineNaslovov = new Set(
        odseki
          .filter(
            (k) =>
              k.visina > telo &&
              (/^\d+\s*\.\s*([a-zčšž]\s*\.?)?$/.test(k.besedilo) ||
                /^\d+\s*\.\s*[A-ZČŠŽ]/.test(k.besedilo))
          )
          .map((k) => Number(k.visina.toFixed(1)))
      );

      // Levi rob vsakega stolpca: naslovi stojijo nanj, oznake polj so
      // zamaknjene nekaj točk desno.
      const robStolpca = new Map();
      odseki.forEach((o) => {
        const c = stolpecOdseka(o);
        if (!robStolpca.has(c) || o.od < robStolpca.get(c)) robStolpca.set(c, o.od);
      });

      for (const o of odseki) {
        if (!o.visina) continue;
        const vecji = o.visina >= telo + NAJMANJSI_PRIRASTEK_PISAVE;
        if (!vecji && !jePisavaNaslova(o)) continue;
        if (o.visina > telo * NAJVECJI_KOLICNIK_PISAVE) continue; // naslov obrazca
        const c = stolpecOdseka(o);
        // Naslov sklopa stoji na levem robu stolpca - ali pa takoj za
        // okencem, ki ga vklopi ("☐ Izbira paketa").
        // Da okenčna trditev ("☐ Bolezen") ne obvelja za naslov, mora biti
        // tak naslov pisan z isto pisavo kot oštevilčeni naslovi te strani.
        const zaOkencem =
          visineNaslovov.has(Number(o.visina.toFixed(1))) &&
          okencaStrani.some(
            (r) =>
              Math.abs(r.y + r.height / 2 - o.y) < 8 &&
              o.od - (r.x + r.width) > 0 &&
              o.od - (r.x + r.width) < 14
          );
        // Naslov sklopa je lahko tudi zamaknjen ("Zavarovalec (sklenitelj
        // zavarovanja)" stoji 14 pt desno od roba, ker je podnaslov).
        const dopustRoba = vecji ? DOPUST_ROBA_PODRAZDELKA : NAJVEC_ZAMIK_NASLOVA;
        if (o.od > robStolpca.get(c) + dopustRoba && !zaOkencem) continue;

        // Navodilo v oklepaju ("(izpolnite v primeru prometne nesreče)")
        // ni del naslova, ampak opomba pod njim.
        // Navodilo je ZADNJI oklepaj: "Zavarovalec (sklenitelj zavarovanja)
        // (izpolnite le, če ...)" ima naslov, ki sam vsebuje oklepaj.
        const oklepaj = o.besedilo.lastIndexOf("(");
        const vOklepaju =
          oklepaj > 0 ? o.besedilo.slice(oklepaj).replace(/[()]/g, "") : "";
        const jeNavodilo = jeNavodiloVOklepaju(vOklepaju);
        const naslov = pocisti(
          jeNavodilo ? o.besedilo.slice(0, oklepaj) : o.besedilo
        );
        if (naslov.length < 3 || naslov.length > NAJVEC_ZNAKOV_PODRAZDELKA) continue;
        // Naslov stoji sam v svoji vrstici. Kjer je v isti vrstici polje, je
        // to napis tega polja ("Organizacija, v kateri je zavarovanec
        // zaposlen oziroma je njen član: ______"), ne naslov sklopa.
        const poljeVVrstici = naStrani.some((p) => {
          const r = p.pravokotnik;
          return (
            r.x >= o.do - 2 &&
            r.x - o.do < NAJVEC_VRZEL_DO_POLJA &&
            stolpecOdseka({ od: r.x }) === c &&
            o.y > r.y - 2 &&
            o.y < r.y + r.height + 2
          );
        });
        if (poljeVVrstici) continue;
        // Naslov, prepoznan le po pisavi, mora biti tudi kratek: znak je
        // šibkejši od večje pisave in bi sicer pobral kakšen odstavek.
        // Dvopičje na koncu je močan znak naslova, zato tak sme biti daljši.
        const meja = /:\s*$/.test(o.besedilo)
          ? NAJVEC_ZNAKOV_PODRAZDELKA
          : NAJVEC_ZNAKOV_PO_PISAVI;
        if (!vecji && (naslov.length > meja || naslov.length < 8)) continue;
        if (naslov.includes("?")) continue;
        // Dolg naslov je še naslov, dokler ni poved: "Upravičenec za dodatno
        // zavarovanje ... je zavarovana oseba" je opomba pod tabelo.
        if (
          !/:\s*$/.test(o.besedilo) &&
          naslov.length > 50 &&
          /\b(je|so|ni|ne|niso|naj|bo|bodo|se|smo|ste)\b/i.test(naslov)
        ) {
          continue;
        }
        if (!/^([IVX]+\.|\d+\.|[A-ZČŠŽ])/.test(naslov)) continue;
        // Oznaka obrazca ("340.107.018.11", "ZA-OZ-pis/25-7") ni naslov.
        if (/^[\d.]+$/.test(naslov)) continue;
        // Oznaka obrazca ("ZA-OZ-pis/25-7") ni naslov razdelka.
        if (/^[A-ZČŠŽ]{2,}[-/][\w./-]*\d/.test(naslov)) continue;

        // Besedilo, ki leži V polju ali ob njem, je vsebina, ne naslov.
        // Napis je vsebina polja le, kadar leži v njem v CELOTI. Naslov nad
        // poljem se z njim pogosto malo prekriva ("Zavarovanec (zavarovana
        // oseba):" sega 60 pt čez levi rob polja pod njim) in to ga ne sme
        // razveljaviti.
        const vPolju = naStrani.some((p) => {
          const r = p.pravokotnik;
          if (o.y <= r.y - 2 || o.y >= r.y + r.height + 2) return false;
          const prekritje = Math.min(o.do, r.x + r.width) - Math.max(o.od, r.x);
          return prekritje > (o.do - o.od) * NAJMANJ_PREKRITJA_S_POLJEM;
        });
        if (vPolju) continue;

        izhod.push({
          stran: s.stran,
          stolpec: c,
          y: ((mere.visina - o.y) / mere.visina) * 100,
          naslov: naslov.replace(/\s*:\s*$/, ""),
          opomba: jeNavodilo ? pocisti(vOklepaju) : null,
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
  // Meja med stolpcema je blizu sredine; dlje je proga znotraj stolpca.
  const NAJVEC_ODMIK_SREDINE = 0.08;
  const DOPUST_ZRCALJENJA = 4; // pt
  const NAJMANJ_ZRCALNIH = 0.6; // delež vrstic, ki morajo biti zrcalne

  // Med dvema blokoma obrazca teče prazna vodoravna proga; pod to mero gre
  // za razmik med vrsticami istega bloka.
  const NAJMANJSA_VRZEL_PASU = 2.8; // % višine strani

  /**
   * Polja razreže na pasove - vodoravne trakove, med katerimi ni nobenega
   * polja. Vsakemu polju pripiše .pas (0, 1, ...) znotraj njegove skupine.
   */
  function dolociPasove(polja, kljucSkupine) {
    const skupine = new Map();
    polja.forEach((p) => {
      if (!p.polozaj) return;
      const k = kljucSkupine(p);
      if (!skupine.has(k)) skupine.set(k, []);
      skupine.get(k).push(p);
    });
    for (const skupina of skupine.values()) {
      skupina.sort((a, b) => a.polozaj.y - b.polozaj.y);
      let pas = 0;
      let dno = -Infinity;
      skupina.forEach((p) => {
        if (p.polozaj.y - dno > NAJMANJSA_VRZEL_PASU) pas++;
        p.pas = pas;
        dno = Math.max(dno, p.polozaj.y + (p.polozaj.visina || 0));
      });
    }
  }

  /**
   * Razdeli polja strani v stolpce. Stolpca sta dva, kadar čez vso višino
   * strani teče prazna navpična proga, ki nobenega polja ne preseka.
   * Vsakemu polju pripiše .stolpec (0, 1, ...) in vrne mejo stolpcev po
   * straneh (Map stran -> x v točkah), da po istem rezu razvrstimo tudi
   * naslove razdelkov.
   */
  /**
   * Sta polovici zrcalni? Pri dveh stolpcih (prva / druga zavarovana oseba)
   * stoji vsako polje desne polovice natanko toliko desno od svojega para
   * kot je široka polovica. Pri TABELI to ne drži: tam vrstica teče čez obe
   * polovici in so stolpci tabele različno široki.
   */
  function polovicaZrcali(levo, desno) {
    const x = (p) => p.pravokotnik.x;
    const zamik = Math.min(...desno.map(x)) - Math.min(...levo.map(x));
    const vrstice = new Map();
    levo.forEach((p) => {
      const k = Math.round((p.pravokotnik.y || 0) / 3);
      if (!vrstice.has(k)) vrstice.set(k, { l: [], d: [] });
      vrstice.get(k).l.push(x(p));
    });
    desno.forEach((p) => {
      const k = Math.round((p.pravokotnik.y || 0) / 3);
      if (!vrstice.has(k)) vrstice.set(k, { l: [], d: [] });
      vrstice.get(k).d.push(x(p));
    });

    let obojestranskih = 0;
    let zrcalnih = 0;
    for (const { l, d } of vrstice.values()) {
      if (!l.length || !d.length) continue;
      obojestranskih++;
      const ujema = l.every((xl) =>
        d.some((xd) => Math.abs(xd - (xl + zamik)) <= DOPUST_ZRCALJENJA)
      );
      if (ujema) zrcalnih++;
    }
    if (!obojestranskih) return true; // polovici se sploh ne srečata
    return zrcalnih / obojestranskih >= NAJMANJ_ZRCALNIH;
  }

  function dolociStolpce(polja, kljucSkupine, lastnost, zahtevajZrcaljenje) {
    const poStrani = new Map();
    const meje = new Map();
    const kljuc = kljucSkupine || ((p) => p.stran);
    const ime = lastnost || "stolpec";
    polja.forEach((p) => {
      if (!p.pravokotnik) return;
      const k = kljuc(p);
      if (!poStrani.has(k)) poStrani.set(k, []);
      poStrani.get(k).push(p);
    });

    for (const [stran, naStrani] of poStrani) {
      naStrani.forEach((p) => (p[ime] = 0));
      const odseki = naStrani
        .map((p) => [p.pravokotnik.x, p.pravokotnik.x + p.pravokotnik.width])
        .sort((a, b) => a[0] - b[0]);

      // Vse prazne navpične proge, ki jih nobeno polje ne preseka.
      let konec = odseki[0][1];
      const kandidati = [];
      for (const [od, do_] of odseki) {
        if (od - konec >= NAJMANJSA_VRZEL_STOLPCA) {
          kandidati.push(konec + (od - konec) / 2);
        }
        konec = Math.max(konec, do_);
      }
      if (!kandidati.length) continue;

      // Dva stolpca sta dve POLOVICI: meja teče po sredini. Zato izmed prog
      // vzamemo tisto, ki je sredini najbližja, ne najširše. Pri Zahtevku je
      // med okencem "Druga zavarovana oseba" in njenimi polji 56 pt prazne
      // proge, prava meja med stolpcema (24 pt) pa je na sredini; najširša
      // proga bi desni stolpec prerezala na pol.
      const levi = Math.min(...odseki.map((o) => o[0]));
      const desni = Math.max(...odseki.map((o) => o[1]));
      const sredina = (levi + desni) / 2;
      const dopust = (desni - levi) * NAJVEC_ODMIK_SREDINE;

      let meja = null;
      let levo = null;
      let desno = null;
      let najblizje = Infinity;
      for (const m of kandidati) {
        const odmik = Math.abs(m - sredina);
        if (odmik > dopust || odmik >= najblizje) continue;
        const l = naStrani.filter((p) => p.pravokotnik.x < m);
        const d = naStrani.filter((p) => p.pravokotnik.x >= m);
        if (l.length < NAJMANJ_POLJ_V_STOLPCU || d.length < NAJMANJ_POLJ_V_STOLPCU) {
          continue;
        }
        if (zahtevajZrcaljenje && !polovicaZrcali(l, d)) continue;
        najblizje = odmik;
        meja = m;
        levo = l;
        desno = d;
      }
      if (meja === null) continue;
      desno.forEach((p) => (p[ime] = 1));
      meje.set(stran, meja);
    }
    return meje;
  }

  // Vprašanje nad vrstico okenc: odstavek tik nad njimi, skupaj s svojimi
  // nadaljevalnimi vrsticami.
  const NAJVEC_ODMIK_VPRASANJA = 30; // pt nad okenci
  const VRZEL_NADALJEVANJA = 14; // pt med vrsticama istega odstavka

  function vprasanjeNadOkenci(stran, okenca) {
    if (!stran) return "";
    const odseki = stran.odseki || (stran.odseki = razdeliNaOdseke(stran.kosi));
    const vrh = Math.max(
      ...okenca.map((o) => o.pravokotnik.y + o.pravokotnik.height)
    );
    const nad = odseki
      .filter((o) => o.y > vrh && o.y - vrh < NAJVEC_ODMIK_VPRASANJA)
      .sort((a, b) => a.y - b.y);
    if (!nad.length) return "";
    const vrstice = [nad[0]];
    for (const o of odseki.sort((a, b) => a.y - b.y)) {
      const zadnja = vrstice[vrstice.length - 1];
      if (o.y > zadnja.y && o.y - zadnja.y <= VRZEL_NADALJEVANJA) vrstice.push(o);
    }
    const celo = pocisti(
      vrstice
        .sort((a, b) => b.y - a.y)
        .map((o) => o.besedilo)
        .join(" ")
    );
    return celo.length > 25 ? celo : "";
  }

  /** Ali je ime polja neuporabno ("Checkbox7") in naj raje vzamemo besedilo? */
  function imeJeNeuporabno(ime) {
    // "4", "5", "6" so v prilogah imena okenc - povedo prav toliko kot
    // "Checkbox7".
    return (
      /^(check ?box|text ?field|radio ?button|group|button|polje|field|untitled)\s*\d*$/i.test(
        ime
      ) ||
      /^\d+$/.test(String(ime || "").trim())
    );
  }

  return {
    razdeliNaOdseke,
    najdiGlavoStolpca,
    najdiOznakoVrstice,
    oznaciPolja,
    najdiMestaPodpisov,
    oznaciPoljaVPodpisih,
    zdruziVVrstice,
    zdruziVIzbire,
    oznaciRazdeljenoStevilko,
    najdiRazdelke,
    najdiPodrazdelke,
    dolociStolpce,
    dolociPasove,
    popraviZnake,
    izberiOznako,
    pocistiNapis,
    imeJeNeuporabno,
  };
});
