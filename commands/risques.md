---
description: Risques, urbanisme et cadastre à une adresse
argument-hint: <adresse>
---

L'utilisateur veut connaître les contraintes à l'adresse : $ARGUMENTS

Appelle dans cet ordre :

1. `natural_risks` — rapport officiel Géorisques (inondation, retrait-gonflement
   des argiles, radon, sismicité, sites industriels).
2. `urbanism_zoning` — zone PLU (U / AU / A / N), règlement applicable et
   prescriptions (emplacements réservés, périmètres protégés, alignements).
3. `cadastral_parcel` — parcelle, identifiant `idu` cité sur les actes et
   contenance officielle.

Puis, si l'utilisateur parle de vendre, louer ou construire, ajoute
`dpe_lookup` (étiquette énergie, étiquette GES) et, le cas échéant,
`rent_control` pour le plafond légal de loyer.

Règles de restitution :

- Un risque `available: false` est un risque **inconnu** : recopie le motif et le
  portail de repli publiés par l'outil. N'écris jamais « aucun risque ».
- `urbanism_zoning` dit quelles règles s'appliquent, **jamais** si un projet est
  autorisé : renvoie vers le service urbanisme de la commune pour toute décision.
- La contenance cadastrale est la surface fiscale de la parcelle entière, terrain
  compris — pas la surface habitable — et le cadastre ne dit rien de la propriété.
- Un DPE est une donnée déclarative : un diagnostic postérieur peut l'invalider.
