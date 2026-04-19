import fetch from "node-fetch";

const BOG_AUTH_URL = "https://api.bog.ge/auth/token";
const BOG_ORDERS_URL = "https://api.bog.ge/payments/v1/ecommerce/orders";
const BOG_ORDER_DETAILS_URL = "https://api.bog.ge/payments/v1/ecommerce/orders/";

interface BOGTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface BOGOrderRequest {
  callback_url: string;
  purchase_units: {
    currency: string;
    total_amount: number;
  };
  redirect_urls: {
    success: string;
    fail: string;
  };
  shop_order_id?: string;
}

interface BOGOrderResponse {
  id: string;
  redirect_url: string;
  status?: string;
}

interface BOGOrderDetails {
  order_status: {
    key: string;
  };
  payment_detail?: {
    amount: number;
    currency: string;
  };
}

async function getBOGToken(): Promise<string> {
  const clientId = process.env.BOG_CLIENT_ID;
  const clientSecret = process.env.BOG_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("BOG credentials not configured");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(BOG_AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`BOG auth failed: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as BOGTokenResponse;
  return data.access_token;
}

export async function createBOGOrder(
  amount: number,
  currency: string = "USD",
  shopOrderId: string,
  baseUrl: string
): Promise<{ orderId: string; redirectUrl: string }> {
  const token = await getBOGToken();

  const orderPayload: BOGOrderRequest = {
    callback_url: `${baseUrl}/api/bog/callback`,
    purchase_units: {
      currency: currency,
      total_amount: amount,
    },
    redirect_urls: {
      success: `${baseUrl}/payment/success?ref=${shopOrderId}`,
      fail: `${baseUrl}/payment/fail?ref=${shopOrderId}`,
    },
    shop_order_id: shopOrderId,
  };

  const response = await fetch(BOG_ORDERS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(orderPayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`BOG order creation failed: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as BOGOrderResponse;
  return {
    orderId: data.id,
    redirectUrl: data.redirect_url,
  };
}

export async function getBOGOrderStatus(orderId: string): Promise<string> {
  const token = await getBOGToken();

  const response = await fetch(`${BOG_ORDER_DETAILS_URL}${orderId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`BOG order details failed: ${response.status}`);
  }

  const data = (await response.json()) as BOGOrderDetails;
  return data.order_status?.key || "unknown";
}
