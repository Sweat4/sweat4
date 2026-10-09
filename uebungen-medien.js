/* =====================================================================
   SWEAT4 – Echte Übungsvideos (optional)
   Sobald hier ein Video eingetragen ist, zeigt die App in der Übungsansicht
   das Video statt der 3D-Figur. Ohne Eintrag bleibt die 3D-Figur.

   So geht's:
   1. Video aufnehmen: 5–8 Sekunden, eine saubere Wiederholung, seitlich oder schräg vorne,
      ruhiger dunkler Hintergrund, Handy quer.
   2. Als MP4 (H.264) speichern, möglichst unter 2 MB, z. B. kniebeuge-w.mp4.
   3. In den Ordner "media" im GitHub-Repository hochladen.
   4. Hier eintragen. Schlüssel = Übungs-ID aus uebungen-katalog.js,
      w = Frau, m = Mann, any = für beide.

   Beispiel (die // am Zeilenanfang entfernen):
   //  'kniebeuge':  { w: { src: 'media/kniebeuge-w.mp4' }, m: { src: 'media/kniebeuge-m.mp4' } },
   //  'hip-thrust': { any: { src: 'media/hip-thrust.mp4', poster: 'media/hip-thrust.jpg' } },
   ===================================================================== */
window.SW_MEDIA = {
};

/* =====================================================================
   Video-Server für echte Übungsvideos (MuscleWiki)
   Adresse deines Cloudflare-Workers eintragen, z. B. 'https://sweat4-video.DEINNAME.workers.dev'.
   Leer lassen = bisherige 3D-Darstellung. Eingetragen = Videos statt 3D.
   Der geheime API-Schlüssel gehört NICHT hierher, sondern nur in den Worker.
   ===================================================================== */
window.SW_VIDEO = {
  endpoint: '',
};
