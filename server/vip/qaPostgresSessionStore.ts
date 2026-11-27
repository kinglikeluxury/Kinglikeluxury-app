import connectPg from "connect-pg-simple";
import session from "express-session";
import type {Pool} from "pg";

const SESSION_TTL_SECONDS=12*60*60;

/**
 * QA sessions are isolated from the live site's session table and survive
 * process restarts. The table is created by an owner migration; the runtime
 * role must not be allowed to create it.
 */
export function createQaPostgresSessionStore(pool:Pool):session.Store{
  const PgSessionStore=connectPg(session);
  return new PgSessionStore({
    pool,
    schemaName:"public",
    tableName:"vip_qa_sessions",
    createTableIfMissing:false,
    ttl:SESSION_TTL_SECONDS,
    pruneSessionInterval:15*60,
    errorLog:()=>process.stderr.write("VIP QA session store operation failed.\n"),
  });
}
