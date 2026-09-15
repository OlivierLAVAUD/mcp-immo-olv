# OLV Immo — console web

Interface locale pour **consulter et piloter le serveur MCP `mcp-immo-olv`**.

Le serveur MCP parle JSON-RPC sur *stdio* : il est conçu pour être piloté par un
client IA, pas par un navigateur. Cette console ajoute un **pont HTTP** qui garde
une session MCP ouverte et la réexpose en JSON, puis une application React qui
présente les résultats.

Deux vues :

| Vue | Ce qu'elle fait |
|---|---|
| **Dossier** | Une adresse → un appel à `property_report` → dossier complet : estimation par comparables (avec la table des comparables auditable), marché €/m², ventes notariées, loyers officiels et rendement brut, DPE, risques Géorisques, profil de commune. Le serveur renvoie en plus le cadastre, le zonage PLU, l'IRIS et l'encadrement des loyers dans le même JSON. |
| **Outils MCP** | Explorateur brut : les 16 outils exposés par le serveur, un formulaire généré depuis leur JSON Schema, et la réponse JSON telle quelle. Utile pour vérifier un contrat d'outil ou tester un cas limite. |

## Prérequis

- Node.js ≥ 18 (testé sur 22)
- Le serveur MCP compilé à la racine du dépôt :

```bash
cd ..            # racine du dépôt OLV Immo
npm install
npm run build    # produit dist/index.js, que le pont lance en stdio
```

## Démarrage

```bash
cd ui
npm install
npm run dev      # http://localhost:5173
```

`npm run dev` lance **deux** processus : le pont (`node server/bridge.mjs`, port
8787) et Vite (port 5173). Vite redirige `/api/*` vers le pont, donc le
navigateur ne parle qu'à une seule origine.

### Mode production (un seul port)

```bash
npm run build    # tsc --noEmit && vite build → ui/dist
npm start        # le pont sert ui/dist ET l'API sur http://127.0.0.1:8787
```

### Vérification du rendu, sans navigateur

```bash
npm run smoke
```

Trois couches, toutes pilotées par des charges utiles **réelles** capturées depuis
le serveur :

1. **Cartes** — rendu HTML statique avec `fixtures/property-report-lyon.json`
   (un `property_report` complet sur le 12 rue de la République à Lyon), puis
   vérification que le markup contient les libellés attendus et aucun
   `[object Object]` / `NaN` / `undefined`.
2. **Coercition de schémas** — sur les 16 outils réels (`fixtures/tools.json`) :
   un formulaire vide coerce en charge vide, un formulaire rempli porte tous les
   arguments requis avec le bon type, les tableaux de nombres se parsent.
3. **Console d'outils** — rendu avec la liste réelle, y compris l'indicateur
   de champs requis manquants.

La couche 1 attrape ce que les tests de données laissent passer : un composant
qui plante au rendu parce qu'un champ est un objet là où le type annonçait une
chaîne. C'est exactement le bug trouvé en intégrant cette console —
`commune.departement` et `commune.region` arrivent en `{code, nom}` depuis
geo.api.gouv.fr, pas en chaîne.

Pour rafraîchir une fixture, rejouer l'appel et remplacer le fichier par le
champ `data` de la réponse (voir l'exemple `curl` plus bas). Pour les outils,
`node capture-tools.mjs` ouvre le serveur compilé en stdio et réécrit
`fixtures/tools.json` avec les schémas réellement exposés — la console et son
smoke suivent ainsi automatiquement tout nouvel outil.

## Structure

```
ui/
  server/bridge.mjs        pont MCP ⇄ HTTP (une session stdio persistante)
  src/
    api.ts                 client des trois endpoints du pont
    types.ts               formes renvoyées par les outils MCP
    schema.ts              JSON Schema ⇄ formulaire ⇄ arguments (pur, testé)
    format.ts              formatage fr-FR (€, €/m², %, dates)
    App.tsx                coquille + onglets + état de la session MCP
    tabs/DossierTab.tsx    adresse → property_report → dossier
    tabs/ToolConsoleTab.tsx explorateur d'outils piloté par le JSON Schema
    components/            une carte par section du rapport
  scripts/render-smoke.tsx test de rendu SSR (cartes, coercition, console)
  capture-tools.mjs      régénère fixtures/tools.json depuis le serveur MCP compilé
  fixtures/                charges utiles réelles : rapport + 16 schémas d'outils
```

## API du pont

| Méthode | Chemin | Corps | Réponse |
|---|---|---|---|
| `GET` | `/api/health` | — | état du pont et de la session MCP, version du serveur, nombre d'outils |
| `GET` | `/api/tools` | — | les outils MCP avec `name`, `title`, `description`, `inputSchema` |
| `POST` | `/api/call` | `{ "name": "...", "arguments": { ... } }` | `{ ok, tool, data, text, isError, durationMs }` |

Une erreur d'outil (adresse introuvable, moins de 3 comparables…) revient en
**HTTP 200** avec `ok: false` : c'est un résultat métier, pas une panne de
transport. Le message est dans `error` ou dans `text`.

```bash
curl -s localhost:8787/api/tools | python3 -c 'import json,sys; print([t["name"] for t in json.load(sys.stdin)["tools"]])'

curl -s -X POST localhost:8787/api/call -H 'content-type: application/json' \
  -d '{"name":"price_per_m2","arguments":{"address":"Lyon 3e","type_local":"Appartement"}}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["last_12_months"])'
```

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `IMMO_UI_PORT` | `8787` | port d'écoute du pont |
| `IMMO_UI_HOST` | `127.0.0.1` | adresse d'écoute (le pont n'est **pas** authentifié : gardez-le en local) |
| `IMMO_CALL_TIMEOUT_MS` | `180000` | délai maximal par appel d'outil |
| `IMMO_MCP_ENTRY` | `../dist/index.js` | chemin du serveur MCP compilé |
| `IMMO_BRIDGE_URL` | `http://127.0.0.1:8787` | cible du proxy Vite (côté `npm run dev`) |

## Notes d'implémentation

- **Une seule session MCP**, ouverte paresseusement au premier appel et
  ré-ouverte automatiquement si le processus enfant meurt (`onclose`).
- La `stderr` de l'enfant est drainée en continu : un tuyau non consommé finit
  par bloquer le serveur.
- Les appels sont chronométrés et bornés dans le temps. `property_report`
  interroge cinq API publiques en parallèle ; un dossier complet sur une adresse
  lyonnaise a pris **20 s** lors de la validation.
- Aucune donnée n'est mise en cache : chaque dossier reflète l'état courant des
  jeux de données ouverts.
- Le pont sert `ui/dist` s'il existe, sinon il renvoie un message expliquant
  comment compiler.

## Limites

Cette console est un **outil d'inspection**, pas un produit : pas
d'authentification, pas de multitenancy, pas de persistance. Elle est prévue
pour tourner sur `127.0.0.1`. Les données restent celles des sources officielles
(DVF, ADEME, Géorisques, BAN, INSEE) — et une estimation par comparables n'est
pas une expertise professionnelle.
