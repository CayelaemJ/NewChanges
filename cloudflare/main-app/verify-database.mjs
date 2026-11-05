// Effective grants, not intended GRANT statements, determine eligibility.
export function verifyDatabaseIdentity(row,{allowWrites=false,provider='neon'}={}){
  if (!row || typeof row!=="object") return {ok:false};
  const role = String(row.role_name||"");
  const restricted =
    role.length>0 &&
    !["newchanges_cf_migration_reader","newchanges_owner","avnadmin"].includes(role) &&
    ((provider==="neon" && row.database_name==="newchanges") ||
      (provider==="aiven" && row.database_name==="defaultdb")) &&
    row.is_superuser===false &&
    row.can_create_database===false &&
    row.can_create_roles===false &&
    row.bypasses_rls===false &&
    row.member_superuser===false &&
    row.member_privileged_role===false &&
    row.member_application_owner===false &&
    row.can_create_database_objects===false &&
    row.can_create_public_objects===false &&
    row.can_read_session===true &&
    row.can_read_employer===true;
  // Standby must have no effective public-table or sequence write grants.
  // A separately approved writer must still be a non-owner, non-superuser role.
  const permissions=allowWrites
    ? row.can_write_session===true && row.can_write_any_public_table===true
    : row.can_write_session===false &&
      row.can_write_any_public_table===false &&
      row.can_use_or_update_public_sequence===false;
  return {ok:restricted && permissions};
}
