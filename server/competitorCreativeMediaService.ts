// ── Competitor Creative Media — Lazy Cache (Phase 27, SAFE MODE + Hardening) ─
//
// Safety contract (do not violate):
//   - The ONLY table this file ever CREATEs/INSERTs/UPDATEs is
//     competitor_ad_media, which it owns exclusively.
//   - No bulk downloading, no scheduler, no background caching. Every
//     download + Cloudinary upload happens ONLY when explicitly triggered
//     by an admin (cacheMedia / refreshOriginalMedia).
//   - storeMediaForAd() does NO network I/O — pure metadata persistence.
//   - Only Meta CDN hosts (*.fbcdn.net) may be fetched — SSRF guard enforced
//     before every outbound call.
//   - Downloads are capped: images 25 MB, videos 100 MB.
//   - 403/404/expired URLs set media_status = 'expired'; Cloudinary URL,
//     AI analysis, Creative DNA, and content hash are NEVER deleted.
//   - Never touches CRM, Meta Marketing API, AI Marketing Director, KQS,
//     WhatsApp, Email, Auth/Permissions, or Lead Assignment.

import crypto from "node:crypto";
import { pool } from "./db";
import { uploadBufferUnsigned } from "./cloudinaryService";

export type MediaType = "image" | "video" | "video_poster";

export interface RawMediaItem {
  mediaType: MediaType;
  position: number;
  originalUrl: string;
}

// Hardening: per-type size caps
const MAX_BYTES_IMAGE = 25 * 1024 * 1024;  // 25 MB for images
const MAX_BYTES_VIDEO = 100 * 1024 * 1024; // 100 MB for videos
const FETCH_TIMEOUT_MS = 20000;

function maxBytesFor(mediaType: string): number {
  return mediaType === "video" ? MAX_BYTES_VIDEO : MAX_BYTES_IMAGE;
}

// ── Table bootstrap (additive only) ─────────────────────────────────────────

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
    // Hardening: additive migration — add media_status column if not present
    await client.query(`
      ALTER TABLE competitor_ad_media
        ADD COLUMN IF NOT EXISTS media_status TEXT
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS competitor_ad_media_ad_url_idx
        ON competitor_ad_media(ad_id, original_url)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS competitor_ad_media_hash_idx
        ON competitor_ad_media(content_hash) WHERE content_hash IS NOT NULL
    `);
    console.log("[DB] ensureCompetitorAdMediaTable ✓ (additive, hardening columns applied)");
  } finally {
    client.release();
  }
}

// ── Storing scraped media metadata (no download, no upload) ─────────────────

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
            cache_error, cached_at, media_status, ai_analysis, ai_analysis_generated_at
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
    return host === "fbcdn.net" || host.endsWith(".fbcdn.net");
  } catch {
    return false;
  }
}

// Returns true if the HTTP status looks like an expired/revoked media URL
function isExpiredStatus(status: number): boolean {
  return status === 403 || status === 404 || status === 410 || status === 401;
}

// ── Shared fetch + validate + hash + dedup + upload pipeline ────────────────

