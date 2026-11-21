# Tourplan – Übergabe (Stand: Version 21, 17.11.2026)

Dieses Dokument fasst zusammen, was Tourplan heute kann, wie es gebaut ist, welche Entscheidungen gefallen sind und wie es mit der **nativen App (React Native)** weitergehen soll. Es ist so geschrieben, dass ein neues Gespräch (oder ein anderer Entwickler) ohne Vorwissen weitermachen kann.

## 1. Was Tourplan ist

Web-App (PWA) für einen DHL-Zusteller (Galaxy Z Flip 6, iPad). Adressen eingeben oder diktieren, beste Reihenfolge berechnen, Stopp für Stopp abarbeiten, mit Waze, Google Maps, MAPS.ME oder Apple Karten navigieren.

- Live: https://faresbadawi.github.io/tourplan/ (GitHub Pages, Zweig `main`)
- Repository: `faresbadawi/tourplan` (öffentlich)
- Reine statische Seite ohne Build-Schritt. Daten liegen nur im Browser (`localStorage`).
- Lokal testen: `python3 -m http.server 8931` im Projektordner, dann http://localhost:8931

## 2. Dateien

| Datei | Zeilen | Inhalt |
|---|---|---|
| `index.html` | ~380 | Oberfläche (Einrichtung, Kopfleiste, Karten-Slots, Dialoge) |
| `js/app.js` | ~2.500 | Gesamte App-Logik und Oberfläche (eine große IIFE) |
| `js/geo.js` | ~730 | Adresssuche (Photon/Nominatim/TomTom), Straßenverzeichnis und Hausnummern (Overpass), Routing/Matrix (OSRM), Korrekturvorschläge; Ortsangaben werden gegen Geocoder-Treffer geprüft |
| `js/optimize.js` | ~90 | Tourenoptimierung: Nächster-Nachbar + 2-opt + Or-opt, mit Bonus für nahe Fußgruppen und zusammenhängende Zustellstraßen |
| `js/speech.js` | ~200 | Diktat, Zerlegung gesprochener Adresslisten, Zeilen-Parser (`Hauptstraße 12 - 3`) |
| `js/ai.js` | ~70 | Optionale KI-Texterkennung (Groq/Gemini, Schlüssel vom Nutzer) |
| `css/app.css` | ~1.200 | Gesamtes Design (hell, dunkel, Farbwahl) |
| `sw.js` | ~40 | Service Worker (Cache, Vektorkarten-Kacheln) |
| `img/vehicles/` | 7 Fotos | Beispielfotos Fahrzeuge (Wikimedia Commons, Lizenzen in README) |

## 3. Datenmodell (localStorage)

- `tp.settings`: Einstellungen (`name`, `depot {name,label,lat,lon}`, `nav`, `theme`, `accent`, `roundtrip`, `stopMin`, `pace {sec,n}`, `autoPace`, `mapStyle`, `mapMode`, `region {lat,lon,r,vec}`, `area[]`, `deliveryStreets[{street,place}]`, `vehicle`, `vehAccess`, `zoneN`, `zoneCuts`, `zoneAcc`, `zoneSplit`, `vehCustom`, `meOff`, …)
- `tp.stops`: `[{id, query, pk, status:'ok'|'pending'|'err'|'ask', label, lat, lon, approx, outside, alts, ask}]`
- `tp.route`: `{order[], legs[{dur,dist}], geometry[[lat,lon]], done{id: true|'skip'}, doneAt{id: ms}, saving, created, roundtrip, source}`
- `tp.history`: beendete Touren; `tp.vphotos`: eigene Fahrzeugfotos (verkleinert); `tp.vstyle.l`: gemerkter Kartenstil
- Straßenverzeichnis und Hausnummern des Zustellgebiets liegen zusätzlich lokal (siehe `geo.js`)

## 4. Funktionen (Versionen)

1–7 (früher): Eingabe per Tippen/Diktat, Optimierung, Navigation je Stopp, Verlauf, Straßenverzeichnis mit Korrekturvorschlägen, Zustellgebiet als Kreis, Paketzahl je Adresse, Rundtour/offenes Ende.

