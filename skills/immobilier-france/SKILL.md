---
name: immobilier-france
description: Répondre à une question immobilière française (prix, vente, estimation, loyer, taxe foncière, DPE, risques, PLU, cadastre) en choisissant le bon outil open data et en exposant ses limites. À utiliser dès qu'une adresse, une commune, un prix au m² ou une valeur de bien en France est en jeu.
---

# Données immobilières françaises en open data

Ce plugin branche le serveur MCP `mcp-immo-olv` : 16 outils, sources publiques
françaises, **aucune clé API**. Ton rôle est de choisir le bon outil, de ne
jamais inventer un chiffre, et de publier les limites que la réponse expose.

## Choisir l'outil

| Question de l'utilisateur | Outil |
|---|---|
| « Raconte-moi ce bien / cette adresse » | `property_report` (dossier complet, un seul appel) |
| « Combien vaut ce bien ? » | `estimate_property` (puis `backtest_estimator` pour la fiabilité) |
| « Est-ce que le modèle est fiable ici ? » | `backtest_estimator` |
| « Les prix au m² dans ce quartier / cette commune » | `price_per_m2` |
| « Les ventes récentes autour de… » | `property_sales` |
| « Combien je peux louer ? » | `rent_estimate` (marché) puis `rent_control` (plafond légal) |
| « Le montant de la taxe foncière » | `property_tax_estimate` |
| « Quels travaux / quelle étiquette énergie ? » | `dpe_lookup` |
| « Inondation, argiles, radon, séisme » | `natural_risks` |
| « Est-ce que je peux construire / agrandir ? » | `urbanism_zoning` |
| « Quelle est cette parcelle ? » | `cadastral_parcel` |
| « Quel quartier INSEE ? » | `iris_lookup` |
| « Combien d'habitants, quel département ? » | `commune_info` |
| « Quelle adresse pour ce GPS ? » / adresse ambiguë | `geocode_address`, `reverse_geocode` |

Si l'adresse n'est pas parfaitement identifiée, résous-la d'abord avec
`geocode_address` : tout le reste en dépend.

## Règles non négociables

- **Jamais de chiffre inventé.** Si un outil refuse, dis ce qu'il refuse et
  pourquoi. Le moteur d'estimation exige au moins trois comparables.
- **Une estimation n'est pas un avis de valeur.** C'est une analyse d'open data,
  à citer comme telle, jamais comme un conseil financier.
- **Risque inconnu ≠ absence de risque.** Une réponse `available: false` signifie
  que la source officielle est indisponible — recopie le motif et le portail de
  repli, n'écris jamais « aucun risque signalé ».
- **Taxe foncière = moyenne communale.** Le REI publie des montants agrégés, pas
  l'avis d'imposition du bien. Ne le présente jamais comme un montant dû.
- **DVF = ventes passées.** Les prix notariés décrivent un marché réalisé, ils ne
  disent pas le prix demandé aujourd'hui, ni l'état du bien.
- **Encadrement des loyers : couverture partielle.** Seules les zones publiant une
  grille ouverte sont couvertes (Paris, Métropole de Lyon). Si l'outil répond que
  l'adresse n'est pas couverte, ne généralise pas le plafond.
- **Urbanisme : règles, pas autorisation.** `urbanism_zoning` dit quelles règles
  s'appliquent. Toute décision de projet renvoie au service urbanisme compétent.
- **Cadastre : pas de propriétaire.** L'outil donne parcelle et contenance fiscale
  (terrain compris), jamais le propriétaire, et la contenance n'est pas la surface
  habitable.

## Sensibilité des sources

Plusieurs de ces services publics sont vulnérables aux pannes ou à la charge.
Géorisques en particulier peut être entièrement indisponible : le serveur le
signale alors explicitement plutôt que de retourner un rapport vide. Traite ça
comme une information à donner à l'utilisateur, avec la date de la tentative.
