// Supabase adapter of the analysis audit (migration 015). Writes only through the server's privileged
// client and only through the two service_role RPCs, which re-check that the user belongs to the
// prospect's organization. The user id is bound once, from the JWT the server verified — an entry naming
// any other user is refused before reaching the database.
import type {SupabaseClient} from '@supabase/supabase-js';
import {checked} from './repository.ts';
import type {AnalysisAudit} from './website-analysis.ts';

export function createSupabaseAnalysisAudit(writer: SupabaseClient, verifiedUserId: string): AnalysisAudit {
 const same = (userId: string) => { if (userId !== verifiedUserId) throw Error('AUDIT_USER_MISMATCH'); };
 return {
  async record(e) { same(e.userId); return String(await checked(writer.rpc('record_website_analysis', {p_user_id: verifiedUserId, p_prospect_id: e.prospectId, p_host: e.host, p_mode: e.mode, p_outcome: e.outcome}))); },
  async complete(id, userId, outcome, pages, failed) { same(userId); await checked(writer.rpc('complete_website_analysis', {p_audit_id: id, p_user_id: verifiedUserId, p_outcome: outcome, p_pages: pages, p_failed: failed})); },
 };
}
