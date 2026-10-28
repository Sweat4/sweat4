# SWEAT4 – Zyklus & Tagesform (App v43)

Optionales Modul für Kundinnen. Läuft ohne Wearable. Die Logik steckt in `zyklus.js`, `index.html` hat nur kleine Einhängepunkte.

## 1. Was die Kundin bekommt
- **Einstieg:** Auf der Startseite gibt es die Karte „Zyklus & Tagesform (optional)“. Sie erscheint nur im Kundinnenmodus und nicht bei Geschlecht „m“. Die Kundin kann die Karte ausblenden.
- **Aktivierung:** Zuerst kommen Einführung und eine ausdrückliche Einwilligung (Art. 9 Abs. 2 a DSGVO). Ohne Haken bleibt das Modul aus.
- **Erfassung:**
  - Periode: Beginn, Ende und Stärke pro Tag. Nachtragen, Ändern und Löschen sind möglich.
  - Täglicher Check-in mit Energie, Lust auf Training, Schlaf, Stimmung (1–5), Schmerzen und Krämpfen (0–3), Symptom-Chips, eigenem Symptom, Notiz und einem Sicherheitsfeld „ungewöhnlich starke Beschwerden“. Alles ist optional.
- **Einstellungen:** durchschnittliche Zykluslänge (falls bekannt), Verhütung, unregelmäßiger Zyklus, besondere Umstände (Schwangerschaft, Stillzeit, Wechseljahre). Dazu der Schalter „Trainer darf Anpassung sehen“.
- **Kalender:** Monatsansicht mit dokumentierten Periodentagen (gefüllt), geschätztem Zeitraum (gestrichelt, als Schätzung beschriftet) und Check-in-Punkten. Ein Tag öffnet sich zum Ansehen, Nachtragen oder Löschen.
- **Prognose:** zeigt einen Zeitraum statt eines Datums. Grundlage und Unsicherheit stehen dabei.
- **Verlauf:** pro Zyklus Länge, Periodendauer, Check-ins, Durchschnitt von Energie und Bereitschaft sowie Trainings, davon angepasst.
- **Persönliche Muster:** erst ab 3 gut dokumentierten Zyklen. Sie erscheinen nur als vorsichtiger Hinweis mit „x von y Zyklen“. Die Kundin entscheidet per Schalter, ob der Hinweis beim Check-in erscheint.
- **Ernährung:** An dokumentierten Periodentagen zeigt die Ernährungskarte einen Hinweis: ausreichend essen und trinken, eisenreiche Lebensmittel. Keine Kalorienänderung, keine Supplemente, keine Eisenmangel-Aussage.

## 2. Trainingssteuerung (Entscheidungslogik)
Grundlage ist die Tagesform, nicht der Zyklustag. Die Regeln greifen in dieser Reihenfolge:

1. **Sicherheitsfeld angekreuzt:** Vorschlag Ruhetag, mit dem Hinweis, anhaltende Beschwerden ärztlich abklären zu lassen.
2. **Starkes Signal → aktive Erholung** (Spaziergang oder Mobility). Die leichte Variante bleibt wählbar. Als starkes Signal zählt eines davon:
   - Schmerzen 3
   - Krämpfe 3
   - Bereitschaft 1
   - Energie 1
3. **Mäßige Signale:** 2 oder mehr ergeben „deutlich leichter“, genau 1 ergibt „etwas reduziert“. Als mäßiges Signal zählt jedes davon:
   - Schmerzen 2
   - Krämpfe 2
   - Bereitschaft 2
   - Energie 2
   - Schlaf ≤ 2
4. **Belastung:** Hat die Kundin bereits ≥ 2 Trainings in den letzten 2 Tagen und zusätzlich Beschwerden, wird eine Stufe vorsichtiger gewählt.
5. **Ziel:** Bei Muskelaufbau bleibt im Modus „etwas reduziert“ das Gewicht gleich, nur das Volumen sinkt.
6. **Zyklus:** Der Zyklus ist nur Kontext. „Tag 2 deiner Periode – du fühlst dich gut, also normal trainieren.“ Der Zyklustag allein löst nie eine Anpassung aus.
7. **Fehlende Angaben** bedeuten keine Anpassung. Ein übersprungener Check-in heißt: Training wie geplant.
8. **Muster** lösen keine automatische Anpassung aus, sie sind nur Hinweise.

**Konkrete Änderung der Einheit:** Der Plan bleibt unverändert, angepasst wird nur die eine Session.

| Stufe | Sätze | Ziel-RIR | Pause | Last |
|---|---|---|---|---|
| etwas reduziert | −1 (ab 3 Sätzen, min. 2) | 2–3 | +30 s | gleich |
| deutlich leichter | ×0,6 gerundet (min. 1) | 3–4 | +30 s | ca. −10 % vom letzten regulären Training, auf die Gewichtsstufe gerundet |

