/* =====================================================================
   SWEAT4 ZYKLUS & TAGESFORM (optional, nur auf dem Gerät der Kundin)
   ---------------------------------------------------------------------
   Was das Modul tut
   - Freiwillige Erfassung: Periode (Beginn/Ende, Stärke), täglicher Kurz-Check-in (Energie, Trainingsbereitschaft,
     Schlaf, Stimmung, Schmerzen, Krämpfe, Symptome, Sicherheits-Hinweis), Einstellungen (Zykluslänge, Verhütung,
     unregelmäßiger Zyklus, besondere Umstände).
   - Kalender + Verlauf; dokumentierte Tage und Schätzungen sind getrennt gekennzeichnet.
   - Trainingssteuerung: Vor dem Krafttraining wird die TAGESFORM bewertet (nicht der Zyklustag). Bei Beschwerden schlägt
     die App eine konkrete Anpassung der geplanten Einheit vor (Sätze, Ziel-RIR, Pause, ggf. Last) – annehmen, ablehnen
     oder selbst wählen. Angepasste Einheiten zählen nicht als Bezug für die Gewichtssteigerung (Progression bleibt).
   - Persönliche Muster erst ab mehreren vollständigen Zyklen, nur als vorsichtiger Hinweis.

   Datenschutz
   - Speicherung ausschließlich lokal in IndexedDB (Store „meta“, Datensatz id 'cycle'). Wird NICHT an den Trainer oder
     den Briefkasten übertragen. Am Training wird nur die Stufe der Anpassung gespeichert (ohne Beschwerden); an den
     Trainer geht sie nur mit Erlaubnis („shareAdj“), sonst nur ein neutraler Progressions-Marker.
   - Einwilligung (Art. 9 DSGVO) vor der Aktivierung; abschalten und alles löschen jederzeit möglich.
   - Keine Ausgabe von Zyklus-/Symptomdaten in Konsole, Fehlermeldungen oder Analyse.

   Alle Schwellenwerte unten sind konfigurierbare PRODUKTREGELN, keine medizinisch validierten Grenzwerte.
   Datumsangaben: lokales Kalenderdatum (YYYY-MM-DD) des Geräts.
   ===================================================================== */
const ZY_RULES = {
  // Tagesform (Skalen 1–5; Schmerz/Krämpfe 0 keine · 1 leicht · 2 mittel · 3 stark)
  low: 2,                 // Energie / Bereitschaft / Schlaf ≤ 2 = „niedrig“ (mäßiges Signal)
  veryLow: 1,             // Energie / Bereitschaft = 1 = „sehr niedrig“ (starkes Signal)
  painMod: 2, painStrong: 3,
  levels: {               // konkrete Anpassung der geplanten Krafteinheit
    reduced: { setsDrop: 1, minSets: 2, rir: 2, restAdd: 30, loadPct: 0 },     // etwas weniger Volumen, Gewicht bleibt
    light: { setsFactor: 0.6, minSets: 1, rir: 3, restAdd: 30, loadPct: 10 },   // deutlich leichter
  },
  recent: { days: 2, sessions: 2 },   // bereits ≥2 Trainings in den letzten 2 Tagen + Beschwerden → eine Stufe vorsichtiger
  // Prognose des nächsten Periodenbeginns
  pred: { minCycles: 3, maxSpread: 7, minLen: 10, maxLen: 60, useLast: 6, userAvgWindow: 4, openMax: 10 },   // openMax: nicht beendete Periode zählt höchstens so viele Tage
  // Persönliche Muster
  pattern: { minCycles: 3, minEntries: 2, diff: 1, startDays: 3, preDays: 5 },
};
const ZY_HORMONAL = ['pill', 'iud-h', 'implant', 'ring', 'patch', 'injection', 'other-h'];
const ZY_SYMPTOMS = ['Kopfschmerzen', 'Rückenschmerzen', 'Blähungen', 'Brustspannen', 'Übelkeit', 'Heißhunger', 'Unruhe', 'Schlechter Schlaf'];

