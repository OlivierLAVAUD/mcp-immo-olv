# Prompts d'exemple

Prompts à copier tels quels dans un client connecté à `mcp-immo-olv` (Claude
Code, Cline, console web…). Ils sont en langage naturel : c'est le modèle qui
choisit l'outil et les arguments. Chaque prompt reste compréhensible sans
connaître les outils — les noms d'outils ne servent ici qu'à savoir **lequel**
sera appelé, et à retrouver le prompt correspondant.

Le skill `immobilier-france` cadre les réponses : citer la source de chaque
chiffre, ne jamais en inventer un, et traiter une source indisponible comme
**inconnue** — jamais comme une absence. Les sorties réelles correspondantes sont
dans [EXAMPLES.md](EXAMPLES.md) ; les 21 outils sont décrits dans le README.

## Sommaire par besoin

| Ce que vous voulez savoir | Outils appelés |
|---|---|
| Où est exactement l'adresse, à quelles coordonnées ? | `geocode_address`, `reverse_geocode` |
| Combien vaut ce bien ? | `estimate_property` |
| Est-ce que le moteur est fiable sur ce marché ? | `backtest_estimator` |
| Les prix au m² dans le quartier / la commune | `price_per_m2` |
| Les ventes réelles autour de l'adresse | `property_sales` |
| Le loyer d'annonce, le rendement locatif | `rent_estimate`, `rent_control` |
| Le montant moyen de la taxe foncière | `property_tax_estimate` |
| Les frais d'achat et le rendement net | `acquisition_costs` |
| L'étiquette énergie, le coût annuel, « est-ce louable ? » | `dpe_lookup` |
| Inondation, argiles, radon, ICPE | `natural_risks`, `risk_summary` |
| Ce qu'il y a autour : gare, écoles, commerces, hôpital | `nearby_amenities` |
| Le cadastre, le PLU, l'IRIS, la commune | `cadastral_parcel`, `urbanism_zoning`, `iris_lookup`, `commune_info` |
| Deux biens à départager, ou un quartier à comparer | `compare_properties`, `property_report` |
| « J'ai 300 k€, où puis-je acheter ? » | `search_by_budget` |

## Parcours complets (plusieurs outils)

- « J'envisage d'acheter un appartement de 60 m² au 12 rue de la République à Lyon : donne-moi le dossier complet, puis dis-moi quels travaux et quels risques je dois prévoir, et quel loyer je peux espérer. »
- « Je vends un 3 pièces de 68 m² au 10 place des Terreaux à Lyon. À quel prix puis-je afficher, et quelle marge ai-je par rapport au prix payé il y a quatre ans ? »
- « J'ai 320 000 € à investir dans le Rhône : quelles communes je peux viser pour un T3, avec quel rendement brut, puis simule les frais d'acquisition sur la meilleure option. »
- « Compare 10 place des Terreaux (Lyon 1er) et 12 rue de la République (Lyon 2e) pour un appartement de 55 m² : niveau de marché, estimation, loyer et étiquette énergie côte à côte. »
- « Prépare-moi une note d'une page sur le 12 rue de la République à Lyon (appartement 60 m², 3 pièces), au format Markdown, que je peux envoyer à mon banquier. »
- « Je visite un 4 pièces à Nantes demain : que dois-je vérifier sur place ? (DPE et statut locatif, risques, urbanisme, distance aux commodités) »

## Commandes du plugin

Installés en plugin Claude Code, trois raccourcis pré-câblent les appels :

```text
/immo-olv:rapport 21 avenue des Champs Élysées Paris
/immo-olv:estimation 21 avenue des Champs Élysées Paris Appartement 45
/immo-olv:risques 21 avenue des Champs Élysées Paris
```

## Un outil à la fois

### `geocode_address` — localiser une adresse

- « Où se trouve exactement le 12 rue de la République à Lyon ? Donne-moi le code INSEE et l'identifiant BAN. »
- « Résous l'adresse "8 rue des Fleurs 69003 Lyon" et dis-moi si plusieurs candidats existent. »
- « Les Clos Fleuris, Saint-Priest : trouve l'adresse réelle. »
- « Quelle est l'adresse normalisée de "mairie de Villeurbanne" ? »
- *Adresse ambiguë* : « Rue de la Paix Paris — les deux candidats, avec leurs coordonnées et leur score. »

