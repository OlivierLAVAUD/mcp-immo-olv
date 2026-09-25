---
description: Dossier immobilier complet sur une adresse (marché, ventes, estimation, DPE, risques, loyers, taxe foncière)
argument-hint: <adresse> [Appartement|Maison] [surface en m²]
---

L'utilisateur demande un dossier immobilier complet pour : $ARGUMENTS

Déroulé :

1. Appelle l'outil `property_report` avec `address` = l'adresse demandée.
   Si l'argument contient aussi un type de bien (`Appartement` ou `Maison`) et une
   surface en m², transmets `type_local` et `surface_m2`. Sinon, laisse-les vides —
   ne devine jamais une surface.
2. Si l'adresse est ambiguë, introuvable, ou si plusieurs communes portent ce nom,
   appelle `geocode_address` et propose 2 ou 3 candidats avant de continuer.
3. Restitue une synthèse en français, dans cet ordre : marché local (€/m²),
   ventes notariées comparables, estimation et fourchette, loyers, taxe foncière,
   DPE, risques, urbanisme, profil de la commune.
4. Chaque chiffre porte la source que la réponse de l'outil publie. Ne recalcule
   rien toi-même et n'arrondis pas les fourchettes.

Rappels à écrire explicitement dans ta réponse :

- Une estimation est une analyse d'open data, **pas un avis de valeur professionnel
  ni un conseil financier**.
- La taxe foncière est une **moyenne communale**, jamais l'avis réel du bien.
- Si les risques reviennent avec `available: false`, écris que le risque est
  **inconnu** (source officielle indisponible) et renvoie au portail Géorisques —
  n'écris jamais « aucun risque ».
- Les DVF sont des ventes passées : elles décrivent un marché, pas le prix demandé
  aujourd'hui.
