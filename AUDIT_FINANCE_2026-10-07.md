# Audit financier local — 7 octobre 2026

Révision auditée : `0949b77c604c1dfb148799e5c5031d14eaadf3ac`. Node `v22.22.0`, Windows. Sources applicatives inchangées, aucun appel à la production, aucune publication ni push. Aucun fichier AGENTS.md trouvé dans l'ascendance du dépôt. Les autres fichiers d'audit présents dans le répertoire appartiennent aux autres agents.

## Résultat et reproduction

```powershell
node --test tests/audit-finance-stress.test.cjs tests/audit-finance-findings.test.cjs
```

Résultat : **22 tests, 10 passés, 12 TODO, 0 échec hors TODO, 0 skipped**. Les 12 TODO exécutent réellement leurs assertions et échouent avec les preuves `AUDIT_FINDING` : ce sont des régressions reproduites ou des divergences de règle à arbitrer, **pas 12 réussites**. Le code de sortie 0 est celui du runner Node pour les TODO. Il ne signifie donc pas que les 12 problèmes sont corrigés. La suite stress n'utilise pas de TODO et ses dix tests passent.

Les fichiers de tests sont autonomes. `tests/audit-finance-findings.test.cjs` imprime une preuve JSON par constat. Les suppressions de compte/projet exécutent le vrai gestionnaire d'`app.js` extrait et isolé dans un contexte VM avec état synthétique, boutons synthétiques, confirmation vraie et `save()` limité à `Core.normalizeState`. Aucune interface réelle ni sauvegarde utilisateur n'est touchée.

## Couverture exacte

100 profils de données distincts réutilisés dans les familles de tests. Il s'agit de simulations par code, pas de 100 personnes ni de 100 sessions de navigation. Les fixtures sont variées, les dates fixes, et les suites séquentielles utilisent xorshift32, seeds `0xF10A0000 + profil`, `0xC500 + profil`, `0xAAA000 + profil`.

| Famille | Volume exécuté | Oracle et contrôles |
| --- | ---: | --- |
| Ledger séquentiel | 100 × 120 = **12 000 actions** | Ledger indépendant en centimes, soldes de trois comptes, conservation totale des transferts, exclusion épargne, réserve globale, buffer, dates futures, montant disponible |
| Détail des 12 000 actions | 1 371 revenus, 1 323 dépenses, 1 365 transferts, 1 263 éditions, 1 270 suppressions, 1 353 rapprochements, 1 347 reloads, 1 286 tentatives de réservation, 543 libérations, 879 actions sans élément cible | 12 000 snapshots × 5 égalités financières = **60 000 assertions d'invariant** ; chaque libération ajoute une seconde tentative refusée, **543 tentatives répétées hors des 12 000 actions** |
| CSV | 100 fichiers × 13 lignes = **1 300 lignes** | 1 200 montants de deux décimales, 100 dates impossibles, BOM, CRLF, séparateurs/guillemets/newlines dans libellés Unicode |
| Imports CSV | 100 × 12 × 3 = **3 600 tentatives de ligne** | Premier import + répétition + répétition après reload, soldes calculés indépendamment, aucun salaire implicite |
| Migration | **100 états legacy** | Aliases `operations/objectifs/revenus`, solde/initialBalance, centimes et objectifs, idempotence, oversized volontairement ignoré |
| Récurrences confirmées | **925 confirmations**, **925 tentatives futures**, **925 tentatives stale** | Arithmétique UTC indépendante, jours fin de mois, leap day, weekly/monthly/yearly/once, ledger cumulé |
| Horizons salaire | **100 états** | Salaire du jour déjà enregistré avance l'horizon, dépenses le jour de salaire exclues conformément au comportement existant, charges épargne exclues |
| Prorata | **100 répartitions**, 100 triggers initiaux + 100 répétitions | Oracle BigInt quotient/reste, conservation des centimes, 100 confirmations précoces + 100 dues + 100 répétées |
| Projet édition/lifecycle | **100 éditions** | 100 triggers plafonnés, 100 refus/ignores + 100 répétitions, 100 triggers après édition, 100 libérations avant échéance ; historique saved séparé |
| Import hostile | **100 datasets, 1 000 tentatives de ligne** | 500 vers compte valide + 500 vers compte inconnu ; NaN, >1e9, subcent, date impossible, ID hostile régénéré |
| Sauvegardes | **100 créations de code**, **400 lectures valides**, **200 rejets de troncature** | JSON, gzip G, code J, FLOW42 et retours à la ligne, Unicode ; comparaison intégrale des données brutes |
| Limites | **9 rejets** | >2 Mo CSV, >10 000 lignes, guillemets incomplets, >4 Mo JSON/code, version future, JSON non reconnu, >20 000 éléments, bombe gzip |
| Régressions ciblées | **12 probes** | Assertions attendues échouées, preuves ci-dessous |