### `reverse_geocode` — coordonnées → adresse

- « Quelle adresse correspond aux coordonnées 45.7651, 4.8358 ? »
- « Des photos géolocalisées à 48.8566, 2.3522 : à quel numéro et quelle voie ça correspond ? »
- « Confirme que le point 47.2310, -1.5176 est bien dans le quartier Doulon à Nantes. »

### `property_sales` — les ventes notariées réelles

- « Quelles ventes ont été enregistrées autour du 12 rue de la République à Lyon depuis 2024 ? Prix, date, surface. »
- « Montre-moi les 10 dernières ventes de maisons à Villeurbanne. »
- « Quelles ventes de plus de 80 m² ont eu lieu à Nantes Doulon entre 2023 et 2025 ? »
- « Combien de ventes enregistrées dans le 2e arrondissement de Lyon en 2025, et à quel prix médian ? »

### `price_per_m2` — le niveau de marché

- « À combien se vend le m² dans le 2e arrondissement de Lyon aujourd'hui ? »
- « Compare la médiane des prix au m² des appartements à Villeurbanne en 2022 et en 2025. »
- « Quel est l'écart entre le prix médian et le 3e quartile à Lyon 6e, pour les appartements ? »
- « Évolution du prix au m² dans un rayon de 500 m autour de 10 place des Terreaux. »
- « Médiane 12 derniers mois vs médiane toutes périodes : le marché lyonnais monte ou descend ? »

### `estimate_property` — l'estimation par comparables

- « Estime un appartement de 60 m² au 12 rue de la République à Lyon. »
- « Combien vaut une maison de 120 m² à Saint-Priest ? »
- « Estimation d'un T3 de 68 m² à Lyon 1er : donne-moi la fourchette et la confiance. »
- « Détaille les 5 comparables qui pèsent le plus dans ton estimation, avec leur ajustement. »
- *Garde-fou* : « Estime une maison de 400 m² au 5 rue des Lilas à Nantes » — si moins de trois comparables existent, la réponse doit le dire au lieu de chiffrer.

### `backtest_estimator` — la fiabilité du moteur

- « Ton estimation est-elle fiable pour les appartements à Lyon ? Donne la MAPE et le biais. »
- « Backteste le modèle sur les maisons à Saint-Priest depuis 2023. »
- « Sur Lyon 2e, quelle proportion des ventes réelles tombe dans la fourchette P25–P75 annoncée ? »
- « Où le modèle se trompe-t-il le plus ? Liste les dix pires erreurs avec les biens concernés. »

### `rent_estimate` — les loyers d'annonce

- « Combien je peux louer un appartement de 60 m² à Villeurbanne ? »
- « Loyer au m² pour un T3 dans le 2e arrondissement de Lyon, et pour un T1. »
- « Quels sont les loyers d'annonce pour une maison à Saint-Priest ? »
- « Donne-moi le loyer modélisé pour 45 m² à Paris 11e, pour faire une simulation de rendement. »

### `rent_control` — l'encadrement des loyers

- « Quel est le loyer de référence et le plafond légal pour un 2 pièces au 10 rue de Rivoli à Paris ? »
- « Encadrement des loyers à Lyon 1er pour un T3 meublé construit avant 1946. »
- « Une location meublée de 3 pièces à Villeurbanne est-elle soumise à l'encadrement ? »
- *Garde-fou* : « Et à Saint-Étienne ? » — la réponse doit dire que la zone n'est pas couverte, pas inventer un plafond.

### `property_tax_estimate` — la taxe foncière

- « Quelle est la taxe foncière moyenne à Lyon ? Et à Villeurbanne ? »
- « Détaille la taxe foncière moyenne 2025 dans le 2e arrondissement de Lyon : part communale, intercommunale, GEMAPI, TEOM. »
- « Combien pèse la taxe foncière sur un investissement locatif à Saint-Priest ? »
- *Garde-fou* : « Quelle sera ma taxe foncière exacte l'an prochain ? » — l'outil ne peut donner qu'une moyenne communale, jamais un avis d'imposition.

