import type {
  MockConversation,
  MockMessage,
} from "./whatsappEmployeeMonitoringMock";

type EmployeeConversationDto = {
  id: string;
  employeeId: string;
  customerName: string;
  customerPhone: string;
  unreadCount: number;
  archived?: boolean;
  avatar: { initials: string; color: string };
  hasDeletedMessages: boolean;
  hasMedia: boolean;
};

type EmployeeMessageDto = {
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
};

type EmployeeConversationResponse = {
  items: EmployeeConversationDto[];
};

type EmployeeMessagesResponse = {
  conversation: EmployeeConversationDto;
  messages: EmployeeMessageDto[];
};

const localFilePreview = "data:application/pdf;charset=utf-8,%25PDF-1.4%0A%25%20LOCAL%20MOCK%20DOCUMENT%0A";

const fallbackAvatarColor = "#005476";

function escapeSvgText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  }[character] ?? character));
}

export function avatarDataUrl(initials: string, color: string): string {
  const safeInitials = escapeSvgText(initials);
  const safeColor = /^#[0-9a-f]{6}$/i.test(color) ? color : fallbackAvatarColor;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" rx="80" fill="${safeColor}"/><text x="80" y="93" text-anchor="middle" font-family="Arial,sans-serif" font-size="48" font-weight="700" fill="#fff">${safeInitials}</text></svg>`,
  )}`;
}

function mapConversation(dto: EmployeeConversationDto, messages: MockMessage[] = []): MockConversation & {
  hasDeletedMessages: boolean;
  hasMedia: boolean;
} {
  return {
    id: dto.id,
    employeeId: dto.employeeId,
    customerName: dto.customerName,
    customerPhone: dto.customerPhone,
    unreadCount: dto.unreadCount,
    archived: dto.archived,
    avatar: avatarDataUrl(dto.avatar.initials, dto.avatar.color),
    messages,
    hasDeletedMessages: dto.hasDeletedMessages,
    hasMedia: dto.hasMedia,
  };
}

function mapMessage(dto: EmployeeMessageDto): MockMessage {
  return {
    id: dto.id,
    direction: dto.direction,
    kind: dto.kind,
    text: dto.text,
    time: dto.time,
    dateLabel: dto.dateLabel,
    status: dto.status,
    media: dto.media
      ? {
          kind: dto.media.kind,
          name: dto.media.name,
          size: dto.media.size,
          durationSeconds: dto.media.durationSeconds,
          url: dto.media.kind === "file" ? localFilePreview : dto.media.url,
        }
      : undefined,
  };
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message || "Unable to load WhatsApp mock data");
  }
  return response.json() as Promise<T>;
}

export const employeeWhatsappRepository = {
  async listConversations(): Promise<(MockConversation & {
    hasDeletedMessages: boolean;
    hasMedia: boolean;
  })[]> {
    const payload = await getJson<EmployeeConversationResponse>("/api/employee/whatsapp/conversations");
    return payload.items.map((conversation) => mapConversation(conversation));
  },

  async getConversationMessages(conversationId: string): Promise<MockConversation & {
    hasDeletedMessages: boolean;
    hasMedia: boolean;
  }> {
    const payload = await getJson<EmployeeMessagesResponse>(
      `/api/employee/whatsapp/conversations/${encodeURIComponent(conversationId)}/messages`,
    );
    return mapConversation(payload.conversation, payload.messages.map(mapMessage));
  },
};