async function fetchAndCache(mediaId: number, originalUrl: string, mediaType: string): Promise<{
  ok: boolean;
  media?: any;
  error?: string;
  expired?: boolean;
}> {
  if (!isAllowedMediaHost(originalUrl)) {
    await pool.query(
      `UPDATE competitor_ad_media SET cache_error = $1 WHERE id = $2`,
      ["Rejected: source host is not an allowed Meta CDN domain", mediaId],
    );
    return { ok: false, error: "Source host is not an allowed Meta CDN domain" };
  }

  const maxBytes = maxBytesFor(mediaType);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(originalUrl, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }

  // Hardening: detect expired/revoked Meta CDN URLs
  if (!response.ok) {
    const expired = isExpiredStatus(response.status);
    const errMsg = expired
      ? `Meta media URL expired (HTTP ${response.status})`
      : `Source responded with HTTP ${response.status}`;
    if (expired) {
      await pool.query(
        `UPDATE competitor_ad_media
         SET cache_error = $1, media_status = 'expired'
         WHERE id = $2`,
        [errMsg, mediaId],
      );
    } else {
      await pool.query(
        `UPDATE competitor_ad_media SET cache_error = $1 WHERE id = $2`,
        [errMsg, mediaId],
      );
    }
    return { ok: false, error: errMsg, expired };
  }

  const contentType = response.headers.get("content-type") || "";
  const expectFamily = mediaType === "video" ? "video/" : "image/";
  if (!contentType.startsWith(expectFamily)) {
    const errMsg = `Unexpected content-type "${contentType}" for ${mediaType}`;
    await pool.query(
      `UPDATE competitor_ad_media SET cache_error = $1 WHERE id = $2`,
      [errMsg, mediaId],
    );
    return { ok: false, error: errMsg };
  }

  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader && Number(contentLengthHeader) > maxBytes) {
    const errMsg = `Media too large (${Number(contentLengthHeader)} bytes > ${maxBytes} byte limit) — skipped`;
    await pool.query(
      `UPDATE competitor_ad_media SET cache_error = $1 WHERE id = $2`,
      [errMsg, mediaId],
    );
    return { ok: false, error: errMsg };
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > maxBytes) {
    const errMsg = `Media too large (${arrayBuffer.byteLength} bytes > ${maxBytes} byte limit) — skipped`;
    await pool.query(
      `UPDATE competitor_ad_media SET cache_error = $1 WHERE id = $2`,
      [errMsg, mediaId],
    );
    return { ok: false, error: errMsg };
  }
  const buffer = Buffer.from(arrayBuffer);

  const contentHash = crypto.createHash("sha256").update(buffer).digest("hex");

  // Content dedup: reuse existing Cloudinary URL for identical bytes
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
    const resourceType = mediaType === "video" ? "video" : "image";
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
         cached = TRUE, cache_error = NULL, cached_at = NOW(), media_status = NULL
     WHERE id = $4
     RETURNING *`,
    [contentHash, cloudinaryUrl, cloudinaryPublicId, mediaId],
  );

  return { ok: true, media: updated.rows[0] };
}

// ── Lazy-cache: triggered only by admin opening a creative ───────────────────

export async function cacheMedia(mediaId: number): Promise<{
  ok: boolean;
  media?: any;
  error?: string;
}> {
  const media = await getMediaById(mediaId);
  if (!media) return { ok: false, error: "Media item not found" };

  if (media.cached && media.cloudinary_url) {
    // Already cached — reuse, never re-download.
    return { ok: true, media };
  }

  try {
    return await fetchAndCache(mediaId, media.original_url, media.media_type);
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

// ── Refresh Original Media — manual admin-triggered only ─────────────────────
//
// Re-attempts the original Meta CDN URL for a specific media item.
// If the URL is still alive: clears expired status (Cloudinary URL preserved).
// If still expired/dead: updates media_status = 'expired'.
// Cloudinary URL, AI analysis, Creative DNA, and content hash are NEVER
// deleted regardless of outcome.

export async function refreshOriginalMedia(mediaId: number): Promise<{
  ok: boolean;
  media?: any;
  error?: string;
  expired?: boolean;
}> {
  const media = await getMediaById(mediaId);
  if (!media) return { ok: false, error: "Media item not found" };

  try {
    if (media.cached && media.cloudinary_url) {
      // Already has Cloudinary copy — just probe the original URL to see if it
      // has recovered, and clear expired status if so. No re-upload.
      if (!isAllowedMediaHost(media.original_url)) {
        return { ok: false, error: "Source host is not an allowed Meta CDN domain" };
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(media.original_url, {
          method: "HEAD",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (response.ok) {
        // Original URL is alive again — clear expired status
        const updated = await pool.query(
          `UPDATE competitor_ad_media
           SET media_status = NULL, cache_error = NULL, cached_at = NOW()
           WHERE id = $1 RETURNING *`,
          [mediaId],
        );
        return { ok: true, media: updated.rows[0] };
      } else {
        const expired = isExpiredStatus(response.status);
        await pool.query(
          `UPDATE competitor_ad_media SET media_status = $1 WHERE id = $2`,
          [expired ? "expired" : media.media_status, mediaId],
        );
        return {
          ok: false,
          error: `Original Meta URL still returning HTTP ${response.status}`,
          expired,
          media: await getMediaById(mediaId),
        };
      }
    } else {
      // Not yet cached — attempt full cache pipeline
      return await fetchAndCache(mediaId, media.original_url, media.media_type);
    }
  } catch (err: any) {
    const message = err?.message || String(err);
    console.error(`[CompetitorCreativeMedia] Refresh failed for media ${mediaId}:`, message);
    return { ok: false, error: message };
  }
}
