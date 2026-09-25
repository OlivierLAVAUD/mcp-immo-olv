# mcp-immo-olv

**Données immobilières françaises issues de l'open data public**
À partir d'une adresse, un client MCP peut consulter les ventes notariées (DVF), obtenir une estimation par comparables, les loyers d'annonce, une indication de la taxe foncière, les DPE, les risques Géorisques et le profil INSEE de la commune — sans clé API.. 

## Pourquoi

Les portails affichent des prix demandés et des estimations opaques. Les données
publiques françaises offrent mieux : actes notariés DVF, diagnostics ADEME,
indicateurs de loyer, fiscalité locale REI, risques et référentiels d'adresses.
`mcp-immo-olv` les relie dans des réponses auditables.

Chaque chiffre expose sa source, sa portée et ses limites. Une estimation reste
une analyse d'open data, **pas un avis de valeur professionnel ni un conseil
financier**.

## Installation locale

Node.js 18 ou plus récent est requis.

```bash
npm install
npm run build
node dist/index.js
```

Pour un client MCP compatible stdio après publication du paquet sous votre
compte npm :

```bash
# Remplacez le nom si vous publiez sous un scope npm.
npx -y mcp-immo-olv
```

Exemple de configuration générique :

```json
{
  "mcpServers": {
    "immo-olv": {
      "command": "npx",
      "args": ["-y", "mcp-immo-olv"]
    }
  }
}
```

## Installer depuis le registre MCP

Le serveur est référencé dans le registre officiel MCP sous le nom :

**`io.github.OlivierLAVAUD/mcp-immo`**

Un client capable de résoudre un serveur depuis le registre le trouve par ce
nom, sans clé API ni compte à créer. Le registre ne stocke que les métadonnées :
le serveur tourne en local, en `stdio`, et se lance depuis le paquet npm
`mcp-immo-olv`. La configuration manuelle ci-dessus reste équivalente.

```bash
# Vérifier la fiche publiée
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.OlivierLAVAUD%2Fmcp-immo"
```

## Outils

| Outil | Résultat | Source |
|---|---|---|
| `property_report` | Dossier complet : marché, ventes, estimation, loyers, taxe, DPE, risques, commune, cadastre, PLU, IRIS, encadrement | Toutes les sources ci-dessous |
| `estimate_property` | Estimation pondérée par comparables, fourchette, échantillon effectif, loyer et rendements | DVF + Carte des loyers + REI pour la taxe moyenne |
| `backtest_estimator` | Backtest walk-forward du modèle : MAPE, biais, couverture des intervalles, par bande de surface et par année | DVF (DGFiP / Etalab) |
| `property_sales` | Ventes notariées réelles autour d'une adresse ou dans une commune | DVF (DGFiP / Etalab) |
| `price_per_m2` | Médiane, quartiles, évolution annuelle et fenêtre 12 mois | DVF (DGFiP / Etalab) |
| `rent_estimate` | Indicateurs de loyer d'annonce par segment | Carte des loyers (Ministère du Logement / ANIL) |
| `rent_control` | Loyer de référence, plafond légal (majoré) et minoré | Encadrement des loyers (Ville de Paris, Métropole de Lyon) |
| `property_tax_estimate` | Charge annuelle moyenne par article taxable, ventilée par composante | REI (DGFiP), via API publique OFGL |
| `dpe_lookup` | Diagnostics de performance énergétique à l'adresse, logements existants **et** neufs | ADEME (`dpe03existant`, `dpe02neuf`) |
| `cadastral_parcel` | Parcelle cadastrale : identifiant `idu`, section, numéro, contenance officielle | PCI, IGN / DGFiP (API Carto) |
| `urbanism_zoning` | Zone PLU (U / AU / A / N), règlement et prescriptions d'urbanisme | Géoportail de l'urbanisme (DGALN / IGN) |
| `iris_lookup` | IRIS INSEE d'une adresse : code, nom, type, commune | CONTOURS-IRIS / ADMINEXPRESS, IGN |
| `natural_risks` | Risques naturels et technologiques officiels | Géorisques |
| `commune_info` | Population, code postal, département, région, surface, centre | geo.api.gouv.fr / INSEE |
| `geocode_address` / `reverse_geocode` | Adresse ↔ coordonnées, code INSEE et identifiant BAN | Base Adresse Nationale |

### Taxe foncière et rendement « net »

