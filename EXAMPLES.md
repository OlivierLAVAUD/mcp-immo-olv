# Exemples

Sorties **réelles** du serveur compilé (`dist/`), obtenues par le transport MCP
`stdio` — exactement ce qu'un client reçoit. Chaque bloc dit ce que l'outil
promet et ce qui, dans la réponse, le prouve.

`npm run examples` rejoue ces mêmes appels et vérifie les contrats associés
(nécessite le réseau) ; le README décrit l'installation, les outils et les
sources.

Ces captures datent du **2026-10-09**. Les chiffres dépendent des données
publiées ce jour-là.

1. [`risk_summary` — une phrase par risque](#1-risk_summary--une-phrase-par-risque)
2. [`nearby_amenities` — ce qu'il y a autour](#2-nearby_amenities--ce-quil-y-a-autour)
3. [`compare_properties` — deux adresses côte à côte](#3-compare_properties--deux-adresses-côte-à-côte)
4. [`search_by_budget` — la recherche inversée](#4-search_by_budget--la-recherche-inversée)
5. [`property_report` en Markdown](#5-property_report-en-markdown)
6. [`property_report` en lot d'adresses](#6-property_report-en-lot-dadresses)
7. [Lots hors bornes — les messages d'erreur](#7-lots-hors-bornes--les-messages-derreur)

## 1. `risk_summary` — une phrase par risque

À Lyon :

```json
{
  "available": true,
  "signals_count": 4,
  "headline": "Risque(s) signalé(s) : inondation, retrait-gonflement des argiles, radon, sites industriels (ICPE). DPE D : louable, aucune interdiction programmée.",
  "items": [
    { "key": "inondation", "status": "present", "sentence": "Inondation : signalé (Risque Existant)." },
    { "key": "icpe", "status": "present", "sentence": "Sites industriels (ICPE) : signalé (Risque non Concerne ; Risque Concerne)." },
    { "key": "dpe", "status": "absent", "sentence": "DPE D : louable, aucune interdiction programmée." }
  ],
  "other_present_risks": ["Remontée de nappe", "Séisme", "Pollution des sols", "Rupture de barrage"]
}
```

Trois statuts seulement : `present` (signalé), `absent` (catégorie non signalée),
`unknown` (source injoignable ou DPE illisible). La sortie réelle contient les 5
catégories, dont la liste complète des risques hors catégories.

## 2. `nearby_amenities` — ce qu'il y a autour

À Lyon, rayon 800 m (extrait) :

```text
transports count=  67  plus proche= 116 m  → Saint-Nizier [bus_stop] 116 m | Cordeliers [bus_stop] 179 m | Cordeliers [station] 191 m
education  count=  42  plus proche= 116 m  → Babilou L'Envol [kindergarten] 116 m | Collège Ampère [school] 135 m | Lycée Ampère [school] 150 m
commerces  count= 109  plus proche=  25 m  → Carrefour City [convenience] 25 m | Auchan [supermarket] 59 m | La Vie Claire [convenience] 61 m
sante      count=  38  plus proche= 173 m  → Grande Pharmacie Lyonnaise [pharmacy] 173 m | Pharmacie de l'Opéra [pharmacy] 207 m | Lafayette Florit [pharmacy] 239 m
loisirs    count=  69  plus proche= 228 m  → (sans nom) [garden] 228 m | (sans nom) [garden] 232 m | (sans nom) [garden] 235 m
```

Les distances sont **à vol d'oiseau**, mesurées au centre de chaque objet OSM, et
chaque POI porte son identifiant OSM (`node/…`) pour vérification. Si aucun miroir
Overpass ne répond, tous les `count` sont `null` : **inconnu, jamais 0**.

## 3. `compare_properties` — deux adresses côte à côte

```text
#  adresse résolue                         €/m² 12 m  ventes  estimation €  conf.  loyer €/m²  DPE  rend. %
0  10 Place des Terreaux 69001 Lyon             4 852     283       263 000  high        17,1    E     3,9
1  12 Rue de la République 69002 Lyon           4 848     189       369 000  high        17,6    D     3,8
classements : cheapest_eur_m2 [1,0] · best_gross_yield_pct [0,1]
```

Les classements sont des **indices de lignes** (0 = votre première adresse) :
une ligne sans chiffre en est absente — « unknown », jamais « dernier ». Une
section en échec reste dans le `errors` de sa ligne.

## 4. `search_by_budget` — la recherche inversée

250 000 € d'appartements dans le Rhône, 6 communes les plus peuplées (extrait) :

```text
commune                     pop.  €/m² 12 m  surf. max  loyer €/m²  loyer €/mois  rend. %
Vénissieux (69259)        65 502      2 517         99        14,7         1 456     7,0
Vaulx-en-Velin (69256)    53 069      2 766         90        15,6         1 407     6,8
Lyon (69123)             519 127      4 469         55        16,4           902     4,3
classements : most_surface [5,1,3,…] · cheapest_eur_m2 [5,1,3,…] · best_gross_yield_pct [5,1,3,…]
```

`surf. max` = budget ÷ médiane €/m² de la ligne. Le budget est le prix d'achat
seul — les frais (~6,4 %) s'ajoutent. Une commune aux ventes trop maigres est
écartée du classement et listée nommément dans `not_enough_data`.

## 5. `property_report` en Markdown

`format: "markdown"` (extrait) :

```markdown
# Dossier immobilier — 12 Rue de la République 69002 Lyon

*Généré le 2026-10-09 … **pas un avis de valeur professionnel ni un conseil financier**.*

## Marché (DVF)

- **Médiane 12 derniers mois** : 4 962 €/m² (269 ventes)
- Médiane toute période : 5 691 €/m² (1417 ventes)

## Estimation par comparables

- **Valeur estimée** : 310 000 € (fourchette 261 000 € – 361 000 €)
- Confiance : **high** · 200 comparables (échantillon effectif 177.2)
- Rendement locatif brut : **3,9 %** (net après taxe foncière moyenne : 3,3 %)

## Risques (Géorisques)

> ⚠️ **Statut INCONNU** — Géorisques API unreachable: fetch failed. Ce n'est pas l'absence de risque : vérifier sur https://www.georisques.gouv.fr/minformer-sur-un-risque.
```

## 6. `property_report` en lot d'adresses

`addresses` : une adresse introuvable ne fait pas tomber le lot :

```json
{
  "format": "json",
  "query": { "addresses_count": 2, "type_local": "Appartement", "surface_m2": 55, "rooms": null },
  "reports": [
    { "input_address": "10 place des Terreaux Lyon",
      "resolved_address": "10 Place des Terreaux 69001 Lyon",
      "market": { "all_period": { "sales": 1934, "median_eur_m2": 5438 } } },
    { "input_address": "10 rue inexistante zzzzz 99999 Nulleville",
      "error": "Address not found in the Base Adresse Nationale: \"10 rue inexistante zzzzz 99999 Nulleville\". Try adding a postcode or city name." }
  ]
}
```

## 7. Lots hors bornes — les messages d'erreur

Refusés par le schéma d'entrée, avec un message actionnable :

```text
1 adresse           → MCP error -32602: … "A batch needs at least 2 addresses in `addresses` (pass `address` for a single dossier)."
6 adresses          → MCP error -32602: … "A batch takes at most 5 addresses in `addresses`."
address + addresses → Error: Provide either `address` (one dossier) or `addresses` (2–5), not both.
aucune adresse      → Error: property_report needs an `address`, or 2 to 5 addresses in `addresses`.
```
