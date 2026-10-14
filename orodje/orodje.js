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
  let izbranaStranPodpisov = 1; // katero stran kažeta zavihek in predogled
  let idPodpisaVZajemu = null;
  let odgovoriVrstic = {}; // { idVrstice: "DA" | "NE" }
  let odgovoriIzbir = {}; // { idIzbire: vklopna vrednost okenca }
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
    const f = vnosDatoteke.files[0];
    // Izbiro počistimo, sicer brskalnik ob ponovni izbiri iste datoteke
    // ne sproži "change" in se ne zgodi nič.
    vnosDatoteke.value = "";
    if (f) odpriDatoteko(f);
  });
  document
    .getElementById("izberi-datoteko")
    .addEventListener("click", () => vnosDatoteke.click());

  // Območje za spuščanje je tudi gumb ("ali klikni za izbiro"; v novem
  // izgledu "+ Odpri svoj PDF obrazec").
  spustisce.addEventListener("click", (e) => {
    if (e.target !== vnosDatoteke) vnosDatoteke.click();
  });
  spustisce.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      vnosDatoteke.click();
    }
  });

  // PDF, spuščen kamorkoli na stran, odpremo v orodju. Brez tega bi ga
  // brskalnik odprl namesto orodja in vpisano bi se izgubilo.
  ["dragover", "drop"].forEach((d) =>
    document.addEventListener(d, (e) => {
      if (!e.dataTransfer || ![...e.dataTransfer.types].includes("Files")) return;
      e.preventDefault();
      if (d === "drop" && !spustisce.contains(e.target)) {
        const f = e.dataTransfer.files[0];
        if (f) odpriDatoteko(f);
      }
    })
  );

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

      // Prejšnji dokument zapremo, a ga NE čakamo: če je obtičal (npr. zaradi
      // napake med branjem), bi čakanje nanj zaklenilo tudi vse nadaljnje
      // poskuse in orodje bi obviselo na "Berem obrazec…".
      if (pdfjsDoc) {
        const prejsnji = pdfjsDoc;
        pdfjsDoc = null;
        prejsnji.destroy().catch(() => {});
      }

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
      odgovoriIzbir = {};
      pripraviPodpisnePasove();
      izrisiObrazec();
      oznaciIzbranegaVKazalu(ime);
    } catch (e) {
      // Ob napaki ne pustimo pol-odprtega dokumenta - naslednji poskus mora
      // začeti na čisto.
      pdfjsDoc = null;
      prikaziNapako("Obrazca ni bilo mogoče prebrati: " + e.message);
    }
  }

  // ------------------------------------------------- kazalo pripravljenih obrazcev

  // Prazni obrazci so vgrajeni v samo datoteko (window.VGRAJENI_OBRAZCI), zato
  // je seznam na voljo tudi pri odpiranju z dvoklikom in brez omrežja.
  // Poljuben drug obrazec uporabnik preprosto povleče na stran.
  const kazaloEl = document.getElementById("kazalo-obrazcev");

  function naloziKazalo() {
    if (!kazaloEl) return;
    const obrazci = Array.isArray(window.VGRAJENI_OBRAZCI)
      ? window.VGRAJENI_OBRAZCI
      : [];
    if (obrazci.length === 0) return;
    izrisiKazalo(obrazci);
  }

  /** base64 -> bajti (obrazci so v datoteki shranjeni kot base64). */
  function izBase64(niz) {
    const dvojiski = atob(niz);
    const bajti = new Uint8Array(dvojiski.length);
    for (let i = 0; i < dvojiski.length; i++) bajti[i] = dvojiski.charCodeAt(i);
    return bajti;
  }

  /**
   * Obrazci po kategorijah. Ključ je začetek imena datoteke; kar ni na
   * seznamu, pade v zadnjo kategorijo, zato nov obrazec nikoli ne izgine.
   */
  const KATEGORIJE = [
    {
      naslov: "Zdravstvena zavarovanja",
      datoteke: [
        "Obrazec-Opredelitev zahtev in potreb stranke_aktivno.pdf",
        "Ponudba-individualna-skupna.pdf",
        "Sprememba-podatkov-zdravstvenih-zavarovanj.pdf",
      ],
    },
    {
      naslov: "Prijava nezgode ali bolezni",
      datoteke: [
        "Prijava-nezgode-iz-zavarovanja-otrok-in-mladih.pdf",
        "Prijava-nezgode.pdf",
        "Prijava-zavarovalnega-primera-hujša-bolezen-poškodba.pdf",
      ],
    },
    { naslov: "Ostalo", datoteke: null },
  ];

  /** Razvrsti obrazce po kategorijah; prazne kategorije izpusti. */
  function poKategorijah(obrazci) {
    const razvrsceni = new Set(
      KATEGORIJE.flatMap((k) => k.datoteke || [])
    );
    return KATEGORIJE.map((k) => ({
      naslov: k.naslov,
      obrazci: k.datoteke
        ? k.datoteke
            .map((d) => obrazci.find((o) => o.datoteka === d))
            .filter(Boolean)
        : obrazci.filter((o) => !razvrsceni.has(o.datoteka)),
    })).filter((k) => k.obrazci.length);
  }

  function izrisiKazalo(obrazci) {
    const plosca = (o) =>
      `<button type="button" class="plosca-obrazca" data-datoteka="${escapeHtml(
        o.datoteka
      )}">
            <strong>${escapeHtml(o.ime)}</strong>
            <span>${o.strani} ${o.strani === 1 ? "stran" : "strani"} · ${
        o.stevilo_polj
      } polj</span>
          </button>`;

    kazaloEl.innerHTML = `<h2>Obrazci</h2>${poKategorijah(obrazci)
      .map(
        (k) => `<h3 class="naslov-kategorije">${ikonaKategorije(k.naslov)}${escapeHtml(
          k.naslov
        )}</h3>
      <div class="kazalo-plosce">${k.obrazci.map(plosca).join("")}</div>`
      )
      .join("")}`;
    kazaloEl.classList.remove("skrit");
    kazaloEl.querySelectorAll("[data-datoteka]").forEach((b) =>
      b.addEventListener("click", () => {
        // V novem izgledu je obrazec svoj zaslon; vrnitev na odprti obrazec
        // ga ne sme na novo naložiti, sicer bi se vpisano izgubilo.
        if (
          jeNovIzgled() &&
          odprtObrazec &&
          odprtObrazec.ime === b.dataset.datoteka &&
          document.getElementById("obrazec-polja")
        ) {
          nastaviZaslon("obrazec");
          return;
        }
        odpriIzKazala(b.dataset.datoteka);
      })
    );
  }

  /** Majhna ikona kategorije (vidna le v novem izgledu). */
  function ikonaKategorije(naslov) {
    const poti = /zdravstv/i.test(naslov)
      ? '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'
      : /nezgod|bolezn/i.test(naslov)
        ? '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>'
        : '<path d="M7 3.5h7l4 4V20.5H6.5V3.5z"/><path d="M14 3.5V8h4"/>';
    return `<svg class="ikona-kategorije samo-nov" viewBox="0 0 24 24" aria-hidden="true">${poti}</svg>`;
  }

  async function odpriIzKazala(datoteka) {
    const najden = (window.VGRAJENI_OBRAZCI || []).find(
      (o) => o.datoteka === datoteka
    );
    if (!najden) {
      prikaziNapako("Tega obrazca ni v datoteki.");
      return;
    }
    await odpriBajte(izBase64(najden.b64), datoteka);
  }

  function oznaciIzbranegaVKazalu(ime) {
    if (!kazaloEl) return;
    kazaloEl
      .querySelectorAll("[data-datoteka]")
      .forEach((b) => b.classList.toggle("izbran", b.dataset.datoteka === ime));
  }

  // Prejšnje različice so si šifro prodajnika zapomnile v napravi. Zdaj se
  // ne shrani nič, zato staro vrednost ob prvem zagonu pobrišemo - sicer bi
  // na že uporabljenih napravah obležala za vedno.
  try {
    localStorage.removeItem("sifra-prodajnika");
  } catch {
    /* v zasebnem oknu localStorage ni na voljo; takrat ni kaj brisati */
  }

  // Service worker shrani orodje, da se nameščena aplikacija odpre tudi brez
  // povezave. Smiseln je le na spletu; iz datoteke (file://) ga ni mogoče
  // registrirati in tam tudi ni potreben - vse je že v datoteki.
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("sw.js")
        .then(spremljajPosodobitve)
        .catch(() => {
          /* brez njega orodje deluje, le brez povezave se ne zažene */
        });
    });
  }

  /**
   * Nova različica se prenese v ozadju, odprta stran pa ostane stara -
   * takšna je cena tega, da se orodje odpre tudi brez povezave. Da
   * uporabnik ne ugiba, ali ima najnovejšo, mu to povemo in osvežitev
   * prepustimo njemu: osvežitev pobriše vpisane podatke, zato je ne smemo
   * sprožiti sami sredi dela.
   */
  function spremljajPosodobitve(registracija) {
    if (!registracija) return;
    let jeImelKrmilnika = !!navigator.serviceWorker.controller;
    const obvesti = () => {
      if (jeImelKrmilnika) pokaziObvestiloOPosodobitvi();
      jeImelKrmilnika = true;
    };
    navigator.serviceWorker.addEventListener("controllerchange", obvesti);
    registracija.addEventListener("updatefound", () => {
      const nova = registracija.installing;
      if (!nova) return;
      nova.addEventListener("statechange", () => {
        if (nova.state === "installed" && navigator.serviceWorker.controller) {
          obvesti();
        }
      });
    });
  }

  /** Ali je v obrazcu že kaj vpisanega? Osvežitev bi to pobrisala. */
  function jeKajVpisanega() {
    const vnosi = [...document.querySelectorAll("#obrazec-polja input, #obrazec-polja textarea")];
    if (vnosi.some((e) => (e.type === "checkbox" ? e.checked : e.value.trim()))) return true;
    if (podpisniPasovi.some((p) => p.slika || p.ime || p.sifra)) return true;
    return Object.values(odgovoriVrstic).some(Boolean) ||
      Object.values(odgovoriIzbir).some(Boolean);
  }

  // --- stanje različice v glavi ---------------------------------------
  // Zelena lučka: tečeš na najnovejši. Rumena: nova je prenesena in čaka.
  let jeNovaRazlicica = false;

  function nastaviStanjeRazlicice(besedilo, razred) {
    const gumb = document.getElementById("stanje-razlicice");
    const napis = document.getElementById("stanje-razlicice-besedilo");
    if (!gumb || !napis) return;
    napis.textContent = besedilo;
    gumb.classList.toggle("je-posodobitev", razred === "je-posodobitev");
    gumb.classList.toggle("preverja", razred === "preverja");
  }

  function pokaziObvestiloOPosodobitvi() {
    jeNovaRazlicica = true;
    nastaviStanjeRazlicice("Novejša različica je na voljo", "je-posodobitev");
  }

  /** Klik na lučko: rumena prevzame novo, zelena znova preveri. */
  async function obKlikuNaStanje() {
    if (jeNovaRazlicica) {
      if (
        jeKajVpisanega() &&
        !confirm(
          "Ob posodobitvi se vpisani podatki izgubijo. Naj orodje posodobim?"
        )
      ) {
        return;
      }
      location.reload();
      return;
    }
    nastaviStanjeRazlicice("Preverjam …", "preverja");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
      // Če je bila najdena nova, je pokaziObvestiloOPosodobitvi() že
      // prestavil lučko na rumeno; sicer povemo, da novosti ni.
      if (!jeNovaRazlicica) {
        nastaviStanjeRazlicice("Ni novosti", null);
        setTimeout(() => {
          if (!jeNovaRazlicica) nastaviStanjeRazlicice("Najnovejša različica", null);
        }, 2500);
      }
    } catch {
      nastaviStanjeRazlicice("Brez povezave", null);
      setTimeout(() => {
        if (!jeNovaRazlicica) nastaviStanjeRazlicice("Najnovejša različica", null);
      }, 2500);
    }
  }

  const stanjeEl = document.getElementById("stanje-razlicice");
  if (stanjeEl && "serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    stanjeEl.classList.remove("skrit");
    stanjeEl.addEventListener("click", obKlikuNaStanje);
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
    const pdfjs = await window.naloziPdfJs();
    const strani = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const stran = await doc.getPage(i);
      const vsebina = await stran.getTextContent();
      strani.push({
        stran: i,
        okvirji: await okvirjiStrani(pdfjs, stran),
        kosi: vsebina.items
          .filter((x) => x.str && x.str.trim())
          .map((x) => ({
            besedilo: window.ObrazciLogika.popraviZnake(x.str).trim(),
            x: x.transform[4],
            y: x.transform[5],
            w: x.width,
            // Naslove razdelkov obrazec piše z drugo, večjo pisavo kot oznake
            // polj. To je edini zanesljiv znak, po katerem ju ločimo.
            pisava: x.fontName,
            visina: x.height,
          })),
      });
    }
    return strani;
  }

  /**
   * Okvirji, ki jih obrazec nariše (celice tabel) - vanje postavimo podpis in
   * šifro. pdf.js pri vsaki poti poda očrtni pravokotnik, zato poti ni treba
   * razvozlavati.
   */
  async function okvirjiStrani(pdfjs, stran) {
    const ops = await stran.getOperatorList();
    const izhod = [];
    ops.fnArray.forEach((f, i) => {
      if (f !== pdfjs.OPS.constructPath) return;
      const meja = ops.argsArray[i][2];
      if (!meja) return;
      const [x0, y0, x1, y1] = Array.from(meja);
      izhod.push({ x: x0, y: y0, sirina: x1 - x0, visina: y1 - y0 });
    });
    return izhod;
  }

  // ------------------------------------------------------------- podpisna mesta

  /** Iz napisov na obrazcu ("PODPIS ZAVAROVALCA") pripravimo mesta za podpise. */
  function pripraviPodpisnePasove() {
    const najdeni = odprtObrazec.shema.podpisi || [];
    podpisniPasovi = najdeni.map((m, i) => {
      // Kjer v okvir sodita tudi izpisano ime (in pod njim šifra), si s
      // podpisom delita prostor: podpis se umakne pod vpisani vrstici.
      const vrstic = m.potrebujeIme ? (m.potrebujeSifro ? 2 : 1) : 0;
      const zImenom =
        vrstic === 2 ? m.zImenomInSifro : vrstic === 1 ? m.zImenom : null;
      return {
        id: "podpis" + i,
        naziv: lepNaziv(m.naziv),
        stran: m.stran,
        x: m.x,
        y: zImenom ? zImenom.y : m.y,
        // Privzeta širina podpisa; okvir na obrazcu jo lahko le zmanjša,
        // da podpis vanj sede.
        sirina: Math.round(
          Math.min(PRIVZETA_SIRINA_PODPISA, m.najvecSirina || PRIVZETA_SIRINA_PODPISA)
        ),
        najvecVisina: zImenom ? zImenom.najvecVisina : m.najvecVisina || null,
        // Mesta vpisanih vrstic v okviru: ime, pod njim šifra. Kjer obrazec
        // imena ne zahteva, gre šifra po starem kar ob napis.
        mestoImena: vrstic ? (m.vrstice && m.vrstice[0]) || m.ime || null : null,
        mestoSifre: vrstic === 2 ? (m.vrstice && m.vrstice[1]) || null : m.sifra || null,
        slika: null,
        potrebujeSifro: !!m.potrebujeSifro,
        potrebujeIme: !!m.potrebujeIme,
        zaProdajnika: !!m.zaProdajnika,
        sifra: "",
        ime: "",
      };
    });
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
          potrebujeIme: false,
          sifra: "",
          ime: "",
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
    // Polja, ki so del izbire, ne prikazujemo posebej - izbira jih pokrije.
    const vIzbirah = new Set((shema.izbire || []).flatMap((i) => i.polja));

    // Vrstni red določi shema (po razdelkih in stolpcih, kot si sledijo na
    // papirju) - tu ga samo upoštevamo.
    const elementi = [
      ...shema.polja
        // Polja v okviru za podpis ureja plošča s podpisi, ne ta obrazec;
        // okenca brez napisa so ostanek iz priprave obrazca.
        .filter(
          (p) =>
            !vVrsticah.has(p.ime) &&
            !vIzbirah.has(p.ime) &&
            !p.vPodpisu &&
            !p.brezNapisa
        )
        .map((p) => ({ vir: p, html: poljeVHtml(p) })),
      ...(shema.vrstice || []).map((v) => ({ vir: v, html: vrsticaVHtml(v) })),
      ...(shema.izbire || []).map((i) => ({ vir: i, html: izbiraVHtml(i) })),
    ].sort((a, b) => (a.vir.zaporedje ?? 0) - (b.vir.zaporedje ?? 0));

    const razdelki = shema.razdelki || [];
    const podrazdelki = shema.podrazdelki || [];

    // Rubrike z ročno postavitvijo (postavitve.js) narišemo po njej; njihova
    // polja izpustimo iz samodejne postavitve. Polja rubrike, ki jih
    // postavitev ne navede, pokažemo pod njo, da se nobeno ne izgubi.
    const rocne = postavitveZa(ime);
    const pokrita = new Set();
    rocne.forEach((r) =>
      window.POSTAVITVE_OBRAZCEV.imenaPolj(r).forEach((x) => pokrita.add(x.ime))
    );
    const rocnaZaRazdelek = (indeks) => {
      const r = indeks >= 0 ? razdelki[indeks] : null;
      if (!r) return null;
      return (
        rocne.find((ro) =>
          new RegExp("^" + ro.razdelek.replace(/\./g, "\\.") + "(\\s|$)").test(r.naslov)
        ) || null
      );
    };
    const jePokrit = (vir) =>
      vir.polja
        ? vir.polja.every((n) => pokrita.has(n))
        : pokrita.has(vir.ime);

    // Polja združimo po razdelkih obrazca ("Zavarovalec", "2. Podatki o
    // zavarovalnem primeru"), znotraj njih pa po sklopih, ki jih obrazec piše
    // z manjšim naslovom ("Osebni dokument", "Naslov stalnega prebivališča").
    // Polja, ki na obrazcu stojijo v isti vrstici, naj bodo v isti vrstici
    // tudi tu. Vrstico je določila že shema (glej obrazci-pdf.js).
    const vrsticaNa = (vir) =>
      typeof vir.vrstica === "number" ? vir.vrstica : null;

    // Štiri polja v vrstici gredo 2 x 2, kadar so napisi dolgi ("MESEČNA
    // PREMIJA S POPUSTOM IN DAVKOM"): štiri taka okenca v vrsti so preozka,
    // da bi se dalo brati, kaj sodi kam. Kratke rubrike (ulica, hišna št.,
    // poštna št., kraj) ostanejo v eni vrsti, kot so na papirju.
    const NAJDALJSI_KRATEK_NAPIS = 30;
    const dvaStolpca = (v) =>
      v.deli.length === 4 &&
      (v.napisi || []).some((n) => n.length > NAJDALJSI_KRATEK_NAPIS);

    const skupine = [];
    let tekoca = null;
    let tekociSklop = null;
    let tekocaVrstica = null;
    const narisane = new Map(); // rubrika -> njena skupina
    for (const e of elementi) {
      const rocna = rocnaZaRazdelek(e.vir.razdelek);
      if (rocna) {
        if (!narisane.has(rocna)) {
          const skupina = { rocna, stran: e.vir.stran, ostalo: [] };
          narisane.set(rocna, skupina);
          skupine.push(skupina);
          tekoca = null;
        }
        if (!jePokrit(e.vir)) narisane.get(rocna).ostalo.push(e.html);
        continue;
      }
      const r = e.vir.razdelek >= 0 ? razdelki[e.vir.razdelek] : null;
      const pr = e.vir.podrazdelek >= 0 ? podrazdelki[e.vir.podrazdelek] : null;
      const kljuc = r ? e.vir.stran + "|" + e.vir.razdelek : "stran" + e.vir.stran;
      if (!tekoca || tekoca.kljuc !== kljuc) {
        tekoca = {
          kljuc,
          naslov: r ? r.naslov : "Stran " + e.vir.stran,
          opomba: r ? r.opomba : null,
          stran: e.vir.stran,
          sklopi: [],
        };
        skupine.push(tekoca);
        tekociSklop = null;
      }
      const sklopKljuc = pr ? String(e.vir.podrazdelek) : "";
      if (!tekociSklop || tekociSklop.kljuc !== sklopKljuc) {
        tekociSklop = { kljuc: sklopKljuc, naslov: pr ? pr.naslov : null, vrstice: [] };
        tekoca.sklopi.push(tekociSklop);
        tekocaVrstica = null;
      }
      const v = vrsticaNa(e.vir);
      if (!tekocaVrstica || v === null || v !== tekocaVrstica.v) {
        tekocaVrstica = { v, deli: [] };
        tekociSklop.vrstice.push(tekocaVrstica);
      }
      tekocaVrstica.deli.push(e.html);
      tekocaVrstica.napisi = tekocaVrstica.napisi || [];
      tekocaVrstica.napisi.push(
        String(e.vir.oznaka || e.vir.vprasanje || "")
      );
    }

    const skupineHtml = skupine
      .map((s) =>
        s.rocna
          ? rocnaRubrikaVHtml(s.rocna, shema, s.ostalo)
          : `<div class="polja-skupina">
            <h3>${escapeHtml(s.naslov)} <span class="stran-oznaka">str. ${s.stran}</span></h3>
            ${s.opomba ? `<p class="opomba-razdelka">${escapeHtml(s.opomba)}</p>` : ""}
            ${s.sklopi
              .map(
                (k) =>
                  (k.naslov ? `<h4 class="naslov-sklopa">${escapeHtml(k.naslov)}</h4>` : "") +
                  k.vrstice
                    .map(
                      (v) =>
                        `<div class="mreza-polj${
                          dvaStolpca(v) ? " dva-stolpca" : ""
                        }">${v.deli.join("")}</div>`
                    )
                    .join("")
              )
              .join("")}
          </div>`
      )
      .join("");

    const naslovObrazca = ime.replace(/\.pdf$/i, "").replace(/[-_]/g, " ");
    prikaz.innerHTML = `
      ${glavaNovegaIzgledaVHtml(naslovObrazca)}
      <h2 class="samo-star">${escapeHtml(naslovObrazca)}</h2>
      <p class="meta samo-star">${shema.polja.length} polj · ${shema.strani.length} strani ·
        obdelano v tvojem brskalniku</p>
      <div class="obrazec-postavitev">
        <nav class="nov-kazalo samo-nov" aria-label="Rubrike obrazca"></nav>
        <form id="obrazec-polja" autocomplete="off">${skupineHtml}</form>
        <aside class="podpis-plosca">
          <h3>Podpisi</h3>
          <p class="namig" style="margin:0 0 8px">
            Podpis zajemi, nato ga povleci na pravo mesto na strani.
          </p>
          <div id="zavihki-podpisov" class="zavihki-podpisov"></div>
          <div id="seznam-podpisov"></div>
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
      <div id="izhod-pdf"></div>
      <div class="nov-spodnja samo-nov">
        <div class="nov-napredek">
          <div class="nov-napredek-trak"><div id="nov-napredek-polnilo"></div></div>
          <span id="nov-napredek-besedilo"></span>
        </div>
        <button type="button" class="gumb-tih" id="nov-nazaj">‹ Nazaj</button>
        <button type="button" class="gumb-glavni" id="nov-naprej">Naprej</button>
      </div>`;

    document.getElementById("pripravi-pdf").addEventListener("click", pripraviPdf);
    document.getElementById("pocisti-obrazec").addEventListener("click", pocistiVse);
    povezNovIzgled();

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

    // Klik na možnost izbere natanko eno; ponoven klik jo prekliče.
    prikaz.querySelectorAll(`.odgovor-gumb[data-izbira]`).forEach((g) =>
      g.addEventListener("click", () => {
        const { izbira, vklop } = g.dataset;
        const jeIzbran = odgovoriIzbir[izbira] === vklop;
        odgovoriIzbir[izbira] = jeIzbran ? undefined : vklop;
        prikaz.querySelectorAll(`.odgovor-gumb[data-izbira="${izbira}"]`).forEach((d) =>
          d.classList.toggle("izbran", !jeIzbran && d === g)
        );
      })
    );

    povezRocnePostavitve();

    izbranaStranPodpisov = podpisniPasovi[0]?.stran || 1;
    izrisiZavihkePodpisov();
    izrisiSeznamPodpisov();
    izrisiMestoPodpisa(izbranaStranPodpisov);
  }

  /**
   * Izbira med možnostmi enega polja: "Spol" med m in ž, vrstica med DA in NE.
   * Na obrazcu je to eno polje z več okenci, zato en klik izbere natanko eno.
   */
  function izbiraVHtml(i) {
    const gumbi = i.moznosti
      .map((m) => {
        const barva = /^da$/i.test(m.oznaka) ? " da" : /^ne$/i.test(m.oznaka) ? " ne" : "";
        return `<button type="button" class="odgovor-gumb${barva}"
          data-izbira="${i.id}" data-vklop="${escapeHtml(m.vklop)}"
          >${escapeHtml(m.oznaka)}</button>`;
      })
      .join("");
    // Kadar so možnosti cele povedi (izjave), jih postavimo POD trditev in
    // jim pustimo prelom - sicer razpotegnejo vrstico čez rob.
    const dolge = i.moznosti.some((m) => m.oznaka.length > 28);
    return `<div class="polje sirok vrstica-odgovora${dolge ? " naslozeno" : ""}" data-id="${i.id}">
        <div class="vrstica-besedilo">
          ${i.razdelekNaslov ? `<span class="znacka-razdelek">${escapeHtml(i.razdelekNaslov)}</span>` : ""}
          ${i.oznaka ? `<span class="vrstica-trditev">${escapeHtml(i.oznaka)}</span>` : ""}
          ${i.dodatno ? `<span class="vrstica-produkt">${escapeHtml(i.dodatno)}</span>` : ""}
        </div>
        <div class="odgovor-gumbi">${gumbi}</div>
      </div>`;
  }

  // ------------------------------------------------------- ročne postavitve

  /** Rubrike z ročno postavitvijo za odprti obrazec (glej postavitve.js). */
  function postavitveZa(ime) {
    const p = window.POSTAVITVE_OBRAZCEV;
    return p ? p.zaObrazec(ime) : [];
  }

  /** Izbira iz sheme, ki pokriva dano polje. */
  function izbiraZaPolje(shema, imePolja) {
    return (shema.izbire || []).find((i) => i.polja.includes(imePolja)) || null;
  }

  /** Atributi pogoja: blok je viden le pri izbrani (ali nobeni) možnosti. */
  function pogojAtributi(shema, pogoj) {
    if (!pogoj) return "";
    const izbira = izbiraZaPolje(shema, pogoj.polje);
    if (!izbira) return "";
    return pogoj.prazno
      ? ` data-pogoj-izbira="${izbira.id}" data-pogoj-prazno="1"`
      : ` data-pogoj-izbira="${izbira.id}" data-pogoj-vklop="${escapeHtml(pogoj.vklop)}" hidden`;
  }

  /**
   * Ena celica ročne postavitve. Celica z gumbi vrednost hrani v skritem
   * vnosu z data-ime, zato jo izvoz pobere kot vsako drugo polje.
   */
  /**
   * Skriti vnos in gumbi za celico z gumbi. Privzeta vrednost obrazca (/DV,
   * npr. DPZP "NE") je izbrana že od začetka: izvoz jo zapiše tudi, ko je
   * ne izbereš, zato mora biti vidna.
   */
  function segmentVHtml(p, moznosti, opis) {
    const privzeto = p.privzeto && moznosti.includes(p.privzeto) ? p.privzeto : "";
    const gumbi = moznosti
      .map((g) => {
        const barva = g === "DA" ? " da" : g === "NE" ? " ne" : "";
        const izbran = g === privzeto ? " izbran" : "";
        return `<button type="button" class="odgovor-gumb${barva}${izbran}" data-segment
            data-vrednost="${escapeHtml(g)}">${escapeHtml(g)}</button>`;
      })
      .join("");
    const vrednost = privzeto
      ? ` value="${escapeHtml(privzeto)}" data-privzeto="${escapeHtml(privzeto)}"`
      : "";
    const skupina = opis ? ` role="group" aria-label="${escapeHtml(opis)}"` : "";
    return `<input type="text" hidden data-ime="${escapeHtml(p.ime)}" data-tip="${p.tip}"${vrednost} />
          <div class="odgovor-gumbi segment"${skupina}>${gumbi}</div>`;
  }

  function celicaVHtml(shema, c) {
    const p = shema.polja.find((x) => x.ime === c.polje);
    if (!p) return ""; // neobvezno polje, ki ga v tej izdaji obrazca ni
    const razpon = c.sirina ? ` style="grid-column: span ${c.sirina}"` : "";
    if (c.gumbi) {
      return `<div class="celica"${razpon}><div class="polje">
          <span class="oznaka-polja">${escapeHtml(c.oznaka)}</span>
          ${segmentVHtml(p, c.gumbi)}
        </div></div>`;
    }
    const polje = poljeVHtml({
      ...p,
      oznaka: c.oznaka,
      enota: c.enota !== undefined ? c.enota : p.enota,
      oznaka_iz_pdf: null,
      pripomba: null,
      moznost: null,
    });
    return `<div class="celica"${razpon}>${polje}</div>`;
  }

  /** Vrstica celic kot mreža; širina celice je v stolpcih mreže. */
  function mrezaVHtml(shema, celice) {
    const stolpcev = celice.reduce((n, c) => n + (c.sirina || 1), 0);
    return `<div class="mreza-postavitve" style="grid-template-columns: repeat(${stolpcev}, minmax(0, 1fr))">
        ${celice.map((c) => celicaVHtml(shema, c)).join("")}
      </div>`;
  }

  function osebeVHtml(shema, b) {
    const kartice = [];
    for (let n = 1; n <= b.stevilo; n++) {
      const vsebina = window.POSTAVITVE_OBRAZCEV.vrsticeOsebe(b, n)
        .map((v) =>
          Array.isArray(v)
            ? mrezaVHtml(shema, v)
            : `<div class="kartica-podnaslov">${escapeHtml(v.podnaslov)}</div>`
        )
        .join("");
      kartice.push(`<div class="kartica-osebe" data-skupina="${b.skupina}" data-oseba="${n}"${
        n > 1 ? " hidden" : ""
      }>
          <div class="kartica-glava"><span class="kartica-st">${n}</span>${n}. ${escapeHtml(b.naziv)}</div>
          ${vsebina}
        </div>`);
    }
    return `${kartice.join("")}
      <button type="button" class="gumb-dodaj" data-dodaj="${b.skupina}"
        data-naziv="${escapeHtml(b.nazivDodaj || b.naziv)}" data-najvec="${b.stevilo}"
        >+ Dodaj 2. ${escapeHtml(b.nazivDodaj || b.naziv)}</button>`;
  }

  function tabelaVHtml(shema, b) {
    const stolpci = Array.from({ length: b.stevilo }, (_, i) => i + 1);
    const skrij = (n) => (n > 1 ? " hidden" : "");
    const celica = (v, n) => {
      const p = shema.polja.find((x) => x.ime === v.polje(n));
      if (!p) return `<td data-oseba="${n}"${skrij(n)}></td>`;
      const opis = `${v.oznaka}, ${b.glava(n)}`;
      if (v.gumbi) {
        return `<td data-oseba="${n}"${skrij(n)}><div class="celica">
            ${segmentVHtml(p, v.gumbi, opis)}
          </div></td>`;
      }
      return `<td data-oseba="${n}"${skrij(n)}><input type="text" data-ime="${escapeHtml(
        p.ime
      )}" data-tip="TextField" aria-label="${escapeHtml(opis)}"
          autocomplete="off" autocorrect="off" spellcheck="false"
          ${p.najvec_znakov ? `maxlength="${p.najvec_znakov}"` : ""} /></td>`;
    };
    return `<div class="tabela-kritij-ovoj" data-skupina="${b.skupina}">
        ${b.naslov ? `<div class="kartica-podnaslov">${escapeHtml(b.naslov)}</div>` : ""}
        <table class="tabela-kritij">
          <thead><tr><th scope="col"></th>${stolpci
            .map((n) => `<th scope="col" data-oseba="${n}"${skrij(n)}>${escapeHtml(b.glava(n))}</th>`)
            .join("")}</tr></thead>
          <tbody>${b.vrstice
            .map(
              (v) =>
                `<tr><th scope="row">${escapeHtml(v.oznaka)}</th>${stolpci
                  .map((n) => celica(v, n))
                  .join("")}</tr>`
            )
            .join("")}</tbody>
        </table>
      </div>`;
  }

  /** Cela rubrika z ročno postavitvijo. */
  function rocnaRubrikaVHtml(rubrika, shema, ostalo) {
    const strani = new Set(
      shema.polja
        .filter((p) =>
          window.POSTAVITVE_OBRAZCEV.imenaPolj(rubrika).some((x) => x.ime === p.ime)
        )
        .map((p) => p.stran)
    );
    const oznakaStrani = [...strani].sort((a, b) => a - b).join("–");

    const bloki = rubrika.bloki
      .map((b) => {
        const pogoj = pogojAtributi(shema, b.pogoj);
        if (b.vrsta === "izbira") {
          const izbira = izbiraZaPolje(shema, b.polje);
          if (!izbira) return "";
          const moznosti = izbira.moznosti.map((m) => ({
            ...m,
            oznaka: (b.oznake && b.oznake[m.vklop]) || m.oznaka,
          }));
          return `<div class="rocna-izbira"${pogoj}>${izbiraVHtml({
            ...izbira,
            moznosti,
            oznaka: b.vprasanje,
            razdelekNaslov: null,
            dodatno: null,
          })}</div>`;
        }
        if (b.vrsta === "namig") {
          return `<p class="namig rocni-namig"${pogoj}>${escapeHtml(b.besedilo)}</p>`;
        }
        if (b.vrsta === "osebe") {
          return `<div class="pogojni"${pogoj}>${osebeVHtml(shema, b)}</div>`;
        }
        if (b.vrsta === "tabela") {
          return `<div class="pogojni"${pogoj}>${tabelaVHtml(shema, b)}</div>`;
        }
        return "";
      })
      .join("");

    return `<div class="polja-skupina rocna-rubrika">
        <h3>${escapeHtml(rubrika.naslov)} <span class="stran-oznaka">str. ${oznakaStrani}</span></h3>
        ${bloki}
        ${ostalo.length ? `<div class="mreza-polj">${ostalo.join("")}</div>` : ""}
      </div>`;
  }

  /** Pogojni bloki sledijo izbranim možnostim. */
  function posodobiPogoje() {
    prikaz.querySelectorAll("[data-pogoj-izbira]").forEach((el) => {
      const izbran = odgovoriIzbir[el.dataset.pogojIzbira];
      el.hidden = el.dataset.pogojPrazno ? Boolean(izbran) : izbran !== el.dataset.pogojVklop;
    });
  }

  /** Koliko oseb skupine je odprtih; gumb Dodaj odpre naslednjo. */
  function nastaviStOseb(skupina, koliko) {
    prikaz
      .querySelectorAll(`[data-skupina="${skupina}"] [data-oseba], .kartica-osebe[data-skupina="${skupina}"]`)
      .forEach((el) => {
        el.hidden = Number(el.dataset.oseba) > koliko;
      });
    prikaz.querySelectorAll(`[data-dodaj="${skupina}"]`).forEach((g) => {
      const najvec = Number(g.dataset.najvec);
      g.dataset.odprtih = String(koliko);
      g.hidden = koliko >= najvec;
      g.textContent = `+ Dodaj ${koliko + 1}. ${g.dataset.naziv}`;
    });
  }

  function ponastaviRocnePostavitve() {
    prikaz.querySelectorAll("[data-dodaj]").forEach((g) => nastaviStOseb(g.dataset.dodaj, 1));
    // Po ponastavitvi obrazca imajo skriti vnosi spet privzeto vrednost;
    // gumbi naj kažejo isto.
    prikaz.querySelectorAll("[data-segment]").forEach((g) => {
      const vnos = g.closest(".celica").querySelector("input[data-ime]");
      g.classList.toggle("izbran", vnos.value === g.dataset.vrednost);
    });
    posodobiPogoje();
  }

  function povezRocnePostavitve() {
    // Gumbi namesto tipkanja: vrednost gre v skriti vnos; ponoven klik jo
    // prekliče - razen privzete, ki bi jo izvoz tako ali tako zapisal.
    prikaz.querySelectorAll("[data-segment]").forEach((g) =>
      g.addEventListener("click", () => {
        const celica = g.closest(".celica");
        const vnos = celica.querySelector("input[data-ime]");
        const jeIzbran = vnos.value === g.dataset.vrednost;
        if (jeIzbran && vnos.dataset.privzeto) return;
        vnos.value = jeIzbran ? "" : g.dataset.vrednost;
        celica
          .querySelectorAll("[data-segment]")
          .forEach((d) => d.classList.toggle("izbran", !jeIzbran && d === g));
      })
    );
    prikaz.querySelectorAll("[data-dodaj]").forEach((g) =>
      g.addEventListener("click", () =>
        nastaviStOseb(g.dataset.dodaj, Number(g.dataset.odprtih || 1) + 1)
      )
    );
    // Izbira lahko odpre ali skrije pogojne bloke (paketna tabela proti
    // samostojni izbiri kritij).
    prikaz
      .querySelectorAll(".odgovor-gumb[data-izbira]")
      .forEach((g) => g.addEventListener("click", posodobiPogoje));
    ponastaviRocnePostavitve();
  }

  // ------------------------------------------------------------ nov izgled
  // Drug videz istih polj: obrazec je svoj zaslon s tremi koraki (Izpolni -
  // Podpiši - Izvozi), kazalom rubrik in spodnjo vrstico z napredkom. Vklopi
  // ga ikona v glavi. Polja, podpisi in izvoz so isti kot v starem izgledu -
  // spremeni se le, kaj je kdaj vidno - zato je izvoženi PDF enak.

  const KORAKI = [
    { id: "izpolni", oznaka: "Izpolni" },
    { id: "podpisi", oznaka: "Podpiši" },
    { id: "izvozi", oznaka: "Izvozi" },
  ];
  function jeNovIzgled() {
    return document.body.classList.contains("izgled-nov");
  }

  function nastaviIzgled(nov) {
    document.body.classList.toggle("izgled-nov", nov);
    const gumb = document.getElementById("preklop-izgleda");
    if (gumb) gumb.setAttribute("aria-pressed", String(nov));
    // Shrani se le izbira izgleda, nobenih podatkov stranke.
    try {
      localStorage.setItem("izgled", nov ? "nov" : "star");
    } catch {
      /* v zasebnem oknu ostane izbira le do zaprtja */
    }
    izmeriGlavo();
    if (nov) posodobiNovIzgled();
  }

  /** Lepljivi deli pod glavo morajo vedeti, kako visoka je. */
  function izmeriGlavo() {
    const glava = document.querySelector("header");
    if (glava) {
      document.documentElement.style.setProperty("--visina-glave", glava.offsetHeight + "px");
    }
  }

  /** "seznam" (kartice obrazcev) ali "obrazec" - le v novem izgledu. */
  function nastaviZaslon(zaslon) {
    document.body.dataset.zaslon = zaslon;
    if (jeNovIzgled()) window.scrollTo(0, 0);
  }

  function indeksKoraka() {
    return Math.max(0, KORAKI.findIndex((k) => k.id === document.body.dataset.korak));
  }

  function nastaviKorak(korak) {
    document.body.dataset.korak = korak;
    prikaz.querySelectorAll("[data-nov-korak]").forEach((b) => {
      const aktiven = b.dataset.novKorak === korak;
      b.classList.toggle("aktiven", aktiven);
      if (aktiven) b.setAttribute("aria-current", "step");
      else b.removeAttribute("aria-current");
    });
    const i = indeksKoraka();
    const nazaj = document.getElementById("nov-nazaj");
    const naprej = document.getElementById("nov-naprej");
    if (nazaj) nazaj.hidden = i === 0;
    if (naprej) {
      naprej.textContent =
        i < KORAKI.length - 1
          ? `Naprej: ${KORAKI[i + 1].oznaka.toLowerCase()} ›`
          : "Pripravi PDF";
    }
    if (jeNovIzgled()) window.scrollTo(0, 0);
  }

  function glavaNovegaIzgledaVHtml(naslov) {
    const koraki = KORAKI.map(
      (k, i) => `<button type="button" class="nov-korak" data-nov-korak="${k.id}">
          <span class="nov-korak-st">${i + 1}</span>${k.oznaka}</button>`
    ).join('<span class="nov-korak-loc" aria-hidden="true">›</span>');
    return `<div class="nov-glava-obrazca samo-nov">
        <button type="button" class="gumb-tih nov-na-seznam" id="nov-na-seznam">‹ Obrazci</button>
        <h2>${escapeHtml(naslov)}</h2>
        <div class="nov-koraki">${koraki}</div>
        <nav class="nov-trak" aria-label="Rubrike obrazca"></nav>
      </div>`;
  }

  function rubrikeObrazca() {
    return [...prikaz.querySelectorAll("#obrazec-polja > .polja-skupina")];
  }

  function naslovRubrike(skupina) {
    const h = skupina.querySelector(":scope > h3");
    if (!h) return "";
    const kopija = h.cloneNode(true);
    kopija.querySelectorAll(".stran-oznaka").forEach((e) => e.remove());
    return kopija.textContent.trim();
  }

  /**
   * Deli obrazca za kazalo: rubrike (h3) in sklopi v njih (h4 - "Zavarovanec",
   * "Zavarovalec"). Obrazci brez oštevilčenih razdelkov imajo za rubriko le
   * "Stran 1", pravi pregled dajo šele sklopi.
   * [{ el (cilj skoka), naslov, raven, vsebina: [elementi], list }]
   */
  function deliObrazca() {
    const deli = [];
    rubrikeObrazca().forEach((s) => {
      const rubrika = { el: s, naslov: naslovRubrike(s), raven: 1, vsebina: [s], list: true };
      deli.push(rubrika);
      const pred = []; // polja rubrike pred prvim sklopom ("Številka police")
      let sklop = null;
      for (const otrok of s.children) {
        if (otrok.matches("h4.naslov-sklopa")) {
          sklop = { el: otrok, naslov: otrok.textContent.trim(), raven: 2, vsebina: [], list: true };
          deli.push(sklop);
        } else if (sklop) {
          sklop.vsebina.push(otrok);
        } else {
          pred.push(otrok);
        }
      }
      // Rubrika s sklopi je razdelek le, če ima tudi sama polja.
      if (deli[deli.length - 1] !== rubrika) {
        rubrika.vsebina = pred;
        rubrika.list = pred.some((e) => e.querySelector("[data-ime], .odgovor-gumb"));
      }
    });
    return deli;
  }

  /**
   * Ali je v delu obrazca kaj vpisanega? Privzeta vrednost obrazca (DPZP
   * "NE") ne šteje, prav tako ne polja v skritih (neizbranih) blokih.
   */
  function jeIzpolnjeno(vsebina) {
    for (const kos of vsebina) {
      for (const el of kos.querySelectorAll("[data-ime]")) {
        if (el.parentElement.closest("[hidden]")) continue;
        if (el.type === "checkbox") {
          if (el.checked) return true;
        } else if (el.tagName === "SELECT") {
          const izbrana = el.options[el.selectedIndex];
          if (el.value && !(izbrana && izbrana.defaultSelected)) return true;
        } else if (el.value.trim() && el.value !== el.defaultValue) {
          return true;
        }
      }
      const odgovor = [...kos.querySelectorAll(".odgovor-gumb.izbran")].some(
        (g) => !g.hasAttribute("data-segment") && !g.parentElement.closest("[hidden]")
      );
      if (odgovor) return true;
    }
    return false;
  }

  let deliKazala = [];

  function izrisiKazaloRubrik() {
    deliKazala = deliObrazca();
    deliKazala.forEach((d, i) => {
      d.el.id = "del-" + (i + 1);
    });
    const html = deliKazala
      .map(
        (d, i) => `<a href="#del-${i + 1}" data-del="${i + 1}" class="raven-${d.raven}${
          d.list ? " list" : ""
        }">
          <span class="nov-oznaka-stanja" aria-hidden="true"></span>
          <span class="nov-ime-rubrike">${escapeHtml(d.naslov)}</span></a>`
      )
      .join("");
    prikaz.querySelectorAll(".nov-kazalo, .nov-trak").forEach((n) => {
      n.innerHTML = html;
    });
    prikaz.querySelectorAll(".nov-kazalo a, .nov-trak a").forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const cilj = document.getElementById("del-" + a.dataset.del);
        if (cilj) cilj.scrollIntoView({ behavior: "smooth", block: "start" });
      })
    );
  }

  /** Označi del, ki je trenutno na zaslonu (zadnji, ki je prešel vrh). */
  let tekociDel = null;
  function oznaciTekociDel() {
    if (!jeNovIzgled() || !deliKazala.length || !deliKazala[0].el.isConnected) return;
    const meja = window.innerHeight * 0.35;
    let st = 1;
    deliKazala.forEach((d, i) => {
      if (d.el.getBoundingClientRect().top <= meja) st = i + 1;
    });
    if (st === tekociDel) return;
    tekociDel = st;
    prikaz
      .querySelectorAll("[data-del]")
      .forEach((a) => a.classList.toggle("tekoca", Number(a.dataset.del) === st));
    // Trak (ožji zaslon) pomakne tekoči del v vidno polje.
    const trak = prikaz.querySelector(".nov-trak");
    const v = trak && trak.querySelector(`[data-del="${st}"]`);
    if (v && trak.offsetParent) trak.scrollTo({ left: v.offsetLeft - 16, behavior: "smooth" });
  }
  let cakaDrsenje = false;
  window.addEventListener(
    "scroll",
    () => {
      if (cakaDrsenje) return;
      cakaDrsenje = true;
      requestAnimationFrame(() => {
        cakaDrsenje = false;
        oznaciTekociDel();
      });
    },
    { passive: true }
  );

  function posodobiNovIzgled() {
    if (!deliKazala.length || !deliKazala[0].el.isConnected) return;
    let izpolnjenih = 0;
    let listov = 0;
    deliKazala.forEach((d, i) => {
      const da = jeIzpolnjeno(d.vsebina);
      if (d.list) {
        listov++;
        if (da) izpolnjenih++;
      }
      prikaz
        .querySelectorAll(`[data-del="${i + 1}"]`)
        .forEach((a) => a.classList.toggle("izpolnjena", da));
    });
    const besedilo = document.getElementById("nov-napredek-besedilo");
    if (besedilo) besedilo.textContent = `${izpolnjenih} od ${listov} razdelkov`;
    const polnilo = document.getElementById("nov-napredek-polnilo");
    if (polnilo) polnilo.style.width = Math.round((100 * izpolnjenih) / listov) + "%";
    tekociDel = null;
    oznaciTekociDel();
  }

  /** Ob vsakem izrisu obrazca: kazalo, koraki in spodnja vrstica. */
  function povezNovIzgled() {
    izrisiKazaloRubrik();
    prikaz
      .querySelectorAll("[data-nov-korak]")
      .forEach((b) => b.addEventListener("click", () => nastaviKorak(b.dataset.novKorak)));
    document
      .getElementById("nov-na-seznam")
      .addEventListener("click", () => nastaviZaslon("seznam"));
    document.getElementById("nov-nazaj").addEventListener("click", () => {
      const i = indeksKoraka();
      if (i > 0) nastaviKorak(KORAKI[i - 1].id);
    });
    document.getElementById("nov-naprej").addEventListener("click", () => {
      const i = indeksKoraka();
      if (i < KORAKI.length - 1) nastaviKorak(KORAKI[i + 1].id);
      else pripraviPdf();
    });
    let caka = false;
    const obSpremembi = () => {
      if (caka) return;
      caka = true;
      requestAnimationFrame(() => {
        caka = false;
        posodobiNovIzgled();
      });
    };
    const obrazec = document.getElementById("obrazec-polja");
    ["input", "change", "click"].forEach((d) => obrazec.addEventListener(d, obSpremembi));
    nastaviKorak("izpolni");
    nastaviZaslon("obrazec");
    posodobiNovIzgled();
  }

  // Gumb v glavi preklaplja med izgledoma; meni v novem izgledu le sproži
  // obstoječe gumbe glave, ki so tam skriti.
  document.body.dataset.zaslon = "seznam";
  const gumbIzgleda = document.getElementById("preklop-izgleda");
  if (gumbIzgleda) {
    gumbIzgleda.setAttribute("aria-pressed", String(jeNovIzgled()));
    gumbIzgleda.addEventListener("click", () => nastaviIzgled(!jeNovIzgled()));
  }
  document.querySelectorAll(".meni-glave [data-klikni]").forEach((b) =>
    b.addEventListener("click", () => {
      b.closest("details").open = false;
      const cilj = document.getElementById(b.dataset.klikni);
      if (cilj) cilj.click();
    })
  );
  if (!/^https?:$/.test(location.protocol)) {
    const prenesi = document.querySelector('.meni-glave [data-klikni="prenesi-orodje"]');
    if (prenesi) prenesi.hidden = true;
  }
  izmeriGlavo();
  window.addEventListener("resize", izmeriGlavo);

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
    // Enota je izpisana ob polju; kot pojasnilo bi se le podvojila.
    if (p.enota && p.oznaka_iz_pdf === p.enota) return false;
    const ocisti = (s) =>
      String(s).toLowerCase().replace(/[^a-zčšž0-9]+/g, " ").replace(/\s+/g, " ").trim();
    const a = ocisti(p.oznaka);
    const b = ocisti(p.oznaka_iz_pdf);
    if (a === b || a.includes(b)) return false;
    // Pojasnilo se pogosto začne z isto besedo kot oznaka ("Pristopna starost"
    // → "Pristopna starost zavarovanca (letnica … - letnica rojstva)"). Kadar
    // doda bistveno več, ga pokažemo, sicer je le ponovitev.
    if (b.includes(a)) return b.length - a.length >= 10;
    return true;
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
    // Kadar ista vrsta polj pripada več možnostim izbire (30 % / 50 %),
    // vrstico uvede značka z možnostjo.
    const moznost = p.moznost
      ? `<span class="znacka-razdelek">${escapeHtml(p.moznost)}</span>`
      : "";

    if (p.tip === "CheckBox") {
      return `<div class="polje polje-potrditev sirok" title="${escapeHtml(p.ime)}">
        <input type="checkbox" id="${id}" data-ime="${escapeHtml(p.ime)}" data-tip="CheckBox" />
        <label for="${id}">${znacka}${oznaka}${pojasnilo}</label></div>`;
    }
    if (p.moznosti && p.moznosti.length) {
      // Privzeto vrednost obrazca (/DV) izvoz zapiše tudi, ko je ne izbereš,
      // zato je izbrana že tu in prazne možnosti ni.
      return `<div class="polje"><label class="oznaka-polja" for="${id}">${oznaka}</label>
        <select id="${id}" data-ime="${escapeHtml(p.ime)}" data-tip="${p.tip}">
          ${p.privzeto ? "" : `<option value=""></option>`}
          ${p.moznosti
            .map(
              (m) =>
                `<option value="${escapeHtml(m)}"${
                  m === p.privzeto ? " selected" : ""
                }>${escapeHtml(m)}</option>`
            )
            .join("")}
        </select>${pojasnilo}</div>`;
    }
    // autocomplete/spellcheck izklopimo na vsakem polju posebej: Safari
    // nastavitev na obrazcu pogosto ignorira in bi si podatke stranke
    // zapomnil za samodejno izpolnjevanje.
    // Enota ("LET", "EUR") stoji ob polju, pripomba z obrazca pa pod njim.
    const enota = p.enota
      ? `<span class="enota-polja">${escapeHtml(p.enota)}</span>`
      : "";
    const pripomba = p.pripomba
      ? `<span class="pripomba-polja">${escapeHtml(p.pripomba)}</span>`
      : "";
    return `<div class="polje"><label class="oznaka-polja" for="${id}">${moznost}${oznaka}</label>
      <div class="vnos-z-enoto">
        <input type="text" id="${id}" data-ime="${escapeHtml(p.ime)}" data-tip="TextField"
          autocomplete="off" autocorrect="off" spellcheck="false"
          ${p.najvec_znakov ? `maxlength="${p.najvec_znakov}"` : ""} />${enota}
      </div>${pojasnilo}${pripomba}</div>`;
  }

  /**
   * Zavihki po straneh. Obrazec ima lahko podpise na več straneh (Zahtevek
   * na treh), zato jih ne zlagamo v en dolg seznam: zavihek izbere stran,
   * ta pa hkrati določi, katero stran kaže predogled pod njim.
   */
  function izrisiZavihkePodpisov() {
    const ovoj = document.getElementById("zavihki-podpisov");
    if (!ovoj) return;
    // Zavihek za VSAKO stran obrazca, ne le za tiste s podpisi: tako je
    // mogoče pogledati katero koli stran, tudi če se nanjo ne podpisuje.
    const strani = (odprtObrazec?.shema.strani || []).map((s) => s.stran);
    if (strani.length < 2) {
      ovoj.innerHTML = "";
      return;
    }
    ovoj.innerHTML = strani
      .map((st) => {
        const na = podpisniPasovi.filter((p) => p.stran === st);
        const zajetih = na.filter((p) => p.slika).length;
        return `<button type="button" class="zavihek-podpisov${
          st === izbranaStranPodpisov ? " izbran" : ""
        }" data-stran-podpisov="${st}">Str. ${st}
          ${
            na.length
              ? `<span class="zavihek-stevec${
                  zajetih === na.length ? " polno" : ""
                }">${zajetih}/${na.length}</span>`
              : ""
          }</button>`;
      })
      .join("");
    ovoj.querySelectorAll("[data-stran-podpisov]").forEach((b) =>
      b.addEventListener("click", () => {
        izbranaStranPodpisov = Number(b.dataset.stranPodpisov);
        izrisiZavihkePodpisov();
        izrisiSeznamPodpisov();
        izrisiMestoPodpisa(izbranaStranPodpisov);
      })
    );
  }

  /** Seznam podpisnih mest s predogledom in gumbom za zajem. */
  function izrisiSeznamPodpisov() {
    const ovoj = document.getElementById("seznam-podpisov");
    if (!ovoj) return;
    const naStrani = podpisniPasovi.filter(
      (p) => p.stran === izbranaStranPodpisov
    );
    if (!naStrani.length) {
      ovoj.innerHTML =
        '<p class="namig" style="margin:0 0 8px">Na tej strani ni mesta za podpis.</p>';
      return;
    }
    ovoj.innerHTML = naStrani
      .map(
        (p) => `<div class="podpis-pas" data-id="${p.id}">
          <div class="podpis-pas-glava">
            <strong>${escapeHtml(p.naziv)}</strong>
          </div>
          <div class="podpis-predogled" data-predogled="${p.id}">
            ${p.slika ? `<img src="${p.slika}" alt="Podpis" />` : "Še ni podpisa"}
          </div>
          ${
            p.potrebujeIme
              ? `<input type="text" class="sifra-vnos" data-ime="${p.id}"
                   autocomplete="off" autocorrect="off" spellcheck="false"
                   placeholder="Ime in priimek" value="${escapeHtml(p.ime)}" />`
              : ""
          }
          ${
            p.potrebujeSifro
              ? `<input type="text" class="sifra-vnos" data-sifra="${p.id}"
                   placeholder="Šifra prodajnika" value="${escapeHtml(p.sifra)}" />`
              : ""
          }
          <label class="oznaka-polja velikost-oznaka">
          Velikost <span data-velikost="${p.id}">${p.sirina}</span> % širine strani
        </label>
        <input type="range" class="drsnik-velikosti" min="8" max="45" step="1"
               value="${p.sirina}" data-sirina="${p.id}"
               aria-label="Velikost podpisa" />
        <div class="podpis-pas-gumbi">
            <button type="button" class="gumb-tih majhen" data-zajemi="${p.id}">
              ${p.slika ? "Znova" : "Zajemi podpis"}
            </button>
            ${
              p.slika
                ? `<button type="button" class="gumb-tih majhen" data-odstrani="${p.id}">Odstrani</button>`
                : ""
            }
            ${
              p.slika && naStrani.some((d) => d !== p && !d.slika)
                ? `<button type="button" class="gumb-tih majhen" data-kopiraj="${p.id}"
                     title="Isti podpis prenese na še prazna mesta na tej strani"
                     >Kopiraj v ostala na strani</button>`
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
        izrisiZavihkePodpisov();
        izrisiSeznamPodpisov();
        izrisiZnakePodpisov();
      })
    );
    // Velikost podpisa: oznako na strani posodobimo sproti, seznama pa NE
    // izrisujemo znova - drsnik bi med vlečenjem izgubil fokus.
    ovoj.querySelectorAll("[data-sirina]").forEach((d) =>
      d.addEventListener("input", () => {
        const pas = najdiPas(d.dataset.sirina);
        pas.sirina = Number(d.value);
        const izpis = ovoj.querySelector(`[data-velikost="${pas.id}"]`);
        if (izpis) izpis.textContent = pas.sirina;
        izrisiZnakePodpisov();
      })
    );
    // Kadar je zavarovalec hkrati zavarovanec ali plačnik, se podpisuje
    // enkrat - isti podpis prenesemo na še prazna mesta. Samo na TEJ strani:
    // na drugi strani se praviloma podpisuje kdo drug in tuj podpis v njegovo
    // okence ne sodi.
    ovoj.querySelectorAll("[data-kopiraj]").forEach((b) =>
      b.addEventListener("click", () => {
        const vir = najdiPas(b.dataset.kopiraj);
        podpisniPasovi.forEach((p) => {
          if (p !== vir && !p.slika && p.stran === vir.stran) p.slika = vir.slika;
        });
        izrisiZavihkePodpisov();
        izrisiSeznamPodpisov();
        izrisiZnakePodpisov();
      })
    );
    // Ne šifra ne ime se ne shranita nikamor: živita le v pomnilniku tega
    // zavihka in z njim izgineta.
    ovoj.querySelectorAll("[data-sifra]").forEach((v) =>
      v.addEventListener("input", () => {
        najdiPas(v.dataset.sifra).sifra = v.value;
      })
    );
    ovoj.querySelectorAll("[data-ime]").forEach((v) =>
      v.addEventListener("input", () => {
        najdiPas(v.dataset.ime).ime = v.value;
      })
    );
  }

  // Hiter preklop obrazca ali strani prekine izris; s tem števcem vemo,
  // ali je naš izris še aktualen.
  let zaporednaIzrisa = 0;

  /** Stran izrišemo s pdfjs - podpise nanjo postavimo z vlečenjem. */
  async function izrisiMestoPodpisa(stran) {
    const mojIzris = ++zaporednaIzrisa;
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
    try {
      await p.render({
        canvasContext: platnoStrani.getContext("2d"),
        viewport: koncni,
      }).promise;
    } catch {
      // pdf.js ob preklopu izris prekine (RenderingCancelledException).
      // Oznake podpisov moramo izrisati tudi tedaj, sicer izginejo.
    }

    if (mojIzris !== zaporednaIzrisa) return; // vmes se je začel novejši
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
    odgovoriIzbir = {};
    document
      .querySelectorAll(".odgovor-gumb.izbran")
      .forEach((g) => g.classList.remove("izbran"));
    ponastaviRocnePostavitve();
    posodobiNovIzgled();
    podpisniPasovi.forEach((p) => {
      p.slika = null;
      p.ime = "";
      p.sifra = "";
    });
    sprostiBlobe();
    const izhod = document.getElementById("izhod-pdf");
    if (izhod) izhod.innerHTML = "";
    const stanje = document.getElementById("stanje-obrazca");
    if (stanje) stanje.textContent = "Počiščeno.";
    izrisiZavihkePodpisov();
    izrisiSeznamPodpisov();
    izrisiZnakePodpisov();
  }

  async function pripraviPdf() {
    const stanje = document.getElementById("stanje-obrazca");
    const vrednosti = {};
    document.querySelectorAll("#obrazec-polja [data-ime]").forEach((el) => {
      // Skrit pogojni blok (npr. paketna tabela, ko je izbrana samostojna
      // izbira kritij) ne sme v PDF, tudi če je bil prej izpolnjen.
      if (el.closest("[data-pogoj-izbira][hidden]")) return;
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

    // Izbrana možnost se zapiše kot vklopna vrednost okenca.
    let odgovorjenihIzbir = 0;
    for (const izbira of odprtObrazec.shema.izbire || []) {
      const izbran = odgovoriIzbir[izbira.id];
      if (!izbran) continue;
      izbira.polja.forEach((ime) => {
        vrednosti[ime] = izbran;
      });
      odgovorjenihIzbir++;
    }

    const podpisi = podpisniPasovi
      .filter((p) => p.slika)
      .map((p) => ({
        slika: p.slika,
        stran: p.stran,
        x: p.x,
        y: p.y,
        sirina: p.sirina,
        najvecVisina: p.najvecVisina,
        // Ime gre v vrstico pod napis, šifra pa tik pod ime - ali, kjer
        // obrazec imena ne zahteva, kar ob napis "šifra in podpis".
        besedila: [
          p.ime && p.mestoImena ? { besedilo: p.ime, ...p.mestoImena } : null,
          p.sifra && p.mestoSifre ? { besedilo: p.sifra, ...p.mestoSifre } : null,
        ].filter(Boolean),
      }));

    stanje.textContent = "Pripravljam…";
    try {
      if (!pisavaBajti) pisavaBajti = await window.naloziPisavo();

      // Vsakič izhajamo iz izvirnika: tako drugi izvoz ne podeduje prvega.
      const doc = await window.PDFLib.PDFDocument.load(izvorniBajti.slice(), {
        ignoreEncryption: true,
      });
      // Nekateri obrazci polj ne navedejo na nobeni strani; brez tega
      // seznama jih izvoz ne najde in sploščitev odpove.
      const straniPolj = {};
      (odprtObrazec.shema.polja || []).forEach((p) => {
        straniPolj[p.ime] = p.stran;
      });
      const { pdf, opozorila } = await obrazciPdf.izpolni(doc, {
        vrednosti,
        podpisi,
        zakleni: document.getElementById("zakleni").checked,
        oznake,
        pisavaBajti,
        straniPolj,
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
        odgovorjenihVrstic + odgovorjenihIzbir
          ? ` · ${odgovorjenihVrstic + odgovorjenihIzbir} odgovorjenih vrstic`
          : ""
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
  // Na zaslonu na dotik se preprosto podpišeš - prostoročni način je tam
  // odveč in samo zastira pot. Potreben je le tam, kjer je edino kazalo
  // sledilna ploščica ali miška.
  const jeNaDotik = window.matchMedia("(any-pointer: coarse)").matches;
  if (jeNaDotik) gumbZacni.classList.add("skrit");
  const namigPodpisa = document.getElementById("namig-podpisa");
  let rise = false;
  let jePodpisan = false;
  // Na zaslonu na dotik riše samo prvi kazalec; ko je v rabi pero,
  // dotik dlani ne sme puščati sledi.
  let aktivniKazalec = null;
  let jeVRabiPero = false;

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
  // Privzeta širina podpisa v odstotkih širine strani; zastopnik jo lahko
  // popravi z drsnikom.
  const PRIVZETA_SIRINA_PODPISA = 17;
  const MIROVANJE_MS = 2000;
  // Kratka pavza dvigne ali spusti pero: tako lahko napišeš ime in priimek
  // ločeno ali dodaš strešico, ne da bi vlekel neprekinjeno črto.
  const PREMOR_MS = 400;
  let peroGor = false;
  let casovnikPremora = null;
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
    namigPodpisa.innerHTML = jeNaDotik
      ? "Podpiši se s prstom ali peresom. Ko končaš, izberi <strong>Potrdi</strong> " +
        "ali <strong>Ponovi</strong>."
      : "Klikni <strong>Začni risanje</strong> — potem le drsiš s prstom po " +
        "sledilni ploščici, brez pritiskanja.";
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
    aktivniKazalec = null;
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
      "sredini levo. Za <strong>dvig peresa</strong> se za hip ustavi, premakni se " +
      "drugam in se spet ustavi — tako pišeš črko za črko in dodaš strešice. " +
      "Po 2 sekundah mirovanja se risanje konča.";

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
    clearTimeout(casovnikPremora);
    peroGor = false;
    platno.classList.remove("pero-gor");
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

    // Ko je pero dvignjeno, se premikamo brez sledi.
    if (!peroGor) {
      ctx.lineTo(pero.x, pero.y);
      ctx.stroke();
      jePodpisan = true;
    }
  }

  /** Po 2 s mirovanja risanje ustavimo in ponudimo Potrdi / Ponovi. */
  /** Pavza med risanjem dvigne pero, pavza med premikanjem ga spet spusti. */
  function ponastaviPremor() {
    clearTimeout(casovnikPremora);
    // Dokler se uporabnik ni premaknil, ni česa dvigniti - sicer bi se pero
    // dvignilo že 400 ms po koncu odštevanja, še pred prvo potezo.
    if (!zadnjiKazalec) return;
    casovnikPremora = setTimeout(() => {
      if (!prostorocno) return;
      peroGor = !peroGor;
      platno.classList.toggle("pero-gor", peroGor);
      pokaziIzhodisce(peroGor);
      if (!peroGor) {
        ctx.beginPath();
        ctx.moveTo(pero.x, pero.y);
      }
      namigPodpisa.innerHTML = peroGor
        ? "Pero je <strong>dvignjeno</strong> — premakni se na novo mesto in se za hip ustavi, da se spusti."
        : "Pero <strong>riše</strong>. Za dvig se za hip ustavi.";
    }, PREMOR_MS);
  }

  function ponastaviMirovanje() {
    ponastaviPremor();
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
    if (e.pointerType === "pen") jeVRabiPero = true;
    if (jeVRabiPero && e.pointerType === "touch") return; // dlan
    if (aktivniKazalec !== null) return; // druga poteza počaka
    e.preventDefault();
    aktivniKazalec = e.pointerId;
    rise = true;
    // Lovljenje kazalca je priročnost, ne pogoj: če ga brskalnik zavrne,
    // mora risanje vseeno steči.
    try {
      platno.setPointerCapture(e.pointerId);
    } catch {
      /* ni bistveno */
    }
    const t = tocka(e);
    ctx.beginPath();
    ctx.moveTo(t.x, t.y);
  });

  // Risanje s pritiskom (dotik, pero, miška). Prostoročni način ima svoj
  // poslušalec na oknu, zato se tu ne oglašamo.
  platno.addEventListener("pointermove", (e) => {
    if (prostorocno || !rise || e.pointerId !== aktivniKazalec) return;
    e.preventDefault();
    const t = tocka(e);
    ctx.lineTo(t.x, t.y);
    ctx.stroke();
    jePodpisan = true;
  });

  // Ko kazalec zapusti platno, potezo prekinemo; ob vrnitvi se začne nova.
  platno.addEventListener("pointerleave", () => {
    if (!prostorocno) {
      rise = false;
      aktivniKazalec = null;
    }
  });
  ["pointerup", "pointercancel"].forEach((d) =>
    platno.addEventListener(d, (e) => {
      if (prostorocno) return;
      if (e.pointerId !== aktivniKazalec) return;
      // Dvig prsta ali peresa konča potezo; naslednja se začne na novem
      // mestu, zato lahko pišeš črko za črko in dodajaš strešice.
      aktivniKazalec = null;
      rise = false;
    })
  );

  document.getElementById("pocisti-podpis").addEventListener("click", () => {
    pocistiPlatno();
    // Na dotik je platno takoj pripravljeno; drugod "Ponovi" znova zažene
    // prostoročni način, da ni treba dvakrat klikati.
    if (!jeNaDotik) zacniProstorocno();
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
      izrisiZavihkePodpisov();
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
