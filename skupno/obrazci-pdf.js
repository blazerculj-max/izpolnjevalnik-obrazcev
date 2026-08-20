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
    const { rgb, PDFName } = PDFLib;

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
    function najdiStran(doc, widget) {
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
    function preberiPolja(doc, strani) {
      return doc
        .getForm()
        .getFields()
        .map((p) => {
          const tip = tipPolja(p);
          const widget = p.acroField.getWidgets()[0];
          const r = widget ? widget.getRectangle() : null;
          const stran = widget ? najdiStran(doc, widget) : 1;
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
          // preberemo vsa, ne le prvega.
          if (tip === "CheckBox") {
            skupno.okenca = p.acroField
              .getWidgets()
              .map((wid) => {
                const rr = wid.getRectangle();
                const st = najdiStran(doc, wid);
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
      const strani = mereStrani(doc);
      const polja = preberiPolja(doc, strani);

      // Imena polj so pogosto neuporabna ("Checkbox1"), zato oznako preberemo
      // iz besedila, ki v PDF-ju stoji ob polju.
      let podpisi = [];
      if (straniBesedila && straniBesedila.length) {
        const oznake = logika.oznaciPolja(straniBesedila, polja);
        polja.forEach((p) => {
          const najdeno = oznake.get(p.ime);
          if (!najdeno) return;
          p.oznaka_iz_pdf = najdeno.oznaka
            ? logika.pocistiNapis(najdeno.oznaka)
            : null;
          p.glava = najdeno.glava || null;
          p.oznaka = logika.izberiOznako(p.ime, najdeno.oznaka);
          if (najdeno.desno) {
            p.enota = najdeno.desno.enota || null;
            p.pripomba = najdeno.desno.pripomba || null;
            // Če je bila za oznako vzeta prav enota, ta ne pove ničesar.
            if (p.enota && p.oznaka === p.enota) p.oznaka = p.ime;
          }
        });
        podpisi = logika.najdiMestaPodpisov(straniBesedila, strani);
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

      // pravokotnikov v točkah vmesnik ne potrebuje
      polja.forEach((p) => {
        delete p.pravokotnik;
        if (p.okenca) p.okenca.forEach((o) => delete o.pravokotnik);
      });

      // Polja uredimo tako, kot si sledijo na papirju (od zgoraj navzdol, levo desno)
      polja.sort(
        (a, b) =>
          a.stran - b.stran ||
          (a.polozaj?.y ?? 0) - (b.polozaj?.y ?? 0) ||
          (a.polozaj?.x ?? 0) - (b.polozaj?.x ?? 0)
      );

      const razdelki =
        straniBesedila && straniBesedila.length
          ? logika.najdiRazdelke(straniBesedila, strani)
          : [];

      return { strani, polja, podpisi, vrstice, izbire, razdelki };
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
      } = nastavitve;

      const form = doc.getForm();
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
          if (tip === "CheckBox") {
            if (vrednost === true || vrednost === "true") {
              polje.check();
            } else if (vrednost === false || vrednost === "false") {
              polje.uncheck();
            } else {
              // Izbrana možnost večokenčnega polja. pdf-lib zna nastaviti le
              // vklopno vrednost PRVEGA okenca (drugo zavrne z "invalid field
              // value"), zato vrednost in stanje okenc zapišemo sami.
              nastaviIzbiro(polje, String(vrednost), opozorila);
            }
          } else if (
            tip === "RadioGroup" ||
            tip === "Dropdown" ||
            tip === "OptionList"
          ) {
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
      for (const o of Array.isArray(oznake) ? oznake : []) {
        try {
          const stran = doc.getPages()[Math.max(0, (o.stran || 1) - 1)];
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
          const sirina = ((podpis.sirina || 24) / 100) * stran.getWidth();
          const visina = (sirina / png.width) * png.height;
          // Točka, kamor je zastopnik povlekel podpis, je njegovo SREDIŠČE.
          const sredinaX = ((podpis.x ?? 50) / 100) * stran.getWidth();
          const sredinaY = ((podpis.y ?? 80) / 100) * stran.getHeight();
          const x = sredinaX - sirina / 2;
          // v PDF-ju je izhodišče spodaj levo, v vmesniku zgoraj levo
          const y = stran.getHeight() - sredinaY - visina / 2;
          stran.drawImage(png, { x, y, width: sirina, height: visina });

          // Šifra prodajnika se izpiše nad njegov podpis
          if (podpis.besedilo && pisava) {
            stran.drawText(String(podpis.besedilo), {
              x,
              y: y + visina + 2,
              size: 9,
              font: pisava,
            });
          }
        } catch (e) {
          opozorila.push(`Podpisa ni bilo mogoče vstaviti: ${e.message}`);
        }
      }

      return { pdf: await doc.save(), opozorila };
    }

    /** Nastavi večokenčno potrditveno polje na izbrano možnost. */
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

    return { shemaIzDokumenta, izpolni, mereStrani, preberiPolja };
  }

  return { ustvari };
});