La somme des catégories détaillées de la suite ledger vaut exactement 12 000 ; les repeatRelease et les snapshots ne sont pas comptés comme nouvelles actions. Aucun total artificiel ne mélange personnes, datasets, lignes, assertions et appels.

## Constats reproduits

P1 indique un effet direct sur un solde/deduplication ou sur une attribution de compte ; P2 indique une incohérence plus limitée ou un cas frontière. F04 et F07 ont une preuve comportementale mais leur règle attendue mérite une décision produit ; ils sont distingués des dix défauts techniques.

| Code | Niveau | Preuve observée | Source et conséquence |
| --- | --- | --- | --- |
| F01 | P2 | Rapprochement 123,45 € → metadata `reconciledBalance` 1,23 € au premier normalize, 0,01 € au deuxième ; ledger reste 12 345 centimes | `flow-core.js:73` emploie `euros()` sur une valeur déjà en euros écrite à `:457`. Métadonnée non idempotente à chaque `save()`/reload, sans corruption du vrai solde dans ce probe. |
| F02 | P2 | Projection annuelle du salaire 29/02/2024 → 01/03/2025 ; confirmation de la même occurrence → 28/02/2025 | `flow-core.js:235` vs `:518`. Deux moteurs calendaires contradictoires, décalage d'un jour de l'horizon et des charges incluses. Aucun jugement porté sur la dérive mensuelle 31→29→29, que l'oracle conserve conformément au moteur. |
| F03 | P1 | Loyer bancaire déjà enregistré 100 € : disponible 900 € ; confirmer le même récurrent crée une seconde dépense, disponible 800 € | `flow-core.js:271` reconnaît le paiement existant pour les charges, mais `:510` déduplique uniquement par ID `rec:…`, sans reprendre ce rapprochement. Cas fréquent import bancaire + confirmation manuelle. |
| F04 | P2 / règle à arbitrer | Suppression du projet exécutée par le vrai handler : 0 projets, 10 000 centimes encore actifs, `goalId=g` orphelin | `app.js:204`. La réserve reste libérable séparément, mais la suppression n'indique pas ce maintien. Décider s'il faut libérer ou demander explicitement de conserver l'historique de réserve. |
| F05 | P1 | Réserve de 100 € sur `second`, suppression de `second` → réserve devenue `main`, toujours active | `app.js:205` omet les réservations, puis `normalizeAccount` remappe l'ID inconnu au premier compte. Réaffectation financière silencieuse, distincte de la normalisation volontaire d'un ID hostile. |
| F06 | P1 | Deux références bancaires distinctes `bank-1989051064` et `bank-267641678`, même date/libellé/montant : toutes deux `fp-ce283479` ; import = 1 ajout, 1 doublon | `flow-core.js:461`. FNV 32 bits employé comme preuve unique de duplicat élimine une vraie opération. Le probe final comporte seulement deux lignes ; collision découverte avec xorshift seed 42 après 125 046 candidats, pas besoin d'importer un fichier de 125 046 lignes. |
| F07 | P2 / règle à arbitrer | Compte `main` vide, `cash` 1 000 € : réservation manuelle 200 € sur `main` refusée, automatique sur `main` acceptée pending 20 000 centimes | `flow-core.js:318` vérifie budget global ; le manuel vérifie aussi fonds du compte. Le disponible global reste cohérent. Décider si `accountId` signifie financement réel obligatoire ou simple affectation virtuelle. |
| F08 | P1 | Réserver 500 € sur un livret inclus, puis l'exclure : `main` contient 10 €, mais nouvelle réservation de 100 € sur `main` acceptée | `flow-core.js:352` soustrait une réserve du compte exclu à un total dont elle était déjà absente, ce qui crée des réservations de compte négatives et augmente artificiellement ses fonds. |
| F09 | P2 | Contribution suspendue 80 €, projet cible 100 €, revenu ultérieur et réserve manuelle 80 €, puis réduire/reprendre la suspendue à 80 € : actif 160 € pour cible 100 € | `flow-core.js:405` et `:412` ne recalculent pas le restant du projet à la résolution. Le plafond existant au moment de la proposition devient obsolète. |
| F10 | P2 | Hebdomadaire 1 €/semaine depuis 01/01/2020, horizon 28/10/2026 : oracle 356 occurrences/356 €, résultat 120 occurrences/120 € | `flow-core.js:231` coupe silencieusement à 120 ; disponible surestimé de 236 €. Les anciennes échéances sont censées rester dues d'après la règle de `:267`. Le guard est une limite volontaire, l'absence de signal et le calcul présenté comme complet constituent le défaut. |
| F11 | P2 | Récurrent ID valide de longueur 128 → ID transaction composé longueur 143 → nouveau ID transaction au normalize ; nouvelle invocation du salaire crée une deuxième réserve | `flow-core.js:510`, `:91`, `:151`. Identité composée incompatible avec la limite 128, liaison salaryTransactionId aussi tronquée. Pas déclenché par les IDs ordinaires générés dans l'app, mais reproductible après backup/migration valide. |
| F12 | P2 | CSV `1.005` et `-1.005` donne `[1,-1]` €, core donne `[1.01,-1.01]` € | `bank-import.js:48` arrondit flottant brut différemment de `Core.cents`. Les montants bancaires à deux décimales passent dans les 100 datasets ; seuls les montants à trois décimales acceptés par le parseur exposent la divergence. |