Vor dem Start zeigt die App „Plan → heute“ pro Übung mit Begründung. Die Kundin hat drei Möglichkeiten:
- Anpassung übernehmen,
- die andere Stufe wählen,
- „Nein danke – wie geplant trainieren“.

Während des Trainings kann sie „Doch nach Original-Plan trainieren“ tippen. Jede Entscheidung wird lokal protokolliert.

**Progression:** Angepasste Einheiten tragen `adj.skipProg`. `lastResult(..., forProg=true)` überspringt sie. Die nächste Gewichtssteigerung bezieht sich also auf das letzte reguläre Training. „Letztes Training“ zeigt trotzdem die tatsächlich gemachte Einheit. Die Plan-Reihenfolge läuft normal weiter.

**Laufen:** Laufeinheiten werden noch nicht automatisch angepasst. Das ist ein offener Punkt.

Alle Schwellen stehen in `ZY_RULES` am Anfang von `zyklus.js`. Es sind **Produktregeln**, keine validierten Grenzwerte.

## 3. Prognose des nächsten Periodenbeginns
- **Keine Prognose**, mit Begründung, in diesen Fällen:
  - hormonelle Verhütung
  - unregelmäßiger Zyklus angegeben
  - besondere Umstände
  - keine Periode eingetragen
  - weniger als 3 plausible dokumentierte Zyklen
  - Schwankung der Längen über 7 Tage
- **Es gibt keinen 28-Tage-Standard.** Hat die Kundin selbst eine Länge angegeben, gibt es eine grobe Schätzung (±4 Tage), die als „deine Angabe“ gekennzeichnet ist.
- **Zykluslängen außerhalb 10–60 Tage** gelten als vermutlich fehlender Eintrag oder Tippfehler und werden nicht mitgerechnet.
- **Zeitraum:** letzter Beginn + (kürzester bis längster der letzten 6 Zyklen), mindestens Median ±2 Tage.
- **Eisprung und Zyklusphasen** werden bewusst **nicht** geschätzt.

## 4. Wissenschaftliche Einordnung
| Produktregel | Stützung |
|---|---|
| Keine pauschalen phasenabhängigen Trainingsvorgaben, individuell steuern | McNulty et al. 2020, Sports Med 50:1813–27 (PMID 32661839): 78 Studien, Leistung in der frühen Follikelphase nur „trivial“ reduziert, Evidenz „low“. Die Autoren halten allgemeine Leitlinien für nicht möglich und empfehlen einen personalisierten Ansatz. |
| Zyklustag allein ist kein Grund für Deloads oder Pausen | Niering et al. 2024, Sports 12(1):31 (Meta-Analyse Maximalkraft, 22 Studien): kleine bis mittlere Effekte, große Heterogenität, Evidenzqualität niedrig, Phasen oft nicht hormonell verifiziert. *Hinweis: Die PubMed-Seite 38251305 konnte ich nicht direkt öffnen. Die Zuordnung zu dieser Arbeit ist sehr wahrscheinlich, aber nicht bestätigt.* |
| Symptome und Tagesform statt Phase; tägliches Tracking statt Rückschau | Frontiers in Sports and Active Living 2025, 7:1693190 (108 Elite-Athletinnen): Tage mit Symptomen gehen mit schlechterem Schlaf, schlechterer Stimmung und Fitness einher; die Erfassung im Rückblick überschätzt Symptome. |
| Tracking in einem Leistungskontext, Datenschutz, Freiwilligkeit | BMJ Open SEM 11(3):e002769, laut Suche der „UEFA consensus statement on menstrual cycle tracking in women's football“. **Volltext nicht abrufbar.** Inhaltlich nicht geprüft. |
| RIR/RPE, Satzzahl und Pausen zur Steuerung; eine leichtere Einheit setzt die Progression nicht zurück | Etablierte Trainingslehre (autoregulierte Belastungssteuerung) |
| Konkrete Zahlen (−1 Satz, ×0,6, −10 %, +30 s, Schwellen 1/2 auf 1–5, 3 Zyklen, 7 Tage Schwankung, 10–60 Tage) | **Designentscheidung**, konfigurierbar, nicht validiert |
| Keine Prognose bei hormoneller Verhütung oder unregelmäßigem Zyklus | Gestützt: Eine geschätzte Phase belegt keinen Hormonstatus. Grenze 7 Tage angelehnt an gängige Definitionen der Zyklusregelmäßigkeit (je nach Quelle 7–9 Tage). |

