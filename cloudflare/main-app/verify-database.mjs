// Effective grants, not intended GRANT statements, determine eligibility.
export function verifyDatabaseIdentity(row,{allowWrites=false}={}){
  if (!row || typeof row!=="object")return {ok:false};
  const role = String(row.role_name||"");
  const restricted =
    role.length>0 &&
    !["newchanges_cf_migration_reader","newchanges_owner"].includes(role) &&
    row.database_name==="newchanges" &&
    row.is_superuser===false &&
    row.can_create_database===false &&
    row.can_create_roles===false &&
    row.member_superuser===false &&
    row.can_read_session===true &&
    row.can_read_employer===true;
  // Read-only staging cannot be connected with an accidental write-capable
  // identity role. Production requires write grants and separate review gates.
  const permissions=allowWrites ? row.can_write_session===true
                               : row.can_write_session===false;
  return {ok:restricted && permissions};
}