Heute (8–21):
- **8–9:** mehr Kontrast, Info-Popup statt Anleitung, Standort ausschaltbar, Optimieren ab Standort, Korrektur-Hinweis mit Sprung zur Straße, kein seitliches Scrollen, Lieferwagen-App-Symbol, Startbild, Farbwahl (Blau, Gelb-Orange, Rot, Grün), bessere Gebietsauswahl (Kreis mit Griff).
- **10:** Tempo lernen (Zeit je Stopp aus dem Abhaken), Pakete pro Stunde, bis 300 Stopps (Fahrzeit-Matrix in Blöcken), Karte hell/dunkel wählbar, Paketzahl beim Antippen eines Punktes.
- **11:** Depot-Knopf, stabile Route (neue Adressen werden günstig eingefügt statt alles neu zu sortieren), nummerierte Eingabeliste.
- **12–13:** Apple Karten nur auf Apple-Geräten, MAPS.ME per Intent-Link, Rückfrage vor „Zum Depot“.
- **14–15:** Vektorkarte von OpenFreeMap mit Straßennamen und Hausnummern, Offline-Speichern (Vektorkacheln Zoom 0–14), eigener Dunkelmodus der Karte, Option „Andere Karten-App“ (geo:-Link).
- **16–20:** Laderaum-Probefunktion: Fahrzeugwahl (Ford E-Transit, E-Transit Custom, StreetScooter Work/Work L/Work XL, Mercedes Sprinter, Vito, eigene Maße) mit Fotos, Grundriss nur vom Laderaum, 2–4 Bereiche nach Paketzahl, Zugang hinten/Seite/beides, Seitentür-Bereiche rechts/links geteilt, Bereiche selbst unterteilbar (Ganz, Rechts/Links, 4 Felder), Bereichsgrenzen verschiebbar, Stopp-Liste je Bereich von hinten nach vorn.
- **21:** Überspringen (Pakete fahren zurück zum Depot): `route.done[id] = 'skip'`, eigene Zähler, Anzeige im „Geschafft“-Fenster und Verlauf.

## 5. Externe Dienste und Grenzen

| Dienst | Zweck | Hinweis |
|---|---|---|
| OSRM (Demo-Server) | Routen und Fahrzeit-Matrix | kostenlos, kann überlastet sein; die App versucht bis zu 3 Mal, sonst Luftlinie (anderer Reihenfolge!) |
| Photon / Nominatim | Adresssuche | nicht in Schüben abfragen (IP-Sperre) |
| Overpass | Straßen und Hausnummern des Gebiets | oft langsam/überlastet, parallele Spiegelserver sind eingebaut |
| OpenFreeMap | Vektorkarte | frei, ohne Schlüssel; Offline bis 3.000 Kacheln je Download, 4 gleichzeitig |
| Wikimedia Commons | Fahrzeugfotos | freie Lizenzen, Namensnennung in README und App |
| Kostenlose Raster-Server von OpenStreetMap | früher offline genutzt | **Vorab-Laden ist dort verboten** – deshalb nicht mehr verwenden |

Google Maps wurde bewusst nicht eingebaut (Konto mit Zahlungsdaten, Offline-Speichern untersagt).

## 6. Wünsche und Entscheidungen des Nutzers

- **Nicht gewünscht:** Scanner für Pakete (dürfen sie nicht), Notiz pro Stopp, Paketgrößen.
- Darstellung: dunkel mit klaren Farben, Straßennamen und Hausnummern gut lesbar, alles passt in die Bildschirmbreite (kein seitliches Scrollen).
- Laderaum: nur der Laderaum zeichnen (ohne Fahrerkabine); Bereiche A, B, C antippbar mit Stopp-Liste; er holt Pakete teils von hinten, teils von der Seite.
- Veröffentlicht wird direkt auf `main` (GitHub Pages).
- **Nächster Schritt:** Probetag mit der Web-App, danach native Android-App.

