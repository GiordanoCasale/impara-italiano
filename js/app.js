(function () {
  'use strict';

  const CATS = window.CATEGORIES || [];
  const PRON = window.PRONUNCIA || [];
  const CFG = window.CONFIG || {};
  const STR = window.I18N;
  const STORE_KEY = 'impara-italiano-v1';
  const SESSION_LEN = 10;
  const LANGS = [['fa', 'فارسی'], ['en', 'English'], ['it', 'Italiano']];
  const app = document.getElementById('app');

  // ---------- Dati ----------
  const ALL = [];
  const BY_CAT = {};
  CATS.forEach(c => {
    BY_CAT[c.id] = c.words.map(w => {
      const word = { id: c.id + '|' + w[0], it: w[0], fa: w[1], en: w[2], note: { fa: w[3] || '', en: w[4] || '' }, cat: c.id };
      ALL.push(word);
      return word;
    });
  });
  const catById = id => CATS.find(c => c.id === id);
  const WORD_BY_ID = Object.fromEntries(ALL.map(w => [w.id, w]));

  // ---------- Salvataggio ----------
  function defaults() {
    return { lang: 'fa', name: '', rate: 0.85, voice: '', xp: 0, words: {}, streak: { last: '', count: 0 }, reports: [] };
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && typeof s === 'object') return Object.assign(defaults(), s);
    } catch (e) { /* storage non disponibile */ }
    return defaults();
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignora */ }
  }
  let state = load();
  if (!STR[state.lang]) state.lang = 'fa';

  // ---------- Lingua ----------
  // Lingua dell'interfaccia: fa / en / it.
  // Lingua dei significati: inglese se l'interfaccia è in inglese, altrimenti persiano.
  const T = () => STR[state.lang];
  const H = () => (state.lang === 'en' ? 'en' : 'fa');
  const rtl = () => T().dir === 'rtl';
  const arrowBack = () => (rtl() ? '→' : '←');
  const arrowNext = () => (rtl() ? '←' : '→');
  // Nome predefinito da config.js: testo semplice oppure { fa, en, it }
  function defaultName() {
    const n = CFG.nome;
    if (!n) return '';
    if (typeof n === 'string') return n;
    return n[state.lang] || n.en || n.it || n.fa || '';
  }
  function applyLang() {
    document.documentElement.lang = state.lang;
    document.documentElement.dir = T().dir;
  }

  // ---------- Utilità ----------
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const num = n => Number(n).toLocaleString(T().num);
  const it = s => `<span class="it" dir="ltr" lang="it">${esc(s)}</span>`;
  const helpAttrs = () => `dir="${H() === 'fa' ? 'rtl' : 'ltr'}" lang="${H()}"`;
  const tr = s => `<span class="tr" ${helpAttrs()}>${esc(s)}</span>`;
  const meaning = w => w[H()];
  const noteOf = w => w.note[H()];
  const pick = a => a[Math.floor(Math.random() * a.length)];
  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function dayKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function yesterdayKey() {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    return dayKey(y);
  }

  // ---------- Progressi (sistema a scatole di Leitner) ----------
  const ws = w => state.words[w.id] || { b: 0, r: 0, w: 0, t: 0 };
  const isLearned = w => ws(w).b >= 3;
  const learnedIn = id => BY_CAT[id].filter(isLearned).length;

  function record(word, ok) {
    const s = Object.assign({ b: 0, r: 0, w: 0, t: 0 }, state.words[word.id]);
    if (ok) { s.b = Math.min(5, s.b + 1); s.r++; state.xp += 10; }
    else { s.b = Math.max(0, s.b - 2); s.w++; }
    s.t = Date.now();
    state.words[word.id] = s;
    touchDay();
    save();
  }
  function touchDay() {
    const today = dayKey();
    if (state.streak.last === today) return;
    state.streak.count = state.streak.last === yesterdayKey() ? state.streak.count + 1 : 1;
    state.streak.last = today;
  }
  function streakNow() {
    const l = state.streak.last;
    return (l === dayKey() || l === yesterdayKey()) ? state.streak.count : 0;
  }

  // ---------- Voce ----------
  // Nomi delle voci italiane più diffuse (Windows, Edge, Chrome, iPhone/Mac, Android)
  const FEMALE = /elsa|isabella|alice|federica|paola|emma|carla|bianca|giorgia|fiamma|elisa|chiara|silvia|lucia|sara|valentina|francesca|irma|palmira|pierina|imelda|female|donna/i;
  const MALE = /cosimo|diego|giuseppe|luca|benigno|calogero|gianni|rinaldo|lorenzo|marcello|male\b|uomo/i;
  function voiceScore(v) {
    let s = 0;
    if (/^it[-_]IT/i.test(v.lang)) s += 2;
    if (/natural|neural|premium|enhanced|online/i.test(v.name)) s += 6; // voci neurali: le più naturali
    if (/google/i.test(v.name)) s += 4; // "Google italiano" (femminile) in Chrome
    if (FEMALE.test(v.name)) s += 3;
    if (MALE.test(v.name)) s -= 3;
    return s;
  }

  const Speech = {
    ok: 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window,
    voice: null,
    voices: [],
    onchange: null,
    init() {
      if (!this.ok) return;
      const load = () => {
        this.voices = speechSynthesis.getVoices()
          .filter(v => /^it/i.test(v.lang))
          .sort((a, b) => voiceScore(b) - voiceScore(a));
        this.pick();
        if (this.onchange) this.onchange();
      };
      load();
      speechSynthesis.addEventListener('voiceschanged', load);
    },
    // Voce scelta nelle impostazioni, altrimenti la migliore disponibile
    pick() {
      this.voice = this.voices.find(v => v.voiceURI === state.voice) || this.voices[0] || null;
    },
    say(text, rate) {
      if (!this.ok) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text).replace(/\.\.\.|…/g, ' ').replace(/\s\/\s/g, ', '));
      u.lang = 'it-IT';
      if (this.voice) u.voice = this.voice;
      u.rate = rate || state.rate || 0.85;
      speechSynthesis.speak(u);
    }
  };

  // ---------- Rendering ----------
  const $ = s => app.querySelector(s);
  const on = (sel, fn) => app.querySelectorAll(sel).forEach(el => el.addEventListener('click', fn));
  const sayBtn = (text, cls) => Speech.ok
    ? `<button class="say ${cls || ''}" data-say="${esc(text)}" aria-label="${T().play}">🔊</button>` : '';
  const backBar = () => `<div class="topbar"><button class="back" id="back">${arrowBack()} ${T().back}</button></div>`;

  const langSwitch = () => `
    <div class="lang-switch" role="group" aria-label="${T().language}">
      ${LANGS.map(([k, label]) => `<button data-lang="${k}" class="${state.lang === k ? 'active' : ''}" aria-pressed="${state.lang === k}" lang="${k}">${label}</button>`).join('')}
    </div>`;
  function bindLang(rerender) {
    on('[data-lang]', e => {
      state.lang = e.currentTarget.dataset.lang;
      save();
      applyLang();
      rerender();
    });
  }

  function bindSpeak(root) {
    root.querySelectorAll('[data-say]').forEach(el => el.addEventListener('click', e => {
      e.stopPropagation();
      Speech.say(el.dataset.say);
    }));
  }
  function render(html) {
    app.innerHTML = html;
    window.scrollTo(0, 0);
    bindSpeak(app);
    bindReport(app);
  }

  // ---------- Segnalazione errori ----------
  const reportBtn = w => `<button class="report" data-report="${esc(w.id)}" title="${T().report}" aria-label="${T().report}">⚑</button>`;
  function bindReport(root) {
    root.querySelectorAll('[data-report]').forEach(el => el.addEventListener('click', e => {
      e.stopPropagation();
      const w = WORD_BY_ID[el.dataset.report];
      if (w) openReport(w);
    }));
  }

  const toastEl = document.createElement('div');
  toastEl.className = 'toast';
  toastEl.setAttribute('role', 'status');
  document.body.appendChild(toastEl);
  let toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
  }

  const dlg = document.createElement('dialog');
  dlg.className = 'report-dialog';
  document.body.appendChild(dlg);
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

  function openReport(w) {
    const t = T();
    dlg.setAttribute('dir', t.dir);
    dlg.innerHTML = `
      <form class="rep" id="rep-form">
        <h3>⚑ ${t.report}</h3>
        <div class="rep-word">${it(w.it)} · ${tr(meaning(w))}</div>
        <div class="q-label">${t.reportQ}</div>
        <div class="rep-types">
          ${Object.entries(t.reportTypes).map(([k, label], i) => `
            <label class="rep-type"><input type="radio" name="type" value="${k}" ${i === 0 ? 'checked' : ''}> ${label}</label>`).join('')}
        </div>
        <textarea id="rep-text" rows="3" dir="auto" placeholder="${esc(t.reportPlaceholder)}"></textarea>
        <div class="answer-row">
          <button type="button" class="btn ghost" id="rep-cancel">${t.cancel}</button>
          <button type="submit" class="btn primary">${t.save}</button>
        </div>
      </form>`;
    dlg.querySelector('#rep-cancel').addEventListener('click', () => dlg.close());
    dlg.querySelector('#rep-form').addEventListener('submit', e => {
      e.preventDefault();
      state.reports.push({
        id: w.id, it: w.it, fa: w.fa, en: w.en, cat: w.cat,
        type: dlg.querySelector('input[name=type]:checked').value,
        text: dlg.querySelector('#rep-text').value.trim(),
        date: new Date().toISOString().slice(0, 10)
      });
      save();
      dlg.innerHTML = `
        <div class="rep rep-done">
          <div class="res-emoji">💚</div>
          <h3>${t.reportSaved}</h3>
          <p class="muted">${t.reportSendHint}</p>
          <div class="answer-row">
            <button type="button" class="btn ghost" id="rep-later">${t.later}</button>
            <button type="button" class="btn primary" id="rep-send">${t.sendNow}</button>
          </div>
        </div>`;
      dlg.querySelector('#rep-later').addEventListener('click', () => dlg.close());
      dlg.querySelector('#rep-send').addEventListener('click', () => { dlg.close(); sendReports(); });
    });
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }

  // Il messaggio è in italiano: è pensato per chi corregge le parole.
  const TYPE_IT = { translation: 'traduzione sbagliata', italian: "errore nell'italiano", audio: 'audio / pronuncia', other: 'altro' };
  function reportsText() {
    const lines = state.reports.map((r, i) => {
      const cat = catById(r.cat);
      return `${i + 1}. ${r.it} = ${r.fa} / ${r.en}\n` +
        `   Argomento: ${cat ? cat.it : r.cat}\n` +
        `   Problema: ${TYPE_IT[r.type] || r.type}` +
        (r.text ? `\n   Commento: ${r.text}` : '');
    });
    return `⚑ Errori segnalati — Impara l'italiano (${state.reports.length})\n\n` + lines.join('\n\n');
  }
  function clearSentReports(n) {
    state.reports = state.reports.slice(n);
    save();
  }
  async function sendReports(after) {
    const t = T();
    const n = state.reports.length;
    if (!n) return;
    const text = reportsText();
    const done = () => { clearSentReports(n); if (after) after(); };
    if (navigator.share) {
      try {
        await navigator.share({ title: "Impara l'italiano", text });
        toast(t.sent);
        return done();
      } catch (e) {
        if (e && e.name === 'AbortError') return; // annullato: le segnalazioni restano salvate
      }
    }
    if (CFG.emailSegnalazioni) {
      location.href = `mailto:${encodeURIComponent(CFG.emailSegnalazioni)}?subject=${encodeURIComponent("Errori — Impara l'italiano")}&body=${encodeURIComponent(text)}`;
      return done();
    }
    try {
      await navigator.clipboard.writeText(text);
      toast(t.copied);
      done();
    } catch (e) {
      toast(t.sendFailed);
    }
  }

  // Nome dell'argomento: principale nella lingua dell'interfaccia, secondario come aiuto
  function catNames(c) {
    if (state.lang === 'it') return { main: it(c.it), sub: tr(c[H()]) };
    return { main: tr(c[H()]), sub: it(c.it) };
  }

  // ---------- Home ----------
  function phraseOfDay() {
    const pool = BY_CAT.saluti.concat(BY_CAT.presentarsi, BY_CAT.amore, BY_CAT.ristorante);
    const n = Math.floor(Date.now() / 86400000);
    return pool[n % pool.length];
  }

  function home() {
    const t = T();
    const name = state.name || defaultName();
    const learned = ALL.filter(isLearned).length;
    const p = phraseOfDay();
    const msg = String(CFG.messaggio || '').trim();
    render(`
      <div class="hero-top">${langSwitch()}</div>
      <header class="hero">
        <h1>${t.hello}${name ? ' <span dir="auto">' + esc(name) + '</span>' : ''}! 👋</h1>
        <p>${t.subtitle}</p>
      </header>

      <div class="stats">
        <div class="stat"><b>⭐ ${num(state.xp)}</b><span>${t.points}</span></div>
        <div class="stat"><b>🔥 ${num(streakNow())}</b><span>${t.streak}</span></div>
        <div class="stat"><b>📚 ${num(learned)}</b><span>${t.learnedOf(num(ALL.length))}</span></div>
      </div>

      ${msg ? `<div class="card love"><div class="label">${t.message}</div><p dir="auto">${esc(msg)}</p>
        ${CFG.firma ? `<div class="sign" dir="auto">— ${esc(CFG.firma)}</div>` : ''}</div>` : ''}

      <div class="card phrase">
        <div class="label">${t.phrase}</div>
        <div class="big">${it(p.it)} ${sayBtn(p.it)}</div>
        <div class="fa">${tr(meaning(p))}</div>
      </div>

      <div class="actions">
        <button class="btn primary wide" id="review">${t.daily} <small>(${t.questions(num(SESSION_LEN))})</small></button>
        <button class="btn ghost wide" id="pron">${t.pron}</button>
      </div>

      <div class="section-title">${t.topics}</div>
      <div class="cats">
        ${CATS.map(c => {
          const n = catNames(c);
          return `
          <button class="cat" data-cat="${c.id}">
            <span class="emoji">${c.emoji}</span>
            <span class="cat-main">${n.main}</span>
            <span class="cat-sub">${n.sub}</span>
            <span class="bar"><i style="width:${Math.round(learnedIn(c.id) / BY_CAT[c.id].length * 100)}%"></i></span>
          </button>`;
        }).join('')}
      </div>

      <div class="footer"><button class="link" id="settings">${t.settings}</button></div>
    `);
    bindLang(home);
    on('[data-cat]', e => category(e.currentTarget.dataset.cat));
    on('#review', () => startSession('mix', reviewPool(), home));
    on('#pron', pronuncia);
    on('#settings', settings);
  }

  function reviewPool() {
    // Prima le parole già viste ma non ancora consolidate, poi parole nuove in ordine.
    const seen = ALL.filter(w => state.words[w.id] && ws(w).b < 5)
      .sort((a, b) => ws(a).b - ws(b).b || ws(a).t - ws(b).t);
    let pool = seen.slice(0, SESSION_LEN);
    if (pool.length < SESSION_LEN) {
      pool = pool.concat(ALL.filter(w => !state.words[w.id]).slice(0, SESSION_LEN - pool.length));
    }
    if (pool.length < SESSION_LEN) pool = pool.concat(shuffle(ALL).filter(w => !pool.includes(w)).slice(0, SESSION_LEN - pool.length));
    return pool;
  }

  // ---------- Categoria ----------
  function category(id) {
    const t = T();
    const c = catById(id);
    const n = catNames(c);
    const words = BY_CAT[id];
    const learned = learnedIn(id);
    const modes = [
      ['flash', '🃏'], ['quiz', '✅'], ['write', '✍️'], Speech.ok ? ['listen', '🎧'] : null
    ].filter(Boolean);
    render(`
      ${backBar()}
      <header class="cat-head">
        <span class="emoji big">${c.emoji}</span>
        <h2>${n.main}</h2>
        <div class="cat-sub">${n.sub}</div>
        <div class="bar"><i style="width:${Math.round(learned / words.length * 100)}%"></i></div>
        <div class="muted">${t.learnedCat(num(learned), num(words.length))}</div>
      </header>
      <div class="modes">
        ${modes.map(([m, e]) => `<button class="mode" data-mode="${m}"><span class="emoji">${e}</span><span><b>${t.modes[m][0]}</b><span class="d">${t.modes[m][1]}</span></span></button>`).join('')}
        <button class="mode" id="list"><span class="emoji">📖</span><span><b>${t.modes.list[0]}</b><span class="d">${t.modes.list[1]}</span></span></button>
      </div>
    `);
    on('#back', home);
    on('[data-mode]', e => startSession(e.currentTarget.dataset.mode, words, () => category(id)));
    on('#list', () => wordList(id));
  }

  function wordList(id) {
    const c = catById(id);
    const n = catNames(c);
    render(`
      ${backBar()}
      <header class="cat-head"><span class="emoji big">${c.emoji}</span><h2>${n.main}</h2><div class="cat-sub">${n.sub}</div></header>
      <div class="words">
        ${BY_CAT[id].map(w => `
          <div class="word-row">
            ${sayBtn(w.it)}
            <div class="w">${it(w.it)}<small ${helpAttrs()}>${esc(meaning(w))}${noteOf(w) ? ' — ' + esc(noteOf(w)) : ''}</small></div>
            <span class="dot l${ws(w).b}"></span>
            ${reportBtn(w)}
          </div>`).join('')}
      </div>
      <p class="muted">${T().legend}</p>
    `);
    on('#back', () => category(id));
  }

  // ---------- Sessione di esercizi ----------
  let S = null;

  function startSession(mode, pool, back) {
    const words = mode === 'flash' ? shuffle(pool) : shuffle(pool).slice(0, SESSION_LEN);
    S = { mode, pool, words, i: 0, ok: 0, back, answered: false };
    next();
  }

  function next() {
    S.answered = false;
    if (S.i >= S.words.length) return results();
    let m = S.mode;
    if (m === 'mix') m = pick(Speech.ok ? ['quiz', 'quiz', 'write', 'listen'] : ['quiz', 'quiz', 'write']);
    ({ flash: flashcard, quiz, write, listen })[m]();
  }

  function sessionBar() {
    const pct = Math.round(S.i / S.words.length * 100);
    return `<div class="topbar">
      <button class="back" id="back" aria-label="${T().exit}">✕</button>
      <div class="progress"><i style="width:${pct}%"></i></div>
      <span class="count">${num(S.i + 1)} / ${num(S.words.length)}</span>
    </div>`;
  }
  function bindExit() { on('#back', () => { Speech.ok && speechSynthesis.cancel(); S.back(); }); }

  // field: 'it' oppure 'help' (significato nella lingua d'aiuto)
  const valueOf = (w, field) => (field === 'it' ? w.it : meaning(w));
  function options(word, field) {
    const seen = new Set([valueOf(word, field)]);
    const out = [word];
    const cands = shuffle(BY_CAT[word.cat]).concat(shuffle(ALL));
    for (const c of cands) {
      if (out.length >= 4) break;
      const v = valueOf(c, field);
      if (!seen.has(v)) { seen.add(v); out.push(c); }
    }
    return shuffle(out);
  }
  const optionsHtml = (opts, field) => `<div class="options">${opts.map((o, k) =>
    `<button class="opt" data-k="${k}" ${field === 'it' ? 'dir="ltr" lang="it"' : helpAttrs()}>${esc(valueOf(o, field))}</button>`).join('')}</div>`;

  function finish(w, ok, msg) {
    const t = T();
    record(w, ok);
    if (ok) S.ok++;
    const fb = $('#feedback');
    fb.innerHTML = `
      <div class="fb ${ok ? 'ok' : 'ko'}">
        <div class="fb-title">${msg || (ok ? pick(t.praise) : t.wrong)}</div>
        <div class="fb-word">${sayBtn(w.it)} ${it(w.it)} <span class="fb-fa">${tr(meaning(w))}</span></div>
        ${noteOf(w) ? `<div class="note" ${helpAttrs()}>${esc(noteOf(w))}</div>` : ''}
        <button class="btn primary wide" id="next">${t.next} ${arrowNext()}</button>
        <button class="link report-link" data-report="${esc(w.id)}">⚑ ${t.report}</button>
      </div>`;
    bindSpeak(fb);
    bindReport(fb);
    Speech.say(w.it);
    const nb = $('#next');
    nb.addEventListener('click', () => { S.i++; next(); });
    nb.focus();
    fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function bindOptions(opts, w) {
    on('.opt', e => {
      if (S.answered) return;
      S.answered = true;
      const k = +e.currentTarget.dataset.k;
      app.querySelectorAll('.opt').forEach((b, j) => {
        b.disabled = true;
        if (opts[j] === w) b.classList.add('correct');
        else if (j === k) b.classList.add('wrong');
      });
      finish(w, opts[k] === w);
    });
  }

  function flashcard() {
    const t = T();
    const w = S.words[S.i];
    render(`
      ${sessionBar()}
      <div class="flash" id="card" role="button" tabindex="0">
        <div class="flash-it">${it(w.it)}</div>
        ${sayBtn(w.it, 'big')}
        <div class="flash-back" hidden>
          <div class="flash-fa">${tr(meaning(w))}</div>
          ${noteOf(w) ? `<div class="note" ${helpAttrs()}>${esc(noteOf(w))}</div>` : ''}
          <button class="link report-link" data-report="${esc(w.id)}">⚑ ${t.report}</button>
        </div>
        <div class="hint">${t.tapToFlip}</div>
      </div>
      <div class="answer-row" id="ans" hidden>
        <button class="btn bad" id="no">${t.didnt}</button>
        <button class="btn good" id="yes">${t.knew}</button>
      </div>
    `);
    bindExit();
    Speech.say(w.it);
    const card = $('#card');
    const flip = () => {
      card.classList.add('flipped');
      $('.flash-back').hidden = false;
      $('.hint').hidden = true;
      $('#ans').hidden = false;
    };
    card.addEventListener('click', flip);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
    card.focus();
    on('#yes', () => { record(w, true); S.ok++; S.i++; next(); });
    on('#no', () => { record(w, false); S.i++; next(); });
  }

  function quiz() {
    const t = T();
    const w = S.words[S.i];
    const toHelp = Math.random() < 0.5;
    const field = toHelp ? 'help' : 'it';
    const opts = options(w, field);
    render(`
      ${sessionBar()}
      <div class="question">
        <div class="q-label">${toHelp ? t.qMeaning : t.qItalian}</div>
        <div class="q-main">${toHelp ? sayBtn(w.it) + it(w.it) : tr(meaning(w))}</div>
      </div>
      ${optionsHtml(opts, field)}
      <div id="feedback"></div>
    `);
    bindExit();
    if (toHelp) Speech.say(w.it);
    bindOptions(opts, w);
  }

  function listen() {
    const t = T();
    const w = S.words[S.i];
    const opts = options(w, 'help');
    render(`
      ${sessionBar()}
      <div class="question">
        <div class="q-label">${t.listenQ}</div>
        <button class="listen-btn" id="play" aria-label="${t.play}">🔊</button>
        <div><button class="link" id="slow">${t.slower}</button></div>
      </div>
      ${optionsHtml(opts, 'help')}
      <div id="feedback"></div>
    `);
    bindExit();
    setTimeout(() => Speech.say(w.it), 250);
    on('#play', () => Speech.say(w.it));
    on('#slow', () => Speech.say(w.it, 0.55));
    bindOptions(opts, w);
  }

  function write() {
    const t = T();
    const w = S.words[S.i];
    render(`
      ${sessionBar()}
      <div class="question">
        <div class="q-label">${t.writeQ}</div>
        <div class="q-main">${tr(meaning(w))}</div>
        ${noteOf(w) ? `<div class="note" ${helpAttrs()}>${esc(noteOf(w))}</div>` : ''}
      </div>
      <form id="wf" class="write-form" autocomplete="off">
        <input id="inp" type="text" dir="ltr" lang="it" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="scrivi qui…">
        <div class="accents">${['à', 'è', 'é', 'ì', 'ò', 'ù'].map(a => `<button type="button" class="acc" data-a="${a}">${a}</button>`).join('')}</div>
        <div class="answer-row">
          <button type="button" class="btn ghost" id="idk">${t.idk}</button>
          <button type="submit" class="btn primary">${t.check}</button>
        </div>
      </form>
      <div id="feedback"></div>
    `);
    bindExit();
    const inp = $('#inp');
    inp.focus();
    on('.acc', e => {
      const a = e.currentTarget.dataset.a;
      const s = inp.selectionStart ?? inp.value.length, en = inp.selectionEnd ?? inp.value.length;
      inp.value = inp.value.slice(0, s) + a + inp.value.slice(en);
      inp.focus();
      inp.setSelectionRange(s + 1, s + 1);
    });
    const lock = cls => {
      S.answered = true;
      inp.disabled = true;
      if (cls) inp.classList.add(cls);
      $('#wf .answer-row').hidden = true;
      $('.accents').hidden = true;
    };
    $('#wf').addEventListener('submit', e => {
      e.preventDefault();
      if (S.answered) return;
      const v = inp.value.trim();
      if (!v) { inp.focus(); return; }
      const res = checkWritten(v, w.it);
      lock(res.ok ? 'correct' : 'wrong');
      finish(w, res.ok, res.msg && t[res.msg]);
    });
    on('#idk', () => {
      if (S.answered) return;
      lock('');
      finish(w, false, t.noWorries);
    });
  }

  // ---------- Correzione delle risposte scritte ----------
  function alternatives(answer) {
    const parts = answer.split('/').map(s => s.trim()).filter(Boolean);
    const first = parts[0].split(/\s+/);
    return parts.map(p => {
      const w = p.split(/\s+/);
      return w.length < first.length ? first.slice(0, first.length - w.length).concat(w).join(' ') : p;
    });
  }
  function norm(s, strip) {
    s = s.toLowerCase().replace(/[’‘`´]/g, "'");
    if (strip) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return s.replace(/[^a-z0-9àáèéìíòóùú' ]/g, ' ').replace(/'\s+/g, "'").replace(/\s+/g, ' ').trim();
  }
  const noArt = s => s.replace(/^(?:(?:il|lo|la|i|gli|le|un|uno|una) |l'|un')/, '');
  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[a.length][b.length];
  }
  // Restituisce { ok, msg } dove msg è una chiave dei testi (okAccents, okArticle, close)
  function checkWritten(input, answer) {
    const alts = alternatives(answer);
    const exact = norm(input, false), loose = norm(input, true);
    if (alts.some(a => norm(a, false) === exact)) return { ok: true };
    if (alts.some(a => norm(a, true) === loose)) return { ok: true, msg: 'okAccents' };
    if (alts.some(a => { const n = norm(a, true); return noArt(n) !== n && noArt(n) === noArt(loose); })) {
      return { ok: true, msg: 'okArticle' };
    }
    if (alts.some(a => { const n = norm(a, true); return n.length >= 5 && lev(n, loose) === 1; })) {
      return { ok: false, msg: 'close' };
    }
    return { ok: false };
  }

  // ---------- Risultati ----------
  function results() {
    const t = T();
    const total = S.words.length, ok = S.ok, pct = total ? ok / total : 0;
    const level = pct >= 0.9 ? 0 : pct >= 0.6 ? 1 : 2;
    const itTitles = ['Fantastico!', 'Molto bene!', 'Forza, continua così!'];
    render(`
      <div class="results">
        <div class="res-emoji">${['🏆', '🎉', '💪'][level]}</div>
        <h2>${t.results[level]}</h2>
        ${state.lang === 'it' ? '' : it(itTitles[level])}
        <div class="score">${t.scoreOf(num(ok), num(total))}</div>
        <div class="muted">${t.earned(num(ok * 10))}</div>
        <div class="answer-row">
          <button class="btn ghost" id="again">${t.again}</button>
          <button class="btn primary" id="done">${t.continue}</button>
        </div>
      </div>
    `);
    on('#again', () => startSession(S.mode, S.mode === 'mix' ? reviewPool() : S.pool, S.back));
    on('#done', () => S.back());
  }

  // ---------- Pronuncia ----------
  function pronuncia() {
    const t = T();
    const h = H();
    render(`
      ${backBar()}
      <header class="cat-head">
        <span class="emoji big">🗣️</span>
        <h2>${t.pron.replace('🗣️ ', '')}</h2>
        <p class="muted">${t.pronIntro}</p>
      </header>
      ${PRON.map(r => `
        <section class="card rule" ${helpAttrs()}>
          <h3><span class="it-tag" dir="ltr" lang="it">${esc(r.t)}</span> ${esc(r[h].title)}</h3>
          <p>${esc(r[h].rule)}</p>
          <div class="chips">${r.ex.map(e => `<button class="chip" data-say="${esc(e[0])}"><b dir="ltr" lang="it">${esc(e[0])}</b><small>${esc(h === 'fa' ? e[1] : e[2])}</small></button>`).join('')}</div>
        </section>`).join('')}
    `);
    on('#back', home);
  }

  // ---------- Impostazioni ----------
  function settings() {
    const t = T();
    const voice = !Speech.ok ? t.noSpeech
      : Speech.voice ? t.voiceName(esc(Speech.voice.name)) : t.noVoice;
    const shortName = v => v.name.replace(/^(Microsoft|Google|Apple)\s+/i, '').replace(/\s*[-–]\s*Ital(ian|iano)\s*\(Ital(y|ia)\)/i, '');
    const voiceSelect = Speech.voices.length > 1 ? `
        <label class="field">${t.voice}
          <select id="voice">
            <option value="">${t.voiceAuto}</option>
            ${Speech.voices.map(v => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === state.voice ? 'selected' : ''}>${esc(shortName(v))}${FEMALE.test(v.name) ? ' ♀' : MALE.test(v.name) ? ' ♂' : ''}</option>`).join('')}
          </select>
        </label>` : '';
    render(`
      ${backBar()}
      <h2>${t.settings}</h2>
      <div class="card">
        <div class="field">${t.language}${langSwitch()}</div>
        ${t.langHint ? `<p class="muted">${esc(t.langHint)}</p>` : ''}
      </div>
      <div class="card">
        <label class="field">${t.yourName}
          <input type="text" id="name" dir="auto" value="${esc(state.name || defaultName())}">
        </label>
        ${voiceSelect}
        <label class="field">${t.voiceRate}
          <input type="range" id="rate" min="0.5" max="1.2" step="0.05" value="${state.rate}">
        </label>
        <button class="btn ghost" id="test">${t.testVoice}</button>
        <p class="muted">${voice}</p>
        <p class="muted">${t.voiceTip}</p>
      </div>
      <div class="card">
        <h3>${t.reports(num(state.reports.length))}</h3>
        ${state.reports.length ? `
          <div class="words rep-list">
            ${state.reports.map((r, i) => `
              <div class="word-row">
                <div class="w">${it(r.it)}<small>${esc(t.reportTypes[r.type] || r.type)}${r.text ? ' — <span dir="auto">' + esc(r.text) + '</span>' : ''}</small></div>
                <button class="link" data-del="${i}">${t.remove}</button>
              </div>`).join('')}
          </div>
          <button class="btn primary wide" id="send-all">${t.sendAll}</button>`
        : `<p class="muted">${t.noReports}</p>`}
      </div>
      <div class="card">
        <button class="btn bad wide" id="reset">${t.reset}</button>
      </div>
    `);
    bindLang(settings);
    on('[data-del]', e => { state.reports.splice(+e.currentTarget.dataset.del, 1); save(); settings(); });
    on('#send-all', () => sendReports(settings));
    on('#back', home);
    $('#name').addEventListener('input', e => { state.name = e.target.value.trim(); save(); });
    $('#rate').addEventListener('input', e => { state.rate = +e.target.value; save(); });
    const sel = $('#voice');
    if (sel) sel.addEventListener('change', e => {
      state.voice = e.target.value;
      save();
      Speech.pick();
      Speech.say('Ciao! Come stai?');
      settings();
    });
    // Le voci a volte arrivano dopo: ridisegna le impostazioni quando sono pronte
    Speech.onchange = () => { if ($('#rate')) settings(); };
    on('#test', () => Speech.say('Ciao! Come stai? Benvenuti in Italia!'));
    on('#reset', () => {
      if (!confirm(t.confirmReset)) return;
      state = Object.assign(defaults(), { lang: state.lang, name: state.name, rate: state.rate, reports: state.reports });
      save();
      home();
    });
  }

  // ---------- Avvio ----------
  applyLang();
  Speech.init();
  home();
})();
