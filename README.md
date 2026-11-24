# Tourplan

> Stand, Entscheidungen und Plan für die native App: [docs/UEBERGABE.md](docs/UEBERGABE.md)

Web-App (PWA) für Zusteller: Adressen tippen, einfügen oder diktieren, beste Reihenfolge berechnen, Stopp für Stopp mit Waze, Google Maps oder Apple Karten fahren.

- **Einrichtung:** Name, Depot/Zustellstützpunkt (Start und Ende jeder Tour), Navi-App, Hell/Dunkel.
- **Eingabe:** eine Adresse pro Zeile; ohne Ort wird rund ums Depot gesucht. Diktat auf Deutsch („nächste“ trennt Adressen), intelligente Aufbereitung (Zahlwörter, „Str.“, „12 a“ → „12a“).
- **Optimierung:** echte Fahrzeiten (OSRM), Nächster-Nachbar + 2-opt + Or-opt; nahe Stopps werden zu Fußgruppen gebündelt, Zustellstraßen und Sackgassen stärker zusammengehalten; Rundtour oder offenes Ende.
- **Unterwegs:** Fortschrittsringe für Pakete und Stopps auf der Vollbildkarte, hervorgehobene Straße/Hausnummer, Hinweis auf nahe Fußwege, „Erledigt“, Ankunftszeiten, Google-Maps-Gesamtroute (in 10er-Teilen), Liste teilen.
- **Zustellgebiet:** Orte und einzelne Straßen lassen sich auswählen; gleichnamige Straßen werden mit Ort gespeichert und bei der Eingabe eindeutig zugeordnet.
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

## Version 11

- Depot-Knopf oben neben dem Mikrofon: navigiert direkt zum Depot (mit der gewählten Navi-App)
- Stabile Route: neue Adressen werden an der günstigsten Stelle eingefügt, ohne die übrige Reihenfolge zu ändern; nur „Route optimieren“ sortiert neu. Routendienst-Anfragen werden bis zu dreimal versucht, damit nicht versehentlich mit Luftlinie (anderer Reihenfolge) gerechnet wird
- Eingabeliste ist nummeriert
- Vorschau am Punkt überarbeitet: Nummer, Straße, Ort, große Paketzahl, „Erledigt“ und „In Liste“; bleibt beim Neuzeichnen der Karte offen

## Version 12

- Apple Karten wird nur auf iPhone/iPad angeboten (auf Android öffnet der Link nur eine Webseite ohne Navigation); wer es auf Android gewählt hatte, bekommt automatisch Google Maps
- MAPS.ME: Route ab deinem Standort, auf Android per Intent-Link direkt in die App (kein leerer Browser-Tab), mit Weiterleitung zum Play Store, falls die App fehlt; auf iPhone/iPad per `mapsme://`

## Version 13

- Depot-Knopf oben fragt erst nach („Zum Depot fahren?“ mit Depot-Name, Hinweis auf noch offene Stopps und der gewählten Navi-App); die Navigation startet erst nach „Ja, zum Depot“

## Version 14

- Neue Standardkarte „Straßen & Hausnummern“: Vektorkarte von OpenFreeMap (frei, ohne Schlüssel) mit Straßennamen, Hausnummern ab Zoomstufe 16 und Gebäuden, hell und dunkel
- Offline-Speichern jetzt mit dieser Vektorkarte statt mit Rasterkacheln (deren Server verbieten das Vorab-Laden); Zoom 0–14 im gewählten Kreis, höhere Stufen werden daraus gezoomt – typisch 10–25 MB statt hunderter Kacheln; Fehler werden gezählt statt Fehlerseiten zu speichern
- Navi-App „Andere Karten-App“ (Android): öffnet über einen geo:-Link die Auswahl der installierten Karten-Apps (MAPS.ME, Organic Maps, CoMaps …)

## Version 15

