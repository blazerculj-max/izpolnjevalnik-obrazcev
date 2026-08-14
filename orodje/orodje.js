// orodje.js
// Samostojno orodje za izpolnjevanje PDF obrazcev - deluje brez strežnika.
//
// Vse se zgodi v brskalniku: PDF nikoli ne zapusti računalnika.
// Pamet je ista kot v asistentu (skupno/obrazci-logika.js in
// skupno/obrazci-pdf.js), tu je le vmesnik in branje datoteke.
//
// Okolje pripravi stran (orodje/predloga.html ali zgrajena enodatotečna
// različica) in ponudi:
//   window.PDFLib, window.fontkit, window.ObrazciLogika, window.ObrazciPdf
//   window.naloziPdfJs()   -> Promise<pdfjs modul>
//   window.naloziPisavo()  -> Promise<Uint8Array | null>

(function () {
  "use strict";

  const obrazciPdf = window.ObrazciPdf.ustvari({
    PDFLib: window.PDFLib,
    fontkit: window.fontkit,
    logika: window.ObrazciLogika,
  });

  // ------------------------------------------------------------------ stanje

  let izvorniBajti = null; // izvirni PDF (nedotaknjen, za vsakokratno izpolnitev)
  let pdfjsDoc = null; // odprt dokument v pdfjs (za izris strani)
  let odprtObrazec = null; // { ime, shema }
  let podpisniPasovi = []; // [{ id, naziv, slika, stran, x, y, sirina, sifra }]
  let idPodpisaVZajemu = null;
  let odgovoriVrstic = {}; // { idVrstice: "DA" | "NE" }
  let pisavaBajti = null;
  // Izvožen PDF živi kot blob: naslov, dokler ga ne sprostimo ali dokler se
  // stran ne zapre. Ker vsebuje podatke stranke, ga počistimo takoj, ko ga
  // ne rabimo več.
  let zivijBlobi = [];

  const prikaz = document.getElementById("prikaz-obrazca");
  const spustisce = document.getElementById("spustisce");
  const vnosDatoteke = document.getElementById("vnos-datoteke");

  // ------------------------------------------------------- odpiranje datoteke

  vnosDatoteke.addEventListener("change", () => {
    if (vnosDatoteke.files[0]) odpriDatoteko(vnosDatoteke.files[0]);
  });
  document
    .getElementById("izberi-datoteko")
    .addEventListener("click", () => vnosDatoteke.click());

  ["dragenter", "dragover"].forEach((d) =>
    spustisce.addEventListener(d, (e) => {
      e.preventDefault();
      spustisce.classList.add("cez");
    })
  );
  ["dragleave", "drop"].forEach((d) =>
    spustisce.addEventListener(d, (e) => {
      e.preventDefault();
      spustisce.classList.remove("cez");
    })
  );
  spustisce.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f) odpriDatoteko(f);
  });

  async function odpriDatoteko(datoteka) {
    if (!/\.pdf$/i.test(datoteka.name)) {
      prikaziNapako("Izberi datoteko PDF.");
      return;
    }
    odpriBajte(new Uint8Array(await datoteka.arrayBuffer()), datoteka.name);
  }

  async function odpriBajte(bajti, ime) {
    prikaz.innerHTML = '<p class="prazno">Berem obrazec…</p>';
    try {
      izvorniBajti = bajti;

      // pdfjs in pdf-lib dobita vsak svojo kopijo: pdfjs vhodni medpomnilnik
      // prevzame (detach) in izvirnik bi ostal prazen.
      const pdfjs = await window.naloziPdfJs();
      if (pdfjsDoc) await pdfjsDoc.destroy();
      pdfjsDoc = await pdfjs.getDocument({
        data: izvorniBajti.slice(),
        useSystemFonts: true,
      }).promise;

      const besedilo = await preberiBesediloSKoordinatami(pdfjsDoc);
      const doc = await window.PDFLib.PDFDocument.load(izvorniBajti.slice(), {
        ignoreEncryption: true,
      });

      const shema = obrazciPdf.shemaIzDokumenta(doc, besedilo);
      odprtObrazec = { ime, shema };
      odgovoriVrstic = {};
      pripraviPodpisnePasove();
      izrisiObrazec();
      oznaciIzbranegaVKazalu(ime);
    } catch (e) {
      prikaziNapako("Obrazca ni bilo mogoče prebrati: " + e.message);
    }
  }

  // ------------------------------------------------- kazalo pripravljenih obrazcev

  // Kadar orodje stoji na spletu (GitHub Pages), poleg njega ležijo tudi
  // obrazci - takrat kolegu ni treba nikjer iskati PDF-ja. Ko je datoteka
  // odprta z dvoklikom (file://), tega seznama ni in ostane spuščanje datoteke.
  const kazaloEl = document.getElementById("kazalo-obrazcev");

  async function naloziKazalo() {
    if (!kazaloEl) return;
    try {
      const odziv = await fetch("obrazci/kazalo.json", { cache: "no-cache" });
      if (!odziv.ok) throw new Error(odziv.status);
      const kazalo = await odziv.json();
      if (!Array.isArray(kazalo.obrazci) || kazalo.obrazci.length === 0) return;
      izrisiKazalo(kazalo.obrazci);
    } catch {
      /* brez seznama: uporabnik obrazec preprosto povleče na stran */
    }
  }

  function izrisiKazalo(obrazci) {
    kazaloEl.innerHTML = `<h2>Obrazci</h2>
      <div class="kazalo-plosce">${obrazci
        .map(
          (o) => `<button type="button" class="plosca-obrazca" data-datoteka="${escapeHtml(
            o.datoteka
          )}">
            <strong>${escapeHtml(o.ime)}</strong>
            <span>${o.strani} ${o.strani === 1 ? "stran" : "strani"} · ${
            o.stevilo_polj
          } polj</span>
          </button>`
        )
        .join("")}</div>`;
    kazaloEl.classList.remove("skrit");
    kazaloEl.querySelectorAll("[data-datoteka]").forEach((b) =>
      b.addEventListener("click", () => odpriIzKazala(b.dataset.datoteka))
    );
  }

  async function odpriIzKazala(datoteka) {
    prikaz.innerHTML = '<p class="prazno">Prenašam obrazec…</p>';
    try {
      const odziv = await fetch("obrazci/" + encodeURIComponent(datoteka));
      if (!odziv.ok) throw new Error("HTTP " + odziv.status);
      await odpriBajte(new Uint8Array(await odziv.arrayBuffer()), datoteka);
    } catch (e) {
      prikaziNapako("Obrazca ni bilo mogoče prenesti: " + e.message);
    }
  }

  function oznaciIzbranegaVKazalu(ime) {
    if (!kazaloEl) return;
    kazaloEl
      .querySelectorAll("[data-datoteka]")
      .forEach((b) => b.classList.toggle("izbran", b.dataset.datoteka === ime));
  }

  // Kopija za delo brez povezave ima smisel le, kadar orodje stoji na spletu.
  const prenesiEl = document.getElementById("prenesi-orodje");
  if (prenesiEl && /^https?:$/.test(location.protocol)) {
    prenesiEl.classList.remove("skrit");
  }

  // Ob zapiranju strani za sabo ne pustimo blob naslovov s podatki stranke.
  window.addEventListener("pagehide", sprostiBlobe);

  naloziKazalo();

  function prikaziNapako(sporocilo) {
    prikaz.innerHTML = `<div class="opozorilo"><strong>Napaka</strong>${escapeHtml(
      sporocilo
    )}</div>`;
  }

  /** Besedilo strani s koordinatami - vhod za skupno logiko oznak. */
  async function preberiBesediloSKoordinatami(doc) {
    const strani = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const stran = await doc.getPage(i);
      const vsebina = await stran.getTextContent();
      strani.push({
        stran: i,
        kosi: vsebina.items
          .filter((x) => x.str && x.str.trim())
          .map((x) => ({
            besedilo: x.str.trim(),
            x: x.transform[4],
            y: x.transform[5],
            w: x.width,
          })),
      });
    }
    return strani;
  }

  // ------------------------------------------------------------- podpisna mesta

  /** Iz napisov na obrazcu ("PODPIS ZAVAROVALCA") pripravimo mesta za podpise. */
  function pripraviPodpisnePasove() {
    const najdeni = odprtObrazec.shema.podpisi || [];
    podpisniPasovi = najdeni.map((m, i) => ({
      id: "podpis" + i,
      naziv: lepNaziv(m.naziv),
      stran: m.stran,
      x: m.x,
      y: m.y,
      sirina: 22,
      slika: null,
      potrebujeSifro: !!m.potrebujeSifro,
      zaProdajnika: !!m.zaProdajnika,
      sifra: m.potrebujeSifro ? localStorage.getItem("sifra-prodajnika") || "" : "",
    }));
    // Če napisov nismo našli, ponudimo vsaj en prosti podpis.
    if (podpisniPasovi.length === 0) {
      podpisniPasovi = [
        {
          id: "podpis0",
          naziv: "Podpis",
          stran: odprtObrazec.shema.strani.length,
          x: 50,
          y: 85,
          sirina: 22,
          slika: null,
          potrebujeSifro: false,
          sifra: "",
        },
      ];
    }
  }

  function lepNaziv(s) {
    const t = String(s).trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function najdiPas(id) {
    return podpisniPasovi.find((p) => p.id === id);
  }

  // ------------------------------------------------------------------- izris

  function izrisiObrazec() {
    const { ime, shema } = odprtObrazec;

    if (shema.polja.length === 0) {
      prikaz.innerHTML = `<h2>${escapeHtml(ime)}</h2>
        <div class="opozorilo"><strong>Ta PDF nima vnosnih polj</strong>
        Obrazec mora biti »aktiven« (AcroForm). Skenirane ali natisnjene
        različice ni mogoče izpolnjevati - vprašaj za aktivno različico.</div>`;
      return;
    }

    // Polja, ki so del vrstice z odgovorom, ne prikazujemo posebej.
    const vVrsticah = new Set(
      (shema.vrstice || []).flatMap((v) => v.odgovori.flatMap((o) => o.polja))
    );

    // Vse skupaj postavimo v vrstni red, kot si sledi na papirju.
    const elementi = [
      ...shema.polja
        .filter((p) => !vVrsticah.has(p.ime))
        .map((p) => ({ stran: p.stran, y: p.polozaj?.y ?? 0, html: poljeVHtml(p) })),
      ...(shema.vrstice || []).map((v) => ({
        stran: v.stran,
        y: v.y,
        html: vrsticaVHtml(v),
      })),
    ].sort((a, b) => a.stran - b.stran || a.y - b.y);

    const poStrani = new Map();
    elementi.forEach((e) => {
      if (!poStrani.has(e.stran)) poStrani.set(e.stran, []);
      poStrani.get(e.stran).push(e.html);
    });

    const skupine = [...poStrani.entries()]
      .map(
        ([stran, deli]) => `<div class="polja-skupina">
          <h3>Stran ${stran}</h3>
          <div class="mreza-polj">${deli.join("")}</div>
        </div>`
      )
      .join("");

    prikaz.innerHTML = `
      <h2>${escapeHtml(ime.replace(/\.pdf$/i, "").replace(/[-_]/g, " "))}</h2>
      <p class="meta">${shema.polja.length} polj · ${shema.strani.length} strani ·
        obdelano v tvojem brskalniku</p>
      <div class="obrazec-postavitev">
        <form id="obrazec-polja" autocomplete="off">${skupine}</form>
        <aside class="podpis-plosca">
          <h3>Podpisi</h3>
          <p class="namig" style="margin:0 0 8px">
            Podpis zajemi, nato ga povleci na pravo mesto na strani.
          </p>
          <div id="seznam-podpisov"></div>
          <label class="oznaka-polja" style="margin-top:12px">Stran za postavitev</label>
          <select id="stran-podpisa">
            ${shema.strani
              .map((s) => `<option value="${s.stran}">Stran ${s.stran}</option>`)
              .join("")}
          </select>
          <div class="podpis-mesto" id="podpis-mesto"></div>
        </aside>
      </div>
      <div class="obrazec-orodja">
        <button class="gumb-glavni" id="pripravi-pdf">Pripravi PDF</button>
        <button class="gumb-tih" id="pocisti-obrazec"
          title="Pobriše polja, odgovore, podpise in pripravljen PDF">Počisti vse</button>
        <label class="polje-potrditev" style="padding:0;border:none;background:none">
          <input type="checkbox" id="zakleni" checked />
          <span style="font-size:13px">zakleni polja (za tisk in pošiljanje)</span>
        </label>
        <span class="stanje" id="stanje-obrazca"></span>
      </div>
      <div id="izhod-pdf"></div>`;

    document.getElementById("pripravi-pdf").addEventListener("click", pripraviPdf);
    document.getElementById("pocisti-obrazec").addEventListener("click", pocistiVse);

    // Klik na DA/NE velja za celo vrstico; ponoven klik odgovor prekliče.
    prikaz.querySelectorAll(".odgovor-gumb[data-vrstica]").forEach((g) =>
      g.addEventListener("click", () => {
        const { vrstica, odgovor } = g.dataset;
        const jeIzbran = odgovoriVrstic[vrstica] === odgovor;
        odgovoriVrstic[vrstica] = jeIzbran ? undefined : odgovor;
        prikaz
          .querySelectorAll(`.odgovor-gumb[data-vrstica="${vrstica}"]`)
          .forEach((d) => d.classList.toggle("izbran", !jeIzbran && d === g));
      })
    );

    const izbiraStrani = document.getElementById("stran-podpisa");
    const privzetaStran = podpisniPasovi[0]?.stran || 1;
    izbiraStrani.value = String(privzetaStran);
    izbiraStrani.addEventListener("change", () =>
      izrisiMestoPodpisa(Number(izbiraStrani.value))
    );

    izrisiSeznamPodpisov();
    izrisiMestoPodpisa(privzetaStran);
  }

  /**
   * Vrstica obrazca z enim odgovorom za vsa okenca v njej.
   * Zastopnik klikne DA ali NE enkrat, obkljuka pa se okence v stolpcu POTREBE
   * in v stolpcu ZAHTEVE - tako, kot vrstica teče na papirju.
   */
  function vrsticaVHtml(v) {
    const naVoljo = new Map(v.odgovori.map((o) => [o.odgovor, o]));
    const gumb = (odgovor) => {
      const o = naVoljo.get(odgovor);
      if (!o) return "";
      const razred = odgovor === "DA" ? "da" : "ne";
      const stOkenc = o.polja.length + o.oznake.length;
      return `<button type="button" class="odgovor-gumb ${razred}"
        data-vrstica="${v.id}" data-odgovor="${odgovor}"
        title="Označi ${stOkenc} okenci v tej vrstici">${odgovor}</button>`;
    };
    return `<div class="polje sirok vrstica-odgovora" data-id="${v.id}">
        <div class="vrstica-besedilo">
          <span class="vrstica-trditev">${escapeHtml(v.oznaka)}</span>
          ${v.dodatno ? `<span class="vrstica-produkt">${escapeHtml(v.dodatno)}</span>` : ""}
        </div>
        <div class="odgovor-gumbi">${gumb("DA")}${gumb("NE")}</div>
      </div>`;
  }

  /**
   * Ali besedilo iz PDF-ja pove kaj več od oznake polja?
   * Pri poljih kot "Naslov" je pojasnilo "naslov" samo ponovitev.
   */
  function pojasniloJeKoristno(p) {
    if (!p.oznaka_iz_pdf || p.oznaka_iz_pdf === p.oznaka) return false;
    const ocisti = (s) =>
      String(s).toLowerCase().replace(/[^a-zčšž0-9]+/g, " ").replace(/\s+/g, " ").trim();
    const a = ocisti(p.oznaka);
    const b = ocisti(p.oznaka_iz_pdf);
    return !a.includes(b) && !b.includes(a);
  }

  /** Polje obrazca kot vnos v spletnem obrazcu. */
  function poljeVHtml(p) {
    const id = "polje-" + encodeURIComponent(p.ime);
    const oznaka = escapeHtml(p.oznaka || p.ime);
    const znacka = p.glava
      ? `<span class="znacka-odgovor ${p.glava === "DA" ? "da" : "ne"}">${escapeHtml(
          p.glava
        )}</span>`
      : "";
    const pojasnilo = pojasniloJeKoristno(p)
      ? `<span class="pojasnilo-polja">${escapeHtml(p.oznaka_iz_pdf)}</span>`
      : "";

    if (p.tip === "CheckBox") {
      return `<div class="polje polje-potrditev sirok" title="${escapeHtml(p.ime)}">
        <input type="checkbox" id="${id}" data-ime="${escapeHtml(p.ime)}" data-tip="CheckBox" />
        <label for="${id}">${znacka}${oznaka}${pojasnilo}</label></div>`;
    }
    if (p.moznosti && p.moznosti.length) {
      return `<div class="polje"><label class="oznaka-polja" for="${id}">${oznaka}</label>
        <select id="${id}" data-ime="${escapeHtml(p.ime)}" data-tip="${p.tip}">
          <option value=""></option>
          ${p.moznosti
            .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
            .join("")}
        </select>${pojasnilo}</div>`;
    }
    // autocomplete/spellcheck izklopimo na vsakem polju posebej: Safari
    // nastavitev na obrazcu pogosto ignorira in bi si podatke stranke
    // zapomnil za samodejno izpolnjevanje.
    return `<div class="polje"><label class="oznaka-polja" for="${id}">${oznaka}</label>
      <input type="text" id="${id}" data-ime="${escapeHtml(p.ime)}" data-tip="TextField"
        autocomplete="off" autocorrect="off" spellcheck="false"
        ${p.najvec_znakov ? `maxlength="${p.najvec_znakov}"` : ""} />${pojasnilo}</div>`;
  }

  /** Seznam podpisnih mest s predogledom in gumbom za zajem. */
  function izrisiSeznamPodpisov() {
    const ovoj = document.getElementById("seznam-podpisov");
    if (!ovoj) return;
    ovoj.innerHTML = podpisniPasovi
      .map(
        (p) => `<div class="podpis-pas" data-id="${p.id}">
          <div class="podpis-pas-glava">
            <strong>${escapeHtml(p.naziv)}</strong>
            <span class="namig">str. ${p.stran}</span>
          </div>
          <div class="podpis-predogled" data-predogled="${p.id}">
            ${p.slika ? `<img src="${p.slika}" alt="Podpis" />` : "Še ni podpisa"}
          </div>
          ${
            p.potrebujeSifro
              ? `<input type="text" class="sifra-vnos" data-sifra="${p.id}"
                   placeholder="Šifra prodajnika" value="${escapeHtml(p.sifra)}" />`
              : ""
          }
          <div class="podpis-pas-gumbi">
            <button type="button" class="gumb-tih majhen" data-zajemi="${p.id}">
              ${p.slika ? "Znova" : "Zajemi podpis"}
            </button>
            ${
              p.slika
                ? `<button type="button" class="gumb-tih majhen" data-odstrani="${p.id}">Odstrani</button>`
                : ""
            }
          </div>
        </div>`
      )
      .join("");

    ovoj.querySelectorAll("[data-zajemi]").forEach((b) =>
      b.addEventListener("click", () => odpriOknoPodpisa(b.dataset.zajemi))
    );
    ovoj.querySelectorAll("[data-odstrani]").forEach((b) =>
      b.addEventListener("click", () => {
        najdiPas(b.dataset.odstrani).slika = null;
        izrisiSeznamPodpisov();
        izrisiZnakePodpisov();
      })
    );
    ovoj.querySelectorAll("[data-sifra]").forEach((v) =>
      v.addEventListener("input", () => {
        najdiPas(v.dataset.sifra).sifra = v.value;
        localStorage.setItem("sifra-prodajnika", v.value);
      })
    );
  }

  /** Stran izrišemo s pdfjs - podpise nanjo postavimo z vlečenjem. */
  async function izrisiMestoPodpisa(stran) {
    const ovoj = document.getElementById("podpis-mesto");
    if (!ovoj || !pdfjsDoc) return;
    ovoj.dataset.stran = String(stran);
    ovoj.innerHTML = "";

    const platnoStrani = document.createElement("canvas");
    ovoj.appendChild(platnoStrani);

    const p = await pdfjsDoc.getPage(stran);
    const pogled = p.getViewport({ scale: 1 });
    // 760 px je dovolj, da se vidi, kam podpis pade, in dovolj malo,
    // da izris ostane hiter tudi na iPadu.
    const merilo = 760 / pogled.width;
    const koncni = p.getViewport({ scale: merilo });
    platnoStrani.width = Math.round(koncni.width);
    platnoStrani.height = Math.round(koncni.height);
    await p.render({ canvasContext: platnoStrani.getContext("2d"), viewport: koncni })
      .promise;

    izrisiZnakePodpisov();
  }

  /** Oznake podpisov na sliki strani - vsako je mogoče povleči. */
  function izrisiZnakePodpisov() {
    const ovoj = document.getElementById("podpis-mesto");
    if (!ovoj) return;
    const stran = Number(ovoj.dataset.stran);
    ovoj.querySelectorAll(".podpis-znak").forEach((z) => z.remove());

    podpisniPasovi
      .filter((p) => p.stran === stran)
      .forEach((p) => {
        const znak = document.createElement("div");
        znak.className = "podpis-znak" + (p.slika ? " ima-podpis" : "");
        znak.dataset.id = p.id;
        znak.style.left = p.x + "%";
        znak.style.top = p.y + "%";
        znak.style.width = p.sirina + "%";
        znak.innerHTML = p.slika
          ? `<img src="${p.slika}" alt="" />`
          : `<span>${escapeHtml(p.naziv)}</span>`;
        znak.title = "Povleci na pravo mesto";
        omogociVlecenje(znak, p, ovoj);
        ovoj.appendChild(znak);
      });
  }

  /** Vlečenje oznake podpisa po sliki strani (miška, dotik, pero). */
  function omogociVlecenje(znak, pas, ovoj) {
    znak.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      znak.setPointerCapture(e.pointerId);
      znak.classList.add("vlecem");

      const premakni = (dogodek) => {
        const r = ovoj.getBoundingClientRect();
        pas.x = Math.min(98, Math.max(2, ((dogodek.clientX - r.left) / r.width) * 100));
        pas.y = Math.min(98, Math.max(2, ((dogodek.clientY - r.top) / r.height) * 100));
        znak.style.left = pas.x + "%";
        znak.style.top = pas.y + "%";
      };

      const koncaj = () => {
        znak.classList.remove("vlecem");
        znak.removeEventListener("pointermove", premakni);
        znak.removeEventListener("pointerup", koncaj);
        znak.removeEventListener("pointercancel", koncaj);
      };

      znak.addEventListener("pointermove", premakni);
      znak.addEventListener("pointerup", koncaj);
      znak.addEventListener("pointercancel", koncaj);
    });
  }

  // ------------------------------------------------------------- priprava PDF

  function sprostiBlobe() {
    zivijBlobi.forEach((u) => URL.revokeObjectURL(u));
    zivijBlobi = [];
  }

  /** Pobriše vse, kar je vpisala stranka - polja, odgovore, podpise, izvoz. */
  function pocistiVse() {
    const obrazec = document.getElementById("obrazec-polja");
    if (obrazec) obrazec.reset();
    odgovoriVrstic = {};
    document
      .querySelectorAll(".odgovor-gumb.izbran")
      .forEach((g) => g.classList.remove("izbran"));
    podpisniPasovi.forEach((p) => {
      p.slika = null;
    });
    sprostiBlobe();
    const izhod = document.getElementById("izhod-pdf");
    if (izhod) izhod.innerHTML = "";
    const stanje = document.getElementById("stanje-obrazca");
    if (stanje) stanje.textContent = "Počiščeno.";
    izrisiSeznamPodpisov();
    izrisiZnakePodpisov();
  }

  async function pripraviPdf() {
    const stanje = document.getElementById("stanje-obrazca");
    const vrednosti = {};
    document.querySelectorAll("#obrazec-polja [data-ime]").forEach((el) => {
      if (el.dataset.tip === "CheckBox") {
        if (el.checked) vrednosti[el.dataset.ime] = true;
      } else if (el.value.trim()) {
        vrednosti[el.dataset.ime] = el.value.trim();
      }
    });

    // En odgovor v vrstici označi vsa okenca tega odgovora (POTREBE in ZAHTEVE).
    // Kjer obrazec polja nima, križec narišemo sami.
    let odgovorjenihVrstic = 0;
    const oznake = [];
    for (const vrstica of odprtObrazec.shema.vrstice || []) {
      const izbran = odgovoriVrstic[vrstica.id];
      if (!izbran) continue;
      const najden = vrstica.odgovori.find((o) => o.odgovor === izbran);
      if (!najden) continue;
      najden.polja.forEach((ime) => {
        vrednosti[ime] = true;
      });
      oznake.push(...najden.oznake);
      odgovorjenihVrstic++;
    }

    const podpisi = podpisniPasovi
      .filter((p) => p.slika)
      .map((p) => ({
        slika: p.slika,
        stran: p.stran,
        x: p.x,
        y: p.y,
        sirina: p.sirina,
        besedilo: p.sifra || null,
      }));

    stanje.textContent = "Pripravljam…";
    try {
      if (!pisavaBajti) pisavaBajti = await window.naloziPisavo();

      // Vsakič izhajamo iz izvirnika: tako drugi izvoz ne podeduje prvega.
      const doc = await window.PDFLib.PDFDocument.load(izvorniBajti.slice(), {
        ignoreEncryption: true,
      });
      const { pdf, opozorila } = await obrazciPdf.izpolni(doc, {
        vrednosti,
        podpisi,
        zakleni: document.getElementById("zakleni").checked,
        oznake,
        pisavaBajti,
      });

      sprostiBlobe(); // prejšnji izvoz ne rabi več viseti v pomnilniku
      const url = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
      zivijBlobi.push(url);
      const imeDatoteke = odprtObrazec.ime.replace(/\.pdf$/i, "") + "-izpolnjen.pdf";
      document.getElementById("izhod-pdf").innerHTML = `
        <div class="obrazec-orodja">
          <a class="gumb-glavni" href="${url}" download="${escapeHtml(imeDatoteke)}"
             style="text-decoration:none;display:inline-block">Prenesi PDF</a>
          <a class="gumb-tih" href="${url}" target="_blank"
             style="text-decoration:none;display:inline-block">Odpri za tisk</a>
        </div>
        ${
          opozorila.length
            ? `<div class="opozorilo"><strong>Opozorila</strong><ul>${opozorila
                .map((o) => `<li>${escapeHtml(o)}</li>`)
                .join("")}</ul></div>`
            : ""
        }
        <object class="predogled-pdf" data="${url}" type="application/pdf">
          <p class="namig" style="padding:14px">
            Ta brskalnik ne prikaže PDF-ja neposredno — uporabi gumba zgoraj.
          </p>
        </object>`;
      stanje.textContent = `Pripravljeno · ${Object.keys(vrednosti).length} polj${
        odgovorjenihVrstic ? ` · ${odgovorjenihVrstic} odgovorjenih vrstic` : ""
      }${podpisi.length ? ` · ${podpisi.length} podpis(ov)` : ""}`;
    } catch (e) {
      stanje.textContent = "Napaka: " + e.message;
    }
  }

  // ---------------------------------------------------------- podpis na platno

  const oknoPodpisa = document.getElementById("okno-podpisa");
  const platno = document.getElementById("platno-podpisa");
  const ctx = platno.getContext("2d");
  const gumbZacni = document.getElementById("zacni-risanje");
  const namigPodpisa = document.getElementById("namig-podpisa");
  let rise = false;
  let jePodpisan = false;

  // Prostoročni način: na sledilni ploščici MacBooka je držanje klika med
  // podpisovanjem nerodno, zato po pritisku na "Začni risanje" riše že samo
  // premikanje prsta.
  //
  // Dve stvari, brez katerih to ni uporabno:
  //  1. Odštevanje - po kliku na gumb prst še potuje proti ploščici in ta pot
  //     bi se narisala. Zato risanje steče šele po nekaj sekundah.
  //  2. Relativno risanje - na ploščici ne vidiš, kje je kazalec. Pero zato
  //     vedno začne na sredini levo, nato pa sledi le PREMIKOM prsta,
  //     ne absolutnemu položaju kazalca.
  let prostorocno = false;
  let casovnikMirovanja = null;
  let casovnikOdstevanja = null;
  let pero = null; // navidezno pero: { x, y } v koordinatah platna
  let zadnjiKazalec = null; // za računanje premika
  const MIROVANJE_MS = 2000;
  const ODSTEVANJE_S = 2;
  const ZACETEK_X = 0.1; // 10 % širine od levega roba
  const ZACETEK_Y = 0.55; // malo pod sredino, kot na podpisni črti
  // Kazalec zaradi pospeševanja prepotuje precej več kot prst po ploščici;
  // brez zadržka bi pero po nekaj potezah že zadelo desni rob.
  const OBCUTLJIVOST = 0.6;

  function odpriOknoPodpisa(idPasu) {
    idPodpisaVZajemu = idPasu;
    const pas = najdiPas(idPasu);
    document.getElementById("naslov-podpisa").textContent = pas
      ? pas.naziv
      : "Podpis stranke";
    oknoPodpisa.classList.remove("skrit");
    pocistiPlatno();
  }

  function pocistiPlatno() {
    ctx.clearRect(0, 0, platno.width, platno.height);
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#10243a";
    jePodpisan = false;
    koncajProstorocno();
  }

  /** Po kliku na gumb najprej odšteje, da prst brez sledi pride na ploščico. */
  function zacniProstorocno() {
    koncajProstorocno();
    gumbZacni.textContent = "Prekliči risanje";
    platno.classList.add("odsteva");

    let preostalo = ODSTEVANJE_S;
    const pokazi = () => {
      namigPodpisa.innerHTML =
        `Pripravi prst na sledilno ploščico — risanje se začne čez ` +
        `<strong>${preostalo}</strong>…`;
    };
    pokazi();

    casovnikOdstevanja = setInterval(() => {
      preostalo -= 1;
      if (preostalo > 0) {
        pokazi();
        return;
      }
      clearInterval(casovnikOdstevanja);
      casovnikOdstevanja = null;
      zaceniRisanje();
    }, 1000);
  }

  /** Konec odštevanja: pero postavimo na izhodišče in začnemo loviti premike. */
  function zaceniRisanje() {
    prostorocno = true;
    rise = false;
    zadnjiKazalec = null;
    pero = { x: platno.width * ZACETEK_X, y: platno.height * ZACETEK_Y };

    platno.classList.remove("odsteva");
    platno.classList.add("prostorocno");
    gumbZacni.textContent = "Končaj risanje";
    namigPodpisa.innerHTML =
      "Zdaj drsi s prstom — <strong>brez pritiskanja</strong>. Pero začne na " +
      "sredini levo. Ko se za 2 sekundi ustaviš, se risanje konča.";

    pokaziIzhodisce(true);
    // Premike lovimo na celem oknu: kje je kazalec, ni pomembno, šteje le pot.
    window.addEventListener("pointermove", premikPeresa);
    ponastaviMirovanje();
  }

  /**
   * Označevalec, ki pokaže, kje bo podpis začel.
   * Je nad platnom, ne na njem - sicer bi pikica pristala v podpisu.
   */
  function pokaziIzhodisce(vidno) {
    const znak = document.getElementById("znak-izhodisca");
    if (!znak) return;
    znak.classList.toggle("skrit", !vidno);
    if (!vidno || !pero) return;
    znak.style.left = (pero.x / platno.width) * 100 + "%";
    znak.style.top = (pero.y / platno.height) * 100 + "%";
  }

  function koncajProstorocno() {
    prostorocno = false;
    rise = false;
    zadnjiKazalec = null;
    clearTimeout(casovnikMirovanja);
    clearInterval(casovnikOdstevanja);
    casovnikOdstevanja = null;
    window.removeEventListener("pointermove", premikPeresa);
    pokaziIzhodisce(false);
    platno.classList.remove("prostorocno", "odsteva");
    gumbZacni.textContent = "Začni risanje";
  }

  /** Pero premakne za toliko, kolikor se je premaknil prst. */
  function premikPeresa(e) {
    if (!prostorocno || !pero) return;
    ponastaviMirovanje();

    if (!zadnjiKazalec) {
      zadnjiKazalec = { x: e.clientX, y: e.clientY };
      pokaziIzhodisce(false); // pero je krenilo, oznaka ni več potrebna
      ctx.beginPath();
      ctx.moveTo(pero.x, pero.y);
      return;
    }

    // Premik kazalca preslikamo iz zaslonskih točk v koordinate platna.
    // Če platno (še) nima postavitve, je širina 0 - brez varovala bi merilo
    // postalo neskončno in koordinate peresa NaN.
    const r = platno.getBoundingClientRect();
    const merilo = (r.width > 0 ? platno.width / r.width : 1) * OBCUTLJIVOST;
    pero.x = Math.min(
      platno.width,
      Math.max(0, pero.x + (e.clientX - zadnjiKazalec.x) * merilo)
    );
    pero.y = Math.min(
      platno.height,
      Math.max(0, pero.y + (e.clientY - zadnjiKazalec.y) * merilo)
    );
    zadnjiKazalec = { x: e.clientX, y: e.clientY };

    ctx.lineTo(pero.x, pero.y);
    ctx.stroke();
    jePodpisan = true;
  }

  /** Po 2 s mirovanja risanje ustavimo in ponudimo Potrdi / Ponovi. */
  function ponastaviMirovanje() {
    clearTimeout(casovnikMirovanja);
    casovnikMirovanja = setTimeout(() => {
      if (!prostorocno) return;
      koncajProstorocno();
      if (jePodpisan) {
        namigPodpisa.innerHTML =
          "Risanje končano. <strong>Potrdi</strong> podpis ali ga s <strong>Ponovi</strong> nariši znova.";
        document.getElementById("shrani-podpis").focus();
      } else {
        namigPodpisa.textContent =
          "Nič ni bilo narisano. Znova pritisni »Začni risanje« in drsi s prstom.";
      }
    }, MIROVANJE_MS);
  }

  gumbZacni.addEventListener("click", () => {
    const tece = prostorocno || casovnikOdstevanja;
    if (tece) {
      koncajProstorocno();
      namigPodpisa.textContent = "Risanje ustavljeno.";
    } else {
      zacniProstorocno();
    }
  });

  /** Točka iz dogodka, preslikana iz prikazane velikosti v velikost platna. */
  function tocka(e) {
    const r = platno.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * platno.width,
      y: ((e.clientY - r.top) / r.height) * platno.height,
    };
  }

  // Pointer dogodki pokrijejo miško, sledilno ploščico, dotik in Apple Pencil naenkrat.
  platno.addEventListener("pointerdown", (e) => {
    if (prostorocno) return; // v prostoročnem načinu klik ni potreben
    e.preventDefault();
    platno.setPointerCapture(e.pointerId);
    rise = true;
    const t = tocka(e);
    ctx.beginPath();
    ctx.moveTo(t.x, t.y);
  });

  // Risanje s pritiskom (dotik, pero, miška). Prostoročni način ima svoj
  // poslušalec na oknu, zato se tu ne oglašamo.
  platno.addEventListener("pointermove", (e) => {
    if (prostorocno || !rise) return;
    e.preventDefault();
    const t = tocka(e);
    ctx.lineTo(t.x, t.y);
    ctx.stroke();
    jePodpisan = true;
  });

  // Ko kazalec zapusti platno, potezo prekinemo; ob vrnitvi se začne nova.
  platno.addEventListener("pointerleave", () => {
    if (!prostorocno) rise = false;
  });
  ["pointerup", "pointercancel"].forEach((d) =>
    platno.addEventListener(d, () => {
      if (!prostorocno) rise = false;
    })
  );

  document.getElementById("pocisti-podpis").addEventListener("click", () => {
    pocistiPlatno();
    zacniProstorocno(); // "Ponovi" naj takoj omogoči novo risanje
  });
  document.getElementById("preklici-podpis").addEventListener("click", () => {
    koncajProstorocno();
    oknoPodpisa.classList.add("skrit");
  });
  document.getElementById("shrani-podpis").addEventListener("click", () => {
    koncajProstorocno();
    if (jePodpisan && idPodpisaVZajemu) {
      const pas = najdiPas(idPodpisaVZajemu);
      if (pas) pas.slika = obrezanoPlatno();
      izrisiSeznamPodpisov();
      izrisiZnakePodpisov();
    }
    oknoPodpisa.classList.add("skrit");
  });

  /** Podpis obrežemo na dejansko narisano območje, da ni praznega roba. */
  function obrezanoPlatno() {
    const slika = ctx.getImageData(0, 0, platno.width, platno.height);
    let minX = platno.width,
      minY = platno.height,
      maxX = 0,
      maxY = 0,
      najden = false;
    for (let y = 0; y < platno.height; y++) {
      for (let x = 0; x < platno.width; x++) {
        if (slika.data[(y * platno.width + x) * 4 + 3] > 8) {
          najden = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (!najden) return platno.toDataURL("image/png");
    const rob = 6;
    minX = Math.max(0, minX - rob);
    minY = Math.max(0, minY - rob);
    maxX = Math.min(platno.width - 1, maxX + rob);
    maxY = Math.min(platno.height - 1, maxY + rob);

    const izrez = document.createElement("canvas");
    izrez.width = maxX - minX + 1;
    izrez.height = maxY - minY + 1;
    izrez
      .getContext("2d")
      .drawImage(platno, minX, minY, izrez.width, izrez.height, 0, 0, izrez.width, izrez.height);
    return izrez.toDataURL("image/png");
  }

  // ------------------------------------------------------------------ skupno

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
