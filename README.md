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

## Version 6

- Neues Design: Schrift Plus Jakarta Sans, kühle Blau-/Navy-Töne, Verläufe; das Blau bleibt.
- Gebiet auf der Karte wählen (Mittelpunkt + Radius): Orte im Kreis, Straßen, Hausnummern und Karte offline speichern (max. 250 Kacheln ab Zoom 13, nach den OSM-Nutzungsregeln).
- Gleichnamige Straßen: eindeutige Fälle (Hausnummer nur in einem Ort, nur einer im Gebiet) automatisch, sonst einmal fragen und merken.
- „Hauptstraße 5 - 3“ / „5-3“ = 3 Pakete.
- Karten-Knopf „Stopp“: Mitzoomen zum nächsten Stopp, getrennt für kleine Karte und Vollbild.
- „Geschafft!“-Bildschirm am Ende, Knopf „Ende“ statt Stopp-Quadrat, kleine wegwischbare Rückgängig-Blase.
- Optional: Gemini-KI (kostenloser Schlüssel) zum Zerlegen diktierter Sätze.
- Fehler behoben: Absturz beim Neuöffnen während einer Tour; Overpass-Abfragen mit Wiederholung und parallelen Ersatzservern.

## Version 7

- Startseite mit Karte: Depot, eigener Standort, neue Adressen fallen als Punkte hinein; Anleitung „So schreibst oder sagst du Adressen“.
- Ruhige Kopfzeile; während der Tour ein Tour-Kopf mit Fortschrittsring, Paketen, Rückkehrzeit und „Beenden“.
- Einstellungen mit Unterseiten: Zustellgebiet, Tour & Navigation, Darstellung & Karte, Schlüssel & KI.
- Gebietswahl: auf die Karte tippen setzt den Mittelpunkt (Nadel ziehbar), der Kreis zieht sich auf.
- KI jetzt mit Groq (kostenloser Schlüssel „gsk_…“); Schlüssel gehen beim Übertragen auf andere Geräte mit.

## Version 8

- Farben wie zuvor (kein neuer Kontrast-Look)
- „So schreibst du Adressen“ als Popup hinter dem Info-Knopf (i) bei „Adressen“
- Standort auf der Karte lässt sich ausschalten (Knopf zweimal tippen); die Wahl bleibt gespeichert
- „Route optimieren“ in einer laufenden Tour sortiert die offenen Stopps ab deinem aktuellen Standort; Abhaken ändert die Reihenfolge nie
- Großer Hinweis, wenn Adressen nicht gefunden wurden oder mehrdeutig sind; „Jetzt korrigieren“ springt direkt zur Straße und öffnet die Korrektur
- Nie seitlich scrollen: lange Straßennamen und alle Menüs (auch Einstellungen) brechen um und passen in die Bildschirmbreite
- Altes Symbol und alte Farben bleiben

## Version 9

- Neues App-Symbol (gelber Lieferwagen mit Standort-Pin in den App-Farben), auch als Startbild beim Öffnen und als Logo oben
- Farbwahl in „Darstellung & Karte“: Blau, Gelb-Orange, Rot oder Grün
- Gebiet wählen: Kreis bleibt immer ganz sichtbar, Griff am Kreisrand zum Ziehen, kleineres Bedienfeld, Orte einklappbar
- Offline-Karte: bis zu 900 Kartenteile (mehr Details), Karte und Straßenverzeichnis laden gleichzeitig
- Straßen und Hausnummern laden parallel; antwortet der Hauptserver nach 10 Sekunden nicht, springen Ersatzserver ein

## Version 10

- Tempo lernen: aus den Abständen zwischen dem Abhaken (minus Fahrzeit) lernt die App deine Zeit pro Stopp und rechnet Ankunftszeiten damit; im Überblick stehen Pakete pro Stunde. Abschaltbar und zurücksetzbar unter „Tour & Navigation“
- Bis zu 300 Stopps pro Tour (echte Fahrzeiten bis 200 Stopps, darüber Luftlinie für die Sortierung)
- Karte hell oder dunkel unabhängig vom App-Design wählbar (Ebenen-Knopf auf der Karte)
- Stopp-Punkt auf der Karte antippen zeigt groß die Paketzahl mit Paket-Symbol
- Feinerer Fortschrittsring oben
