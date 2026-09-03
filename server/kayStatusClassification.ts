/**
 * Kay-only interpretation of CRM statuses.  This deliberately never writes a
 * status and defaults new/unrecognised values to review, not automation.
 *
 * Audit notes: the CRM UI exposes no_answer_3 only as a recovery-draft
 * message type (no customer send); no_answer_2 has the WhatsApp follow-up
 * action; no_answer_4 is the later manually/imported attempt stage.  The
 * application therefore has no persisted no_answer_3 CRM status transition.
 */
export type KayStatusClass =
  | "ACTIVE_NEW" | "CONTACT_ATTEMPT" | "RESCUE_ELIGIBLE_STAGE" | "FOLLOW_UP"
  | "INTERESTED" | "CLOSING" | "TERMINAL_SUCCESS" | "TERMINAL_LOSS"
  | "NON_SALES" | "UNKNOWN_REVIEW";

export type KayStatusIntelligence = {
  status: string;
  classification: KayStatusClass;
  terminal: boolean;
  rescueEvaluated: boolean;
  protectedCandidate: boolean;
  description: string;
};

const entry = (status: string, classification: KayStatusClass, description: string, options: Partial<Omit<KayStatusIntelligence, "status" | "classification" | "description">> = {}): KayStatusIntelligence => ({
  status, classification, description, terminal: false, rescueEvaluated: false, protectedCandidate: false, ...options,
});

export const KAY_STATUS_INTELLIGENCE: Readonly<Record<string, KayStatusIntelligence>> = {
  new: entry("new", "ACTIVE_NEW", "New active CRM lead."),
  new_fresh_after_3_no_answer: entry("new_fresh_after_3_no_answer", "ACTIVE_NEW", "Recycled active lead after the three-no-answer workflow."),
  no_answer: entry("no_answer", "CONTACT_ATTEMPT", "Legacy generic no-answer contact attempt; not rescue-evaluated."),
  no_answer_1: entry("no_answer_1", "RESCUE_ELIGIBLE_STAGE", "First no-answer contact attempt.", { rescueEvaluated: true }),
  no_answer_2: entry("no_answer_2", "RESCUE_ELIGIBLE_STAGE", "Second no-answer attempt; the existing workflow has a WhatsApp follow-up side-effect.", { rescueEvaluated: true }),
  no_answer_3: entry("no_answer_3", "UNKNOWN_REVIEW", "Legacy UI/import/manual PATCH compatibility and recovery-draft hook, absent from the current production status model; no automatic customer send."),
  no_answer_4: entry("no_answer_4", "CONTACT_ATTEMPT", "Later manual/import no-answer attempt; no Kay threshold or rescue rule is approved."),
  after_3_no_answer_whatsapp_contacted: entry("after_3_no_answer_whatsapp_contacted", "FOLLOW_UP", "WhatsApp follow-up after the no-answer sequence."),
  no_answer_converted: entry("no_answer_converted", "TERMINAL_LOSS", "Closed for the current-owner rescue workflow after no-answer conversion; this is not a sale-success or employee-performance conclusion.", { terminal: true }),
  follow_up: entry("follow_up", "FOLLOW_UP", "Existing scheduled/waiting follow-up state."),
  will_think: entry("will_think", "FOLLOW_UP", "Customer is considering; a waiting/follow-up state."),
  interested: entry("interested", "INTERESTED", "Interested lead."),
  qualified: entry("qualified", "INTERESTED", "Qualified active lead."),
  hot_buyer: entry("hot_buyer", "INTERESTED", "High-intent buyer; Shadow protection recommendation candidate.", { protectedCandidate: true }),
  entering_lead: entry("entering_lead", "ACTIVE_NEW", "Active intake/entry stage; not a protection recommendation."),
  deposited: entry("deposited", "CLOSING", "Closing-stage deposit; Shadow protection recommendation candidate, not terminal.", { protectedCandidate: true }),
  reserved: entry("reserved", "CLOSING", "Closing-stage reservation; Shadow protection recommendation candidate, not terminal.", { protectedCandidate: true }),
  purchased: entry("purchased", "TERMINAL_SUCCESS", "Purchase completed.", { terminal: true }),
  converted: entry("converted", "TERMINAL_SUCCESS", "CRM conversion completed.", { terminal: true }),
  sold_by_kinglike_luxury: entry("sold_by_kinglike_luxury", "TERMINAL_SUCCESS", "Sale completed by Kinglike Luxury.", { terminal: true }),
  lost: entry("lost", "TERMINAL_LOSS", "Explicitly lost lead.", { terminal: true }),
  lost_competition: entry("lost_competition", "TERMINAL_LOSS", "Explicitly lost to competition.", { terminal: true }),
  not_interested_maybe_later: entry("not_interested_maybe_later", "FOLLOW_UP", "May-contact-later waiting/follow-up state; not terminal."),
  not_qualified: entry("not_qualified", "TERMINAL_LOSS", "Explicitly not qualified.", { terminal: true }),
  junk_lead: entry("junk_lead", "TERMINAL_LOSS", "Explicitly junk/closed lead.", { terminal: true }),
  broker: entry("broker", "NON_SALES", "Broker relationship, not a direct sales lead."),
  agency: entry("agency", "NON_SALES", "Agency relationship, not a direct sales lead."),
  second_hand: entry("second_hand", "NON_SALES", "Second-hand category, not this direct-sales workflow."),
  re_sale: entry("re_sale", "NON_SALES", "Resale category, not this direct-sales workflow."),
};

const unknown = (status: string): KayStatusIntelligence => entry(status, "UNKNOWN_REVIEW", "Unknown CRM status. Kay requires review and will not evaluate Rescue.");
export function getKayStatusIntelligence(status: string | null | undefined): KayStatusIntelligence {
  return KAY_STATUS_INTELLIGENCE[status ?? ""] ?? unknown(status || "(empty)");
}
export function isKayTerminalStatus(status: string | null | undefined): boolean {
  return getKayStatusIntelligence(status).terminal;
}
export function isKayRescueEvaluatedStatus(status: string | null | undefined): boolean {
  return getKayStatusIntelligence(status).rescueEvaluated;
}
export function isKayOrphanEligibleStatus(status: string | null | undefined): boolean {
  const info = getKayStatusIntelligence(status);
  return !info.terminal && info.classification !== "NON_SALES" && info.classification !== "UNKNOWN_REVIEW" && info.classification !== "FOLLOW_UP";
}