### `acquisition_costs` — frais d'achat et rendement

- « Pour un appartement de 55 m² au 10 place des Terreaux à Lyon, à 285 000 € négociés : frais de notaire, droits de mutation et total clés en main. »
- « Simule les frais d'acquisition d'un appartement estimé à 310 000 € au 12 rue de la République à Lyon, puis donne-moi le rendement net après taxe foncière. »
- « Avec 250 000 € affichés pour une maison de 95 m² à Saint-Priest, quel rendement brut et net ? »
- « Quel est le surcoût réel entre un acte chez un notaire "standard" et un modèle "agressif" sur 300 000 € ? »
- « Le prix n'est pas encore fixé : simule les frais d'acquisition sur l'estimation automatique d'un appartement de 60 m² au 12 rue de la République à Lyon. »

### `dpe_lookup` — énergie et conformité locative

- « Quelles étiquettes énergie pour le 12 rue de la République à Lyon ? Combien de DPE au total ? »
- « Le logement au 10 place des Terreaux est-il louable aujourd'hui, et à partir de quand ne le sera plus ? »
- « Estime le coût annuel de chauffage du 12 rue de la République à Lyon, en supposant 0,30 €/kWh. »
- « Récupère à la fois les DPE des logements existants et ceux du neuf pour cette adresse. »
- « Cette passoire thermique est-elle un risque locatif à 5 ans ? »

### `natural_risks` — les risques officiels

- « Quels risques naturels et technologiques au 12 rue de la République à Lyon ? »
- « Ce terrain est-il en zone inondable ? »
- « Le secteur est-il exposé au radon et aux mouvements de terrain ? »
- « Donne-moi le rapport officiel Géorisques avec le lien, pour cette adresse. »
- *Garde-fou* : en cas d'indisponibilité de Géorisques, la réponse doit dire **inconnu** et non « aucun risque ».

### `risk_summary` — le digest d'une phrase par risque

- « Fais-moi un résumé des risques du 12 rue de la République à Lyon, une phrase par risque. »
- « Ce logement est-il exposé à un risque majeur ? Réponds en trois lignes grand public. »
- « Y a-t-il des sites industriels dangereux près de cette adresse ? »
- « Quels risques dois-je mentionner dans mon compromis de vente ? »
- *Garde-fou* : « Une source injoignable doit s'afficher comme INCONNU, jamais comme "aucun risque" — vérifie-le sur cette adresse. »

### `nearby_amenities` — ce qu'il y a autour

- « Qu'est-ce qu'il y a autour du 12 rue de la République à Lyon à moins de 800 m ? »
- « Quelle est la gare ou l'arrêt de métro le plus proche du 10 rue de Rivoli à Paris ? »
- « Une école, une pharmacie et un supermarché dans les 500 m autour de cette adresse ? »
- « Ce quartier est-il pratique sans voiture ? Donne les distances à vol d'oiseau en précisant que ce n'est pas un temps de marche. »
- « Élargis le rayon à 2 km et dis-moi ce qui apparaît : hôpital, université, parc. »

### `cadastral_parcel` — le cadastre

- « Quelle est la parcelle cadastrale du 12 rue de la République à Lyon ? Donne l'identifiant `idu`. »
- « Quelle est la contenance cadastrale de cette parcelle, et est-ce la surface habitable ? »
- « Combien de parcelles couvrent cette adresse ? »
- *Garde-fou* : « Qui est le propriétaire de cette parcelle ? » — le cadastre ne le publie pas, la réponse doit le dire.

### `urbanism_zoning` — le PLU

- « En quelle zone PLU se trouve le 12 rue de la République à Lyon ? »
- « Un appartement de 60 m² au 10 place des Terreaux appartient à quelle zone (U, AU, A, N) ? »
- « Y a-t-il des prescriptions d'urbanisme ou des emplacements réservés sur cette parcelle ? »
- « Je veux agrandir de 20 m² : quelles règles s'appliquent ? »
- *Garde-fou* : l'outil dit quelles règles s'appliquent, jamais si le projet est autorisé.

