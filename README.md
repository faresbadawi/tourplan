# Tourplan

Web-App (PWA) für Zusteller: Adressen tippen, einfügen oder diktieren, beste Reihenfolge berechnen, Stopp für Stopp mit Waze, Google Maps oder Apple Karten fahren.

- **Einrichtung:** Name, Depot/Zustellstützpunkt (Start und Ende jeder Tour), Navi-App, Hell/Dunkel.
- **Eingabe:** eine Adresse pro Zeile; ohne Ort wird rund ums Depot gesucht. Diktat auf Deutsch („nächste“ trennt Adressen), intelligente Aufbereitung (Zahlwörter, „Str.“, „12 a“ → „12a“).
- **Optimierung:** echte Fahrzeiten (OSRM), Nächster-Nachbar + 2-opt + Or-opt; Rundtour oder offenes Ende.
- **Unterwegs:** Daumen-Leiste mit nächstem Stopp, „Erledigt“, Ankunftszeiten, Google-Maps-Gesamtroute (in 10er-Teilen), Liste teilen.
- Optimiert für Handy (z. B. Galaxy Z Flip 6, auch Außendisplay), iPad und Desktop.

Dienste ohne API-Schlüssel: Photon/Nominatim (Adresssuche), OSRM (Routing), OpenStreetMap (Karte). Alle Daten bleiben im Browser (localStorage).

Lokal starten: `python3 -m http.server 8931` und http://127.0.0.1:8931 öffnen. Mikrofon, Standort und „Zum Startbildschirm“ brauchen HTTPS (z. B. GitHub Pages).

## Version 2

- Adress-Vorschläge beim Tippen (Depot und Stopps), Paketzahl je Adresse (`Lindenweg 7, 3 Pakete`, `2x Lindenweg 7`)
- Adresssuche parallel (höchstens 3 Anfragen gleichzeitig), mit Ersatzdienst, wenn Photon nicht antwortet
- Große Karte, Antippen öffnet Vollbild; Packstationen und Postfilialen an der Route (OpenStreetMap/Overpass) mit Öffnungszeiten
- Route-Liste: antippen für Aktionen, wischen (rechts erledigt, links löschen), Rückgängig, Ton beim Abhaken
- Neue, geänderte oder gelöschte Stopps werden in die laufende Tour eingerechnet; erledigte bleiben stehen
- Google-Maps-Abschnitte und weitere Aktionen im Drei-Punkte-Menü

## Version 3

- Straßenverzeichnis des Zustellgebiets (12 km um das Depot, aus OpenStreetMap, auf dem Gerät gespeichert): sofortige Straßenvorschläge, Ort wird ergänzt, Korrekturvorschläge bei Verhörern und Tippfehlern
- Diktieren per Gedrückthalten; nach dem Loslassen landen die Adressen direkt in der Liste
- Tour-Überblick mit ausgeschriebenen Angaben statt Kennzahl-Pillen
- „Tour beenden & speichern“ und Verlauf mit Monatskalender; alte Touren lassen sich neu laden
- Kopfzeile: Verlauf und Einstellungen oben rechts

## Version 4

- Mikrofon oben in der Leiste öffnet ein Eingabe-Fenster und hört sofort zu.
- Ein langer Satz wird in Straße, Hausnummer, Ort und Paketzahl zerlegt („Lindenweg 3 und 5 zwei Pakete, Am Markt 3 in Wittingen ein Paket“).
- Fortschrittsbalken ganz oben: Stopps, Pakete übrig, voraussichtliches Ende. Knopf zum Beenden oder Abbrechen der Tour.
- Zustellgebiet: Orte wählbar, Adressen außerhalb werden markiert, eindeutige Verhörer automatisch korrigiert.
- Tour-Überblick als Kacheln mit Symbolen, Paketzahl auch bei der Eingabe.
- Karte: Route abspielen (Stopp für Stopp anfliegen), pulsierender nächster Stopp, echter Vollbildmodus mit Leiste für Haken und Navigation, Kartenstile (Deutschland, Klar, Standard, Satellit, TomTom).
- Optional TomTom-Schlüssel für genauere Hausnummern.
- Einrichtung per Link auf ein anderes Gerät übertragen.
- Neuer Abhak-Ton (heller, aufsteigender Glockenklang).
- Service Worker wiederhergestellt (war in Version 3 versehentlich leer).

## Version 5

- Keine automatische Flug-Animation mehr: am Anfang die ganze Tour, im Vollbild direkt zum nächsten Stopp.
- Ähnliche Straßen (Schreibweise + Klang, Kölner Phonetik) beim Antippen eines Stopps und im Eingabe-Fenster.
- Gebiet offline: Straßen und alle Hausnummern (12 km) werden gespeichert → exakte Adressen sofort, ohne Netz.
- Fehler behoben: Straßenverzeichnis brach nach 20 s ab, der Dienst braucht aber ~35 s.
- Kartenstil selbst wählen (Liste statt Durchschalten), gesehene Kartenkacheln bleiben gespeichert.
- Eigener Standort mit Blickrichtung: Pfeil, gelber Lieferwagen oder Punkt.