## Preuves de sortie compactes

Les scripts contiennent les fixtures complètes et réimpriment ces faits à chaque exécution ; les IDs régénérés et durées peuvent changer, pas les centimes ni les résultats.

```text
AUDIT_FINDING {"code":"F01","before":123.45,"first":1.23,"second":0.01,"actualLedger":12345}
AUDIT_FINDING {"code":"F02","projected":"2025-03-01","confirmed":"2025-02-28"}
AUDIT_FINDING {"code":"F03","before":900,"after":800,"alreadyCountedLiability":0,"added":true,"transactionCount":2}
AUDIT_FINDING {"code":"F04","goals":0,"activeCents":10000,"orphanGoalId":"g"}
AUDIT_FINDING {"code":"F05","accounts":["main"],"reservationAccount":"main","activeCents":10000}
AUDIT_FINDING {"code":"F06","references":["bank-1989051064","bank-267641678"],"fingerprints":["fp-ce283479","fp-ce283479"],"added":1,"duplicates":1}
AUDIT_FINDING {"code":"F07","manualReason":"insufficient-funds","chosenAccountBalance":0,"automaticStatus":"pending","automaticCents":20000}
AUDIT_FINDING {"code":"F08","mainBalanceCents":1000,"reservationAccepted":true,"reservationCents":10000}
AUDIT_FINDING {"code":"F09","resumedCents":8000,"activeCents":16000,"targetCents":10000}
AUDIT_FINDING {"code":"F10","expectedOccurrences":356,"actualOccurrences":120,"expectedCents":35600,"actualCents":12000}
AUDIT_FINDING {"code":"F11","beforeLength":143,"afterLength":20,"sameId":false,"retriggered":1,"totalReservations":2}
AUDIT_FINDING {"code":"F12","input":["1.005","-1.005"],"actual":[1,-1],"expected":[1.01,-1.01]}
```

## Limites et priorités

Les invariants du ledger, les transferts, les centimes usuels, les déductions courantes et les sauvegardes bornées passent. Cela ne valide pas l'authentification, la synchronisation multiappareils, l'ergonomie mobile, ni les autorisations serveur : confiés aux autres volets d'audit. Aucun test sur les données ou comptes de l'utilisateur.

Priorité proposée : corriger F03 (double charge), F05 (réaffectation), F06 (perte à l'import) et F08 (fonds artificiels), puis résoudre les divergences calendaires et l'identité stable. Les TODO sont un registre de défauts ; pour une suite de régression bloquante après correction, retirer leur option `todo`, sans compter une assertion échouée comme une validation.

## Vérification après correctifs locaux — 8 octobre 2026

Les douze constats F01–F12 ont été convertis en tests de régression bloquants et passent dans le worktree actuel. La suite finance ciblée comprend aussi le ledger/stress indépendant. Le `npm test` complet est à **73 réussis, 0 échec, 0 ignoré, 0 TODO**. Les correctifs couvrent notamment la double comptabilisation d'une échéance, la suppression de comptes/projets, les collisions d'import, les réservations par compte et l'identité idempotente des récurrences.

Cette validation est locale et synthétique : elle ne prouve pas l'absence de tout cas financier erroné ni ne reproduit les données de l'incident réel. Les résultats F04/F07 suivent désormais la règle choisie dans le code (libérer la réserve à la suppression; ne pas réserver au-delà des fonds du compte sélectionné); aucun arbitrage produit ne reste ouvert pour ces deux tests. Aucun changement n'a été déployé.
