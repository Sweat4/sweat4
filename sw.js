// SWEAT4 Trainer-Logbuch – Offline-Cache. Bei Updates VERSION erhöhen.
const VERSION = 'sweat4-v43';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'uebungen-katalog.js', 'uebungen-medien.js', 'lebensmittel.js', 'sprache-en.js', 'zyklus.js', 'uebungen3d.js', 'three.min.js', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
// Fehlende Dateien (z. B. Übungskatalog) dürfen die Installation nicht blockieren
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => Promise.all(FILES.map(f => c.add(f).catch(() => null)))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== 'sweat4-thumbs-v4').map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Nur eigene Dateien cachen. Fremde Anfragen (Video-Server, Videostreams) gehen unverändert ins Netz –
  // Videos dürfen laut MuscleWiki nicht zwischengespeichert werden.
  if (new URL(e.request.url).origin !== self.location.origin) return;
  // Netzwerk zuerst (für Updates), sonst Cache – so funktioniert die App auch ohne Internet.
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});

/* ---------- Push-Mitteilungen ----------
   Der Briefkasten schickt Push-Nachrichten OHNE Inhalt (keine Trainings- oder Gesundheitsdaten).
   Welche ART Ereignis es war (Nachricht, Trainingsplan, Training abgeschlossen …), fragt das Gerät beim Briefkasten nach
   (/push/last – nur Art + Zeitpunkt). Der Text wird hier auf dem Gerät erzeugt – passend zu Rolle und Sprache.
   Ist der Briefkasten nicht erreichbar, erscheint ein allgemeiner Text. */