- Straßennamen früher (ab Zoomstufe 13,5), größer und fett, dunkel auf hell; Hausnummern größer
- Eigener Dunkelmodus der Karte aus dem hellen Stil abgeleitet: helle Straßen, hellgraue Gebäude, weiße Schrift und Hausnummern, kräftigere Gewässer und Grünflächen
- Auf den Stopp zoomen ist jetzt näher (Stufe 17): „Stopp“-Knopf, nächster Stopp, Standort folgen

## Version 16 (Probefunktion)

- Laderaum-Knopf oben neben dem Mikrofon: Fahrzeug wählen (Ford E-Transit, E-Transit Custom, StreetScooter Work/Work L/Work XL, Mercedes Sprinter, Vito/VW Transporter oder eigene Maße)
- Zeichnet den Laderaum von oben (Fahrerkabine, Schiebetür, Hecktüren, Radkästen) und teilt ihn in 2, 3 oder 4 Bereiche mit ungefähr gleich vielen Paketen
- Jeder Bereich zeigt Paketzahl, Stopp-Nummern und Straßen; Hinweis zur Ladereihenfolge (hinten zuerst); optional A/B/C-Marken in der Route
- Fahrzeugmaße sind Richtwerte aus Hersteller- und Pressangaben

## Version 17

- Laderaum: nur noch der Laderaum wird gezeichnet (ohne Fahrerkabine), breit und gut lesbar; in jedem Bereich stehen Paketzahl, Stopp-Nummern und alle Straßennamen vollständig; die Liste darunter nennt ebenfalls alle Straßen

## Version 18

- Laderaum: Zugang „Von hinten“ (Standard) oder „Seitentür“ – bei Zugang von hinten liegt Bereich A (erste Stopps) direkt an den Hecktüren, bei Seitentür vorne an der Schiebetür; Ladehinweis passt sich an
- Bereichsgrenzen selbst verschieben (±1 Stopp je Grenze), „Automatisch“ stellt die Aufteilung nach Paketzahl wieder her
- Fahrzeuge als Karten zum Auswählen; zu jedem Fahrzeug lässt sich ein eigenes Foto hinzufügen (nur auf dem Gerät gespeichert, auf ca. 480 px verkleinert)

## Version 19

- Laderaum: Grundriss wieder einfach (A, B, C, D mit Paketzahl und Zugang); Antippen eines Bereichs öffnet ein Fenster mit allen Stopps und Straßen von hinten nach vorn
- Zugang „Beides“ (Standard): erste Bereiche hinten (Hecktür), spätere vorne (Seitentür); pro Bereich im Fenster umschaltbar. „Von hinten“ und „Seitentür“ gibt es weiterhin
- Beispielfotos der Fahrzeuge von Wikimedia Commons (freie Lizenzen), eigene Fotos haben Vorrang

### Bildnachweise (Fahrzeugfotos in `img/vehicles/`, auf 420 px verkleinert)

