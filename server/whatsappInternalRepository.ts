import type { WhatsappActor } from "./whatsappInternalAuth";

export interface WhatsappEmployee {
  id: string;
  name: string;
  role: string;
  status: "connected" | "attention" | "disconnected";
  phone: string;
  avatar: { initials: string; color: string };
}

export interface WhatsappMessage {
  id: string;
  direction: "incoming" | "outgoing";
  kind: "text" | "media" | "deleted";
  text: string;
  time: string;
  dateLabel: string;
  status?: "sent" | "delivered" | "read";
  media?: {
    kind: "image" | "video" | "audio" | "file";
    name: string;
    size?: string;
    durationSeconds?: number;
    mimeType: string;
    url: string;
  };
}

export interface WhatsappConversation {
  id: string;
  employeeId: string;
  customerName: string;
  customerPhone: string;
  unreadCount: number;
  archived?: boolean;
  avatar: { initials: string; color: string };
  hasDeletedMessages: boolean;
  hasMedia: boolean;
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
}

interface StoredConversation extends WhatsappConversation {
  messages: WhatsappMessage[];
}

const employees: StoredEmployee[] = [
  { id: "samer", name: "Samer", role: "Property Advisor", phone: "+999 555 0101", status: "connected", avatar: { initials: "SA", color: "#3bcac4" } },
  { id: "fadi", name: "Fadi", role: "Sales Advisor", phone: "+999 555 0102", status: "attention", avatar: { initials: "FA", color: "#005476" } },
  { id: "joanna", name: "Joanna", role: "Client Relations", phone: "+999 555 0103", status: "disconnected", avatar: { initials: "JO", color: "#64748b" } },
];

const conversations: StoredConversation[] = [
  {
    id: "conversation-demo-1",
    employeeId: "samer",
    customerName: "Lina Demo",
    customerPhone: "+999 555 1001",
    unreadCount: 2,
    avatar: { initials: "LD", color: "#d97706" },
    hasDeletedMessages: true,
    hasMedia: true,
    messages: [
      { id: "message-1", direction: "incoming", kind: "text", text: "مرحباً، أريد معرفة تفاصيل المشروع التجريبي.", time: "09:12", dateLabel: "Today" },
      { id: "message-2", direction: "outgoing", kind: "text", text: "שלום Lina — English follow-up.", time: "09:14", dateLabel: "Today", status: "read" },
      { id: "message-3", direction: "outgoing", kind: "media", text: "Project overview", time: "09:15", dateLabel: "Today", status: "delivered", media: { kind: "image", name: "project-overview.svg", mimeType: "image/svg+xml", url: "data:image/svg+xml;charset=UTF-8,%3Csvg width='900' height='560'%3E%3Crect width='900' height='560' fill='%23005476'/%3E%3Ctext x='450' y='290' fill='white' text-anchor='middle' font-size='42'%3ELOCAL MOCK IMAGE%3C/text%3E%3C/svg%3E" } },
      { id: "message-4", direction: "incoming", kind: "deleted", text: "This archived message remains visible.", time: "09:18", dateLabel: "Today" },
    ],
  },
  {
    id: "conversation-unicode-demo",
    employeeId: "samer",
    customerName: "Lia — ליאה — ლეა",
    customerPhone: "+999 555 2005",
    unreadCount: 0,
    avatar: { initials: "UD", color: "#9333ea" },
    hasDeletedMessages: false,
    hasMedia: false,
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
    avatar: { initials: "AS", color: "#7c3aed" },
    hasDeletedMessages: false,
    hasMedia: true,
    messages: [
      { id: "message-7", direction: "incoming", kind: "text", text: "Could you send the sample floor plan?", time: "Yesterday", dateLabel: "Yesterday" },
      { id: "message-8", direction: "outgoing", kind: "media", text: "Here is the local sample file.", time: "Yesterday", dateLabel: "Yesterday", status: "read", media: { kind: "file", name: "sample-floor-plan.pdf", mimeType: "application/pdf", url: "data:application/pdf;charset=utf-8,%25PDF-1.4%0A%25%20LOCAL%20MOCK%20DOCUMENT%0A", size: "180 KB" } },
    ],
  },
  {
    id: "conversation-demo-3",
    employeeId: "joanna",
    customerName: "Maya Example",
    customerPhone: "+999 555 1003",
    unreadCount: 1,
    avatar: { initials: "ME", color: "#0f766e" },
    hasDeletedMessages: false,
    hasMedia: true,
    messages: [
      { id: "message-9", direction: "incoming", kind: "text", text: "Is the video walkthrough available in English?", time: "11:02", dateLabel: "Today" },
      { id: "message-10", direction: "outgoing", kind: "media", text: "Local video walkthrough", time: "11:05", dateLabel: "Today", status: "delivered", media: { kind: "video", name: "walkthrough.mp4", mimeType: "video/mp4", url: "data:image/svg+xml;charset=UTF-8,%3Csvg width='900' height='560'%3E%3Crect width='900' height='560' fill='%230f766e'/%3E%3Ctext x='450' y='290' fill='white' text-anchor='middle' font-size='42'%3ELOCAL MOCK VIDEO%3C/text%3E%3C/svg%3E", size: "2.1 MB" } },
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
  return clone(employee);
}

function publicConversation(conversation: StoredConversation): WhatsappConversation {
  return clone({
    id: conversation.id,
    employeeId: conversation.employeeId,
    customerName: conversation.customerName,
    customerPhone: maskPhone(conversation.customerPhone),
    unreadCount: conversation.unreadCount,
    archived: conversation.archived,
    avatar: conversation.avatar,
    hasDeletedMessages: conversation.messages.some((message) => message.kind === "deleted"),
    hasMedia: conversation.messages.some((message) => Boolean(message.media)),
  });
}

function ownedEmployeeId(actor: WhatsappActor, employeeUserMapping: ReadonlyMap<number, string>): string | null {
  if (actor.isAdmin) return null;
  return employeeUserMapping.get(actor.userId) ?? null;
}

function assertCanReadConversation(
  actor: WhatsappActor,
  conversation: StoredConversation,
  employeeUserMapping: ReadonlyMap<number, string>,
): void {
  if (actor.isAdmin) return;
  if (ownedEmployeeId(actor, employeeUserMapping) !== conversation.employeeId) {
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
  constructor(private readonly employeeUserMapping: ReadonlyMap<number, string> = new Map()) {}

  async listEmployees(actor: WhatsappActor, query: WhatsappListQuery): Promise<WhatsappPage<WhatsappEmployee>> {
    if (!actor.isAdmin) throw new Error("Not authorized");
    const rows = employees
      .filter((employee) => !query.search || `${employee.name} ${employee.role}`.toLowerCase().includes(query.search.toLowerCase()))
      .map(publicEmployee);
    return page(rows.slice(query.offset, query.offset + query.limit), rows.length, query);
  }

  async listConversations(actor: WhatsappActor, query: WhatsappListQuery): Promise<WhatsappPage<WhatsappConversation>> {
    const owner = ownedEmployeeId(actor, this.employeeUserMapping);
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
    assertCanReadConversation(actor, conversation, this.employeeUserMapping);
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