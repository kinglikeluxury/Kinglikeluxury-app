import type { WhatsappActor } from "./whatsappInternalAuth";

export interface WhatsappEmployee {
  id: string;
  name: string;
  role: string;
  status: "connected" | "attention" | "disconnected";
  phone: string;
}

export interface WhatsappMessage {
  id: string;
  direction: "incoming" | "outgoing";
  kind: "text" | "media" | "deleted";
  text: string;
  time: string;
  dateLabel: string;
  status?: "sent" | "delivered" | "read";
  media?: { kind: "image" | "video" | "audio" | "file"; name: string };
}

export interface WhatsappConversation {
  id: string;
  employeeId: string;
  customerName: string;
  customerPhone: string;
  unreadCount: number;
  archived?: boolean;
}

export interface WhatsappInternalNote {
  id: string;
  conversationId: string;
  authorId: number;
  text: string;
  createdAt: string;
}

export interface WhatsappPage<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
}

export interface WhatsappListQuery {
  offset: number;
  limit: number;
  search?: string;
  employeeId?: string;
}

export interface WhatsappEmployeeMonitoringRepository {
  listEmployees(actor: WhatsappActor, query: WhatsappListQuery): Promise<WhatsappPage<WhatsappEmployee>>;
  listConversations(actor: WhatsappActor, query: WhatsappListQuery): Promise<WhatsappPage<WhatsappConversation>>;
  getConversationMessages(actor: WhatsappActor, conversationId: string): Promise<{
    conversation: WhatsappConversation;
    messages: WhatsappMessage[];
  }>;
  addInternalNote(actor: WhatsappActor, conversationId: string, text: string): Promise<WhatsappInternalNote>;
}

interface StoredEmployee extends WhatsappEmployee {
  userId: number;
}

interface StoredConversation extends WhatsappConversation {
  messages: WhatsappMessage[];
}

export const MOCK_EMPLOYEE_USER_IDS = {
  samer: 1,
  fadi: 2,
  joanna: 3,
} as const;

const employees: StoredEmployee[] = [
  { id: "samer", userId: MOCK_EMPLOYEE_USER_IDS.samer, name: "Samer", role: "Property Advisor", phone: "+999 555 0101", status: "connected" },
  { id: "fadi", userId: MOCK_EMPLOYEE_USER_IDS.fadi, name: "Fadi", role: "Sales Advisor", phone: "+999 555 0102", status: "attention" },
  { id: "joanna", userId: MOCK_EMPLOYEE_USER_IDS.joanna, name: "Joanna", role: "Client Relations", phone: "+999 555 0103", status: "disconnected" },
];

const conversations: StoredConversation[] = [
  {
    id: "conversation-demo-1",
    employeeId: "samer",
    customerName: "Lina Demo",
    customerPhone: "+999 555 1001",
    unreadCount: 2,
    messages: [
      { id: "message-1", direction: "incoming", kind: "text", text: "مرحباً، أريد معرفة تفاصيل المشروع التجريبي.", time: "09:12", dateLabel: "Today" },
      { id: "message-2", direction: "outgoing", kind: "text", text: "שלום Lina — English follow-up.", time: "09:14", dateLabel: "Today", status: "read" },
      { id: "message-3", direction: "incoming", kind: "deleted", text: "This archived message remains visible.", time: "09:18", dateLabel: "Today" },
    ],
  },
  {
    id: "conversation-unicode-demo",
    employeeId: "samer",
    customerName: "Lia — ליאה — ლეა",
    customerPhone: "+999 555 2005",
    unreadCount: 0,
    messages: [
      { id: "unicode-1", direction: "incoming", kind: "text", text: "مُرحبًا — ליאה — mixed English text", time: "09:30", dateLabel: "Today" },
    ],
  },
  {
    id: "conversation-demo-2",
    employeeId: "fadi",
    customerName: "Alex Sample",
    customerPhone: "+999 555 1002",
    unreadCount: 0,
    archived: true,
    messages: [
      { id: "message-7", direction: "incoming", kind: "text", text: "Could you send the sample floor plan?", time: "Yesterday", dateLabel: "Yesterday" },
    ],
  },
  {
    id: "conversation-demo-3",
    employeeId: "joanna",
    customerName: "Maya Example",
    customerPhone: "+999 555 1003",
    unreadCount: 1,
    messages: [
      { id: "message-9", direction: "incoming", kind: "text", text: "Is the video walkthrough available in English?", time: "11:02", dateLabel: "Today" },
    ],
  },
];

