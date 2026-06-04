import pg from "pg";
const { Pool } = pg;

const connString = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
const pool = new Pool({ connectionString: connString });

const DEFAULT_PROJECTS = [
  "Ambassadori",
  "Artex",
  "Grand Sapphire Blu",
  "Silk Tower",
  "Lamborghini",
  "Strada",
  "Green Garden",
  "Emmar Tbilisi",
  "Emmar Batumi",
  "Monte Villas",
  "Miramar",
  "Magnolia",
  "Archi - Ally",
  "Petra Resort",
  "Alphica",
  "Lux Project",
  "Panorama",
  "Tekto Franko",
  "Dream Land",
  "Swiss Village",
  "Next Collection",
  "Next Apartment",
  "Next Garden",
  "Radisson Blu",
  "Wyndham by Next",
  "Rotana",
  "Next Address",
  "Oval",
  "Cube",
  "Orbi",
  "White Sails",
  "Batumi View",
  "Elite Holding Tbilisi",
  "Dighomi 3",
  "Okto",
  "Noyanlar",
  "Cyprus Construction",
];

async function run() {
  const client = await pool.connect();
  try {
    console.log("[seed-crm-projects] Seeding default CRM projects...");

    let inserted = 0;
    let skipped = 0;

    for (let i = 0; i < DEFAULT_PROJECTS.length; i++) {
      const name = DEFAULT_PROJECTS[i];
      const existing = await client.query(
        "SELECT id FROM crm_projects WHERE LOWER(name) = LOWER($1)",
        [name]
      );
      if (existing.rows.length > 0) {
        console.log(`  [skip] "${name}" already exists`);
        skipped++;
      } else {
        await client.query(
          "INSERT INTO crm_projects (name, is_active, sort_order) VALUES ($1, TRUE, $2)",
          [name, i + 1]
        );
        console.log(`  [add]  "${name}"`);
        inserted++;
      }
    }

    console.log(`\n[seed-crm-projects] ✅ Done — ${inserted} inserted, ${skipped} skipped`);
  } catch (err) {
    console.error("[seed-crm-projects] ❌ Failed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