| Fahrzeug | Urheber | Lizenz | Quelle |
|---|---|---|---|
| StreetScooter Work XL | Geoprofi Lars | CC BY-SA 4.0 | [Commons](https://commons.wikimedia.org/wiki/File:DHL_Roelckestra%C3%9Fe_Berlin.jpg) |
| Ford E-Transit | JustAnotherCarDesigner | CC0 | [Commons](https://commons.wikimedia.org/wiki/File:Ford_E-Transit_003.jpg) |
| Ford E-Transit Custom | Alexander Migl | CC BY-SA 4.0 | [Commons](https://commons.wikimedia.org/wiki/File:Ford_E-Transit_Custom_MS-RT_IMG_5323.jpg) |
| StreetScooter Work | ManuelB701 | CC0 | [Commons](https://commons.wikimedia.org/wiki/File:Nieder-Olm_-_Pariser_Stra%C3%9Fe,_DHL-Streetscooter.jpg) |
| StreetScooter Work L | Superbass | CC BY-SA 4.0 | [Commons](https://commons.wikimedia.org/wiki/File:2016-12-10-Post_Streetscooter-9409.jpg) |
| Mercedes Sprinter | Herranderssvensson | CC BY-SA 3.0 | [Commons](https://commons.wikimedia.org/wiki/File:2018_MB_Sprinter_3.jpg) |
| Mercedes Vito / VW Transporter | Thomas doerfer | CC BY-SA 3.0 | [Commons](https://commons.wikimedia.org/wiki/File:Mercedes-Benz_Vito_Kastenwagen_(447).JPG) |

## Version 20

- Laderaum: Fahrzeugwahl nur noch im Pop-up („Ändern“ in der Fahrzeug-Zeile), das Laderaum-Fenster konzentriert sich auf den Grundriss
- Bereiche mit Seitentür-Zugang sind standardmäßig rechts/links geteilt (rechts = an der Schiebetür, was zuerst drankommt; links das Spätere)
- Jeden Bereich kann man selbst unterteilen: Ganz, Rechts/Links oder 4 Felder (rechts/links × vorn/hinten); die Stopp-Liste im Bereichs-Fenster ist nach Feldern gegliedert

## Version 21

- Überspringen: Knopf „Überspringen – Pakete nehme ich zurück mit“ am nächsten Stopp, in der aufgeklappten Zeile und im Fenster am Karten-Punkt. Übersprungene Stopps zählen nicht als zugestellt, kommen nicht mehr in Ankunftszeit, Laderaum und nächsten Stopp, werden gelb markiert und zeigen oben „X Pakete zurück“. Erneutes Tippen macht sie wieder offen (auch „Rückgängig“ im Hinweis)
- Das Fenster „Geschafft“ nennt die Pakete, die zurück ins Depot fahren; der Verlauf speichert übersprungene Stopps getrennt

## Version 22

- **Schlauere Reihenfolge für Zusteller:** Stopps, die man bei einem Halt erledigt (gleiche Straße bis ca. 80 m Abstand oder direkt nebeneinander), bilden einen Haltepunkt und werden nie auseinandergerissen – egal, ob die Häuser links oder rechts liegen. Innerhalb des Haltepunkts kürzester Laufweg; bei gleich guter Richtung gewinnt die mit mehr Häusern auf der rechten Seite. Straßen werden möglichst in einem Zug abgefahren.
- **Straßen-Reihenfolge:** Straßen „zuerst“ oder „zuletzt“ festlegen (Stopp antippen → „Vorrang“, Link über „Route optimieren“, Tour-Menü); bleibt für alle Touren gespeichert und ist unter „Tour & Navigation“ zu sehen.
- **Zustellstraßen-Liste:** ganze Straßenliste (z. B. vom Zustellstützpunkt) auf einmal einfügen. Diktierte/vertippte Namen werden auf diese Liste korrigiert. Einmal zugeordnete Orte und selbst korrigierte Verhörer bleiben für immer gemerkt (sichtbar und löschbar unter „Zustellgebiet“).
- **Karte jetzt direkt mit MapLibre:** mit zwei Fingern neigen (3D-Gebäude) und drehen, 3D-Knopf im Vollbild, Kompass/Zoom-Knöpfe.
- **Hausnummern sichtbar:** Stopp-Nadeln stehen über der Adresse (Spitze zeigt aufs Haus), Hausnummern sitzen knapp darunter.
- **Vollbild-Leiste:** dunkel mit großer weißer Straße und weißem Hausnummern-Schild; ein Doppelring (außen Pakete, innen Stopps, Mitte Stopp-Nummer) mit kurzer Legende.

## Version 23

- Fehler behoben: Kartenstile „Deutschland“, „Klar“, „Standard“ und „Satellit“ blieben leer (alte gespeicherte Kacheln waren für die neue Karte unlesbar). Dunkelmodus dieser Stile wieder wie früher invertiert.
- Route zweifarbig: vor dir kräftig blau, schon gefahren grau – ab deinem Standort (sonst ab dem letzten erledigten Stopp), wird beim Fahren nachgezogen.
- Stopps: kleiner Punkt genau auf der Adresse, Blase schräg daneben (ohne Strich) – die Hausnummer bleibt frei. Paketzahl unten rechts an der Blase.
- Fenster am Punkt wird nicht mehr am Rand abgeschnitten.
