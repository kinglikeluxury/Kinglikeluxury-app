import {
  MOCK_CONVERSATIONS,
  MOCK_EMPLOYEES,
  type MockConversation,
  type MockEmployee,
  type MockMessage,
} from "./whatsappEmployeeMonitoringMock";

export const WHATSAPP_MONITORING_MODE = "mock" as const;

export interface InternalNoteDraft {
  conversationId: string;
  text: string;
}

export interface WhatsappEmployeeMonitoringRepository {
  readonly mode: typeof WHATSAPP_MONITORING_MODE;
  listEmployees(): MockEmployee[];
  listConversations(): MockConversation[];
  getConversationMessages(conversationId: string): MockMessage[];
  addInternalNote(note: InternalNoteDraft): { id: string; persistence: "memory_until_restart" };
}

const internalNotes: InternalNoteDraft[] = [];

export const whatsappMonitoringRepository: WhatsappEmployeeMonitoringRepository = {
  mode: WHATSAPP_MONITORING_MODE,
  listEmployees: () => MOCK_EMPLOYEES.map((employee) => ({ ...employee })),
  listConversations: () => MOCK_CONVERSATIONS.map((conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => ({ ...message })),
  })),
  getConversationMessages: (conversationId) =>
    MOCK_CONVERSATIONS.find((conversation) => conversation.id === conversationId)?.messages.map((message) => ({ ...message })) ?? [],
  addInternalNote: (note) => {
    internalNotes.push({ ...note });
    return { id: `mock-internal-note-${internalNotes.length}`, persistence: "memory_until_restart" };
  },
};

/** Explicit Mock Mode: notes are never written to localStorage or a network service. */
export function getMockInternalNotes(): readonly InternalNoteDraft[] {
  return internalNotes.map((note) => ({ ...note }));
}