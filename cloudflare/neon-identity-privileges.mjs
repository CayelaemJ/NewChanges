// Inspect the effective privileges of the CURRENT database connection,
// not the grants an operator intended to apply. Created Neon roles may inherit
// neon_superuser even after narrow explicit grants.
// Never log the role's password, connection URL, raw session rows or login.
const FORBIDDEN_ROLE = "newchanges_cf_migration_reader";
export const IDENTITY_ROLE_AUDIT_SQL = [
  "SELECT current_database() AS database_name,",
  "current_user AS role_name,",
  "r.rolsuper AS is_superuser,",
  "r.rolcreatedb AS can_create_database,",
  "r.rolcreaterole AS can_create_roles,",
  "pg_has_role(r.oid, 'neon_superuser', 'MEMBER') AS member_of_neon_superuser,",
  "has_table_privilege(current_user, 'public.\\\"Session\\\"', 'SELECT') AS session_read,",
  "has_table_privilege(current_user, 'public.\\\"User\\\"', 'SELECT') AS user_read,",
  "has_table_privilege(current_user, 'public.\\\"UserEmployer\\\"', 'SELECT') AS user_employer_read,",
  "has_table_privilege(current_user, 'public.\\\"Session\\\"', 'INSERT') AS session_write,",
  "has_table_privilege(current_user, 'public.\\\"Employer\\\"', 'SELECT') AS employer_read",
  "FROM pg_roles AS r WHERE r.rolname = current_user"
].join(" ");

export function verifyNeonIdentityPrivileges(row){
  const violations=[];
  if(!row||typeof row!=="object")violations.push("Missing role audit evidence");
  else {
    if(row.database_name!=="newchanges")violations.push("Wrong primary database");
    if(!row.role_name||row.role_name===FORBIDDEN_ROLE)violations.push("Prohibited or unnamed identity role");
    if(row.is_superuser!==false||row.can_create_database!==false||
      row.can_create_roles!==false||row.member_of_neon_superuser!==false)
      violations.push("Elevated PostgreSQL privileges");
    if(row.session_read!==true||row.user_read!==true||row.user_employer_read!==true)
      violations.push("Required session tables are inaccessible");
    if(row.session_write!==false||row.employer_read!==false)
      violations.push("Reader can write sessions or access unrelated employer data");
  }
  return {allowed:violations.length===0,violations};
}

export async function requireNeonIdentityReader(prisma){
  if(typeof prisma?.$queryRaw!=="function")throw new Error("Cannot audit current DB connection");
  // Tagged SQL literal; the query is constant and has no user-supplied input.
  const rows=await prisma.$queryRaw`SELECT current_database() AS database_name,
    current_user AS role_name, r.rolsuper AS is_superuser,
    r.rolcreatedb AS can_create_database, r.rolcreaterole AS can_create_roles,
    pg_has_role(r.oid, 'neon_superuser', 'MEMBER') AS member_of_neon_superuser,
    has_table_privilege(current_user, 'public."Session"', 'SELECT') AS session_read,
    has_table_privilege(current_user, 'public."User"', 'SELECT') AS user_read,
    has_table_privilege(current_user, 'public."UserEmployer"', 'SELECT') AS user_employer_read,
    has_table_privilege(current_user, 'public."Session"', 'INSERT') AS session_write,
    has_table_privilege(current_user, 'public."Employer"', 'SELECT') AS employer_read
    FROM pg_roles AS r WHERE r.rolname = current_user`;
  const policy=verifyNeonIdentityPrivileges(Array.isArray(rows)?rows[0]:null);
  if(!policy.allowed)throw new Error("Connection cannot pass restricted Neon identity role audit");
  return true;
}
