# Dossier juridique Flōw — suivi du 8 octobre 2026

Ce document est un plan de mise en conformité, pas une attestation. Les points non vérifiés ci-dessous restent ouverts. Ne pas publier de coordonnées, de statut d’entreprise, de localisation d’hébergement ou de garanties inventés.

## Informations confirmées par l’éditeur

- Statut confirmé le 8 octobre 2026 : projet personnel non professionnel de Soren Querrec, réalisé avec l’IA pour aider ses proches et d’autres personnes à suivre leurs dépenses. Aucune entreprise officielle. « Soren Production » était un nom imaginé et n’est pas présenté comme une personne morale ou un nom légal enregistré.
- Contact public autorisé : soren.querrec.0@gmail.com.
- Flōw est un outil de suivi : aucune connexion bancaire automatique, aucun paiement, aucun virement réel. Les réservations sont virtuelles.

## Actions dans l’application

- La politique de confidentialité comporte désormais une adresse de contact utilisable pour l’accès, la correction et l’effacement.
- La notice décrit désormais l’authentification e-mail/mot de passe (pas Google), les copies locales, Firestore, le partage et les limites de l’effacement. Un résumé avec lien apparaît avant l’authentification. Cela améliore l’information mais ne suffit pas à valider toutes les mentions obligatoires.
- Présenter un résumé de confidentialité et un lien vers la notice avant l’inscription ou la connexion Firebase ; distinguer stockage local, synchronisation et partage volontaire.
- Conserver les crédits de Soren Querrec, de l’assistance GPT/Codex et les remerciements à Hana_is, sans les présenter comme une certification.
- Ne pas annoncer un effacement global lorsqu’il ne porte que sur la copie locale ou l’état personnel cloud. Le compte Auth est partagé avec Sōlo ; les espaces partagés et les sous-collections nécessitent un périmètre explicite.

## Registre des traitements à finaliser

| Traitement | Données / destinataires | Finalité | Décisions et preuves manquantes |
|---|---|---|---|
| Utilisation locale | Comptes, opérations, projets, préférences dans le navigateur | Suivi demandé par l’utilisateur | Vérifier le périmètre des caches et copies de conflit ; ne pas assimiler l’export à une sauvegarde chiffrée |
| Authentification facultative | E-mail, identifiant et données techniques chez Firebase Authentication | Connexion et récupération d’accès | Documenter la base légale retenue, les conditions du service et le contrat du prestataire |
| Synchronisation facultative | État financier chez Firestore, accès technique des administrateurs | Retrouver les données sur plusieurs appareils | Vérifier région réelle, sous-traitants, transferts, garanties et durées effectives ; aucune preuve de chiffrement de bout en bout |
| Partage volontaire | Résumé partagé, membres, droits et invitations | Collaboration dans l’espace choisi | Nettoyer et révoquer les anciens codes exposés ; documenter conservation des preuves privées et retrait des accès |
| Rappels push optionnels | Identifiant, abonnement de l’appareil, types/dates chez le relais et le service push | Livraison des rappels choisis | Service actuellement désactivé dans la configuration versionnée ; vérifier contrat, localisation et effacement avant activation |
| Hébergement et ressources distantes | Requêtes techniques vers GitHub Pages, Firebase et les services de polices | Affichage et fonctionnement du site | Vérifier fournisseurs réels, journaux, durées, clauses contractuelles et éventuels transferts |

Ne pas utiliser un consentement générique pour couvrir indistinctement ces traitements. La base légale doit être choisie et documentée pour chaque finalité avant la notice définitive. L’autorisation du navigateur pour les notifications ne règle pas à elle seule toutes les obligations RGPD.

## Points indispensables restant à obtenir

1. Statut personnel non professionnel désormais confirmé. La notice publique le précise et nomme le responsable de publication. Ne pas inventer de SIRET ni de société.
2. Informations d’identification/adresse requises selon le statut, et coordonnées vérifiées de l’hébergeur ; aucun renseignement à recopier de mémoire. Ne pas publier une adresse personnelle sans avoir d’abord vérifié l’obligation applicable et les solutions licites de domiciliation/confidentialité.

   Les coordonnées GitHub ont été vérifiées dans sa notice officielle et ajoutées à la page. L’article 1-1 II de la LCEN prévoit une possibilité de confidentialité pour un éditeur non professionnel sous réserve d’avoir transmis les éléments d’identification à l’hébergeur : il reste à vérifier ces éléments avec le titulaire du compte GitHub. Aucune adresse personnelle n’a été publiée automatiquement.
3. Région Firestore effective, contrats de sous-traitance applicables et garanties des éventuels transferts hors UE.
4. Politique de conservation approuvée, en distinguant données actives, invitations, preuves privées, caches, files d’attente et sauvegardes des fournisseurs. Ne pas promettre un nettoyage automatique qui n’est pas implémenté.
5. Procédure testée de réponse aux demandes : vérifier raisonnablement l’identité, limiter les pièces demandées, tracer la demande et le résultat, préciser les données conservées et les copies hors contrôle.
6. Procédure d’incident : préserver les preuves sans publier de données personnelles, qualifier l’atteinte et le risque, examiner les obligations de notification. Une vulnérabilité détectée n’établit pas à elle seule une violation réelle.

## Critères de validation avant publication

- Notice accessible au moment de la collecte et dans les réglages, lisible sur mobile.
- Identité/contact, finalités, bases légales, destinataires, conservation, droits, réclamation et transferts renseignés avec des faits vérifiés.
- Export, rectification, effacement personnel et retrait d’un partage testés ; préciser les limites du compte Auth partagé et des copies des membres.
- Corrections de sécurité testées, règles et clients déployés de façon coordonnée ; révocation des anciennes invitations autorisée et vérifiée séparément.
- Relecture juridique adaptée au statut et au fonctionnement réel, sans prétendre garantir qu’il n’existe aucun risque juridique.

## Sources de référence

- [CNIL — information et transparence](https://www.cnil.fr/fr/conformite-rgpd-information-des-personnes-et-transparence)
- [CNIL — bases légales](https://www.cnil.fr/fr/les-bases-legales)
- [CNIL — informations de l’article 13 RGPD](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre3)
- [CNIL — rôle du responsable et des sous-traitants](https://www.cnil.fr/fr/rgpd-comment-bien-identifier-son-role)
- [Service Public — mentions d’un entrepreneur individuel](https://entreprendre.service-public.gouv.fr/vosdroits/F31228) : à appliquer seulement si ce statut correspond réellement à l’éditeur.
- [Service Public — domicilier une entreprise individuelle](https://entreprendre.service-public.fr/vosdroits/F2160?quest0=0) : précise notamment l’adresse à afficher dans le cas d’un EI; à adapter au statut effectivement retenu.
- [Firebase — confidentialité](https://firebase.google.com/support/privacy) : ne remplace pas la vérification du projet et des contrats applicables.
- [LCEN — dispositions actuelles sur l’identification des éditeurs](https://www.legifrance.gouv.fr/loda/id/LEGISCTA000049570802) : article 1-1, régime non professionnel à vérifier selon le cas.
- [GitHub — coordonnées officielles et confidentialité](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
