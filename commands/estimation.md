---
description: Estimer un bien par comparables et mesurer la fiabilité du modèle sur cette commune
argument-hint: <adresse> <Appartement|Maison> <surface en m²> [pièces]
---

L'utilisateur veut une estimation pour : $ARGUMENTS

Étapes :

1. Il te faut trois éléments : une adresse précise (rue + numéro), un type
   (`Appartement` ou `Maison`) et une surface en m². S'ils manquent, demande-les
   avant d'appeler quoi que ce soit. Le nombre de pièces est optionnel.
2. Appelle `estimate_property` avec `address`, `type_local`, `surface_m2` et
   `rooms` si fourni.
3. Appelle ensuite `backtest_estimator` sur la même adresse et le même type. Il
   rejoue le modèle sur les ventes de la commune en n'utilisant que les ventes
   antérieures à chacune : c'est ta mesure honnête de fiabilité ici.
4. Présente dans cet ordre : estimation centrale, fourchette P25–P75, nombre de
   comparables effectifs, puis la fiabilité (MAPE, erreur médiane, biais signé,
   couverture de l'intervalle). Si le moteur refuse (moins de trois comparables),
   dis-le au lieu de produire un chiffre.
5. Termine par les limites : le modèle ignore l'état, l'étage, la vue, les
   travaux et les contraintes juridiques. Un intervalle P25–P75 bien calibré
   contient environ la moitié des ventes réalisées, pas 95 %.
6. Écris noir sur blanc qu'il s'agit d'une analyse d'open data et **non d'un avis
   de valeur professionnel**.
