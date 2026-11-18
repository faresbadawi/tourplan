/* Tourplan-Connector für Claude (MCP über HTTP, ohne Sitzung).
   Claude bereinigt diktierte/getippte Adressen, dieser Server prüft sie optional und baut einen Link,
   der die Tour in der Tourplan-Web-App öffnet. Gesucht und sortiert wird dann in der App selbst
   (Straßenverzeichnis, Korrekturen, Optimierung mit echten Fahrzeiten). */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

type Env = { APP_URL: string; SECRET?: string };

const INSTRUCTIONS = `Tourplan hilft einem Paketzusteller in Deutschland, seine Zustelltour zu planen.
Ablauf: Der Nutzer diktiert oder tippt Adressen (oft mit Hörfehlern). Zerlege den Text selbst in einzelne Stopps:
- Jede Hausnummer ist ein eigener Stopp („Lindenweg 3 und 5“ = zwei Stopps).
- Paketzahl aus „Pakete“, „Päckchen“, „x“ oder einer Zahl nach Bindestrich („Hauptstraße 5 - 3“ = 3 Pakete).
- Korrigiere offensichtliche Hörfehler bei Straßennamen; erfinde keine Adressen.
- Ort nur angeben, wenn genannt oder eindeutig.
Bei Zweifeln an Straßennamen: adressen_pruefen aufrufen. Danach tour_link_erstellen aufrufen und dem Nutzer
den Link geben – er öffnet ihn auf dem Handy, die App sucht die Adressen und berechnet die beste Reihenfolge.
Antworte auf Deutsch, kurz.`;

const Stop = z.object({
  adresse: z.string().min(3).describe('Straße und Hausnummer, z. B. „Hauptstraße 5“ oder „Am Markt 3a“'),
  ort: z.string().optional().describe('Ort oder PLZ + Ort, nur wenn genannt oder eindeutig'),
  pakete: z.number().int().min(1).max(99).optional().describe('Anzahl Pakete, wenn genannt'),
});

/** Base64url wie in der App (UTF-8 → btoa). */
const b64url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const line = (s: z.infer<typeof Stop>) => [s.adresse.trim(), s.ort?.trim(), s.pakete ? `${s.pakete} Paket${s.pakete === 1 ? '' : 'e'}` : ''].filter(Boolean).join(', ');

async function photon(q: string, near?: string) {
  const r = await fetch(`https://photon.komoot.io/api/?limit=3&lang=de&q=${encodeURIComponent(near ? `${q}, ${near}` : q)}`, { headers: { 'User-Agent': 'Tourplan-MCP/1.0' } });
  if (!r.ok) throw new Error('Adresssuche nicht erreichbar (' + r.status + ')');
  const feats = ((await r.json()) as any).features || [];
  return [...new Set<string>(feats.filter((f: any) => f.properties.countrycode === 'DE').map((f: any) => {
    const p = f.properties, city = p.city || p.town || p.village || p.district || '';
    return [[p.street || p.name, p.housenumber].filter(Boolean).join(' '), [p.postcode, city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  }))];
}

function server(env: Env) {
  const s = new McpServer({ name: 'tourplan', version: '1.0.0' }, { instructions: INSTRUCTIONS });

  s.registerTool('tour_link_erstellen', {
    title: 'Tour-Link für die Tourplan-App erstellen',
    description: 'Baut aus den bereinigten Stopps einen Link, der die Tour in der Tourplan-App öffnet. Die App sucht die Adressen im Zustellgebiet und sortiert sie nach Fahrzeit (außer reihenfolge_beibehalten = true).',
    inputSchema: {
      stopps: z.array(Stop).min(1).max(300),
      reihenfolge_beibehalten: z.boolean().optional().describe('true = genau diese Reihenfolge fahren, nicht neu sortieren'),
      rundtour: z.boolean().optional().describe('true = am Ende zurück zum Depot; weglassen = Einstellung der App'),
    },
  }, async ({ stopps, reihenfolge_beibehalten, rundtour }) => {
    const data: Record<string, unknown> = { a: stopps.map(line) };
    if (reihenfolge_beibehalten) data.k = 1;
    if (typeof rundtour === 'boolean') data.r = rundtour;
    const url = `${env.APP_URL}#tour=${b64url(JSON.stringify(data))}`;
    const pk = stopps.reduce((a, x) => a + (x.pakete || 1), 0);
    const list = stopps.map((x, i) => `${i + 1}. ${line(x)}`).join('\n');
    return { content: [{ type: 'text', text: `${stopps.length} Stopps, ${pk} Pakete${reihenfolge_beibehalten ? ' (Reihenfolge bleibt)' : ' – die App sortiert nach Fahrzeit'}.\n${list}\n\nLink zum Öffnen auf dem Handy:\n${url}` }] };
  });

  s.registerTool('adressen_pruefen', {
    title: 'Adressen prüfen',
    description: 'Sucht bis zu 25 Adressen in OpenStreetMap und zeigt die besten Treffer – um Hörfehler bei Straßennamen zu erkennen. Nicht nötig, wenn die Adressen eindeutig sind.',
    inputSchema: {
      adressen: z.array(z.string().min(3)).min(1).max(25).describe('z. B. „Hauptstraße 5, Wittingen“'),
      gegend: z.string().optional().describe('Ort oder PLZ des Zustellgebiets, falls in den Adressen kein Ort steht'),
    },
  }, async ({ adressen, gegend }) => {
    const out: string[] = [];
    for (let i = 0; i < adressen.length; i += 3) {                      // höchstens 3 gleichzeitig (Photon sperrt sonst)
      const part = await Promise.all(adressen.slice(i, i + 3).map(async a => {
        try { const hits = await photon(a, /,/.test(a) ? undefined : gegend); return `• ${a} → ${hits.length ? hits.join(' | ') : 'NICHT GEFUNDEN'}`; }
        catch (e: any) { return `• ${a} → Fehler: ${e.message}`; }
      }));
      out.push(...part);
    }
    return { content: [{ type: 'text', text: out.join('\n') }] };
  });
  return s;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const path = new URL(req.url).pathname;
    const want = env.SECRET ? `/${env.SECRET}/mcp` : '/mcp';
    if (path !== want) return new Response('Tourplan-Connector', { status: path === '/' ? 200 : 404 });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server(env).connect(transport);
    return transport.handleRequest(req);
  },
};
