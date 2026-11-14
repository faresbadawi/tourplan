# Tourplan

Web-App (PWA) für Zusteller: Adressen tippen, einfügen oder diktieren, beste Reihenfolge berechnen, Stopp für Stopp mit Waze, Google Maps oder Apple Karten fahren.

- **Einrichtung:** Name, Depot/Zustellstützpunkt (Start und Ende jeder Tour), Navi-App, Hell/Dunkel.
- **Eingabe:** eine Adresse pro Zeile; ohne Ort wird rund ums Depot gesucht. Diktat auf Deutsch („nächste“ trennt Adressen), intelligente Aufbereitung (Zahlwörter, „Str.“, „12 a“ → „12a“).
- **Optimierung:** echte Fahrzeiten (OSRM), Nächster-Nachbar + 2-opt + Or-opt; Rundtour oder offenes Ende.
- **Unterwegs:** Daumen-Leiste mit nächstem Stopp, „Erledigt“, Ankunftszeiten, Google-Maps-Gesamtroute (in 10er-Teilen), Liste teilen.
- Optimiert für Handy (z. B. Galaxy Z Flip 6, auch Außendisplay), iPad und Desktop.

Dienste ohne API-Schlüssel: Photon/Nominatim (Adresssuche), OSRM (Routing), OpenStreetMap (Karte). Alle Daten bleiben im Browser (localStorage).

Lokal starten: `python3 -m http.server 8931` und http://127.0.0.1:8931 öffnen. Mikrofon, Standort und „Zum Startbildschirm“ brauchen HTTPS (z. B. GitHub Pages).