## 5. Datenmodell
Alles steckt in einem Datensatz im bestehenden IndexedDB-Store `meta`, `id: 'cycle'`. Es gibt keine neue Datenbank und keine DB-Migration.
```
{ id:'cycle', v:1, on, consentAt, consentV, cid,
  settings:{ avgLen, contra, irregular, special, shareAdj, usePatterns },
  periods:[{ id, start:'YYYY-MM-DD', end|null, flow:{ 'YYYY-MM-DD':1..3 }, at }],
  days:{ 'YYYY-MM-DD':{ energy, ready, sleep, mood, pain, cramps, symptoms[], custom, note, safety, at } },
  log:[{ id, date, at, level, sug, choice:'auto'|'accept'|'manual'|'decline'|'restored', why[], sid? }],
  updatedAt }
```
- An der Training-Session steht nur `adj = { level, sug, choice, rir, loadPct, restAdd, skipProg, orig }`, ohne Beschwerden.
- **Dokumentiert vs. geschätzt:** Dokumentiert sind nur `periods` und `days`. Schätzungen werden immer neu berechnet und nie gespeichert.
- **Zeitzone:** lokales Kalenderdatum des Geräts.
- **Ältere Profile:** Ohne den Datensatz verhält sich die App wie vorher. Das ist per Test geprüft.

## 6. Datenschutz
- **Speicherort:** nur auf dem Gerät der Kundin. Kein Versand an Trainer, Briefkasten oder KI. In Konsole und Fehlermeldungen tauchen keine Zyklus- oder Symptomdaten auf.
- **Rückmeldung an den Trainer** (`makeReturn`): Trainings laufen über `ZY.sessionOut`.
  - Ohne Erlaubnis geht nur der neutrale Marker `{skipProg:true}` mit, damit die Progression auch beim Trainer stimmt.
  - Mit Erlaubnis geht nur die Stufe mit.
- **Update vom Trainer** (`setupFromFile`): Die Datensätze `cycle` und `cycleHide` bleiben erhalten.
- **Abschalten und Löschen:**
  - „Modul abschalten“ lässt die Daten liegen.
  - „Alle Zyklusdaten löschen“ entfernt den Datensatz samt Einwilligung. Die Trainings bleiben.
  - „Kundenmodus beenden & Daten löschen“ entfernt ohnehin alles.
- **Backups und Exporte:**
  - Das Trainer-Backup enthält keine Zyklusdaten, weil sie dort nicht existieren.
  - Im Kundinnenmodus gibt es keine Backup-Funktion.
  - Der CSV-Export betrifft nur Trainings.
- **Serverseitige Autorisierung:** Es gibt keinen Server-Endpunkt für Zyklusdaten. Der Briefkasten sieht nur Ende-zu-Ende-verschlüsselte Pakete.

**Offene rechtliche Punkte**
- Datenschutzerklärung um „Zyklus & Tagesform“ ergänzen: Zweck, lokale Speicherung, Rechtsgrundlage Art. 9 Abs. 2 a, Widerruf, Löschung.
- Gesundheitshinweis prüfen lassen.
- Klären, ob die Funktion als Medizinprodukt eingestuft werden könnte. Gedacht ist sie als Trainingssteuerung ohne Diagnose oder Therapie; das sollte fachlich geprüft werden.

## 7. Geänderte Dateien
- `zyklus.js` (neu): das gesamte Modul.
- `index.html`:
  - Skript eingebunden, `ZYM()`
  - Route `#/zyklus`
  - Startseiten-Karte
  - Einhängepunkt in `start-day`
  - `lastResult(…, forProg)`
  - `viewTrain` (Banner, Hinweise, Lastvorschlag)
  - `viewSession`-Hinweis
  - `makeReturn` filtert
  - `setupFromFile` erhält Daten
  - Ernährungshinweis, CSS
- `sprache-en.js` / `i18n/ui-en-2.js`: englische Texte.
- `sw.js`: v43, `zyklus.js` im Offline-Cache.
- `tests/cycle_test.py` (neu, 52 Prüfungen).

## 8. Lokal testen
1. Im App-Ordner `python3 -m http.server 8766` starten.
2. Im Ordner `scratchpad` den nachgebauten Briefkasten mit `MOCK_AI=1 node mockbox.mjs` starten (:8787).
3. `python3 tests/cycle_test.py` ausführen. Die Regressionstests liegen ebenfalls in `tests/`.
4. Manuell:
   1. Kundin einladen.
   2. Auf dem Kundinnen-Handy Startseite → „Zyklus & Tagesform“ öffnen, einwilligen, „Periode hat begonnen“ tippen.
   3. Training starten → Check-in, z. B. Energie 2 und Krämpfe 2.
   4. Den Vorschlag prüfen und eine Variante wählen.
