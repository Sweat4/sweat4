/* =====================================================================
   SWEAT4 Video-Server (Cloudflare Worker)

   Aufgabe: verbindet die SWEAT4-App mit echten Übungsvideos von MuscleWiki,
   ohne dass der geheime API-Schlüssel jemals in der App landet.

   Ablauf pro Übung (SWEAT4-ID, z. B. "kniebeuge"):
   1. Zuordnung aus dem Speicher (KV) lesen – einmal gefunden, gilt sie 30 Tage.
   2. Sonst: bei MuscleWiki nach den englischen Namen aus NAMES suchen und NUR einen
      Treffer übernehmen, dessen Name exakt einem dieser Namen entspricht.
      Ähnliche Muskelgruppe allein reicht nicht → sonst "kein Video".
   3. Video-Adresse passend zur Figur wählen (female-/male-, bevorzugt Front, sonst Seite)
      und mit einem kurzlebigen Media-Token (15 Min.) zurückgeben.
   Die Videos selbst werden NICHT gespeichert oder weitergeleitet – die App streamt
   direkt von MuscleWiki, wie in deren Doku für Apps vorgesehen.

   Einstellungen (Cloudflare → Worker → Settings → Variables):
     MW_API_KEY      Secret  – MuscleWiki-Schlüssel (beginnt mit mw_)
     ALLOWED_ORIGIN  Text    – z. B. https://sweat4.github.io
     ADMIN_TOKEN     Secret  – beliebiges langes Passwort für den Prüfbericht
   KV-Namespace mit dem Binding-Namen MAP.

   Endpunkte:
     GET /video?id=<sweat4-id>&fig=w|m      → { src, name, angle, source } oder { none: true }
     GET /report?token=<ADMIN_TOKEN>        → Übersicht aller Zuordnungen (zum Prüfen)
     GET /report?token=…&refresh=1          → Zuordnungen neu suchen
   ===================================================================== */

const MW = 'https://api.musclewiki.com';
const MAP_TTL = 30 * 24 * 3600;      // Metadaten-Cache laut MuscleWiki-Doku bis 30 Tage
const NONE_TTL = 7 * 24 * 3600;      // "kein Treffer" eine Woche merken, dann neu versuchen

/* SWEAT4-ID → englische Bezeichnungen, unter denen die GLEICHE Übung bekannt ist.
   Nur exakte Namensgleichheit zählt. Fehlt ein Video, hier weitere Namen ergänzen
   oder in OVERRIDE die MuscleWiki-ID direkt eintragen. */
