// obrazci-pdf.js
// Branje sheme in izpolnjevanje PDF obrazcev nad pdf-lib.
//
// Modul ne uvaža ničesar sam: pdf-lib, fontkit in logiko dobi od klicatelja.
// Tako isto kodo poganjata strežnik asistenta (Node) in samostojno orodje
// (brskalnik), brez dveh različic istega pravila.
//
// Vse, kar je odvisno od okolja (branje datoteke, izris strani v sliko),
// ostane zunaj tega modula.

(function (koren, tovarna) {
  if (typeof module === "object" && module.exports) module.exports = tovarna();
  else koren.ObrazciPdf = tovarna();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * @param {Object} odvisnosti
   * @param {Object} odvisnosti.PDFLib - cel imenski prostor pdf-lib
   * @param {Object} odvisnosti.fontkit - @pdf-lib/fontkit
   * @param {Object} odvisnosti.logika - skupno/obrazci-logika.js
   */
  function ustvari({ PDFLib, fontkit, logika }) {
    const { rgb, PDFName, PDFRef, PDFDict } = PDFLib;

    // Tip polja ugotovimo z instanceof, ne iz constructor.name: v pomanjšani
    // (minified) različici pdf-lib za brskalnik so imena razredov skrajšana
    // na "r" in "e", zato bi po imenu vsa polja izpadla kot besedilna.
    const TIPI = [
      ["CheckBox", PDFLib.PDFCheckBox],
      ["RadioGroup", PDFLib.PDFRadioGroup],
      ["Dropdown", PDFLib.PDFDropdown],
      ["OptionList", PDFLib.PDFOptionList],
      ["TextField", PDFLib.PDFTextField],
      ["Button", PDFLib.PDFButton],
      ["Signature", PDFLib.PDFSignature],
    ].filter(([, razred]) => typeof razred === "function");

    function tipPolja(polje) {
      for (const [ime, razred] of TIPI) if (polje instanceof razred) return ime;
      return polje.constructor.name.replace("PDF", "");
    }
    /** Na kateri strani je pripomoček (widget) tega polja? */
    function najdiStran(doc, widget, straniBesedila) {
      const strani = doc.getPages();
      for (let i = 0; i < strani.length; i++) {
        const annots = strani[i].node.Annots();
        if (!annots) continue;
        for (let j = 0; j < annots.size(); j++) {
          if (annots.get(j) === widget.dict || annots.lookup(j) === widget.dict) {
            return i + 1;
          }
        }
      }

      // Nekateri obrazci imajo polja, ki niso navedena na NOBENI strani
      // (pri Prijavi nezgode je takih 13 okenc seznama prilog). Brez tega
      // bi vsa pristala na prvi strani, ostala brez napisa in izpadla.
      // Pravo stran pove besedilo: napis okenca stoji tik ob njem.
      if (straniBesedila && straniBesedila.length > 1) {
        const r = widget.getRectangle();
        const cy = r.y + r.height / 2;
        const desno = r.x + r.width;
        let naj = null;
        straniBesedila.forEach((s) => {
          const ob = (s.kosi || [])
            .filter((k) => Math.abs(k.y - cy) < 7 && k.x >= desno - 2)
            .sort((a, b) => a.x - b.x)[0];
          if (!ob) return;
          const vrzel = ob.x - desno;
          if (vrzel > NAJVEC_VRZEL_DO_NAPISA) return;
          if (!naj || vrzel < naj.vrzel) naj = { vrzel, stran: s.stran };
        });
        if (naj) return naj.stran;
      }
      return 1;
    }

    /** Mere vseh strani dokumenta. */
    function mereStrani(doc) {
      return doc.getPages().map((p, i) => ({
        stran: i + 1,
        sirina: p.getWidth(),
        visina: p.getHeight(),
      }));
    }

    /** Polja obrazca s tipom, stranjo in položajem (v odstotkih strani). */
    const NAJVEC_VRZEL_DO_NAPISA = 30; // pt med okencem in njegovim napisom

    function preberiPolja(doc, strani, straniBesedila) {
      popraviObrnjenePravokotnike(doc);
      dodajManjkajocaPolja(doc);
      return doc
        .getForm()
        .getFields()
        .map((p) => {
          const tip = tipPolja(p);
          const widget = p.acroField.getWidgets()[0];
          const r = widget ? widget.getRectangle() : null;
          const stran = widget ? najdiStran(doc, widget, straniBesedila) : 1;
          const mere = strani[stran - 1];
          const skupno = {
            ime: p.getName(),
            tip, // TextField | CheckBox | Dropdown | RadioGroup | OptionList
            stran,
          };
          if (r && mere) {
            skupno.pravokotnik = { x: r.x, y: r.y, width: r.width, height: r.height };
            // v odstotkih, izhodišče zgoraj levo (kot v brskalniku)
            skupno.polozaj = {
              x: (r.x / mere.sirina) * 100,
              y: ((mere.visina - r.y - r.height) / mere.visina) * 100,
              sirina: (r.width / mere.sirina) * 100,
              visina: (r.height / mere.visina) * 100,
            };
          }
          // Potrditveno polje ima lahko VEČ okenc, vsako s svojo vklopno
          // vrednostjo - to je izbira (m/ž, DA/NE), ne kljukica. Zato jih
          // preberemo vsa, ne le prvega. Skupina izbirnih gumbov
          // (RadioGroup) je isto, le da ji PDF tako reče - tudi ta v
          // vmesniku sodi med gumbe z možnostmi, ne v spustni seznam.
          if (tip === "CheckBox" || tip === "RadioGroup") {
            skupno.okenca = p.acroField
              .getWidgets()
              .map((wid) => {
                const rr = wid.getRectangle();
                const st = najdiStran(doc, wid, straniBesedila);
                const me = strani[st - 1];
                if (!rr || !me) return null;
                const vklopna = wid.getOnValue();
                return {
                  stran: st,
                  vklop: vklopna ? vklopna.asString().replace(/^\//, "") : null,
                  pravokotnik: { x: rr.x, y: rr.y, width: rr.width, height: rr.height },
                  polozaj: {
                    x: (rr.x / me.sirina) * 100,
                    y: ((me.visina - rr.y - rr.height) / me.visina) * 100,
                    sirina: (rr.width / me.sirina) * 100,
                    visina: (rr.height / me.visina) * 100,
                  },
                };
              })
              .filter(Boolean);
          }

          if (typeof p.getOptions === "function") {
            try {
              skupno.moznosti = p.getOptions();
            } catch {
              /* nekatera polja nimajo možnosti */
            }
          }
          if (typeof p.getMaxLength === "function") {
            const m = p.getMaxLength();
            if (m) skupno.najvec_znakov = m;
          }
          return skupno;
        });
    }

    /**
     * Shema obrazca: polja, vrstice z odgovori in mesta za podpis.
     * @param {Object} doc - naložen PDFDocument
     * @param {Array} straniBesedila - [{stran, kosi:[{besedilo,x,y,w}]}] iz pdfjs
     */
    function shemaIzDokumenta(doc, straniBesedila) {
      const VRZEL_VRSTICE = 0.9; // % višine strani - toliko še velja za isto vrstico
      const NAJMANJSI_ZAMIK_STOLPCA = 1; // % širine strani
      const strani = mereStrani(doc);
      const polja = preberiPolja(doc, strani, straniBesedila);

      const imaBesedilo = !!(straniBesedila && straniBesedila.length);
      const razdelki = imaBesedilo
        ? logika.najdiRazdelke(straniBesedila, strani)
        : [];

      // Naslov velja za polja POD njim; ob robu je poravnan na sredino svojega
      // bloka, zato dopustimo nekaj odstotka strani nazaj navzgor.
      const DOPUST = 2;
      // Razdelek se ne konča s stranjo: tabela razdelka 10.b se pri Zahtevku
      // nadaljuje na naslednjo stran in polja tam spadajo podenj, dokler se
      // ne začne nov razdelek. Zato primerjamo mesto v dokumentu, ne le y.
      const jePred = (r, stran, y) => r.stran < stran || (r.stran === stran && r.y <= y);
      const razdelekNa = (stran, y) => {
        let naj = -1;
        razdelki.forEach((r, i) => {
          if (jePred(r, stran, y)) naj = i;
        });
        return naj;
      };
      polja.forEach((p) => {
        p.razdelek = razdelekNa(p.stran, (p.polozaj?.y ?? 0) + DOPUST);
      });

      // Obrazec je lahko postavljen v dva stolpca; brati ga je treba po
      // stolpcih, sicer polja skačejo z leve na desno in nazaj. Stolpce
      // določimo pred oznakami, ker napis iz sosednjega stolpca ni naš.
      const meje = logika.dolociStolpce(polja);

      // Kjer čez vso stran ni nobene prazne proge, jo poiščemo še znotraj
      // vsakega razdelka posebej: pri Zahtevku sta v rubrikah 5 do 11 levi
      // stolpec prva in desni druga zavarovana oseba, na isti strani pa
      // stoji še tabela čez vso širino, ki vsako progo strani prekrije.
      // To velja samo za VRSTNI RED; oznake polj se ravnajo po strani.
      polja.forEach((p) => {
        p.stolpecRazdelka = p.stolpec ?? 0;
      });
      // Razdelek je lahko mešan: rubrika 6 ima zgoraj dva bloka (prva in
      // druga zavarovana oseba), spodaj pa tabelo čez vso širino. Zato
      // razdelek najprej razrežemo na PASOVE - vodoravne trakove, med
      // katerimi je prazna proga - in stolpce iščemo v vsakem posebej.
      logika.dolociPasove(polja.filter((p) => !meje.has(p.stran)), (p) =>
        p.stran + "|" + p.razdelek
      );
      logika.dolociStolpce(
        polja.filter((p) => !meje.has(p.stran)),
        (p) => p.stran + "|" + p.razdelek + "|" + p.pas,
        "stolpecRazdelka",
        true
      );

      // Imena polj so pogosto neuporabna ("Checkbox1"), zato oznako preberemo
      // iz besedila, ki v PDF-ju stoji ob polju.
      let podpisi = [];
      if (imaBesedilo) {
        const oznake = logika.oznaciPolja(straniBesedila, polja, meje);
        polja.forEach((p) => {
          const najdeno = oznake.get(p.ime);
          if (!najdeno) return;
          p.oznaka_iz_pdf = najdeno.oznaka
            ? logika.pocistiNapis(najdeno.oznaka)
            : null;
          p.glava = najdeno.glava || null;
          p.oznaka = najdeno.izUvoda
            ? najdeno.oznaka
            : logika.izberiOznako(p.ime, najdeno.oznaka, p.tip);
          if (najdeno.desno) {
            p.enota = najdeno.desno.enota || null;
            p.pripomba = najdeno.desno.pripomba || null;
            // Če je bila za oznako vzeta prav enota, ta ne pove ničesar.
            if (p.enota && p.oznaka === p.enota) p.oznaka = p.ime;
          }
        });
        // Okence brez napisa, ki ga obrazec tudi ne nariše, je ostanek iz
        // priprave obrazca ("Priloga1" ... "Priloga13" na prijavah nezgode
        // stojijo nevidna pod besedilom). Takega ni mogoče smiselno
        // ponuditi, zato ga v vmesniku ne kažemo.
        polja.forEach((p) => {
          p.brezNapisa =
            p.tip === "CheckBox" && !(p.oznaka_iz_pdf || "").trim();
        });

        // Taka okenca kvarijo tudi iskanje oznak ostalim poljem: vrstica
        // sega do sredine SOSEDNJEGA polja, nevidno okence pa sosed navidez
        // približa in napis ostane zunaj pasu. Zato oznake določimo še
        // enkrat, tokrat brez njih.
        const uporabna = polja.filter((p) => !p.brezNapisa);
        if (uporabna.length !== polja.length) {
          straniBesedila.forEach((st) => {
            delete st.odsekiPoPoljih;
          });
          const znova = logika.oznaciPolja(straniBesedila, uporabna, meje);
          uporabna.forEach((p) => {
            const najdeno = znova.get(p.ime);
            if (!najdeno) return;
            p.oznaka_iz_pdf = najdeno.oznaka
              ? logika.pocistiNapis(najdeno.oznaka)
              : null;
            p.glava = najdeno.glava || null;
            p.oznaka = najdeno.izUvoda
            ? najdeno.oznaka
            : logika.izberiOznako(p.ime, najdeno.oznaka, p.tip);
            p.enota = najdeno.desno ? najdeno.desno.enota || null : null;
            p.pripomba = najdeno.desno ? najdeno.desno.pripomba || null : null;
            if (p.enota && p.oznaka === p.enota) p.oznaka = p.ime;
          });
        }
        logika.oznaciRazdeljenoStevilko(polja);
        podpisi = logika.najdiMestaPodpisov(straniBesedila, strani, polja);
        // Polja v okviru za podpis (ime, šifra, podpis) pokrije narisan
        // podpis; v spletnem obrazcu jih ne ponujamo.
        logika.oznaciPoljaVPodpisih(polja, podpisi);
      } else {
        polja.forEach((p) => {
          p.oznaka = p.ime;
        });
      }

      const izbire = straniBesedila && straniBesedila.length
        ? logika.zdruziVIzbire(polja, straniBesedila)
        : [];
      // Vrstice z DA/NE so poseben primer izbir; kadar jih prepoznamo kot
      // izbire, jih ne podvajamo.
      const vIzbirah = new Set(izbire.flatMap((i) => i.polja));
      const vrstice = logika
        .zdruziVVrstice(polja)
        .filter((v) => !v.odgovori.some((o) => o.polja.some((n) => vIzbirah.has(n))));

      // Naslovi sklopov znotraj razdelka; tiste, ki so že razdelek, izpustimo.
      const podrazdelki = (
        imaBesedilo
          ? logika.najdiPodrazdelke(straniBesedila, strani, polja, meje)
          : []
      ).filter(
        (p) =>
          !razdelki.some((r) => r.stran === p.stran && Math.abs(r.y - p.y) < 1)
      );

      const zadnjiNad = (seznam, p, dodatno) => {
        const y = (p.polozaj?.y ?? 0) + DOPUST;
        let naj = -1;
        seznam.forEach((r, i) => {
          if (!jePred(r, p.stran, y)) return;
          if (dodatno && !dodatno(r)) return;
          naj = i;
        });
        return naj;
      };
      polja.forEach((p) => {
        const sekcija = p.razdelek >= 0 ? razdelki[p.razdelek] : null;
        // Naslov sklopa velja za svoj stolpec in le znotraj svojega razdelka.
        p.podrazdelek = zadnjiNad(
          podrazdelki,
          p,
          (r) =>
            r.stolpec === (p.stolpec ?? 0) &&
            (!sekcija || !jePred(r, sekcija.stran, sekcija.y - 0.001))
        );
      });

      // Polja uredimo tako, kot si sledijo na papirju: razdelek za razdelkom,
      // v vsakem stolpec za stolpcem, v vsakem sklop za sklopom.
      // Vrstni red zapišemo, da se ga drži tudi vmesnik.
      polja.sort(
        (a, b) =>
          a.stran - b.stran ||
          a.razdelek - b.razdelek ||
          (a.pas ?? 0) - (b.pas ?? 0) ||
          (a.stolpecRazdelka ?? 0) - (b.stolpecRazdelka ?? 0) ||
          a.podrazdelek - b.podrazdelek ||
          (a.polozaj?.y ?? 0) - (b.polozaj?.y ?? 0) ||
          (a.polozaj?.x ?? 0) - (b.polozaj?.x ?? 0)
      );
      // Polja, ki na papirju stojijo v isti vrstici, imajo lahko y različen
      // za stotinko odstotka; brez zaokroževanja bi "premija" (y 50,174)
      // prehitela "zavarovalno vsoto" (y 50,233), ki stoji levo od nje.
      // Vrstico zapišemo, da po njej riše tudi vmesnik.
      let skupina = null;
      let vrstica = -1;
      let vrhVrstice = -Infinity;
      polja.forEach((p) => {
        const k =
          p.stran + "|" + p.razdelek + "|" + (p.pas ?? 0) + "|" + (p.stolpecRazdelka ?? 0);
        const y = p.polozaj?.y ?? 0;
        if (k !== skupina || y - vrhVrstice > VRZEL_VRSTICE) {
          skupina = k;
          vrstica++;
          vrhVrstice = y;
        }
        p.vrstica = vrstica;
      });
      // Okence, ki na papirju stoji ob VEČ vrsticah hkrati ("mesečna
      // nezgodna renta za invalidnost" ob vrsticah za 30 % in 50 %), pade
      // med nji. Tako okence je samo v svoji vrstici, stoji ob levem robu
      // stolpca, vrstica nad njim pa je zamaknjena desno - takrat ga
      // postavimo na čelo te vrstice, ker jo uvaja.
      const poVrsticah = new Map();
      polja.forEach((p) => {
        if (!poVrsticah.has(p.vrstica)) poVrsticah.set(p.vrstica, []);
        poVrsticah.get(p.vrstica).push(p);
      });
      const levoV = (v) => Math.min(...(poVrsticah.get(v) || []).map((p) => p.polozaj?.x ?? 0));
      polja.forEach((p) => {
        const sama = poVrsticah.get(p.vrstica);
        if (sama.length !== 1 || p.tip !== "CheckBox") return;
        const prej = poVrsticah.get(p.vrstica - 1);
        if (!prej || !prej.length) return;
        if (prej[0].stran !== p.stran || prej[0].razdelek !== p.razdelek) return;
        // Zamaknjeno mora biti OPAZNO: stotinka odstotka je zaokroževanje,
        // ne stolpec (tri vprašanja vprašalnika stojijo vsa na x = 82,1 %).
        if ((p.polozaj?.x ?? 0) >= levoV(p.vrstica - 1) - NAJMANJSI_ZAMIK_STOLPCA)
          return;
        p.vrstica -= 1;
        p.uvajaVrstico = true;
      });
      polja.sort(
        (a, b) =>
          a.vrstica - b.vrstica ||
          (b.uvajaVrstico ? 1 : 0) - (a.uvajaVrstico ? 1 : 0) ||
          (a.polozaj?.x ?? 0) - (b.polozaj?.x ?? 0)
      );
      polja.forEach((p, i) => {
        p.zaporedje = i;
      });

      // Kadar ima izbira možnosti razporejene ena pod drugo in ima vsaka
      // svojo vrstico ENAKIH polj ("renta / doba izplačevanja / premija"
      // pri 30 % in pri 50 %), se vrstici ne dasta razločiti. Prvemu polju
      // vsake vrstice zato pripišemo možnost, ki ji pripada.
      const vrsticePolj = new Map();
      polja.forEach((p) => {
        if (!vrsticePolj.has(p.vrstica)) vrsticePolj.set(p.vrstica, []);
        vrsticePolj.get(p.vrstica).push(p);
      });
      const poImenu = new Map(polja.map((p) => [p.ime, p]));
      // Vrstico opišejo njena VNOSNA polja; okenca so oznake, ne vsebina.
      const vnosniVVrstici = (v, izbira) =>
        (vrsticePolj.get(v) || []).filter(
          (p) => p.tip === "TextField" && !izbira.polja.includes(p.ime)
        );
      izbire.forEach((i) => {
        if (!i.moznosti || i.moznosti.length < 2) return;
        // Vrstico iščemo le v STOLPCU izbire: enaki vrstici prve in druge
        // zavarovane osebe stojita na isti višini in bi se zamenjali.
        const svoje = poImenu.get(i.polja[0]);
        if (!svoje) return;
        const vrstice = i.moznosti.map((m) => {
          if (!m.polozaj) return null;
          let naj = null;
          polja.forEach((p) => {
            if (!p.polozaj || i.polja.includes(p.ime)) return;
            if (
              p.stran !== svoje.stran ||
              p.razdelek !== svoje.razdelek ||
              (p.pas ?? 0) !== (svoje.pas ?? 0) ||
              (p.stolpecRazdelka ?? 0) !== (svoje.stolpecRazdelka ?? 0)
            ) {
              return;
            }
            const d = Math.abs(p.polozaj.y - m.polozaj.y);
            if (d > VRZEL_VRSTICE) return;
            if (!naj || d < naj.d) naj = { d, vrstica: p.vrstica };
          });
          return naj ? naj.vrstica : null;
        });
        const podpisi = vrstice.map((v) =>
          v === null
            ? ""
            : vnosniVVrstici(v, i)
                .map((p) => p.oznaka)
                .join("|")
        );
        // Značka je smiselna le, kadar ima VSAKA možnost svojo vrstico in
        // so si vrstice na las podobne - takrat se sicer ne da ugotoviti,
        // katera pripada kateri možnosti. Pri možnostih, ki stojijo druga
        // ob drugi (m / ž, DA / NE), vrstica ni njihova in značke ni.
        const polne = podpisi.filter(Boolean);
        if (polne.length !== i.moznosti.length) return;
        if (new Set(vrstice).size !== vrstice.length) return;
        if (new Set(polne).size !== 1) return;
        if (vrstice.some((v) => vnosniVVrstici(v, i).length < 2)) return;
        vrstice.forEach((v, k) => {
          if (v === null) return;
          const vrsta = vnosniVVrstici(v, i);
          if (vrsta.length) vrsta[0].moznost = i.moznosti[k].oznaka;
        });
      });

      // Izbire in vrstice sledijo prvemu svojemu polju in podedujejo njegov
      // razdelek, da pristanejo v isti skupini.
      const prvoPolje = (imena) =>
        imena
          .map((n) => poImenu.get(n))
          .filter(Boolean)
          .sort((a, b) => a.zaporedje - b.zaporedje)[0] || null;
      const podedujOd = (cilj, imena) => {
        const p = prvoPolje(imena);
        if (!p) return;
        cilj.zaporedje = p.zaporedje;
        cilj.razdelek = p.razdelek;
        cilj.podrazdelek = p.podrazdelek;
        cilj.vrstica = p.vrstica;
      };
      izbire.forEach((i) => podedujOd(i, i.polja));
      vrstice.forEach((v) => podedujOd(v, v.odgovori.flatMap((o) => o.polja)));

      // pravokotnikov v točkah vmesnik ne potrebuje
      polja.forEach((p) => {
        delete p.pravokotnik;
        if (p.okenca) p.okenca.forEach((o) => delete o.pravokotnik);
      });

      return { strani, polja, podpisi, vrstice, izbire, razdelki, podrazdelki };
    }

    /**
     * Izpolni obrazec in vrne bajte novega PDF-ja.
     * @param {Object} doc - naložen PDFDocument (spremenjen bo na mestu)
     * @param {Object} nastavitve
     * @param {Object} nastavitve.vrednosti - { imePolja: vrednost }
     * @param {Array}  nastavitve.podpisi - [{ slika: dataURL, stran, x, y, sirina, besedilo }]
     *   x/y sta v odstotkih strani in pomenita SREDIŠČE podpisa
     * @param {boolean} nastavitve.zakleni - polja spremenimo v navadno vsebino
     * @param {Array}  nastavitve.oznake - okenca brez polja, ki jih narišemo sami
     * @param {Uint8Array} nastavitve.pisavaBajti - TTF s šumniki
     */
    async function izpolni(doc, nastavitve = {}) {
      const {
        vrednosti = {},
        podpisi = [],
        zakleni = true,
        oznake = [],
        pisavaBajti = null,
        straniPolj = null,
      } = nastavitve;

      // Isti popravki kot pri branju sheme, sicer se imena polj razlikujejo.
      popraviObrnjenePravokotnike(doc);
      dodajManjkajocaPolja(doc);

      const form = doc.getForm();

      // Nekateri obrazci imajo polja, ki niso navedena na nobeni strani.
      // pdf-lib ob sploščitvi zanje ne najde strani in izvoz odpove
      // ("Could not find page for PDFRef"). Uskladimo jih s stranmi.
      if (straniPolj) uskladiPolja(doc, straniPolj);
      const opozorila = [];

      // Pisava s šumniki mora biti vgrajena, preden nastavimo besedilo.
      let pisava = null;
      if (pisavaBajti) {
        try {
          doc.registerFontkit(fontkit);
          pisava = await doc.embedFont(pisavaBajti, { subset: true });
        } catch (e) {
          opozorila.push(
            `Pisave s šumniki ni bilo mogoče vgraditi (${e.message}); črke č, š, ž morda ne bodo pravilne.`
          );
        }
      }

      for (const [ime, vrednost] of Object.entries(vrednosti)) {
        if (vrednost === "" || vrednost === null || vrednost === undefined) continue;
        let polje;
        try {
          polje = form.getField(ime);
        } catch {
          opozorila.push(`Polja "${ime}" v obrazcu ni.`);
          continue;
        }
        const tip = tipPolja(polje);
        try {
          if (tip === "CheckBox" && (vrednost === true || vrednost === "true")) {
            polje.check();
          } else if (
            tip === "CheckBox" &&
            (vrednost === false || vrednost === "false")
          ) {
            polje.uncheck();
          } else if (tip === "CheckBox" || tip === "RadioGroup") {
            // Izbrana možnost večokenčnega polja. pdf-lib zna nastaviti le
            // vklopno vrednost PRVEGA okenca (drugo zavrne z "invalid field
            // value"), zato vrednost in stanje okenc zapišemo sami. Skupina
            // izbirnih gumbov je ista reč z drugim imenom.
            nastaviIzbiro(polje, String(vrednost), opozorila);
          } else if (tip === "Dropdown" || tip === "OptionList") {
            polje.select(String(vrednost));
          } else {
            if (pisava) polje.updateAppearances(pisava);
            polje.setText(String(vrednost));
          }
        } catch (e) {
          opozorila.push(`Polja "${ime}" ni bilo mogoče izpolniti: ${e.message}`);
        }
      }

      if (pisava) {
        // Videz polj je treba izrisati z vgrajeno pisavo, sicer pdf-lib ob
        // sploščitvi znova poseže po WinAnsi in šumniki spet odpovejo.
        try {
          form.updateFieldAppearances(pisava);
        } catch (e) {
          opozorila.push(`Videza polj ni bilo mogoče osvežiti: ${e.message}`);
        }
      }

      if (zakleni) razresiVideze(doc, form, opozorila);

      // Nekateri obrazci imajo za okence vklopljeni videz enak izklopljenemu -
      // prazen kvadratek. Bralnik kljukico nariše sam (obrazec ima
      // /NeedAppearances), ob sploščitvi pa se izgubi, zato jo narišemo mi.
      const brezKljukice = zakleni ? okencaBrezKljukice(doc, form) : [];

      const jeZaOznaciti = Array.isArray(oznake) && oznake.length > 0;

      // Okenca obrazca so izrisana NAD vsebino strani, zato bi bil križec,
      // narisan pred sploščitvijo, skrit pod njimi. Sploščimo torej najprej,
      // nato rišemo.
      if (zakleni) {
        // Polja postanejo navadna vsebina - PDF je pripravljen za tisk in
        // pošiljanje in ga prejemnik ne more več spreminjati.
        form.flatten();
      } else if (jeZaOznaciti) {
        opozorila.push(
          "Brez zaklepanja polj so lastnoročno označena okenca lahko skrita pod okvirji obrazca. Za tisk priporočamo zaklepanje."
        );
      }

      // Križci v okenca, ki so na obrazcu narisana, a nimajo polja
      for (const o of [
        ...(Array.isArray(oznake) ? oznake : []),
        ...brezKljukice,
      ]) {
        try {
          const stran = doc.getPages()[Math.max(0, (o.stran || 1) - 1)];
          if (o.oblika === "kvadrat") {
            // Tako so videti kljukice, ki jih riše sam obrazec: polno
            // pobarvan kvadratek sredi okenca.
            const rob = o.sirina * 0.3;
            stran.drawRectangle({
              x: o.x + rob,
              y: o.y + o.visina * 0.3,
              width: o.sirina - 2 * rob,
              height: o.visina * 0.4,
              color: rgb(0, 0, 0),
            });
            continue;
          }
          // Debelina in rob sta usklajena z videzom pravih kljukic v obrazcu -
          // tanka črta v 7 pt okencu se na tisku skoraj ne vidi.
          const rob = Math.max(1, o.sirina * 0.2);
          const x1 = o.x + rob;
          const y1 = o.y + rob;
          const x2 = o.x + o.sirina - rob;
          const y2 = o.y + o.visina - rob;
          const crta = {
            thickness: Math.max(0.9, o.sirina * 0.16),
            color: rgb(0, 0, 0),
          };
          stran.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, ...crta });
          stran.drawLine({ start: { x: x1, y: y2 }, end: { x: x2, y: y1 }, ...crta });
        } catch (e) {
          opozorila.push(`Okenca ni bilo mogoče označiti: ${e.message}`);
        }
      }

      // Podpisi: PNG s platna, vsak na svojem mestu (v odstotkih strani).
      // pdf-lib zna base64 niz vzeti neposredno, zato dekodiranje ni potrebno
      // in koda deluje enako v Node in v brskalniku.
      for (const podpis of Array.isArray(podpisi) ? podpisi : [podpisi].filter(Boolean)) {
        if (!podpis || !podpis.slika) continue;
        try {
          const png = await doc.embedPng(String(podpis.slika));
          const stran = doc.getPages()[Math.max(0, (podpis.stran || 1) - 1)];
          let sirina = ((podpis.sirina || 24) / 100) * stran.getWidth();
          let visina = (sirina / png.width) * png.height;

          // Podpis naj ne prerase okenca, v katerem stoji. Če je previsok, ga
          // pomanjšamo - a ne pod polovico, sicer postane neberljiv drobiž.
          if (podpis.najvecVisina) {
            const dovoljeno = (podpis.najvecVisina / 100) * stran.getHeight();
            if (visina > dovoljeno) {
              const faktor = Math.max(dovoljeno / visina, 0.5);
              sirina *= faktor;
              visina *= faktor;
            }
          }
          // Točka, kamor je zastopnik povlekel podpis, je njegovo SREDIŠČE.
          const sredinaX = ((podpis.x ?? 50) / 100) * stran.getWidth();
          const sredinaY = ((podpis.y ?? 80) / 100) * stran.getHeight();
          const x = sredinaX - sirina / 2;
          // v PDF-ju je izhodišče spodaj levo, v vmesniku zgoraj levo
          const y = stran.getHeight() - sredinaY - visina / 2;
          stran.drawImage(png, { x, y, width: sirina, height: visina });

          // Vpisane vrstice (ime in priimek, pod njim šifra): če obrazec ima
          // okvir z napisom, gredo vanj, sicer nad podpis kot doslej.
          const besedila = Array.isArray(podpis.besedila)
            ? podpis.besedila
            : podpis.besedilo
              ? [
                  {
                    besedilo: podpis.besedilo,
                    x: podpis.besedilo_x,
                    y: podpis.besedilo_y,
                  },
                ]
              : [];
          if (pisava) {
            besedila.forEach((b, i) => {
              if (!b || !b.besedilo) return;
              const imaMesto = b.x !== null && b.x !== undefined;
              stran.drawText(String(b.besedilo), {
                x: imaMesto ? (b.x / 100) * stran.getWidth() : x,
                y: imaMesto
                  ? stran.getHeight() - (b.y / 100) * stran.getHeight()
                  : y + visina + 2 + i * 10,
                size: 9,
                font: pisava,
              });
            });
          }
        } catch (e) {
          opozorila.push(`Podpisa ni bilo mogoče vstaviti: ${e.message}`);
        }
      }

      return { pdf: await doc.save(), opozorila };
    }

    /** Nastavi večokenčno potrditveno polje na izbrano možnost. */
    /**
     * Obrne pravokotnike okvirjev, ki so zapisani "narobe obrnjeno".
     *
     * V PDF-ju je /Rect lahko zapisan s katerimakoli nasprotnima ogliščema;
     * bralnik ga popravi sam, pdf-lib pa ne. Pri otroški nezgodi so tako
     * zapisana štiri polja ("zaposleni" in dva dela številke računa) in se
     * ob sploščitvi izrišejo za vrstico previsoko - okence se podvoji.
     */
    function popraviObrnjenePravokotnike(doc) {
      const obdelani = new Set();
      const popravi = (dict) => {
        if (!dict || typeof dict.lookup !== "function") return;
        const rect = dict.lookup(PDFName.of("Rect"));
        if (!rect || typeof rect.size !== "function" || rect.size() !== 4) return;
        const v = [0, 1, 2, 3].map((i) => {
          const st = rect.lookup(i);
          return st && typeof st.asNumber === "function" ? st.asNumber() : null;
        });
        if (v.some((x) => x === null)) return;
        if (v[0] <= v[2] && v[1] <= v[3]) return;
        const urejen = [
          Math.min(v[0], v[2]),
          Math.min(v[1], v[3]),
          Math.max(v[0], v[2]),
          Math.max(v[1], v[3]),
        ];
        dict.set(PDFName.of("Rect"), doc.context.obj(urejen));
      };

      doc.getPages().forEach((pg) => {
        const annots = pg.node.Annots && pg.node.Annots();
        if (!annots) return;
        for (let i = 0; i < annots.size(); i++) {
          const ref = annots.get(i);
          obdelani.add(String(ref));
          popravi(doc.context.lookup(ref));
        }
      });
      doc
        .getForm()
        .getFields()
        .forEach((f) =>
          f.acroField.getWidgets().forEach((w) => {
            const ref = doc.context.getObjectRef(w.dict);
            if (ref && obdelani.has(String(ref))) return;
            popravi(w.dict);
          })
        );
    }

    /**
     * V seznam polj obrazca doda okvirje, ki so samo na straneh.
     *
     * V Prijavi nezgode manjka v AcroForm enajst okvirjev (status
     * zavarovanca, policijska postaja, prometna nesreča, št. vozniškega
     * dovoljenja, podatki upravičenca). Bralnik jih izriše in vanje je
     * mogoče pisati, orodje pa jih brez tega popravka sploh ne vidi.
     * Okvirje z istim imenom združimo v eno polje z otroki, tako kot bi
     * jih zapisal pravilno izdelan obrazec.
     */
    function dodajManjkajocaPolja(doc) {
      const acro = doc.catalog.lookup(PDFName.of("AcroForm"));
      if (!acro || typeof acro.lookup !== "function") return;
      const seznam = acro.lookup(PDFName.of("Fields"));
      if (!seznam || typeof seznam.push !== "function") return;

      const zeVPolju = new Set();
      doc
        .getForm()
        .getFields()
        .forEach((f) =>
          f.acroField
            .getWidgets()
            .forEach((w) => zeVPolju.add(kljucOkvirja(doc, w.dict)))
        );

      const skupine = new Map();
      doc.getPages().forEach((pg) => {
        const annots = pg.node.Annots && pg.node.Annots();
        if (!annots) return;
        for (let i = 0; i < annots.size(); i++) {
          const ref = annots.get(i);
          const dict = doc.context.lookup(ref);
          if (!dict || typeof dict.get !== "function") continue;
          const vrsta = dict.get(PDFName.of("FT"));
          const ime = dict.get(PDFName.of("T"));
          if (!vrsta || !ime || dict.get(PDFName.of("Parent"))) continue;
          if (zeVPolju.has(kljucOkvirja(doc, dict))) continue;
          const kljuc = `${String(vrsta)}|${String(ime)}`;
          if (!skupine.has(kljuc))
            skupine.set(kljuc, { vrsta, ime, dict, deli: [] });
          skupine.get(kljuc).deli.push(ref);
        }
      });

      skupine.forEach(({ vrsta, ime, dict, deli }) => {
        if (deli.length === 1) {
          seznam.push(deli[0]);
          return;
        }
        // Več okvirjev z istim imenom je ena sama izbira z več okenci.
        const starsevski = doc.context.obj({
          FT: vrsta,
          T: ime,
          Kids: deli,
        });
        const zastavice = dict.get(PDFName.of("Ff"));
        if (zastavice) starsevski.set(PDFName.of("Ff"), zastavice);
        const starsevskiRef = doc.context.register(starsevski);
        deli.forEach((ref) => {
          const otrok = doc.context.lookup(ref);
          otrok.set(PDFName.of("Parent"), starsevskiRef);
          otrok.delete(PDFName.of("T"));
          otrok.delete(PDFName.of("FT"));
        });
        seznam.push(starsevskiRef);
      });
    }

    /**
     * Uskladi seznam polj obrazca s seznamom oznak na straneh.
     *
     * Nekateri obrazci (npr. Prijava nezgode) imajo vsako polje zapisano
     * dvakrat: strani kažejo na en niz okvirjev, AcroForm pa na drug,
     * enak niz. Bralnik riše tiste s strani, pdf-lib pa izpolnjuje tiste
     * iz AcroForm - vpisano se zato ne vidi, sploščitev pa odpove z
     * "Could not find page for PDFRef", ker okvir ni na nobeni strani.
     * Dvojnika na strani zamenjamo s pravim poljem; če dvojnika ni,
     * polje pripnemo na stran, ki smo jo zanj ugotovili pri branju sheme.
     */
    function uskladiPolja(doc, straniPolj) {
      const strani = doc.getPages();
      const naStraneh = new Set();
      const dvojniki = new Map();
      strani.forEach((pg) => {
        const seznam = pg.node.Annots && pg.node.Annots();
        if (!seznam) return;
        for (let i = 0; i < seznam.size(); i++) {
          const ref = seznam.get(i);
          naStraneh.add(String(ref));
          const kljuc = kljucOkvirja(doc, doc.context.lookup(ref));
          if (kljuc && !dvojniki.has(kljuc))
            dvojniki.set(kljuc, { seznam, mesto: i });
        }
      });

      doc
        .getForm()
        .getFields()
        .forEach((f) => {
          const stran = straniPolj[f.getName()];
          f.acroField.getWidgets().forEach((w) => {
            const ref = doc.context.getObjectRef(w.dict);
            if (!ref || naStraneh.has(String(ref))) return;
            naStraneh.add(String(ref));
            const kljuc = kljucOkvirja(doc, w.dict);
            const dvojnik = kljuc && dvojniki.get(kljuc);
            if (dvojnik) {
              dvojnik.seznam.set(dvojnik.mesto, ref);
              dvojniki.delete(kljuc);
              return;
            }
            const pg = stran ? strani[stran - 1] : null;
            if (pg) pg.node.addAnnot(ref);
          });
        });
    }

    /**
     * Zapiše seznam videzov okenca neposredno v /AP /N.
     *
     * Kadar obrazec tja postavi sklic na slovar stanj (<< /Da ... /Off ... >>),
     * pdf-lib ob sploščitvi ne izbere pravega stanja, ampak na stran nariše
     * kar slovar - okence ostane prazno. Sklic zato razrešimo vnaprej.
     */
    function razresiVideze(doc, form, opozorila) {
      try {
        form.getFields().forEach((f) => {
          const tip = tipPolja(f);
          if (tip !== "CheckBox" && tip !== "RadioGroup") return;
          f.acroField.getWidgets().forEach((w) => {
            const ap = w.dict.lookup(PDFName.of("AP"));
            if (!ap || typeof ap.get !== "function") return;
            const n = ap.get(PDFName.of("N"));
            if (!(n instanceof PDFRef)) return;
            const razresen = doc.context.lookup(n);
            if (razresen instanceof PDFDict) ap.set(PDFName.of("N"), razresen);
          });
        });
      } catch (e) {
        opozorila.push(`Videza okenc ni bilo mogoče razrešiti: ${e.message}`);
      }
    }

    /**
     * Poišče označena okenca, ki v obrazcu nimajo narisane kljukice.
     * Vrne mesta (v točkah), kamor naj sami narišemo križec.
     */
    function okencaBrezKljukice(doc, form) {
      const mesta = [];
      const strani = doc.getPages();
      form.getFields().forEach((f) => {
        const tip = tipPolja(f);
        if (tip !== "CheckBox" && tip !== "RadioGroup") return;
        f.acroField.getWidgets().forEach((w) => {
          const stanje = w.dict.get(PDFName.of("AS"));
          if (!stanje || String(stanje) === "/Off") return;
          if (!videzJePrazen(doc, w, stanje)) return;
          const stran = strani.findIndex((pg) => {
            const a = pg.node.Annots && pg.node.Annots();
            if (!a) return false;
            const ref = doc.context.getObjectRef(w.dict);
            for (let i = 0; i < a.size(); i++)
              if (String(a.get(i)) === String(ref)) return true;
            return false;
          });
          const r = w.getRectangle();
          mesta.push({
            stran: (stran < 0 ? 0 : stran) + 1,
            x: r.x,
            y: r.y,
            sirina: r.width,
            visina: r.height,
            oblika: "kvadrat",
          });
        });
      });
      return mesta;
    }

    /** Ali je vklopljeni videz okenca enak izklopljenemu (torej brez kljukice)? */
    function videzJePrazen(doc, w, stanje) {
      try {
        const ap = w.dict.lookup(PDFName.of("AP"));
        const n = ap && ap.lookup(PDFName.of("N"));
        if (!n || typeof n.lookup !== "function") return false;
        const vklop = n.lookup(stanje);
        const izklop = n.lookup(PDFName.of("Off"));
        if (!vklop || !izklop) return false;
        const a = vklop.getContents();
        const b = izklop.getContents();
        if (!a || !b || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
      } catch {
        return false;
      }
    }

    /** Okvir prepoznamo po imenu polja in položaju - dvojnika sta enaka. */
    function kljucOkvirja(doc, dict) {
      if (!dict || typeof dict.get !== "function") return null;
      const rect = dict.get(PDFName.of("Rect"));
      if (!rect) return null;
      const ime = dict.get(PDFName.of("T"));
      return `${ime ? String(ime) : ""}|${String(rect)}`;
    }

    function nastaviIzbiro(polje, vklop, opozorila) {
      const okenca = polje.acroField.getWidgets();
      const iskano = okenca
        .map((w) => w.getOnValue())
        .find((v) => v && v.asString().replace(/^\//, "") === vklop);
      if (!iskano) {
        opozorila.push(`Možnosti "${vklop}" v polju "${polje.getName()}" ni.`);
        return;
      }
      polje.acroField.dict.set(PDFName.of("V"), iskano);
      okenca.forEach((w) => {
        const v = w.getOnValue();
        w.setAppearanceState(
          v && v.asString() === iskano.asString() ? v : PDFName.of("Off")
        );
      });
    }

    return {
      shemaIzDokumenta,
      izpolni,
      mereStrani,
      preberiPolja,
      dodajManjkajocaPolja,
    };
  }

  return { ustvari };
});
