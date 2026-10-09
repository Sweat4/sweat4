# SWEAT4 Video-Server einrichten (ca. 20 Minuten)

Die App zeigt echte Übungsvideos von MuscleWiki. Damit der geheime API-Schlüssel nicht in der App steht,
läuft dazwischen ein kleiner kostenloser Server bei Cloudflare.

## 1. MuscleWiki
1. Auf https://api.musclewiki.com ein Konto anlegen.
2. Einen bezahlten Plan wählen (mindestens „Testing“). Nur bezahlte Pläne erlauben den API-Zugriff und die kommerzielle Nutzung.
3. Im Dashboard den API-Schlüssel kopieren (beginnt mit `mw_`).

## 2. Cloudflare Worker
1. Auf https://dash.cloudflare.com kostenlos registrieren.
2. Workers & Pages → Create → Worker → Name `sweat4-video` → Deploy.
3. „Edit code“: den Inhalt von `worker.js` komplett einfügen → Deploy.
4. Storage & Databases → KV → Namespace `sweat4-map` anlegen.
5. Im Worker → Settings → Bindings → KV namespace hinzufügen, Variable name: `MAP`, Namespace: `sweat4-map`.
6. Settings → Variables and Secrets:
   - `MW_API_KEY` (Typ Secret): dein MuscleWiki-Schlüssel
   - `ADMIN_TOKEN` (Typ Secret): ein langes, ausgedachtes Passwort
   - `ALLOWED_ORIGIN` (Typ Text): `https://sweat4.github.io`
7. Die Adresse des Workers kopieren, z. B. `https://sweat4-video.DEINNAME.workers.dev`.

## 3. App verbinden
In `uebungen-medien.js` bei `endpoint` die Worker-Adresse eintragen und auf GitHub hochladen.

## 4. Zuordnung prüfen
Im Browser öffnen: `https://sweat4-video.DEINNAME.workers.dev/report?token=DEIN_ADMIN_TOKEN`
Es werden je 8 Übungen geprüft, unten steht der Link für die nächsten 8.
Übungen mit „—“ haben kein exakt passendes Video. Für diese in `worker.js`
bei NAMES weitere englische Namen ergänzen oder bei OVERRIDE die MuscleWiki-ID nach Sichtprüfung eintragen.

Hinweis: Jede Videowiedergabe zählt bei MuscleWiki als API-Aufruf (auch Spulen). Kontingent im Dashboard im Blick behalten.