const NAMES = {
  'schraegbank-kh': ['Dumbbell Incline Bench Press', 'Incline Dumbbell Bench Press', 'Incline Dumbbell Press', 'Dumbbell Incline Press'],
  'flachbank-kh': ['Dumbbell Bench Press', 'Dumbbell Flat Bench Press'],
  'fliegende-kh': ['Dumbbell Chest Fly', 'Dumbbell Fly', 'Dumbbell Flat Bench Fly'],
  'fliegende-schraeg': ['Dumbbell Incline Chest Fly', 'Incline Dumbbell Fly', 'Dumbbell Incline Fly'],
  'ueberzuege-kh': ['Dumbbell Pullover', 'Dumbbell Chest Pullover'],
  'bankdruecken-lh': ['Barbell Bench Press', 'Bench Press'],
  'schraegbank-lh': ['Barbell Incline Bench Press', 'Incline Barbell Bench Press', 'Incline Bench Press'],
  'schraegbank-multi': ['Smith Machine Incline Bench Press', 'Smith Incline Bench Press'],
  'flachbank-multi': ['Smith Machine Bench Press', 'Smith Bench Press'],
  'butterfly': ['Machine Pec Fly', 'Pec Deck', 'Machine Chest Fly', 'Pec Deck Fly'],
  'kabel-fliegende-gerade': ['Cable Chest Fly', 'Cable Fly', 'Cable Pec Fly'],
  'kabel-fliegende-oben': ['Cable Crossover', 'High Cable Fly', 'Cable High To Low Fly'],
  'kabel-fliegende-unten': ['Cable Low To High Fly', 'Low Cable Fly', 'Cable Low Fly'],
  'dips': ['Chest Dip', 'Dips', 'Parallel Bar Dip', 'Bar Dip'],
  'schulterdruecken-kh': ['Dumbbell Seated Overhead Press', 'Seated Dumbbell Shoulder Press', 'Dumbbell Seated Shoulder Press'],
  'schulterdruecken-multi-front': ['Smith Machine Seated Overhead Press', 'Smith Machine Shoulder Press'],
  'nackendruecken-multi': ['Smith Machine Behind The Neck Press'],
  'schulterdruecken-lh-stehend': ['Barbell Overhead Press', 'Barbell Military Press', 'Overhead Press'],
  'nackendruecken-lh-stehend': ['Barbell Behind The Neck Press', 'Behind The Neck Press'],
  'seitheben-stehend': ['Dumbbell Lateral Raise', 'Lateral Raise'],
  'seitheben-sitzend': ['Dumbbell Seated Lateral Raise', 'Seated Lateral Raise'],
  'seitheben-einarmig': ['Dumbbell Single Arm Lateral Raise', 'Single Arm Lateral Raise'],
  'seitheben-kabel': ['Cable Lateral Raise', 'Cable Single Arm Lateral Raise'],
  'vorgebeugtes-seitheben': ['Dumbbell Rear Delt Fly', 'Dumbbell Bent Over Reverse Fly', 'Bent Over Dumbbell Reverse Fly'],
  'vorgebeugt-seitheben-turm': ['Cable Rear Delt Fly', 'Cable Bent Over Reverse Fly'],
  'vorgebeugt-seitheben-turm-einarmig': ['Cable Single Arm Rear Delt Fly', 'Cable Single Arm Reverse Fly'],
  'face-pulls': ['Cable Face Pull', 'Face Pull', 'Rope Face Pull'],
  'hintere-schulter-turm-ueberkreuzt': ['Cable Reverse Fly', 'Cable Rear Delt Crossover'],
  'nackenziehen-turm-stange': ['Cable Upright Row'],
  'frontziehen-turm-stange': ['Cable Front Raise', 'Cable Bar Front Raise'],
  'frontziehen-kh-stehend': ['Dumbbell Front Raise', 'Front Raise'],
  'frontheben-kh-sitzend': ['Dumbbell Seated Front Raise', 'Seated Front Raise'],
  'nackenziehen-sz': ['EZ Bar Upright Row', 'Barbell Upright Row', 'Upright Row'],
  'shrugs-kh': ['Dumbbell Shrug', 'Dumbbell Shrugs'],
  'schulterpresse-maschine': ['Machine Shoulder Press', 'Machine Overhead Press'],
  'seitheben-maschine': ['Machine Lateral Raise'],
  'reverse-butterfly': ['Machine Reverse Fly', 'Reverse Pec Deck', 'Machine Rear Delt Fly'],
  'latziehen-breit': ['Lat Pulldown', 'Machine Lat Pulldown', 'Cable Lat Pulldown', 'Wide Grip Lat Pulldown'],
  'klimmzuege': ['Pull Up', 'Pull Ups', 'Pullup'],
  'lh-rudern': ['Barbell Bent Over Row', 'Barbell Row', 'Bent Over Barbell Row'],
  'lh-rudern-untergriff': ['Barbell Reverse Grip Bent Over Row', 'Underhand Barbell Row', 'Barbell Underhand Row'],
  'kh-rudern-einarmig': ['Dumbbell Row Unilateral', 'Dumbbell Single Arm Row', 'One Arm Dumbbell Row', 'Single Arm Dumbbell Row'],
  'kh-rudern-schraegbank': ['Dumbbell Incline Row', 'Dumbbell Chest Supported Row', 'Incline Dumbbell Row'],
  't-bar-rudern': ['T Bar Row', 'Landmine T Bar Row', 'Barbell T Bar Row'],
  'rudermaschine-breit': ['Machine Row', 'Machine Seated Row'],
  'rudern-eng-turm': ['Cable Seated Row', 'Seated Cable Row', 'Cable Row'],
  't-bar-maschine': ['Machine T Bar Row', 'Chest Supported T Bar Row'],
  'rueckenstrecker-tension': ['Back Extension', 'Hyperextension', '45 Degree Back Extension'],
  'ueberzuege-turm': ['Cable Straight Arm Pulldown', 'Straight Arm Pulldown', 'Cable Pullover'],
  'kniebeuge': ['Barbell Squat', 'Barbell Back Squat', 'Back Squat'],
  'frontkniebeuge': ['Barbell Front Squat', 'Front Squat'],
  'ausfallschritte-gehen': ['Dumbbell Walking Lunge', 'Walking Lunge', 'Bodyweight Walking Lunge'],
  'ausfallschritte-lh': ['Barbell Lunge', 'Barbell Forward Lunge', 'Barbell Static Lunge'],
  'ausfallschritte-einbeinig-kh': ['Dumbbell Split Squat', 'Split Squat', 'Dumbbell Static Lunge'],
  'beinpresse': ['Machine Leg Press', 'Leg Press', '45 Degree Leg Press'],
  'hackenschmidt': ['Machine Hack Squat', 'Hack Squat'],
  'beinbeuger-maschine': ['Machine Lying Leg Curl', 'Lying Leg Curl', 'Machine Hamstring Curl'],
  'beinstrecker-maschine': ['Machine Leg Extension', 'Leg Extension'],
  'hip-thrust': ['Barbell Hip Thrust', 'Hip Thrust'],
  'kickbacks-turm': ['Cable Glute Kickback', 'Cable Kickback', 'Cable Donkey Kickback'],
  'adduktoren-maschine': ['Machine Hip Adduction', 'Hip Adduction Machine', 'Machine Adductor'],
  'abduktoren-maschine': ['Machine Hip Abduction', 'Hip Abduction Machine', 'Machine Abductor'],
  'wadenheben-sitzend': ['Machine Seated Calf Raise', 'Seated Calf Raise'],
  'wadenheben-stehend': ['Machine Standing Calf Raise', 'Standing Calf Raise', 'Calf Raise'],
  'frontkniebeuge-kh': ['Dumbbell Goblet Squat', 'Goblet Squat'],
  'frontkniebeuge-kh-eng': ['Dumbbell Narrow Goblet Squat', 'Narrow Stance Goblet Squat'],
  'crunches-turm': ['Cable Crunch', 'Cable Kneeling Crunch', 'Kneeling Cable Crunch'],
  'beinheben-liegend': ['Lying Leg Raise', 'Leg Raise', 'Laying Leg Raises'],
  'beinheben-haengend': ['Hanging Knee Raise', 'Hanging Knee Raises'],
  'beinheben-haengend-gestreckt': ['Hanging Leg Raise', 'Hanging Leg Raises'],
  'russian-twist': ['Russian Twist', 'Weighted Russian Twist'],
  'plank': ['Forearm Plank', 'Plank', 'Elbow Plank'],
  'plank-beinheben': ['Plank Leg Raise', 'Plank With Leg Lift', 'Plank Leg Lift'],
  'seitstuetz-becken': ['Side Plank Hip Dip', 'Side Plank Hip Dips'],
  'seitstuetz-bein': ['Side Plank Leg Raise', 'Side Plank Leg Lift', 'Side Plank With Leg Raise'],
  'squat-jumps': ['Jump Squat', 'Squat Jump', 'Jump Squats'],
  'box-jumps': ['Box Jump', 'Box Jumps'],
  'knee-tuck-jumps': ['Tuck Jump', 'Tuck Jumps', 'Knee Tuck Jump'],
  'jumping-lunges': ['Jumping Lunge', 'Jump Lunge', 'Split Jump'],
  'mountain-climbers': ['Mountain Climber', 'Mountain Climbers'],
  'seitliche-spruenge': ['Lateral Jump', 'Lateral Line Hop', 'Lateral Hop'],
  'seitliche-squat-jumps': ['Lateral Squat Jump', 'Lateral Jump Squat'],
};
/* Manuelle Zuordnung nach Sichtprüfung: SWEAT4-ID → MuscleWiki-Übungs-ID (Zahl) */
const OVERRIDE = {
  // 'kniebeuge': 23,
};

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function cors(env, req) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(x => x.trim()).filter(Boolean);
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : (allowed[0] || 'null'),
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Vary': 'Origin',
  };
}
const json = (data, env, req, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(env, req), ...extra } });