const internalNotes: WhatsappInternalNote[] = [];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length < 4 ? "***" : `${phone.slice(0, 4)}***${phone.slice(-2)}`;
}

function publicEmployee(employee: StoredEmployee): WhatsappEmployee {
  const { userId: _userId, ...safeEmployee } = employee;
  return clone(safeEmployee);
}

function publicConversation(conversation: StoredConversation): WhatsappConversation {
  return clone({ ...conversation, customerPhone: maskPhone(conversation.customerPhone), messages: undefined } as unknown as WhatsappConversation);
}

function ownedEmployeeId(actor: WhatsappActor): string | null {
  if (actor.isAdmin) return null;
  return Object.entries(MOCK_EMPLOYEE_USER_IDS).find(([, userId]) => userId === actor.userId)?.[0] ?? null;
}

function assertCanReadConversation(actor: WhatsappActor, conversation: StoredConversation): void {
  if (actor.isAdmin) return;
  if (ownedEmployeeId(actor) !== conversation.employeeId) {
    throw new Error("Conversation not found");
  }
}

function page<T>(items: T[], total: number, query: WhatsappListQuery): WhatsappPage<T> {
  return {
    items: clone(items),
    total,
    offset: query.offset,
    limit: query.limit,
    nextOffset: query.offset + items.length < total ? query.offset + items.length : null,
  };
}

export class MockWhatsappInternalRepository implements WhatsappEmployeeMonitoringRepository {
  async listEmployees(actor: WhatsappActor, query: WhatsappListQuery): Promise<WhatsappPage<WhatsappEmployee>> {
    if (!actor.isAdmin) throw new Error("Not authorized");
    const rows = employees
      .filter((employee) => !query.search || `${employee.name} ${employee.role}`.toLowerCase().includes(query.search.toLowerCase()))
      .map(publicEmployee);
    return page(rows.slice(query.offset, query.offset + query.limit), rows.length, query);
  }

  async listConversations(actor: WhatsappActor, query: WhatsappListQuery): Promise<WhatsappPage<WhatsappConversation>> {
    const owner = ownedEmployeeId(actor);
    const rows = conversations
      .filter((conversation) => actor.isAdmin || conversation.employeeId === owner)
      .filter((conversation) => !query.employeeId || conversation.employeeId === query.employeeId)
      .filter((conversation) => !query.search || `${conversation.customerName} ${conversation.customerPhone}`.toLowerCase().includes(query.search.toLowerCase()))
      .map(publicConversation);
    return page(rows.slice(query.offset, query.offset + query.limit), rows.length, query);
  }

  async getConversationMessages(actor: WhatsappActor, conversationId: string): Promise<{ conversation: WhatsappConversation; messages: WhatsappMessage[] }> {
    const conversation = conversations.find((item) => item.id === conversationId);
    if (!conversation) throw new Error("Conversation not found");
    assertCanReadConversation(actor, conversation);
    return {
      conversation: publicConversation(conversation),
      messages: clone(conversation.messages),
    };
  }

  async addInternalNote(actor: WhatsappActor, conversationId: string, text: string): Promise<WhatsappInternalNote> {
    if (!actor.isAdmin) throw new Error("Not authorized");
    const conversation = conversations.find((item) => item.id === conversationId);
    if (!conversation) throw new Error("Conversation not found");
    const note: WhatsappInternalNote = {
      id: `internal-note-${internalNotes.length + 1}`,
      conversationId,
      authorId: actor.userId,
      text,
      createdAt: new Date().toISOString(),
    };
    internalNotes.push(note);
    return clone(note);
  }
}

/** Phase 2A deliberately exposes only the in-memory fixture repository. */
export const whatsappInternalRepository: WhatsappEmployeeMonitoringRepository =
  new MockWhatsappInternalRepository();

export function clearMockWhatsappInternalNotes(): void {
  internalNotes.length = 0;
}