### `iris_lookup` — le quartier INSEE

- « Quel est le code IRIS du 12 rue de la République à Lyon ? »
- « Dans quel IRIS de Nantes se trouve le chemin Vert ? »
- « Donne-moi le code IRIS à joindre aux tables INSEE de revenus pour ce quartier de Lyon 1er. »
- *Garde-fou* : l'outil ne publie ni revenu ni population d'IRIS ; la réponse doit le dire.

### `commune_info` — la commune

- « Combien d'habitants à Lyon, et quelle est sa surface ? »
- « Quel département et quelle région pour le code INSEE 69123 ? »
- « Quels codes postaux couvrent Villeurbanne, et quelle est sa population ? »
- « Donne le centre géographique de Saint-Priest. »

### `compare_properties` — départager 2 à 5 biens

- « Compare ces trois biens : 12 rue de la République Lyon (appartement 60 m²), 10 place des Terreaux Lyon (appartement 55 m²) et 1 cours Gambetta Villeurbanne (appartement 65 m²). Lequel a le meilleur rendement ? »
- « Deux adresses à Nantes, appartements de 70 m² : laquelle est la moins chère au m², et pourquoi ? »
- « Classe ces quatre adresses par prix au m² croissant et par rendement brut décroissant. »
- « Lequel de ces deux appartements est le mieux noté côté énergie ? »
- *Garde-fou* : une ligne dont une section a échoué doit rester hors du classement concerné, jamais classée dernière.

### `property_report` — le dossier complet

- « Fais-moi le dossier complet du 12 rue de la République à Lyon. »
- « Dossier complet pour un appartement de 60 m², 3 pièces, 12 rue de la République à Lyon. »
- « Le même dossier en Markdown, prêt à coller dans un email. »
- « Compare deux quartiers en un appel : dossiers pour 12 rue de la République (Lyon 2e) et 1 cours Gambetta (Villeurbanne), appartements de 60 m². »
- « Dossier pour ces cinq adresses avec le même profil : … » (2 à 5 adresses par appel, chacune isolée : une adresse introuvable ne fait pas tomber le lot).
- *Garde-fou* : « Montre-moi ce que le dossier dit quand une source est en panne : la section doit afficher `available: false` ou une erreur explicite, jamais un vide silencieux. »

### `search_by_budget` — la recherche inversée

- « J'ai 250 000 € pour un appartement : où puis-je acheter dans le Rhône ? »
- « Avec 400 000 € pour une maison en Gironde (33), quelles communes je peux viser ? »
- « Donne-moi les 10 communes du 69 où 300 000 € achètent le plus de surface, avec le rendement brut. »
- « Pour 200 000 € à Lyon, quelle surface maximale, et faut-il viser la périphérie ? »
- « Quelle commune de la métropole lyonnaise offre le meilleur rendement brut sous 250 000 € ? »
- *Garde-fou* : le budget est hors frais ; une commune aux ventes trop maigres doit être listée dans `not_enough_data`, pas classée.

## Prompts pour vérifier les garde-fous

À utiliser pour contrôler qu'un client restitue bien les limites du serveur.

- « Adresse totalement inventée : "10 rue inexistante zzzzz 99999 Nulleville" » → l'outil doit refuser et dire ce qu'il n'a pas trouvé.
- « Quels sont les risques à cette adresse ? » quand Géorisques est injoignable → **INCONNU**, jamais « aucun risque signalé ».
- « Estime ce bien » avec moins de trois comparables → refus explicite, pas de fourchette inventée.
- « Donne-moi la taxe foncière exacte de mon logement » → moyenne communale seulement, avec la mention que l'avis dépend de la valeur locative et du propriétaire.
- « Quel sera le prix de revente dans cinq ans ? » → aucune projection : le serveur publie des ventes passées, pas des prévisions.
- « Le projet d'agrandissement est-il autorisé ? » → règles d'urbanisme citées, décision renvoyée au service compétent.
