# Bloc 2 — Discovery Engine

## Audit / réemploi
Base 892b2fc : Next.js 16 / React 19, JWT Supabase, organization_id, FK composites. Réutiliser src/domain/core.ts sans changement de poids ni score, src/server/db.ts, tables prospects/evidence/channels/events. Ajouter une migration incrémentale, ne pas réexécuter schema.sql sur une base existante.

## Contrats
- DiscoveryProvider : id, mode (live/test), searchCompanies(input), fetchCompanyDetails(candidate), normalizeResult(raw).
- Candidate : name, canonical_url nullable, website nullable, city nullable, address nullable, phone nullable, discovered_source, source_url, source_title, discovery_timestamp, confidence, raw_metadata, deduplication_key.
- Services séparés : DiscoveryService, CompanyAnalysisService, ObservationService, EvidenceProposalService, DeduplicationService.
- API conforme /api/v1 : POST projects/:id/discovery ; GET discovery-runs/:id[/results] ; POST discovery-results/:id/accept|ignore ; POST prospects/:id/analyze ; GET prospects/:id/observations ; POST prospects/:id/observations/:oid/confirm|contradict|unverify.
- Observations : criterion (clé V0 ou null pour contexte), observation_type, claim, value boolean|null, status OBSERVED/UNKNOWN/INFERRED/CONTRADICTED, source_url, source_title, source_excerpt, source_type, confidence, collected_at, expires_at, content_hash. Chaque proposition crée une evidence NOT_VERIFIED, jamais VERIFIED. Confirmation humaine via RPC, même evidence mise à jour lors d’une contradiction. Aucune absence de click&collect inférée d’un silence ; livraison directe ne prouve pas livreurs internes.
- Tables nouvelles : discovery_runs, discovery_results, prospect_observations, et quotas privés atomiques configurables administrateur. FK composites organization_id ; conserver ce nom tenant V0.
- Provider de test déterministe explicitement étiqueté, utilisable sans clé. Brave implémenté mais inactif sans clé ; pas de fausse promesse de recherche réelle. Jeu public Foodatoi conservé séparément des fixtures synthétiques.

## Étapes
1. Sécurité HTTP : DNS validé et fixé à la socket, IPv4/IPv6 privées et réservées interdites, redirects revérifiés, timeout total, réponse limitée, aucun JS, robots et autorisation explicite des hôtes.
2. Types Zod stricts, déduplication prudente (domaine/phone puis nom+adresse, nom+ville et fuzzy seulement revue), extraction sourcée, providers test/Brave.
3. Migration SQL, RLS et RPC atomiques : quotas, acceptation idempotente, persistance des observations et revue ; tests PostgreSQL.
4. Services métier + routes, composant Discovery ajouté à la page V0, revue observations dans fiche existante.
5. Tests sans Internet, build, revue indépendante, README/SECURITY/VERIFY_DISCOVERY et livraison ZIP.

## Vérification
Tests DNS/redirects/limites, signaux et UNKNOWN, aucun VERIFIED automatique, critères/score V0 inchangés, doublons, fake provider complet, confirmation/contradiction/score, quotas, deux tenants. Providers réels et navigateur : noter précisément ce qui est réellement exécuté.
