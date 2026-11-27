import bcrypt from "bcrypt";
import { createHash, randomBytes } from "node:crypto";
import { assertQaDatabaseIdentity, pool } from "../qaPreviewDb";
import { assertQaPreviewConfiguration } from "../qaPreviewRules";

const SYNTHETIC_PASSWORD = "SyntheticQaOnly-Password-418!";

async function main() {
  assertQaPreviewConfiguration();
  await assertQaDatabaseIdentity();

  const users = await pool.query("SELECT COUNT(*)::int AS count FROM users");
  const units = await pool.query("SELECT COUNT(*)::int AS count FROM vip_units");
  const receipts = await pool.query("SELECT COUNT(*)::int AS count FROM vip_receipts");
  if (users.rows[0].count !== 0 || units.rows[0].count !== 0 || receipts.rows[0].count !== 0) {
    throw new Error("QA fixture seeding requires an empty synthetic VIP database");
  }

  const password = await bcrypt.hash(SYNTHETIC_PASSWORD, 8);
  const accounts = [
    { username: "qa_admin", role: "user", isAdmin: true },
    { username: "qa_approver_admin", role: "user", isAdmin: true },
    { username: "qa_buyer_a", role: "user", isAdmin: false },
    { username: "qa_buyer_b", role: "user", isAdmin: false },
    { username: "qa_seller", role: "sub_agent", isAdmin: false },
    { username: "qa_seller_other", role: "sub_agent", isAdmin: false },
    { username: "qa_finance", role: "crm_employee", isAdmin: false },
  ];
  const ids: Record<string, number> = {};
  for (const account of accounts) {
    const result = await pool.query(
      "INSERT INTO users(username,email,password,role,is_verified,is_active,is_admin,auth_method) " +
        "VALUES($1,$2,$3,$4,TRUE,TRUE,$5,'email') RETURNING id",
      [
        account.username,
        `${account.username}@fixture.test`,
        password,
        account.role,
        account.isAdmin,
      ],
    );
    ids[account.username] = Number(result.rows[0].id);
  }

  const project = await pool.query(
    "INSERT INTO vip_projects(name,developer_name) VALUES($1,$2) RETURNING id",
    ["Synthetic QA Project", "Test-only developer"],
  );
  const projectId = Number(project.rows[0].id);
  const unitA = await pool.query(
    "INSERT INTO vip_units(project_id,unit_number) VALUES($1,'QA-A') RETURNING id",
    [projectId],
  );
  const unitB = await pool.query(
    "INSERT INTO vip_units(project_id,unit_number) VALUES($1,'QA-B') RETURNING id",
    [projectId],
  );
  const unitC = await pool.query(
    "INSERT INTO vip_units(project_id,unit_number) VALUES($1,'QA-C') RETURNING id",
    [projectId],
  );
  const unitAId = Number(unitA.rows[0].id);
  const unitBId = Number(unitB.rows[0].id);
  const unitCId = Number(unitC.rows[0].id);
  await pool.query(
    "INSERT INTO vip_unit_access(unit_id,user_id,access_role) VALUES" +
      "($1,$2,'owner'),($3,$4,'owner')",
    [unitAId, ids.qa_buyer_a, unitBId, ids.qa_buyer_b],
  );
  const installment = await pool.query(
    "INSERT INTO vip_installments(unit_id,sequence_number,due_date,amount,currency) " +
      "VALUES($1,1,'2027-12-01',120,'USD') RETURNING id",
    [unitAId],
  );
  const invitationToken = randomBytes(32).toString("hex");
  const invitationHash = createHash("sha256").update(invitationToken).digest("hex");
  await pool.query(
    "INSERT INTO vip_invitations(unit_id,invited_email,token_hash,status,delivery_status," +
      "invited_by,expires_at) VALUES($1,$2,$3,'pending','sent',$4,NOW()+INTERVAL '1 hour')",
    [unitCId, "qa_invited@fixture.test", invitationHash, ids.qa_admin],
  );
  await pool.query(
    "INSERT INTO vip_progress_updates(project_id,percent_complete,stage,note,is_published,updated_by) " +
      "VALUES($1,35,'foundation','Synthetic QA progress',TRUE,$2)",
    [projectId, ids.qa_admin],
  );
  await pool.query(
    "INSERT INTO vip_journey_milestones(unit_id,stage_code,status,planned_date,note,published,updated_by) " +
      "VALUES($1,'construction','in_progress','2027-06-01','Synthetic QA milestone',TRUE,$2)",
    [unitAId, ids.qa_admin],
  );
  await pool.query(
    "INSERT INTO vip_benefits(category,title,details,published,created_by) " +
      "VALUES('after_sales','Synthetic QA benefit','Test-only benefit terms.',TRUE,$1)",
    [ids.qa_admin],
  );
  await pool.query(
    "INSERT INTO vip_exchange_rates(base_currency,quote_currency,rate,effective_date,source," +
      "source_reference,published,created_by,approved_by,approved_at) " +
      "VALUES('USD','GEL',2.7,CURRENT_DATE,'QA fixture','QA-REFERENCE-001',TRUE,$1,$2,NOW())",
    [ids.qa_admin, ids.qa_approver_admin],
  );
  await pool.query(
    "INSERT INTO vip_notifications(user_id,unit_id,event_type,title,body,created_by) " +
      "VALUES($1,$2,'admin_update','Synthetic QA notice','Test-only in-app notice.',$3)",
    [ids.qa_buyer_a, unitAId, ids.qa_admin],
  );
  await pool.query(
    "INSERT INTO vip_handover(unit_id,status,checklist,updated_by) VALUES" +
      "($1,'ready_for_appointment','{}'::jsonb,$3),($2,'handover_approved','{}'::jsonb,$3)",
    [unitAId, unitBId, ids.qa_admin],
  );
  await pool.query(
    "INSERT INTO vip_handover_key_receipts(unit_id,owner_user_id,developer_handover_reference," +
      "approval_note,approved_by,approved_at) VALUES($1,$2,'QA-HANDOVER-001'," +
      "'Synthetic approval fixture only',$3,NOW())",
    [unitBId, ids.qa_buyer_b, ids.qa_admin],
  );
  process.stdout.write(
    JSON.stringify({
      projectId,
      unitAId,
      unitBId,
      unitCId,
      installmentId: Number(installment.rows[0].id),
      invitationToken,
    }) + "\n",
  );
}

main()
  .catch((error) => {
    process.stderr.write(
      "Synthetic VIP browser fixture seeding failed: " +
        (error instanceof Error ? error.message : "unknown error") +
        "\n",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
