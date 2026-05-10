import pg from 'pg';
import { v2 as cloudinary } from 'cloudinary';
import fetch from 'node-fetch';
import { createWriteStream, unlinkSync } from 'fs';
import { pipeline } from 'stream/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const { Client } = pg;

const knownCloudName = "dmfy0mz7g";
const knownApiKey = "128179551742346";
const vars = [
  process.env.CLOUDINARY_CLOUD_NAME,
  process.env.CLOUDINARY_API_KEY,
  process.env.CLOUDINARY_API_SECRET,
].filter(Boolean);
const cloudName = vars.find(v => v === knownCloudName) || knownCloudName;
const apiKey = vars.find(v => v === knownApiKey) || knownApiKey;
const apiSecret = vars.find(v => v !== knownCloudName && v !== knownApiKey);

cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret,
  secure: true,
});

const RAILWAY_DB_URL = process.env.TARGET_DB || process.env.DATABASE_URL;
const REPLIT_BASE = 'http://localhost:5000';

async function downloadImage(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  await pipeline(res.body, createWriteStream(destPath));
}

async function uploadToCloudinary(filePath, publicId) {
  return cloudinary.uploader.upload(filePath, {
    folder: 'kinglike/photos',
    public_id: publicId,
    overwrite: false,
  });
}

async function main() {
  const client = new Client({ connectionString: RAILWAY_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Connected to Railway DB');

  const { rows: properties } = await client.query(
    `SELECT id, title, images FROM properties WHERE images::text LIKE '%/objects/uploads/%'`
  );

  console.log(`Found ${properties.length} properties with old image URLs`);

  for (const prop of properties) {
    console.log(`\nProcessing: [${prop.id}] ${prop.title}`);
    const images = prop.images;
    const newImages = [];
    let changed = false;

    for (const imgUrl of images) {
      if (!imgUrl.startsWith('/objects/uploads/')) {
        newImages.push(imgUrl);
        continue;
      }

      const uuid = imgUrl.replace('/objects/uploads/', '');
      const tmpPath = join(tmpdir(), `img_${uuid}.jpg`);

      try {
        const fetchUrl = `${REPLIT_BASE}${imgUrl}`;
        console.log(`  Downloading: ${fetchUrl}`);
        await downloadImage(fetchUrl, tmpPath);

        console.log(`  Uploading to Cloudinary...`);
        const result = await uploadToCloudinary(tmpPath, `migrated_${uuid}`);
        console.log(`  ✅ Done: ${result.secure_url}`);

        newImages.push(result.secure_url);
        changed = true;

        try { unlinkSync(tmpPath); } catch {}
      } catch (err) {
        console.error(`  ❌ Failed for ${imgUrl}: ${err.message}`);
        newImages.push(imgUrl);
      }
    }

    if (changed) {
      await client.query(
        `UPDATE properties SET images = $1::jsonb WHERE id = $2`,
        [JSON.stringify(newImages), prop.id]
      );
      console.log(`  ✅ DB updated for property ${prop.id}`);
    }
  }

  await client.end();
  console.log('\n✅ Migration complete!');
}

main().catch(console.error);