function idbMeta(keys, write) {
  return new Promise(res => {
    try {
      const r = indexedDB.open('trainer-logbuch');
      r.onerror = () => res({});
      r.onsuccess = () => {
        const db = r.result; if (!db.objectStoreNames.contains('meta')) return res({});
        const out = {}, tx = db.transaction('meta', write ? 'readwrite' : 'readonly'), st = tx.objectStore('meta');
        if (write) st.put(write);
        keys.forEach(k => { const g = st.get(k); g.onsuccess = () => { out[k] = g.result; }; });
        tx.oncomplete = () => res(out); tx.onerror = () => res(out);
      };
    } catch (e) { res({}); }
  });
}
const PUSH_TXT = {
  de: {
    trainer: { done: 'Ein Kunde hat ein Training abgeschlossen.', run: 'Ein Kunde hat eine Laufeinheit abgeschlossen.', msg: 'Ein Kunde hat dir geschrieben.', issue: 'Ein Kunde meldet eine Schwierigkeit.', intake: 'Ein Kunde hat den Fragebogen ausgefüllt.', many: '{n} neue Meldungen von deinen Kunden.', any: 'Neue Aktivität deiner Kunden – tippe, um die Meldungen zu öffnen.' },
    client: { msg: 'Du hast eine neue Nachricht von deinem Trainer.', feedback: 'Du hast eine neue Rückmeldung von deinem Trainer.', plan: 'Dein Trainingsplan wurde aktualisiert.', plannew: 'Dein neuer Trainingsplan ist verfügbar.', many: '{n} neue Mitteilungen von deinem Trainer.', any: 'Neue Mitteilung von deinem Trainer – tippe zum Öffnen.' },
    private: 'Neue Mitteilung', test: 'Test: Push-Mitteilungen funktionieren ✓' },
  en: {
    trainer: { done: 'A client finished a workout.', run: 'A client finished a running session.', msg: 'A client sent you a message.', issue: 'A client reports a difficulty.', intake: 'A client completed the questionnaire.', many: '{n} new notifications from your clients.', any: 'New activity from your clients – tap to open your notifications.' },
    client: { msg: 'You have a new message from your trainer.', feedback: 'You have new feedback from your trainer.', plan: 'Your training plan has been updated.', plannew: 'Your new training plan is available.', many: '{n} new notifications from your trainer.', any: 'New notification from your trainer – tap to open.' },
    private: 'New notification', test: 'Test: push notifications work ✓' },
};
const PUSH_URL = { client: { msg: '#/nachrichten', feedback: '#/nachrichten', plan: '#/mitteilungen', plannew: '#/mitteilungen' }, trainer: {} };
async function pushInfo(m) {
  const box = m.box && m.box.url ? String(m.box.url).replace(/\/+$/, '') : '', ch = m.pushCh && m.pushCh.ch;
  if (!box || !ch) return null;
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 4000);
  try { const r = await fetch(`${box}/push/last/${ch}`, { cache: 'no-store', signal: ctl.signal }); if (!r.ok) return null; return (await r.json()).items || []; }
  catch (e) { return null; } finally { clearTimeout(tm); }
}
// Text, Ziel und Gruppierung für eine Mitteilung (auch von der App für Tests genutzt)
function pushContent(role, lang, items, seenAt, priv, kind) {
  const L = PUSH_TXT[lang === 'en' ? 'en' : 'de'], R = L[role];
  if (kind === 'test') return { body: L.test, url: role === 'client' ? '#/mitteilungen' : '#/meldungen', tag: 'sweat4-test', n: 1 };
  const all = (items || []).filter(x => x && x.at > (seenAt || 0));
  if (all.length && all[all.length - 1].t === 'test') return { body: L.test, url: role === 'client' ? '#/mitteilungen' : '#/meldungen', tag: 'sweat4-test', n: 0, at: all[all.length - 1].at };
  const fresh = all.filter(x => R[x.t]);
  const last = fresh[fresh.length - 1], n = fresh.length;
  let body = !items ? R.any : !last ? R.any : n > 1 && new Set(fresh.map(x => x.t)).size > 1 ? R.many.replace('{n}', n) : R[last.t];
  const url = (last && n === 1 && PUSH_URL[role][last.t]) || (role === 'client' ? '#/mitteilungen' : '#/meldungen');
  if (priv) body = L.private;
  return { body, url, tag: 'sweat4-' + role, n: Math.max(1, n), at: all.length ? all[all.length - 1].at : 0 };
}
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let kind = ''; try { kind = e.data ? (e.data.json().t || '') : ''; } catch (x) {}
    const m = await idbMeta(['role', 'lang', 'box', 'pushCh', 'pushPrivate', 'pushSeen']);
    const lang = m.lang && m.lang.value === 'en' ? 'en' : 'de', role = m.role && m.role.value === 'client' ? 'client' : 'trainer';
    const items = kind === 'test' ? [] : await pushInfo(m);
    const c = pushContent(role, lang, items, m.pushSeen && m.pushSeen.at, m.pushPrivate && m.pushPrivate.on, kind);
    if (c.at) await idbMeta([], { id: 'pushSeen', at: c.at });
    // Ist die App gerade sichtbar geöffnet: sofort abgleichen und die Mitteilung nur leise anzeigen
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visible = wins.some(w => w.visibilityState === 'visible');
    wins.forEach(w => w.postMessage({ type: 'sweat4-push', role }));
    await self.registration.showNotification('SWEAT4', { body: c.body, icon: 'icon-192.png', badge: 'icon-192.png', tag: c.tag, renotify: !visible, silent: visible,
      vibrate: visible ? undefined : [180, 80, 180], timestamp: Date.now(), data: { url: c.url } });
    if (visible) await new Promise(r => setTimeout(r, 2500)).then(() => self.registration.getNotifications({ tag: c.tag })).then(ns => ns.forEach(x => x.close())).catch(() => {});
    try { if (self.navigator.setAppBadge) { const prev = (await idbMeta(['badge'])).badge; const nb = ((prev && prev.n) || 0) + (c.n || 0); if (!nb) return; await idbMeta([], { id: 'badge', n: nb }); await self.navigator.setAppBadge(nb); } } catch (x) {}
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || '', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope)) { c.navigate ? c.navigate(target).catch(() => {}) : null; return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
