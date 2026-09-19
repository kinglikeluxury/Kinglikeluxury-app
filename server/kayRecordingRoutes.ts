import type { Express, Request, Response } from "express";
import { requireKayAdmin } from "./kayAuth";
import {
  getKayRecordingArchiveView,
  getKayRecordingPlaybackUrl,
  getKayRecording,
  isSupervisedKayEmployee,
  listKayRecordings,
} from "./kayRecordingService";

function sendKayRecordingError(res: Response, error: any) {
  const status = Number.isInteger(error?.status) ? error.status : 503;
  return res.status(status).json({
    message: error?.message || "Kay recording metadata is unavailable.",
    code: error?.code || "KAY_RECORDING_METADATA_UNAVAILABLE",
  });
}

function parseId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Administrative read-only archive routes. Every metadata and playback request
 * reuses the live Kay admin gate; the client cannot bypass it with a direct URL.
 */
export function registerKayRecordingRoutes(app: Express) {
  app.get("/api/admin/kay/recordings", requireKayAdmin, async (req: any, res) => {
    try {
      const employeeId = req.query.employeeId === undefined ? undefined : parseId(req.query.employeeId);
      if (req.query.employeeId !== undefined) {
        if (employeeId == null) {
          return res.status(403).json({ message: "Recording archive is limited to Samer, Fadi, and Jwana." });
        }
        if (!isSupervisedKayEmployee(employeeId)) {
          return res.status(403).json({ message: "Recording archive is limited to Samer, Fadi, and Jwana." });
        }
      }
      const view = await getKayRecordingArchiveView();
      if (employeeId === undefined) return res.json(view);
      const scopedEmployeeId = employeeId as number;
      return res.json({
        ...view,
        recordings: view.recordings.filter((row: any) => Number(row.employee_id) === scopedEmployeeId),
        managerDebriefs: [],
      });
    } catch (error) {
      return sendKayRecordingError(res, error);
    }
  });

  app.get("/api/admin/kay/manager-debriefs", requireKayAdmin, async (_req, res) => {
    try {
      const rows = await listKayRecordings({ archiveType: "MANAGER_DEBRIEF" });
      return res.json({
        archiveType: "MANAGER_DEBRIEF",
        recordings: rows,
        controls: { employeeStop: false, employeeDelete: false, consentFlow: false },
      });
    } catch (error) {
      return sendKayRecordingError(res, error);
    }
  });

  app.get("/api/admin/kay/recordings/:id", requireKayAdmin, async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid recording id." });
    try {
      const recording = await getKayRecording(id);
      if (!recording) return res.status(404).json({ message: "Recording not found." });
      return res.json({ recording });
    } catch (error) {
      return sendKayRecordingError(res, error);
    }
  });

  app.get("/api/admin/kay/recordings/:id/play", requireKayAdmin, async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid recording id." });
    try {
      const url = await getKayRecordingPlaybackUrl(id, "inline");
      res.setHeader("Cache-Control", "private, no-store");
      return res.redirect(302, url);
    } catch (error) {
      return sendKayRecordingError(res, error);
    }
  });

  app.get("/api/admin/kay/recordings/:id/download", requireKayAdmin, async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid recording id." });
    try {
      const url = await getKayRecordingPlaybackUrl(id, "attachment");
      res.setHeader("Cache-Control", "private, no-store");
      return res.redirect(302, url);
    } catch (error) {
      return sendKayRecordingError(res, error);
    }
  });
}