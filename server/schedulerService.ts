import cron from "node-cron";
import { sendBulkEmail } from "./emailService";
import { sendBulkWhatsApp } from "./whatsappNotificationService";

export function startScheduler() {
  // Weekly update — every Monday at 9:00 AM
  cron.schedule("0 9 * * 1", async () => {
    console.log("[Scheduler] Running weekly update notifications...");
    await Promise.all([
      sendBulkEmail("weekly_update"),
      sendBulkWhatsApp("weekly_update"),
    ]);
  });

  // Inactive reminder — every day at 10:00 AM (checks 30+ day inactive users)
  cron.schedule("0 10 * * *", async () => {
    console.log("[Scheduler] Running inactive user reminders...");
    await Promise.all([
      sendBulkEmail("inactive_reminder"),
      sendBulkWhatsApp("inactive_reminder"),
    ]);
  });

  console.log("[Scheduler] Started — weekly updates (Mon 9AM), inactive reminders (daily 10AM)");
}
