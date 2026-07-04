// ── Competitor Creative Media — Lazy Cache (Phase 27, SAFE MODE) ────────────
//
// Safety contract (do not violate):
//   - The ONLY table this file ever CREATEs/INSERTs/UPDATEs is
//     competitor_ad_media, which it owns exclusively.
//   - No bulk downloading, no scheduler, no background caching. Every
//     download + Cloudinary upload here happens ONLY when explicitly
//     triggered by an admin opening a specific creative (cacheMedia()).
//   - Storing original media URLs at scrape time (storeMediaForAd) does NOT
//     download or upload anything — it is pure metadata persistence.
//   - Only Meta CDN hosts (*.fbcdn.net) may be fetched from — every other
//     host is rejected before any network call is made (SSRF guard).
//   - Downloads are capped at MAX_BYTES; oversized or wrong-content-type
//     responses are rejected without ever reaching Cloudinary.
//   - Never touches CRM, Meta Marketing API, AI Marketing Director, KQS,
//     WhatsApp, Email, Auth/Permissions, or Lead Assignment tables/routes.

import crypto from "node:crypto";
import { pool } from "./db";
import { uploadBufferUnsigned } from "./cloudinaryService";

export type MediaType = "image" | "video" | "video_poster";

export interface RawMediaItem {
  mediaType: MediaType;
  position: number;
  originalUrl: string;
}

const MAX_BYTES = 25 * 1024 * 1024; // 25MB hard cap for any single download
const FETCH_TIMEOUT_MS = 20000;

// ── Table bootstrap (new table only, additive) ──────────────────────────────

export async function ensureCompetitorAdMediaTable(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS competitor_ad_media (
        id                        SERIAL PRIMARY KEY,
        ad_id                     INTEGER REFERENCES competitor_ads(id) ON DELETE CASCADE,
        media_type                TEXT NOT NULL,
        position                  INTEGER NOT NULL DEFAULT 0,
        original_url              TEXT NOT NULL,
        content_hash              TEXT,
        cloudinary_url            TEXT,
        cloudinary_public_id      TEXT,
        cached                    BOOLEAN NOT NULL DEFAULT FALSE,
        cache_error               TEXT,
        cached_at                 TIMESTAMPTZ,
        ai_analysis               JSONB,
        ai_analysis_generated_at  TIMESTAMPTZ,
        created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS competitor_ad_media_ad_url_idx
        ON competitor_ad_media(ad_id, original_url)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS competitor_ad_media_hash_idx
        ON competitor_ad_media(content_hash) WHERE content_hash IS NOT NULL
    `);
    console.log("[DB] ensureCompetitorAdMediaTable \u2713 (additive, new table only)");
  } finally {
    client.release();
  }
}

// ── Storing scraped media metadata (no download, no upload) ────────────────

export async function storeMediaForAd(adId: number, items: RawMediaItem[]): Promise<void> {
  if (!items || items.length === 0) return;
  for (const item of items) {
    if (!item.originalUrl) continue;
    try {
      await pool.query(
        `INSERT INTO competitor_ad_media (ad_id, media_type, position, original_url)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (ad_id, original_url) DO NOTHING`,
        [adId, item.mediaType, item.position, item.originalUrl],
      );
    } catch (err) {
      console.error("[CompetitorCreativeMedia] Failed to store media item:", err);
    }
  }
}

export async function getMediaForAd(adId: number) {
  const res = await pool.query(
    `SELECT id, ad_id, media_type, position, original_url, cloudinary_url, cached,
            cache_error, cached_at, ai_analysis, ai_analysis_generated_at
     FROM competitor_ad_media WHERE ad_id = $1 ORDER BY media_type, position ASC`,
    [adId],
  );
  return res.rows;
}

export async function getMediaById(mediaId: number) {
  const res = await pool.query(`SELECT * FROM competitor_ad_media WHERE id = $1`, [mediaId]);
  return res.rows[0] || null;
}

// ── SSRF guard: only Meta CDN hosts are ever fetched ────────────────────────

function isAllowedMediaHost(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    // Meta's ad-library media is always served from *.fbcdn.net
    // (e.g. scontent.xx.fbcdn.net, video.xx.fbcdn.net, external.xx.fbcdn.net).
    return host === "fbcdn.net" || host.endsWith(".fbcdn.net");
  } catch {
    return false;
  }
}

// ── Lazy-cache: download → validate → hash → dedup → upload (on-demand only) ─

export async function cacheMedia(mediaId: number): Promise<{
  ok: boolean;
  media?: any;
  error?: string;
}> {
  const media = await getMediaById(mediaId);
  if (!media) return { ok: false, error: "Media item not found" };

  if (media.cached && media.cloudinary_url) {
    // Already cached — reuse, never re-download or re-upload.
    return { ok: true, media };
  }

  if (!isAllowedMediaHost(media.original_url)) {
    await pool.query(
      `UPDATE competitor_ad_media SET cache_error = $1 WHERE id = $2`,
      ["Rejected: source host is not an allowed Meta CDN domain", mediaId],
    );
    return { ok: false, error: "Source host is not an allowed Meta CDN domain" };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(media.original_url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`Source responded with HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    const expectFamily = media.media_type === "video" ? "video/" : "image/";
    if (!contentType.startsWith(expectFamily)) {
      throw new Error(`Unexpected content-type "${contentType}" for ${media.media_type}`);
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader && Number(contentLengthHeader) > MAX_BYTES) {
      throw new Error(
        `Media too large (${Number(contentLengthHeader)} bytes > ${MAX_BYTES} byte limit) — skipped`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_BYTES) {
      throw new Error(
        `Media too large (${arrayBuffer.byteLength} bytes > ${MAX_BYTES} byte limit) — skipped`,
      );
    }
    const buffer = Buffer.from(arrayBuffer);

    const contentHash = crypto.createHash("sha256").update(buffer).digest("hex");

    // Dedup: if this exact content was already cached elsewhere, reuse it —
    // never upload the same asset to Cloudinary twice.
    const existing = await pool.query(
      `SELECT cloudinary_url, cloudinary_public_id FROM competitor_ad_media
       WHERE content_hash = $1 AND cached = TRUE AND cloudinary_url IS NOT NULL
       LIMIT 1`,
      [contentHash],
    );

    let cloudinaryUrl: string;
    let cloudinaryPublicId: string | null = null;

    if (existing.rows.length > 0) {
      cloudinaryUrl = existing.rows[0].cloudinary_url;
      cloudinaryPublicId = existing.rows[0].cloudinary_public_id;
    } else {
      const resourceType = media.media_type === "video" ? "video" : "image";
      const uploaded = await uploadBufferUnsigned(buffer, {
        folder: "kinglike/competitor-creatives",
        resourceType,
      });
      cloudinaryUrl = uploaded.secureUrl;
      cloudinaryPublicId = uploaded.publicId;
    }

    const updated = await pool.query(
      `UPDATE competitor_ad_media
       SET content_hash = $1, cloudinary_url = $2, cloudinary_public_id = $3,
           cached = TRUE, cache_error = NULL, cached_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [contentHash, cloudinaryUrl, cloudinaryPublicId, mediaId],
    );

    return { ok: true, media: updated.rows[0] };
  } catch (err: any) {
    const message = err?.message || String(err);
    console.error(`[CompetitorCreativeMedia] Failed to cache media ${mediaId}:`, message);
    await pool.query(
      `UPDATE competitor_ad_media SET cache_error = $1 WHERE id = $2`,
      [message, mediaId],
    );
    return { ok: false, error: message };
  }
}