async function mw(env, path, init = {}) {
  const r = await fetch(MW + path, { ...init, headers: { 'X-API-Key': env.MW_API_KEY, ...(init.headers || {}) } });
  if (r.status === 429) throw new Error('quota');
  if (!r.ok) throw new Error('MuscleWiki ' + r.status + ' ' + path);
  return r.json();
}
/* Antworten defensiv lesen: Die Doku legt die Felder der Video-Objekte nicht fest */
const listOf = d => Array.isArray(d) ? d : (d && (d.results || d.exercises || d.data || d.items)) || [];
function videoUrls(v) {
  const out = [];
  const walk = x => {
    if (!x) return;
    if (typeof x === 'string') { if (/\.mp4(\?|$)/i.test(x)) out.push(x); return; }
    if (Array.isArray(x)) return x.forEach(walk);
    if (typeof x === 'object') Object.values(x).forEach(walk);
  };
  walk(v);
  return [...new Set(out)];
}

async function findMapping(env, id) {
  const names = NAMES[id]; if (!names && !OVERRIDE[id]) return { none: true, reason: 'keine Suchbegriffe' };
  let hit = null;
  if (OVERRIDE[id]) {
    const d = await mw(env, '/exercises/' + OVERRIDE[id]); hit = { id: OVERRIDE[id], name: d.name || '' };
  } else {
    const want = new Set(names.map(norm));
    for (const q of names) {
      const res = listOf(await mw(env, '/search?q=' + encodeURIComponent(q) + '&limit=10'));
      const m = res.find(r => want.has(norm(r.name)));
      if (m) { hit = { id: m.id, name: m.name }; break; }
    }
  }
  if (!hit) return { none: true, reason: 'kein exakt passender Name bei MuscleWiki', tried: names };
  const urls = videoUrls(await mw(env, '/exercises/' + hit.id + '/videos'));
  if (!urls.length) return { none: true, reason: 'Übung gefunden, aber ohne Video', mwId: hit.id, mwName: hit.name };
  return { mwId: hit.id, mwName: hit.name, urls };
}
async function getMapping(env, id, refresh) {
  const key = 'map:' + id;
  if (!refresh) { const c = await env.MAP.get(key, 'json'); if (c) return c; }
  const m = await findMapping(env, id);
  await env.MAP.put(key, JSON.stringify({ ...m, at: Date.now() }), { expirationTtl: m.none ? NONE_TTL : MAP_TTL });
  return m;
}
function pickUrl(urls, fig) {
  const base = u => u.split('?')[0].split('/').pop().toLowerCase();
  const sex = fig === 'w' ? 'female-' : 'male-';
  const bySex = urls.filter(u => base(u).startsWith(sex));
  const pool = bySex.length ? bySex : urls;
  const pref = pool.find(u => /-front\.mp4$/i.test(base(u))) || pool.find(u => /-side\.mp4$/i.test(base(u))) || pool[0];
  const angle = /-front\./i.test(pref) ? 'front' : /-side\./i.test(pref) ? 'side' : '';
  return { url: pref.startsWith('http') ? pref : MW + (pref.startsWith('/') ? '' : '/') + pref, angle, female: base(pref).startsWith('female-') };
}
let tokenCache = { token: null, until: 0 };
async function mediaToken(env) {
  if (tokenCache.token && Date.now() < tokenCache.until) return tokenCache.token;
  const d = await mw(env, '/media/token', { method: 'POST' });
  tokenCache = { token: d.token, until: Date.now() + Math.max(60, (d.expires_in || 900) - 120) * 1000 };
  return d.token;
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(env, req) });
    const url = new URL(req.url);
    try {
      if (url.pathname === '/video') {
        const id = url.searchParams.get('id') || '', fig = url.searchParams.get('fig') === 'w' ? 'w' : 'm';
        if (!/^[a-z0-9-]{2,60}$/.test(id)) return json({ error: 'ungültige ID' }, env, req, 400);
        const m = await getMapping(env, id, false);
        if (m.none) return json({ none: true }, env, req, 200, { 'Cache-Control': 'private, max-age=3600' });
        const p = pickUrl(m.urls, fig), token = await mediaToken(env);
        return json({ src: p.url + (p.url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token), name: m.mwName, angle: p.angle, female: p.female, source: 'MuscleWiki' },
          env, req, 200, { 'Cache-Control': 'private, max-age=600' }); // Token gilt 15 Min.
      }
      if (url.pathname === '/report') {
        if (!env.ADMIN_TOKEN || url.searchParams.get('token') !== env.ADMIN_TOKEN) return json({ error: 'nicht erlaubt' }, env, req, 403);
        // Cloudflare erlaubt ~50 Anfragen pro Aufruf → in Blöcken prüfen: &from=0, &from=8, …
        const refresh = url.searchParams.get('refresh') === '1', from = +url.searchParams.get('from') || 0, out = {};
        const ids = Object.keys(NAMES).slice(from, from + 8);
        out._weiter = from + 8 < Object.keys(NAMES).length ? `/report?token=…&from=${from + 8}${refresh ? '&refresh=1' : ''}` : 'fertig';
        for (const id of ids) { try { const m = await getMapping(env, id, refresh); out[id] = m.none ? '— ' + m.reason : `${m.mwName} (#${m.mwId}, ${m.urls.length} Videos)`; } catch (e) { out[id] = 'Fehler: ' + e.message; } }
        return json(out, env, req);
      }
      return json({ ok: true, service: 'SWEAT4 Video-Server' }, env, req);
    } catch (e) {
      return json({ error: e.message === 'quota' ? 'Monatliches API-Kontingent erschöpft' : 'Videoquelle nicht erreichbar' }, env, req, e.message === 'quota' ? 429 : 502);
    }
  },
};
