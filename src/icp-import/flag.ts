// ICP import kill switch (docs/ICP_IMPORT.md §Interrupteur). Server-side, OFF unless ICP_IMPORT_ENABLED is "true"/"1".
// OFF: the /icp-imports routes answer 404 before reading anything (no body, no database, no provider), and the browser
// is told only a boolean (account.icp_import_enabled), so the « Importer mon entreprise » screen is not rendered. It must
// stay OFF wherever migration 041 is not applied: the table and its functions do not exist there.
export function icpImportEnabled(env:Record<string,string|undefined>):boolean{
 const v=(env.ICP_IMPORT_ENABLED??'').trim().toLowerCase();
 return v==='true'||v==='1';
}