`property_tax_estimate` ne prétend **jamais** connaître l'avis de taxe foncière
d'un bien. Le REI publie des montants agrégés et nombres d'articles imposés par
commune : le serveur calcule leur charge moyenne, avec les composantes publiées
(part communale, intercommunale, syndicats, GEMAPI, TEOM). L'avis réel dépend de
la valeur locative cadastrale, des exonérations, du propriétaire et de
l'imposition : demandez-le avant tout achat.

Le rendement après taxe moyenne retire cette seule moyenne au loyer annuel. Il
ne déduit ni charges de copropriété, assurance, gestion, vacance, travaux ni
impôt sur les revenus : ce n'est pas un rendement net-net.

## Méthodologie d'estimation

L'estimation est une médiane pondérée des ventes comparables : même type de
bien, surface 40–250 % de la cible, un seul logement par acte, valeurs extrêmes
écartées. Les prix anciens sont ramenés au niveau du dernier millésime de marché
par commune (coefficient borné 0,7–1,6). Les poids combinent distance,
similarité de surface et ancienneté ; les quartiles pondérés donnent la
fourchette. Chaque comparable, son ajustement et son poids sont restitués.

Le moteur refuse une estimation sous trois comparables. Il ne connaît ni l'état,
ni l'étage, ni la vue, ni les travaux, ni les contraintes juridiques.

### Backtesting du moteur

`backtest_estimator` rejoue le moteur sur les ventes de la commune : chaque vente
est estimée en n'utilisant **que les ventes enregistrées avant sa propre date**
(découpe `asOf`, acte exclu), puis comparée au prix réellement payé. Aucun
comparable futur, aucun niveau de marché futur ne peut fuiter.

Il publie la MAPE, l'erreur médiane et le 90ᵉ centile, le biais signé (positif =
le modèle surestime) et la couverture de l'intervalle P25–P75 — à lire près de
**50 %**, pas 95 % : un intervalle P25–P75 bien calibré contient la moitié des
ventes réalisées. Le tout est ventilé par bande de surface et par année, avec
les dix plus grosses erreurs pour audit. Une exécution de contrôle sur Lyon
donne une MAPE d'environ 21 %, un biais de +8 % et une couverture de 52,5 %.

## Sources, licences et limites

| Jeu | Producteur | Usage dans le serveur |
|---|---|---|
| DVF géolocalisées | DGFiP / Etalab | Ventes 2021 → présent ; **aucune source géolocalisée avant 2021** ; pas d'Alsace-Moselle ni Mayotte ; délai de publication |
| Carte des loyers | Ministère du Logement / ANIL | Loyer d'annonce modélisé, charges comprises ; pas un loyer de référence réglementé |
| Encadrement des loyers | Ville de Paris, Métropole de Lyon | Loyers de référence des zones couvertes uniquement ; « non couvert » est renvoyé explicitement ailleurs |
| REI | DGFiP, exposé par OFGL | Fiscalité locale agrégée ; moyenne par article, jamais taxe individuelle |
| DPE logements existants et neufs | ADEME | Diagnostics `dpe03existant` et `dpe02neuf`, chacun étiqueté par registre |
| Cadastre (PCI) | IGN / DGFiP | Parcelle, `idu` et contenance ; jamais la propriété ni le droit de construire |
| Géoportail de l'urbanisme | DGALN / IGN | Zonage et prescriptions opposables ; les communes sans PLU en sont absentes |
| CONTOURS-IRIS / ADMINEXPRESS | IGN (source INSEE) | Identité de l'IRIS ; aucune donnée socio-démographique dans cette couche |
| Géorisques | Ministère de la Transition écologique | Rapport de risques officiel ; si leur API ne répond pas, la réponse porte `available: false` et le dit explicitement au lieu de renvoyer une liste vide |
| BAN / geo.api.gouv.fr | IGN / DINUM / INSEE | Adresses et unités administratives |

Les jeux publics sont interrogés en direct, sans clé API. Le cache mémoire DVF
réduit la latence et les appels répétés, mais est vidé au redémarrage.

## Développement

```bash
npm install
npm run build
npm test          # tests unitaires, sans réseau
npm run smoke     # vérification live des API publiques

cd ui
npm install
npm run dev       # console avec hot reload : http://localhost:5173
npm run build
npm start         # console compilée + pont MCP : http://localhost:8787
npm run smoke     # test de rendu avec fixtures réelles
```

## Licence

MIT. Copyright **© 2026 Olivier LAVAUD** ; les avis de copyright des portions
reprises restent dans `LICENSE`, conformément aux conditions MIT.
