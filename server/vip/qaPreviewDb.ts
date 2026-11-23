import pg from "pg";
import {validateQaDatabaseUrl} from "./qaPreviewRules";

const {Pool}=pg;

/**
 * Railway-isolated QA database. Does not and must never accept a Neon URL,
 * a public remote Postgres URL, or any existing production DB credentials.
 * The service is intended ONLY for its own dedicated Railway project.
 */

export const pool=new Pool({
 connectionString:validateQaDatabaseUrl(process.env.KINGLIKE_VIP_QA_DATABASE_URL),
 max:5,connectionTimeoutMillis:4000,idleTimeoutMillis:5000
});