const ZY = (() => {
  const S0 = () => S.meta.get('cycle') || null;
  const on = () => { const r = S0(); return !!(r && r.on && r.consentAt); };
  const rec = () => S0() || { id: 'cycle', v: 1, on: false, consentAt: null, settings: {}, periods: [], days: {}, log: [] };
  const save = r => { r.updatedAt = Date.now(); put('meta', r); };
  const addD = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d); };
  const cid = () => roleInfo().clientId;
  const client = () => S.clients.get(cid());
  const visible = () => isClientMode() && !!client() && client().sex !== 'm';
  const sc = (v, a = 1, b = 5) => { const n = +v; return Number.isFinite(n) && n >= a && n <= b ? n : null; };

  /* ---------------- Perioden & Zyklen (dokumentiert) ---------------- */
  const periods = r => (r.periods || []).filter(p => p && p.start).slice().sort((a, b) => a.start.localeCompare(b.start));
  const openPeriod = r => periods(r).filter(p => !p.end).pop() || null;
  const pEnd = p => p.end || [today(), addD(p.start, ZY_RULES.pred.openMax - 1)].sort()[0];
  function periodOn(r, iso) { return periods(r).find(p => p.start <= iso && iso <= pEnd(p)) || null; }
  function cycles(r) {   // dokumentierte Zykluslängen zwischen zwei Periodenbeginnen
    const P = periods(r), out = [];
    for (let i = 1; i < P.length; i++) {
      const len = daysBetween(P[i - 1].start, P[i].start), ok = len >= ZY_RULES.pred.minLen && len <= ZY_RULES.pred.maxLen;
      out.push({ start: P[i - 1].start, next: P[i].start, len, ok, why: ok ? '' : len > ZY_RULES.pred.maxLen ? 'gap' : 'short', bleed: P[i - 1].end ? daysBetween(P[i - 1].start, P[i - 1].end) + 1 : null });
    }
    return out;
  }
  const median = a => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  /* Schätzung des nächsten Beginns – nur wenn die Voraussetzungen passen, sonst begründetes „keine Schätzung“ */
  function predict(r, ref = today()) {
    const st = r.settings || {}, P = periods(r);
    if (ZY_HORMONAL.includes(st.contra)) return { ok: false, why: 'hormonal' };
    if (st.irregular === 'yes') return { ok: false, why: 'irregular' };
    if (st.special) return { ok: false, why: 'special' };
    if (!P.length) return { ok: false, why: 'none' };
    const last = P[P.length - 1].start, L = cycles(r).filter(c => c.ok).slice(-ZY_RULES.pred.useLast).map(c => c.len);
    if (L.length < ZY_RULES.pred.minCycles) {
      const avg = sc(st.avgLen, ZY_RULES.pred.minLen, ZY_RULES.pred.maxLen);
      if (!avg) return { ok: false, why: 'few', n: L.length };
      const w = ZY_RULES.pred.userAvgWindow;
      return { ok: true, basis: 'user', conf: 'low', last, med: avg, lo: addD(last, avg - w), hi: addD(last, avg + w), n: L.length, lens: L };
    }
    const mn = Math.min(...L), mx = Math.max(...L), med = Math.round(median(L));
    if (mx - mn > ZY_RULES.pred.maxSpread) return { ok: false, why: 'variable', spread: mx - mn, lens: L };
    const lo = addD(last, Math.min(mn, med - 2)), hi = addD(last, Math.max(mx, med + 2));
    return { ok: true, basis: 'data', conf: mx - mn <= 3 ? 'mid' : 'low', last, med, lo, hi, n: L.length, lens: L, late: ref > hi };
  }
  /* Zyklustag = Tage seit dem letzten DOKUMENTIERTEN Beginn (nur Kontext, keine Phase) */
  function cycleDay(r, iso = today()) {
    const P = periods(r).filter(p => p.start <= iso); if (!P.length) return null;
    const d = daysBetween(P[P.length - 1].start, iso) + 1; return d <= ZY_RULES.pred.maxLen ? d : null;
  }

  /* ---------------- Tages-Check-in ---------------- */
  const entry = (r, iso) => (r.days || {})[iso] || null;
  const hasVals = e => !!e && ['energy', 'ready', 'sleep', 'mood', 'pain', 'cramps'].some(k => e[k] != null) || !!(e && (e.safety || (e.symptoms || []).length));

  /* ---------------- Entscheidungslogik (Reihenfolge = Priorität) ----------------
     1 Sicherheit vor allem · 2 aktuelle Tagesform/Beschwerden · 3 Ziel, Plan, Belastung · 4 Zyklus nur Kontext ·
     5 Muster nur als Hinweis · 6 fehlende Angaben ≠ schlechte Form · 7 jede Änderung wird erklärt */
  function decide(e, ctx = {}) {
    const R = ZY_RULES, why = [], info = [];
    if (!hasVals(e)) return { level: 'normal', why, info: [T('Keine Angaben zur Tagesform – Training wie geplant.')], none: true };
    if (e.safety) { why.push({ c: 'safety', t: T('Du hast ungewöhnlich starke Beschwerden angegeben (z. B. Schwindel, Fieber, sehr starke Schmerzen oder Blutung).') });
      return { level: 'rest', why, info: [T('Heute lieber pausieren. Wenn die Beschwerden anhalten oder dich beunruhigen, lass sie bitte ärztlich abklären.')] }; }
    const strong = [], mod = [];
    if (e.pain != null && e.pain >= R.painStrong) strong.push({ c: 'pain', t: T('starke Schmerzen') }); else if (e.pain != null && e.pain >= R.painMod) mod.push({ c: 'pain', t: T('mittlere Schmerzen') });
    if (e.cramps != null && e.cramps >= R.painStrong) strong.push({ c: 'cramps', t: T('starke Krämpfe') }); else if (e.cramps != null && e.cramps >= R.painMod) mod.push({ c: 'cramps', t: T('mittlere Krämpfe') });
    if (e.ready != null && e.ready <= R.veryLow) strong.push({ c: 'ready', t: T('sehr geringe Trainingsbereitschaft') }); else if (e.ready != null && e.ready <= R.low) mod.push({ c: 'ready', t: T('geringe Trainingsbereitschaft') });
    if (e.energy != null && e.energy <= R.veryLow) strong.push({ c: 'energy', t: T('sehr wenig Energie / starke Müdigkeit') }); else if (e.energy != null && e.energy <= R.low) mod.push({ c: 'energy', t: T('wenig Energie / müde') });
    if (e.sleep != null && e.sleep <= R.low) mod.push({ c: 'sleep', t: T('schlecht geschlafen') });
    let level = strong.length ? 'recovery' : mod.length >= 2 ? 'light' : mod.length === 1 ? 'reduced' : 'normal';
    why.push(...strong, ...mod);
    if (level !== 'normal' && level !== 'recovery' && (ctx.recent || 0) >= R.recent.sessions) {
      level = level === 'reduced' ? 'light' : level; info.push(T('Du hast in den letzten {d} Tagen bereits {n}× trainiert – deshalb eine Stufe vorsichtiger.', { d: R.recent.days, n: ctx.recent }));
    }
    if (e.mood != null && e.mood <= R.low && level === 'normal') info.push(T('Stimmung eher gedrückt – Bewegung tut oft gut, du entscheidest.'));
    if (ctx.goal === 'mass' && (level === 'reduced')) info.push(T('Für dein Ziel Muskelaufbau bleibt das Gewicht gleich – nur das Volumen sinkt etwas.'));
    if (ctx.periodDay) info.push(level === 'normal'
      ? T('Tag {d} deiner Periode (dokumentiert). Du fühlst dich gut – also ganz normal trainieren.', { d: ctx.periodDay })
      : T('Tag {d} deiner Periode (dokumentiert). Die Anpassung richtet sich nach deinen Angaben, nicht nach dem Zyklustag.', { d: ctx.periodDay }));
    if (level === 'normal' && !ctx.periodDay) info.push(T('Deine Angaben sprechen nicht gegen den Plan – Training wie geplant.'));
    return { level, why, info };
  }
  /* Kontext aus vorhandenen App-Daten (Ziel, letzte Trainings, dokumentierte Periode) */
  function ctxFor(c, r, iso = today()) {
    const recent = sessionsOf(c.id, true).filter(s => s.kind !== 'run' && daysBetween(s.date, iso) >= 0 && daysBetween(s.date, iso) < ZY_RULES.recent.days).length;
    const p = periodOn(r, iso);
    return { recent, goal: nutGoalOf(c), periodDay: p ? daysBetween(p.start, iso) + 1 : null };
  }
  /* Konkrete Änderung einer Übung je Stufe */
  function setsFor(n, level) {
    const L = ZY_RULES.levels[level]; if (!L) return n;
    if (L.setsDrop) return n > L.minSets ? Math.max(L.minSets, n - L.setsDrop) : n;
    return Math.max(L.minSets, Math.round(n * L.setsFactor));
  }
  function planChanges(did, level) {
    return exercisesOf(did).map(e => { const n = Math.max(1, Math.min(CONFIG.MAX_SETS, e.targetSets || CONFIG.DEFAULT_SETS)), L = ZY_RULES.levels[level] || {};
      return { name: e.name, n, n2: setsFor(n, level), rest: e.rest || null, rest2: e.rest ? e.rest + (L.restAdd || 0) : null }; });
  }
  /* Auf die gerade erzeugte Session anwenden – der Plan selbst bleibt unverändert */
  function applyToSession(s, adj) {
    const L = ZY_RULES.levels[adj.level]; if (!L) return s;
    s.adj = { level: adj.level, sug: adj.sug || adj.level, choice: adj.choice || 'accept', at: Date.now(), rir: L.rir, loadPct: L.loadPct, restAdd: L.restAdd, skipProg: true,
      orig: s.exercises.map(e => ({ n: e.sets.length, rest: e.rest || null })) };
    s.exercises.forEach(e => { const n2 = setsFor(e.sets.length, adj.level); e.sets = e.sets.slice(0, n2); if (e.rest) e.rest += L.restAdd; });
    put('sessions', s); return s;
  }
  function restoreSession(s) {
    if (!s.adj || !s.adj.orig) return;
    s.exercises.forEach((e, i) => { const o = s.adj.orig[i]; if (!o) return; while (e.sets.length < o.n) e.sets.push(blankSet()); e.rest = o.rest; });
    s.adj = { level: 'normal', choice: 'restored', at: Date.now(), skipProg: false, was: s.adj.level };
    put('sessions', s);
  }
  /* Vorschlag für die Last bei „deutlich leichter“: ca. X % unter dem letzten regulären Training, auf die Gewichtsstufe gerundet */
  function adjSug(sess, e, sug, lastP, pg) {
    const a = sess.adj; if (!a || !a.loadPct || a.level === 'normal') return sug;
    const base = sug && hasVal(sug.weight) ? (sug.kind === 'up' ? sug.weight - (sug.delta || 0) : sug.weight) : lastP ? topWeight(lastP.sets) : null;
    if (!hasVal(base) || base <= 0) return sug;
    const st = (pg && pg.step) || 2.5, w = Math.max(st, Math.round(base * (1 - a.loadPct / 100) / st) * st);
    return { weight: r3(w), delta: null, kind: 'adj', reason: T('Heute ca. {p} % leichter als zuletzt ({w} kg) – an deine Tagesform angepasst', { p: a.loadPct, w: fmtNum(base) }) };
  }
  function exHint(sess, ei) {
    const a = sess.adj; if (!a || a.level === 'normal' || !a.orig) return '';
    const e = sess.exercises[ei], o = a.orig[ei] || {}, parts = [];
    if (o.n && o.n !== e.sets.length) parts.push(T('{a} statt {b} Sätze', { a: e.sets.length, b: o.n }));
    if (a.rir) parts.push(T('Ziel: {r}–{r2} Wdh. im Tank (RIR)', { r: a.rir, r2: a.rir + 1 }));
    if (o.rest && e.rest !== o.rest) parts.push(T('Pause {a} statt {b}', { a: restTxt(e.rest), b: restTxt(o.rest) }));
    else if (a.restAdd && !o.rest) parts.push(T('Pausen ruhig etwas länger'));
    return parts.length ? `<div class="zy-exh">🌿 ${T('Heute angepasst')}: ${parts.map(esc).join(' · ')}</div>` : '';
  }
  function sessBanner(sess) {
    const a = sess.adj; if (!a || sess.status === 'done' && !a.level) return '';
    if (a.level === 'normal') return a.was ? `<div class="info zy-banner">${T('Du trainierst heute nach dem ursprünglichen Plan.')}</div>` : '';
    return `<div class="info zy-banner"><b>🌿 ${T('An deine Tagesform angepasst')}: ${esc(levelLabel(a.level))}</b>
      <div style="font-size:13.5px;margin-top:4px">${T('Weniger Sätze und mehr Wiederholungen im Tank als geplant. Dein Plan und deine Steigerung bleiben – diese Einheit zählt nicht als Maßstab für die nächste Gewichtssteigerung.')}</div>
      ${sess.status !== 'done' ? `<button class="btn btn-sm btn-ghost" style="margin-top:8px" data-action="zy-restore" data-sid="${sess.id}">${T('Doch nach Original-Plan trainieren')}</button>` : ''}</div>`;
  }
  /* Datensatz an den Trainer: Beschwerden nie; Stufe nur mit Erlaubnis */
  function sessionOut(s) {
    if (!s.adj) return s;
    const share = !!((rec().settings || {}).shareAdj), c = { ...s };
    c.adj = share ? { level: s.adj.level, skipProg: !!s.adj.skipProg, rir: s.adj.rir || null, loadPct: s.adj.loadPct || 0 } : { skipProg: !!s.adj.skipProg };
    return c;
  }

  /* ---------------- Persönliche Muster (nur Hinweise) ---------------- */
  function rpeOfSession(s) { const v = []; for (const e of s.exercises || []) for (const st of e.sets || []) { const m = /(?:rpe\s*)?(\d+(?:[.,]5)?)/i.exec(String(st.rpe || '')); if (m && !/rir/i.test(st.rpe)) { const n = parseFloat(m[1].replace(',', '.')); if (n >= 1 && n <= 10) v.push(n); } } return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
  function patterns(r, sessions = []) {
    const PR = ZY_RULES.pattern, C = cycles(r).filter(c => c.ok);
    const usable = C.filter(c => { let n = 0; for (let i = 0; i < c.len; i++) if (hasVals(entry(r, addD(c.start, i)))) n++; return n >= PR.minEntries * 2; });
    if (usable.length < PR.minCycles) return { enough: false, have: usable.length, need: PR.minCycles, total: C.length };
    const bucket = (c, iso) => { const d = daysBetween(c.start, iso) + 1; return d <= PR.startDays ? 'start' : daysBetween(iso, c.next) <= PR.preDays ? 'pre' : 'mid'; };
    const res = [];
    const metric = (k, label) => {
      for (const b of ['start', 'pre']) {
        let low = 0, high = 0, n = 0;
        for (const c of usable) {
          const inB = [], out = [];
          for (let i = 0; i < c.len; i++) { const iso = addD(c.start, i), e = entry(r, iso); if (!e || e[k] == null) continue; (bucket(c, iso) === b ? inB : out).push(e[k]); }
          if (inB.length < PR.minEntries || out.length < PR.minEntries) continue;
          n++; const d = inB.reduce((a, x) => a + x, 0) / inB.length - out.reduce((a, x) => a + x, 0) / out.length;
          if (d <= -PR.diff) low++; else if (d >= PR.diff) high++;
        }
        if (n >= PR.minCycles && Math.max(low, high) >= PR.minCycles && Math.max(low, high) / n >= 0.66)
          res.push({ k, b, dir: low > high ? 'low' : 'high', cnt: Math.max(low, high), n, t: T('{l} war {w} meist {d} als an anderen Tagen – in {a} von {b} Zyklen.', { l: label, w: b === 'start' ? T('an den ersten Periodentagen') : T('in den Tagen vor der Periode'), d: low > high ? T('niedriger') : T('höher'), a: Math.max(low, high), b: n }) });
      }
    };
    metric('energy', T('Deine Energie')); metric('ready', T('Deine Trainingsbereitschaft')); metric('sleep', T('Dein Schlaf'));
    for (const b of ['start', 'pre']) {   // wiederkehrende Beschwerden
      const cnt = {};
      for (const c of usable) { const seen = new Set(); for (let i = 0; i < c.len; i++) { const iso = addD(c.start, i), e = entry(r, iso); if (!e || bucket(c, iso) !== b) continue;
        if (e.cramps >= 2) seen.add(T('Krämpfe')); if (e.pain >= 2) seen.add(T('Schmerzen')); (e.symptoms || []).forEach(x => seen.add(T(x))); } seen.forEach(x => { cnt[x] = (cnt[x] || 0) + 1; }); }
      for (const [x, k] of Object.entries(cnt)) if (k >= PR.minCycles) res.push({ k: 'sym', b, cnt: k, n: usable.length, t: T('„{x}“ hast du {w} in {a} von {b} Zyklen notiert.', { x, w: b === 'start' ? T('an den ersten Periodentagen') : T('in den Tagen vor der Periode'), a: k, b: usable.length }) });
    }
    // subjektive Anstrengung (RPE) bei Trainings – nur wenn RPE-Zahlen eingetragen wurden
    { let hi = 0, n = 0;
      for (const c of usable) { const inB = [], out = []; for (const s of sessions) { if (s.date < c.start || s.date >= c.next) continue; const v = rpeOfSession(s); if (v == null) continue; (bucket(c, s.date) === 'pre' ? inB : out).push(v); }
        if (!inB.length || !out.length) continue; n++; if (inB.reduce((a, x) => a + x, 0) / inB.length - out.reduce((a, x) => a + x, 0) / out.length >= PR.diff) hi++; }
      if (n >= PR.minCycles && hi >= PR.minCycles) res.push({ k: 'rpe', b: 'pre', cnt: hi, n, t: T('Deine eingetragene Anstrengung (RPE) war in den Tagen vor der Periode in {a} von {b} Zyklen höher.', { a: hi, b: n }) }); }
    return { enough: true, have: usable.length, list: res };
  }
  function todayPatternHint(r) {
    if (!(r.settings || {}).usePatterns) return '';
    const p = patterns(r, sessionsOf(cid(), true)); if (!p.enough || !p.list.length) return '';
    const per = periodOn(r, today()), d = per ? daysBetween(per.start, today()) + 1 : null, pr = predict(r);
    const b = d && d <= ZY_RULES.pattern.startDays ? 'start' : pr.ok && pr.basis === 'data' && daysBetween(today(), pr.lo) <= ZY_RULES.pattern.preDays && daysBetween(today(), pr.lo) >= 0 ? 'pre' : null;
    const hits = b ? p.list.filter(x => x.b === b) : []; if (!hits.length) return '';
    return `<div class="info zy-hint">💡 ${T('Persönlicher Hinweis aus deinen Einträgen')}: ${esc(hits[0].t)} ${T('Wie ist es heute? Entscheidend ist dein heutiger Check-in.')}</div>`;
  }

  /* ---------------- Ansichten ---------------- */
  const levelLabel = l => ({ normal: T('wie geplant'), reduced: T('etwas reduziert'), light: T('deutlich leichter'), recovery: T('aktive Erholung'), rest: T('Ruhetag') })[l] || l;
  const scaleRow = (name, label, v, lo, hi, labs) => `<div class="field zy-sc"><span>${esc(label)} <small class="muted">${esc(labs)}</small></span><div class="iq-chips zy-chips">${Array.from({ length: hi - lo + 1 }, (_, i) => i + lo).map(n => `<label><input type="radio" name="${name}" value="${n}" ${v === n ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div></div>`;
  function checkinForm(r, iso, ctxStart) {
    const e = entry(r, iso) || {}, per = periodOn(r, iso), flow = per && per.flow ? per.flow[iso] : null;
    return `<form data-form="zy-checkin" data-date="${iso}" data-start="${ctxStart ? 1 : ''}">
      ${ctxStart ? `<p class="muted" style="margin:0 0 10px;font-size:13.5px">${T('Kurz vor dem Training: Wie geht es dir heute? Alles ist optional – lass weg, was du nicht angeben möchtest.')}</p>` : ''}
      ${ctxStart ? todayPatternHint(r) : ''}
      ${scaleRow('energy', T('Energie'), e.energy, 1, 5, T('1 sehr müde · 5 voller Energie'))}
      ${scaleRow('ready', T('Lust auf Training'), e.ready, 1, 5, T('1 gar nicht · 5 sehr'))}
      ${scaleRow('sleep', T('Schlaf letzte Nacht'), e.sleep, 1, 5, T('1 sehr schlecht · 5 sehr gut'))}
      ${scaleRow('mood', T('Stimmung'), e.mood, 1, 5, T('1 gedrückt · 5 sehr gut'))}
      ${scaleRow('pain', T('Schmerzen'), e.pain, 0, 3, T('0 keine · 3 stark'))}
      ${scaleRow('cramps', T('Krämpfe'), e.cramps, 0, 3, T('0 keine · 3 stark'))}
      <div class="field"><span>${T('Periode heute')}</span><div class="iq-chips zy-chips">${[['', T('keine')], ['1', T('leicht')], ['2', T('mittel')], ['3', T('stark')]].map(([v, l]) => `<label><input type="radio" name="flow" value="${v}" ${(per && flow ? String(flow) : '') === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
      <details class="zy-more" ${(e.symptoms || []).length || e.custom || e.safety || e.note ? 'open' : ''}><summary>${T('Weitere Symptome & Notiz')}</summary>
        <div class="iq-chips" style="margin-top:8px">${ZY_SYMPTOMS.map(x => `<label><input type="checkbox" name="sym" value="${esc(x)}" ${(e.symptoms || []).includes(x) ? 'checked' : ''}><span>${esc(T(x))}</span></label>`).join('')}</div>
        <label class="field" style="margin-top:10px"><span>${T('Eigenes Symptom (optional)')}</span><input class="input" name="custom" maxlength="60" value="${esc(e.custom || '')}"></label>
        <label class="field"><span>${T('Notiz (optional)')}</span><input class="input" name="note" maxlength="200" value="${esc(e.note || '')}"></label>
      </details>
      <label class="toggle" style="margin:10px 0"><input type="checkbox" name="safety" ${e.safety ? 'checked' : ''}><span class="tg"></span><span>${T('Ungewöhnlich starke Beschwerden')}<small>${T('z. B. Schwindel, Fieber, sehr starke Schmerzen oder Blutung')}</small></span></label>
      <div class="sheet-actions">${ctxStart ? `<button type="button" class="btn btn-ghost" data-action="zy-dlg" data-v="skip">${T('Überspringen')}</button>` : `<button type="button" class="btn btn-ghost" data-action="modal-close">${T('Abbrechen')}</button>`}<button class="btn btn-primary">${ctxStart ? T('Weiter') : T('Speichern')}</button></div></form>`;
  }
  function readCheckin(f) {
    const fd = new FormData(f), g = k => fd.get(k) === null || fd.get(k) === '' ? null : +fd.get(k);
    const e = { energy: sc(g('energy')), ready: sc(g('ready')), sleep: sc(g('sleep')), mood: sc(g('mood')), pain: sc(g('pain'), 0, 3), cramps: sc(g('cramps'), 0, 3),
      symptoms: fd.getAll('sym').filter(x => ZY_SYMPTOMS.includes(x)), custom: String(fd.get('custom') || '').trim().slice(0, 60), note: String(fd.get('note') || '').trim().slice(0, 200), safety: fd.get('safety') === 'on', at: Date.now() };
    return { e, flow: fd.get('flow') ? sc(+fd.get('flow'), 1, 3) : 0 };
  }
  function saveCheckin(iso, e, flow) {
    const r = rec(); r.days = r.days || {};
    if (hasVals(e) || e.note || e.custom) r.days[iso] = e; else delete r.days[iso];
    const per = periodOn(r, iso);
    if (flow) { if (per) { per.flow = { ...(per.flow || {}), [iso]: flow }; if (per.end && per.end < iso) per.end = iso; } else r.periods = [...(r.periods || []), { id: uid(), start: iso, end: null, flow: { [iso]: flow }, at: Date.now() }]; }
    else if (per && per.flow) delete per.flow[iso];
    save(r);
  }
  function checkinModal(iso, ctxStart) {
    return new Promise(res => { modal(ctxStart ? T('Deine Tagesform') : T('Check-in · {d}', { d: fmtDate(iso) }), checkinForm(rec(), iso, ctxStart)); modalResolve = res; });
  }
  function adjustModal(cid, did, d) {
    const day = S.days.get(did), isRec = d.level === 'recovery' || d.level === 'rest', lv = isRec ? 'light' : d.level, ch = planChanges(did, lv);
    const rows = ch.map(x => `<tr><td>${esc(exName(x.name))}</td><td>${x.n}</td><td><b>${x.n2}</b></td></tr>`).join('');
    const L = ZY_RULES.levels[lv];
    return new Promise(res => {
      modal(T('Vorschlag für heute'), `<div class="zy-adj">
        <div class="zy-lv zy-lv-${d.level}"><small>${T('Empfehlung')}</small><b>${esc(levelLabel(d.level))}</b></div>
        ${d.why.length ? `<div style="font-size:14px;margin:8px 0">${T('Grund')}: ${d.why.map(w => esc(w.t)).join(', ')}.</div>` : ''}
        ${d.info.map(t => `<div class="muted" style="font-size:13px;margin-bottom:6px">${esc(t)}</div>`).join('')}
        ${isRec ? `<div class="info" style="font-size:14px">${d.level === 'rest' ? T('Heute ist ein Ruhetag sinnvoll. Dein Plan läuft danach ganz normal weiter.') : T('Statt Krafttraining: 20–30 Min. lockerer Spaziergang oder ruhige Mobility. Wenn du trotzdem trainieren möchtest, dann die leichte Variante.')}</div>` : ''}
        <div style="font-size:13.5px;margin:10px 0 6px"><b>${isRec ? T('Leichte Variante, falls du trainieren möchtest') : T('So ändert sich {d}', { d: esc(TD(day ? day.name : '')) })}</b></div>
        <table class="table zy-tbl"><thead><tr><th>${T('Übung')}</th><th>${T('Plan')}</th><th>${T('Heute')}</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="muted" style="font-size:12.5px;margin-top:6px">${T('Sätze laut Plan → heute. Dazu: Ziel {r}–{r2} Wiederholungen im Tank (RIR), Pausen +{p} Sek.', { r: L.rir, r2: L.rir + 1, p: L.restAdd })}${L.loadPct ? ' ' + T('Gewicht ca. {p} % leichter als zuletzt.', { p: L.loadPct }) : ''} ${T('Dein Trainingsplan und deine Steigerung bleiben unverändert.')}</div>
        <div class="stack" style="margin-top:14px">
          ${isRec ? `<button class="btn btn-primary btn-block" data-action="zy-dlg" data-v="${d.level}">${d.level === 'rest' ? T('Ruhetag nehmen') : T('Aktive Erholung statt Training')}</button>
            <button class="btn btn-ghost btn-block" data-action="zy-dlg" data-v="light">${T('Leichte Variante trainieren')}</button>`
          : `<button class="btn btn-primary btn-block" data-action="zy-dlg" data-v="${d.level}">${T('Anpassung übernehmen')}</button>
            <button class="btn btn-ghost btn-block" data-action="zy-dlg" data-v="${d.level === 'reduced' ? 'light' : 'reduced'}">${d.level === 'reduced' ? T('Noch leichter') : T('Nur etwas reduzieren')}</button>`}
          <button class="btn btn-text btn-block" data-action="zy-dlg" data-v="normal">${T('Nein danke – wie geplant trainieren')}</button></div></div>`);
      modalResolve = res;
    });
  }
  function logDecision(r, x) { r.log = [...(r.log || []), { id: uid(), date: today(), at: Date.now(), ...x }].slice(-400); save(r); }
  /* Einstieg vor dem Start eines Krafttrainings. Rückgabe: null (normal) | {cancel:true} | {adj:{...}} */
  async function beforeStart(c_id, did) {
    if (!isClientMode() || !on() || c_id !== cid()) return null;
    let r = rec(), e = entry(r, today());
    if (!e) {
      const v = await checkinModal(today(), true);
      if (v == null) return { cancel: true };
      r = rec(); e = entry(r, today());
    }
    const d = decide(e, ctxFor(S.clients.get(c_id), r));
    if (d.level === 'normal') { if (!d.none) { logDecision(r, { level: 'normal', sug: 'normal', choice: 'auto', why: [] }); toast(T('Tagesform passt – Training wie geplant 💪')); } return null; }
    const v = await adjustModal(c_id, did, d);
    if (v == null) return { cancel: true };
    const why = d.why.map(w => w.c);
    if (v === 'normal') { logDecision(r, { level: 'normal', sug: d.level, choice: 'decline', why }); return null; }
    if (v === 'recovery' || v === 'rest') { logDecision(r, { level: v, sug: d.level, choice: 'accept', why }); go('/zyklus/erholung'); return { cancel: true }; }
    return { adj: { level: v, sug: d.level, choice: v === d.level ? 'accept' : 'manual', why } };
  }
  function afterCreate(s, pre) {
    if (!pre || !pre.adj) return;
    applyToSession(s, pre.adj); logDecision(rec(), { level: pre.adj.level, sug: pre.adj.sug, choice: pre.adj.choice, why: pre.adj.why, sid: s.id });
  }

  /* Kalender */
  function calendar(r, ym) {
    const [y, m] = ym.split('-').map(Number), first = new Date(y, m - 1, 1), off = (first.getDay() + 6) % 7, n = new Date(y, m, 0).getDate(), pr = predict(r);
    const cells = [];
    for (let i = 0; i < off; i++) cells.push('<span class="zy-d zy-pad"></span>');
    for (let d = 1; d <= n; d++) {
      const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, per = periodOn(r, iso), e = entry(r, iso), est = pr.ok && !per && iso >= pr.lo && iso <= pr.hi && iso > (pr.last || '');
      const cls = ['zy-d', per ? 'zy-per' : '', est ? 'zy-est' : '', iso === today() ? 'zy-today' : '', iso > today() ? 'zy-fut' : ''].join(' ');
      cells.push(`<button class="${cls}" data-action="zy-day" data-d="${iso}" aria-label="${fmtDate(iso)}${per ? ' · ' + T('Periode (dokumentiert)') : est ? ' · ' + T('geschätzt') : ''}"><span>${d}</span>${e && hasVals(e) ? '<i class="zy-dot"></i>' : ''}</button>`);
    }
    const mName = first.toLocaleDateString(LOC(), { month: 'long', year: 'numeric' }), prev = isoOf(new Date(y, m - 2, 1)).slice(0, 7), next = isoOf(new Date(y, m, 1)).slice(0, 7);
    return `<div class="card zy-cal-card"><div class="zy-cal-h"><button class="icon-btn" data-action="zy-month" data-m="${prev}" aria-label="${T('Vorheriger Monat')}">${ic('back', 20)}</button><b>${esc(mName)}</b><button class="icon-btn" data-action="zy-month" data-m="${next}" aria-label="${T('Nächster Monat')}" style="transform:scaleX(-1)">${ic('back', 20)}</button></div>
      <div class="zy-cal">${WEEKDAYS_DE.map(w => `<span class="zy-wd">${T(w)}</span>`).join('')}${cells.join('')}</div>
      <div class="zy-legend"><span><i class="zy-per"></i>${T('Periode (dokumentiert)')}</span><span><i class="zy-est"></i>${T('nächster Beginn (geschätzt)')}</span><span><i class="zy-dotl"></i>${T('Check-in')}</span></div></div>`;
  }
  function predHtml(r) {
    const p = predict(r);
    if (!p.ok) {
      const t = { hormonal: T('Bei hormoneller Verhütung gibt es keinen natürlichen Zyklus, aus dem sich eine Prognose ableiten lässt. Du kannst Blutungen und Tagesform trotzdem erfassen.'),
        irregular: T('Du hast einen unregelmäßigen Zyklus angegeben – die App macht deshalb keine Prognose.'),
        special: T('Wegen der angegebenen besonderen Umstände macht die App keine Prognose.'),
        none: T('Noch keine Periode eingetragen – trage den Beginn ein, wenn sie kommt.'),
        few: T('Für eine Schätzung braucht die App mindestens {m} dokumentierte Zyklen (bisher {n}). Bis dahin keine Prognose.', { m: ZY_RULES.pred.minCycles, n: p.n || 0 }),
        variable: T('Deine Zykluslängen schwanken um {s} Tage – eine verlässliche Schätzung ist deshalb nicht möglich.', { s: p.spread }) }[p.why];
      return `<div class="card zy-pred"><div class="nut-bt-l">${T('Nächste Periode')}</div><div style="font-size:14px;margin-top:4px">${esc(t)}</div></div>`;
    }
    return `<div class="card zy-pred"><div class="nut-bt-l">${T('Nächste Periode · Schätzung')}</div>
      <div class="zy-pred-v">${T('zwischen {a} und {b}', { a: fmtDate(p.lo), b: fmtDate(p.hi) })}</div>
      <div class="muted" style="font-size:13px">${p.basis === 'user' ? T('Grundlage: deine Angabe von ca. {l} Tagen – noch keine eigenen Daten, daher grob.', { l: p.med }) : T('Grundlage: {n} dokumentierte Zyklen ({lens} Tage). Unsicherheit: {s}.', { n: p.n, lens: p.lens.join(', '), s: p.conf === 'mid' ? T('mittel') : T('hoch') })}
      ${p.late ? '<br>' + T('Der geschätzte Zeitraum ist vorbei. Schätzungen können danebenliegen – trag den Beginn einfach ein, wenn es so weit ist.') : ''}</div></div>`;
  }
  function historyHtml(r) {
    const C = cycles(r).slice().reverse(), sess = sessionsOf(cid(), true);
    if (!C.length) return `<div class="card muted" style="font-size:14px">${T('Der Verlauf erscheint, sobald zwei Periodenbeginne eingetragen sind.')}</div>`;
    return `<div class="card list-card">${C.map(c => {
      const ds = []; for (let i = 0; i < Math.min(c.len, 70); i++) { const e = entry(r, addD(c.start, i)); if (e) ds.push(e); }
      const avg = k => { const v = ds.map(e => e[k]).filter(x => x != null); return v.length ? fmtNum(Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10) : '–'; };
      const adj = sess.filter(s => s.date >= c.start && s.date < c.next && s.adj && s.adj.level && s.adj.level !== 'normal').length, tr = sess.filter(s => s.date >= c.start && s.date < c.next).length;
      return `<div class="list-link zy-hist"><div class="grow"><b>${fmtDate(c.start)} – ${fmtDate(addD(c.next, -1))}</b>
        <div class="muted" style="font-size:13px">${c.ok ? T('{l} Tage', { l: c.len }) : c.why === 'gap' ? T('{l} Tage – vermutlich fehlender Eintrag, nicht berücksichtigt', { l: c.len }) : T('{l} Tage – ungewöhnlich kurz, bitte prüfen', { l: c.len })}${c.bleed ? ' · ' + T('Periode {b} Tage', { b: c.bleed }) : ''}</div>
        <div class="muted" style="font-size:13px">${T('{n} Check-ins · Energie Ø {e} · Bereitschaft Ø {r} · {t} Trainings, davon {a} angepasst', { n: ds.length, e: avg('energy'), r: avg('ready'), t: tr, a: adj })}</div></div></div>`;
    }).join('')}</div>`;
  }
  function patternsHtml(r) {
    const p = patterns(r, sessionsOf(cid(), true)), st = r.settings || {};
    const body = !p.enough ? `<div class="muted" style="font-size:14px">${T('Persönliche Muster zeigt die App erst ab {m} gut dokumentierten Zyklen (bisher {n}). Ein einzelner Zyklus sagt noch wenig aus.', { m: p.need, n: p.have })}</div>`
      : p.list.length ? `<ul class="zy-pat">${p.list.map(x => `<li>${esc(x.t)}</li>`).join('')}</ul><div class="muted" style="font-size:12.5px">${T('Das sind Beobachtungen aus deinen Einträgen, keine Ursache und keine Diagnose. Schlaf, Stress, Planänderungen oder fehlende Einträge können ebenso eine Rolle spielen.')}</div>`
      : `<div class="muted" style="font-size:14px">${T('In {n} Zyklen zeigt sich kein wiederkehrendes Muster – gut zu wissen.', { n: p.have })}</div>`;
    return `<div class="card stack">${body}
      <label class="toggle" style="margin:0"><input type="checkbox" data-zyset="usePatterns" ${st.usePatterns ? 'checked' : ''}><span class="tg"></span><span>${T('Hinweise beim Check-in anzeigen')}<small>${T('Nur ein Hinweis – die Trainingsanpassung richtet sich immer nach deinem heutigen Check-in.')}</small></span></label></div>`;
  }
  function viewIntro() {
    return topbar({ back: '/', title: T('Zyklus & Tagesform') }) + `<main class="wrap view">
      <div class="card stack zy-intro"><h2 style="margin:0;font-size:20px">${T('Training nach deiner Tagesform')}</h2>
        <div style="font-size:15px">${T('Optional: Erfasse deine Periode und kurz, wie es dir geht. Vor dem Training passt die App die Einheit an deine Tagesform an – nicht pauschal an den Zyklustag. Fühlst du dich gut, trainierst du wie geplant, auch während der Periode.')}</div>
        <ul class="zy-list"><li>${T('Kein Wearable nötig – ein Check-in dauert ca. 20 Sekunden.')}</li><li>${T('Alle Angaben sind freiwillig und überspringbar.')}</li>
          <li>${T('Deine Zyklus- und Symptomdaten bleiben nur auf diesem Gerät. Sie gehen nicht an deinen Trainer und werden nicht für Werbung genutzt.')}</li>
          <li>${T('Du kannst das Modul jederzeit abschalten und alle Daten löschen.')}</li>
          <li>${T('Die App ersetzt keine ärztliche Beratung und ist kein Verhütungsmittel.')}</li></ul>
        <form data-form="zy-consent" class="stack">
          <label class="toggle" style="margin:0"><input type="checkbox" name="ok" required><span class="tg"></span><span>${T('Ich willige ein, dass meine Zyklus- und Gesundheitsangaben auf diesem Gerät gespeichert und zur Anpassung meines Trainings verwendet werden.')}<small>${T('Freiwillig, jederzeit widerrufbar (Art. 9 Abs. 2 a DSGVO).')}</small></span></label>
          <button class="btn btn-primary btn-big">${T('Zyklus & Tagesform aktivieren')}</button></form>
        ${S.meta.get('cycleHide') ? '' : `<button class="btn btn-text btn-block" data-action="zy-hide">${T('Nicht mehr auf der Startseite anzeigen')}</button>`}</div></main>`;
  }
  function viewMain(sub) {
    if (!visible()) return null;
    const r = rec();
    if (!on()) return viewIntro();
    if (sub === 'erholung') return topbar({ back: '/zyklus', title: T('Aktive Erholung') }) + `<main class="wrap view"><div class="card stack">
      <div style="font-size:15px">${T('Gute Entscheidung – Erholung gehört zum Training. Dein Plan läuft beim nächsten Mal ganz normal weiter.')}</div>
      <ul class="zy-list"><li>${T('20–30 Min. lockerer Spaziergang an der frischen Luft')}</li><li>${T('10–15 Min. ruhige Mobility – nur so weit, wie es angenehm ist')}</li><li>${T('Genug trinken und regelmäßig essen')}</li></ul>
      <a class="btn btn-primary btn-block" href="#/uebungen" data-zy-mob="1">${ic('book', 18)} ${T('Mobility-Übungen ansehen')}</a>
      <div class="muted" style="font-size:12.5px">${T('Wenn starke Beschwerden anhalten oder dich beunruhigen, lass sie bitte ärztlich abklären.')}</div></div></main>`;
    if (sub === 'einstellungen') return viewSettings(r);
    const e = entry(r, today()), op = openPeriod(r), cd = cycleDay(r), ym = UI.zyMonth || today().slice(0, 7), d = e ? decide(e, ctxFor(client(), r)) : null;
    return topbar({ back: '/', title: T('Zyklus & Tagesform'), right: `<a class="icon-btn" href="#/zyklus/einstellungen" aria-label="${T('Einstellungen')}">${ic('db', 22)}</a>` }) + `<main class="wrap view">
      <div class="card stack zy-today-card">
        <div class="nut-bt-h"><div><div class="nut-bt-l">${T('Heute')}${cd ? ' · ' + T('Zyklustag {d} (seit dokumentiertem Beginn)', { d: cd }) : ''}</div>
          <b style="font-size:17px">${e ? T('Trainingsempfehlung: {l}', { l: levelLabel(d.level) }) : T('Noch kein Check-in')}</b></div>
          <button class="btn btn-sm ${e ? 'btn-ghost' : 'btn-primary'}" data-action="zy-checkin" data-d="${today()}">${e ? T('Ändern') : T('Check-in')}</button></div>
        ${e && d ? `<div class="muted" style="font-size:13.5px">${d.why.length ? T('Grund') + ': ' + d.why.map(w => esc(w.t)).join(', ') + '. ' : ''}${d.info.map(esc).join(' ')}</div>` : `<div class="muted" style="font-size:13.5px">${T('Vor dem Training fragt dich die App kurz danach – du kannst es auch jetzt schon eintragen.')}</div>`}
        <div class="grid2">${op ? `<button class="btn btn-ghost" data-action="zy-pend">${T('Periode beendet')}</button>` : `<button class="btn btn-ghost" data-action="zy-pstart">${T('Periode hat begonnen')}</button>`}<a class="btn btn-ghost" href="#/zyklus/einstellungen">${T('Einstellungen')}</a></div>
      </div>
      ${predHtml(r)}
      ${calendar(r, ym)}
      <section class="section"><div class="section-h"><h2>${T('Verlauf')}</h2></div>${historyHtml(r)}</section>
      <section class="section"><div class="section-h"><h2>${T('Persönliche Muster')}</h2></div>${patternsHtml(r)}</section>
      <div class="muted" style="font-size:12.5px;text-align:center;margin-top:14px">🔒 ${T('Nur auf diesem Gerät gespeichert · Schätzungen sind als „geschätzt“ markiert')}</div>
    </main>`;
  }
  function viewSettings(r) {
    const st = r.settings || {}, P = periods(r).slice().reverse();
    const opt = (v, l, cur) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`;
    return topbar({ back: '/zyklus', title: T('Zyklus – Einstellungen') }) + `<main class="wrap view">
      <form data-form="zy-settings" class="card stack">
        <label class="field"><span>${T('Durchschnittliche Zykluslänge (falls bekannt)')}</span><input class="input" name="avgLen" inputmode="numeric" placeholder="${T('z. B. 30 – leer lassen, wenn unbekannt')}" value="${esc(st.avgLen || '')}"></label>
        <label class="field"><span>${T('Verhütung')}</span><select class="input" name="contra">${opt('', T('keine Angabe'), st.contra || '')}${opt('none', T('keine hormonelle Verhütung'), st.contra)}${opt('pill', T('Pille'), st.contra)}${opt('iud-h', T('Hormonspirale'), st.contra)}${opt('implant', T('Implantat'), st.contra)}${opt('ring', T('Vaginalring'), st.contra)}${opt('other-h', T('andere hormonelle Verhütung'), st.contra)}</select></label>
        <label class="field"><span>${T('Ist dein Zyklus unregelmäßig?')}</span><select class="input" name="irregular">${opt('', T('weiß nicht'), st.irregular || '')}${opt('no', T('nein'), st.irregular)}${opt('yes', T('ja'), st.irregular)}</select></label>
        <label class="field"><span>${T('Besondere Umstände (optional)')}</span><select class="input" name="special">${opt('', T('keine'), st.special || '')}${opt('pregnant', T('Schwangerschaft'), st.special)}${opt('postpartum', T('nach einer Geburt / Stillzeit'), st.special)}${opt('peri', T('Wechseljahre'), st.special)}${opt('other', T('anderer Grund'), st.special)}</select></label>
        <div class="muted" style="font-size:12.5px">${T('Bei hormoneller Verhütung, unregelmäßigem Zyklus oder besonderen Umständen macht die App keine Zyklusprognose. Der Tages-Check-in funktioniert trotzdem.')}</div>
        <label class="toggle" style="margin:0"><input type="checkbox" name="shareAdj" ${st.shareAdj ? 'checked' : ''}><span class="tg"></span><span>${T('Trainer darf sehen, dass ein Training an meine Tagesform angepasst wurde')}<small>${T('Nur die Stufe (z. B. „etwas reduziert“), nie Zyklus- oder Symptomdaten.')}</small></span></label>
        <button class="btn btn-primary">${T('Speichern')}</button></form>
      <section class="section"><div class="section-h"><h2>${T('Eingetragene Perioden')}</h2><button class="btn btn-sm btn-ghost" data-action="zy-padd">${ic('plus', 16)} ${T('Nachtragen')}</button></div>
        ${P.length ? `<div class="card list-card">${P.map(p => `<div class="list-link"><div class="grow"><b>${fmtDate(p.start)} – ${p.end ? fmtDate(p.end) : T('läuft')}</b></div>
          <button class="btn btn-sm btn-ghost" data-action="zy-pedit" data-id="${p.id}">${T('Ändern')}</button><button class="icon-btn" data-action="zy-pdel" data-id="${p.id}" aria-label="${T('Löschen')}">${ic('trash', 18)}</button></div>`).join('')}</div>` : `<div class="card muted" style="font-size:14px">${T('Noch keine Periode eingetragen.')}</div>`}</section>
      <section class="section"><div class="section-h"><h2>${T('Daten & Einwilligung')}</h2></div><div class="card stack">
        <div class="muted" style="font-size:13px">${T('Einwilligung erteilt am {d}. Gespeichert: {p} Perioden, {c} Check-ins – nur auf diesem Gerät.', { d: fmtDateTs(r.consentAt), p: P.length, c: Object.keys(r.days || {}).length })}</div>
        <button class="btn btn-ghost btn-block" data-action="zy-off">${T('Modul abschalten (Daten bleiben)')}</button>
        <button class="btn btn-danger-ghost btn-block" data-action="zy-wipe">${ic('trash')} ${T('Alle Zyklusdaten löschen')}</button></div></section>
    </main>`;
  }
  function homeCard(c) {
    if (!visible()) return '';
    if (!on()) return S.meta.get('cycleHide') ? '' : `<a class="list-link card zy-home" style="margin-top:12px" href="#/zyklus"><span class="care-ic">🌙</span><div class="grow"><b>${T('Zyklus & Tagesform')} <span class="tag">${T('optional')}</span></b><div class="muted" style="font-size:13px">${T('Training an deine Tagesform anpassen – ohne Wearable')}</div></div><span class="muted">${ic('arrow', 18)}</span></a>`;
    const r = rec(), e = entry(r, today()), d = e ? decide(e, ctxFor(c, r)) : null, op = openPeriod(r);
    return `<a class="list-link card zy-home" style="margin-top:12px" href="#/zyklus"><span class="care-ic">🌙</span><div class="grow"><b>${T('Zyklus & Tagesform')}</b><div class="muted" style="font-size:13px">${e ? T('Heute: {l}', { l: levelLabel(d.level) }) : T('Heute noch kein Check-in')}${op ? ' · ' + T('Periode Tag {d}', { d: daysBetween(op.start, today()) + 1 }) : ''}</div></div><span class="muted">${ic('arrow', 18)}</span></a>`;
  }
  /* Ernährung: nur Hinweis während dokumentierter Periodentage – keine Kalorienänderung, keine Supplemente */
  function nutHint(c) {
    if (!visible() || !on()) return '';
    const r = rec(), per = periodOn(r, today()); if (!per) return '';
    return `<div class="nut-bt zy-nut"><div class="nut-bt-l">${T('Während deiner Periode')}</div><div class="nut-bt-n">${T('Iss regelmäßig und ausreichend, trink genug. Eisenreiche Lebensmittel (z. B. Fleisch, Hülsenfrüchte, Haferflocken, Vollkorn – mit Vitamin C kombiniert) sind eine gute Wahl. Das ist keine Diagnose; Eisenmangel kann nur eine Blutuntersuchung zeigen.')}</div></div>`;
  }

  /* ---------------- Aktionen ---------------- */
  Object.assign(A, {
    'zy-dlg': el => closeModal(el.dataset.v || null),
    'zy-checkin': el => checkinModal(el.dataset.d, false).then(() => render()),
    'zy-day': el => { const iso = el.dataset.d, r = rec(), per = periodOn(r, iso), e = entry(r, iso);
      modal(fmtDate(iso), `<div class="stack">${per ? `<div class="muted">${T('Periode (dokumentiert)')}: ${fmtDate(per.start)} – ${per.end ? fmtDate(per.end) : T('läuft')}</div>` : ''}
        ${e ? `<div class="muted" style="font-size:14px">${[['energy', T('Energie')], ['ready', T('Lust auf Training')], ['sleep', T('Schlaf')], ['mood', T('Stimmung')], ['pain', T('Schmerzen')], ['cramps', T('Krämpfe')]].filter(([k]) => e[k] != null).map(([k, l]) => `${l} ${e[k]}`).join(' · ')}${(e.symptoms || []).length ? '<br>' + e.symptoms.map(x => esc(T(x))).join(', ') : ''}${e.custom ? '<br>' + esc(e.custom) : ''}</div>` : `<div class="muted">${T('Kein Check-in an diesem Tag.')}</div>`}
        ${iso <= today() ? `<button class="btn btn-primary btn-block" data-action="zy-checkin" data-d="${iso}">${e ? T('Check-in bearbeiten') : T('Check-in nachtragen')}</button>
          ${e ? `<button class="btn btn-text btn-block" data-action="zy-ddel" data-d="${iso}">${T('Check-in löschen')}</button>` : ''}
          ${per ? '' : `<button class="btn btn-ghost btn-block" data-action="zy-pstart" data-d="${iso}">${T('Periode begann an diesem Tag')}</button>`}` : `<div class="muted" style="font-size:13px">${T('Zukünftige Tage sind nur Schätzungen.')}</div>`}</div>`); },
    'zy-ddel': el => { const r = rec(); if (r.days) delete r.days[el.dataset.d]; save(r); closeModal(null); toast(T('Check-in gelöscht')); render(); },
    'zy-month': el => { UI.zyMonth = el.dataset.m; render(); },
    'zy-pstart': el => { const iso = el.dataset.d || today(), r = rec();
      if (periodOn(r, iso)) return toast(T('An diesem Tag ist bereits eine Periode eingetragen'));
      periods(r).forEach(p => { if (!p.end && p.start < iso) p.end = [addD(iso, -1), pEnd(p)].sort()[0]; });   // vorherige offene Periode sinnvoll abschließen
      r.periods = [...(r.periods || []), { id: uid(), start: iso, end: null, flow: {}, at: Date.now() }]; save(r); closeModal(null); toast(T('Periodenbeginn eingetragen')); render(); },
    'zy-pend': async () => { const r = rec(), p = openPeriod(r); if (!p) return;
      const v = await promptDialog(T('Letzter Tag der Periode'), { label: T('Datum (TT.MM.JJJJ)'), value: fmtDate(today()), ok: T('Speichern') }); if (v == null) return;
      const iso = parseDe(v); if (!iso || iso < p.start || iso > today()) return toast(T('Bitte ein gültiges Datum eingeben'));
      p.end = iso; save(r); toast(T('Gespeichert')); render(); },
    'zy-padd': async () => editPeriod(null),
    'zy-pedit': el => editPeriod(el.dataset.id),
    'zy-pdel': async el => { if (!await confirmDialog(T('Eintrag löschen?'), T('Diese Periode wird aus deinem Verlauf entfernt.'), { ok: T('Löschen'), danger: true })) return;
      const r = rec(); r.periods = (r.periods || []).filter(p => p.id !== el.dataset.id); save(r); render(); },
    'zy-off': async () => { if (!await confirmDialog(T('Modul abschalten?'), T('Es gibt dann keinen Check-in und keine Anpassung mehr. Deine Daten bleiben auf diesem Gerät, bis du sie löschst.'), { ok: T('Abschalten') })) return;
      const r = rec(); r.on = false; save(r); go('/'); render(); },
    'zy-wipe': async () => { if (!await confirmDialog(T('Alle Zyklusdaten löschen?'), T('Perioden, Check-ins, Einstellungen und die Einwilligung werden von diesem Gerät gelöscht. Deine Trainings bleiben erhalten.'), { ok: T('Endgültig löschen'), danger: true })) return;
      del('meta', 'cycle'); toast(T('Zyklusdaten gelöscht')); go('/'); render(); },
    'zy-hide': () => { put('meta', { id: 'cycleHide', at: Date.now() }); go('/'); render(); },
    'zy-restore': el => { const s = S.sessions.get(el.dataset.sid); if (!s) return; restoreSession(s); logDecision(rec(), { level: 'normal', sug: s.adj.was, choice: 'restored', sid: s.id }); render(); toast(T('Original-Plan wiederhergestellt')); },
  });
  function parseDe(v) { const m = /^\s*(\d{1,2})[./](\d{1,2})[./](\d{4})\s*$/.exec(v || '') || /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(v || ''); if (!m) return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return isNaN(new Date(iso + 'T12:00:00')) ? null : iso; }
  function editPeriod(id) {
    const r = rec(), p = id ? (r.periods || []).find(x => x.id === id) : null;
    modal(p ? T('Periode ändern') : T('Periode nachtragen'), `<form data-form="zy-period" data-id="${p ? p.id : ''}">
      <div class="grid2"><label class="field"><span>${T('Beginn')}</span><input type="date" class="input" name="start" value="${p ? p.start : ''}" max="${today()}" required></label>
      <label class="field"><span>${T('Ende (optional)')}</span><input type="date" class="input" name="end" value="${p && p.end ? p.end : ''}" max="${today()}"></label></div>
      <div class="sheet-actions"><button type="button" class="btn btn-ghost" data-action="modal-close">${T('Abbrechen')}</button><button class="btn btn-primary">${T('Speichern')}</button></div></form>`);
  }
  document.addEventListener('submit', ev => {
    const f = ev.target; if (!f.dataset || !/^zy-/.test(f.dataset.form || '')) return; ev.preventDefault();
    const k = f.dataset.form;
    if (k === 'zy-consent') { if (!f.querySelector('[name=ok]').checked) return; const r = rec(); Object.assign(r, { on: true, consentAt: r.consentAt || Date.now(), consentV: 1, cid: cid() }); save(r); toast(T('Zyklus & Tagesform aktiviert')); render(); return; }
    if (k === 'zy-checkin') { const { e, flow } = readCheckin(f); saveCheckin(f.dataset.date, e, flow); closeModal({ saved: true }); if (!f.dataset.start) { toast(T('Check-in gespeichert')); render(); } return; }
    if (k === 'zy-settings') { const fd = new FormData(f), r = rec(), al = String(fd.get('avgLen') || '').trim();
      if (al && !sc(+al, ZY_RULES.pred.minLen, ZY_RULES.pred.maxLen)) return toast(T('Zykluslänge bitte zwischen {a} und {b} Tagen', { a: ZY_RULES.pred.minLen, b: ZY_RULES.pred.maxLen }));
      r.settings = { ...(r.settings || {}), avgLen: al ? +al : null, contra: fd.get('contra') || '', irregular: fd.get('irregular') || '', special: fd.get('special') || '', shareAdj: fd.get('shareAdj') === 'on' };
      save(r); toast(T('Gespeichert')); render(); return; }
    if (k === 'zy-period') { const fd = new FormData(f), st = fd.get('start'), en = fd.get('end') || null, r = rec();
      if (!st || st > today() || (en && (en < st || en > today()))) return toast(T('Bitte gültige Daten eingeben'));
      if (periods(r).some(p => p.id !== f.dataset.id && p.start <= (en || st) && st <= (p.end || p.start))) return toast(T('Dieser Zeitraum überschneidet sich mit einem anderen Eintrag'));
      if (f.dataset.id) { const p = r.periods.find(x => x.id === f.dataset.id); if (p) { p.start = st; p.end = en; p.at = Date.now(); } }
      else r.periods = [...(r.periods || []), { id: uid(), start: st, end: en, flow: {}, at: Date.now() }];
      save(r); closeModal(null); toast(T('Gespeichert')); render(); }
  }, true);
  document.addEventListener('change', ev => { const t = ev.target; if (!t.dataset || !t.dataset.zyset) return; const r = rec(); r.settings = { ...(r.settings || {}), [t.dataset.zyset]: t.checked }; save(r); render(); });
  document.addEventListener('click', ev => { const a = ev.target.closest && ev.target.closest('[data-zy-mob]'); if (a) { try { UI.katGroup = 'Mobility'; UI.katSub = 'Alle'; } catch (e) {} } }, true);

  return { on, rec, visible, periods, cycles, predict, cycleDay, decide, ctxFor, setsFor, planChanges, applyToSession, restoreSession, adjSug, exHint, sessBanner, sessionOut,
    patterns, beforeStart, afterCreate, view: viewMain, homeCard, nutHint, levelLabel, saveCheckin };
})();