## 7. Offen und noch nicht auf echtem Handy geprüft

Fast alles wurde nur am Laptop im nachgestellten Handy-Bildschirm getestet. Auf dem Flip 6 noch zu prüfen: Standort (ein/aus, Mitlaufen), MAPS.ME und „Andere Karten-App“, Offline-Karte ohne Netz, Ladezeit der Vektorkarte, Tempo-Lernen, Laderaum, Überspringen.

## 8. Plan: native App mit React Native

Entschieden: **React Native (Expo) + MapLibre Native**, Android zuerst (iPad später möglich). Gründe: Logik in JavaScript ist übernehmbar, MapLibre bietet freie Vektorkarten, Offline-Regionen, 3D-Neigung; Hintergrund-Standort und Benachrichtigungen sind möglich.

Vorgehen in Stufen (nach jeder Stufe eine APK zum Ausprobieren):
1. **Projekt und erste APK:** Expo-Projekt, Build-Kette, Einstellungen (Depot, Navi-App).
2. **Kern:** Adressen eingeben (Parser aus `speech.js`), Geokodierung (`geo.js`), Liste, Optimieren (`optimize.js`, stabil mit Einfügen), Route, Abhaken, Überspringen, Navi starten.
3. **Karte:** MapLibre mit Pins, Route, eigenem Standort, Antippen für Paketzahl.
4. **Nativ:** Standort im Hintergrund, Benachrichtigungen, Offline-Regionen.
5. **Rest:** Laderaum, Verlauf, Tempo, Farbwahl, Feinschliff.

Übernehmbare Logik (reine Funktionen, kaum DOM): `optimize.js`, Teile von `geo.js` (Matrix/Route/Suche, Straßenverzeichnis), `speech.js` (`parseLine`, `smartParse`, `splitSpoken`), Zonen-Berechnung (`loadZones`, `zoneCells`), Stabilitäts-Logik in `plan()`.

Entwicklungsumgebung auf dem Laptop des Nutzers: JDK 17 unter `~/jdk`, Android-SDK unter `~/Android/Sdk` (Build-Tools 35/36, Plattform 34/36, Emulator vorhanden), Node 24. Es gibt noch kein Android- oder React-Native-Projekt.

## 9. Hinweise für Tests

- Die Dienste Photon und Overpass sperren bei vielen Anfragen die IP – beim Testen keine Schübe schicken.
- Zum Testen der Karte gibt es keine Schlüssel. Die Vektorkarte lädt im nachgestellten Handy-Bildschirm teils erst nach 10–15 Sekunden.
- Service Worker ist nur auf `https:` und `localhost` aktiv; bei Änderungen die Cache-Version in `sw.js` erhöhen.

## 10. Claude-Connector (MCP, Stand 18.11.2026)

React Native und die Capacitor-APK wurden verworfen – es bleibt bei der Web-App.
Neu: ein MCP-Server in `mcp/` (Cloudflare Worker `tourplan-mcp`), als eigener Connector in Claude eingebunden.

- Claude zerlegt diktierte Adressen selbst (Regeln in `INSTRUCTIONS`), optional `adressen_pruefen` (Photon, max. 25),
  dann `tour_link_erstellen` → Link `…/tourplan/#tour=<base64url {a:[Zeilen], k?:1, r?:bool}>`.
- Die App (`js/app.js`, `tourLink`) übernimmt die Zeilen wie getippte Adressen (Straßenverzeichnis, Korrekturen),
  sucht sie und sortiert danach selbst (`plan(true)`; mit `k` bleibt die Reihenfolge).
- Sortiert wird bewusst in der App: Cloudflare Free erlaubt nur 10 ms Rechenzeit und 50 Unteranfragen je Aufruf.
- Geheimer Pfad: `https://tourplan-mcp.<konto>.workers.dev/<SECRET>/mcp`, SECRET in `mcp/.dev.vars` (nicht im Repo).
- Neu hochladen: `cd mcp && npx wrangler deploy`.
- Kartenbibliotheken liegen jetzt lokal in `vendor/` statt auf CDNs.
