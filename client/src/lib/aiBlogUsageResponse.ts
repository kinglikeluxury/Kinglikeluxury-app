export interface AiBlogUsageResponse {
  configured: boolean;
  message?: string;
  [key: string]: unknown;
}

export async function parseAiBlogUsageResponse<
  T extends AiBlogUsageResponse,
>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));

  if (
    response.status === 503 &&
    data?.code === "AI_BLOG_USAGE_SCHEMA_MISSING"
  ) {
    return {
      configured: false,
      message: data.message || "يلزم تجهيز ترحيل حصص AI Blog قبل عرض بيانات الاستخدام.",
    } as T;
  }

  if (!response.ok) {
    throw new Error(data.message || "تعذر تحميل بيانات الاستخدام");
  }

  return data as T;
}
