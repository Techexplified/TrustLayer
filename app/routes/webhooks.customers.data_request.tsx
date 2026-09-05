import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async () => {
  return new Response("Webhook endpoint active", { status: 200 });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`[TrustLayer] ${topic} received for ${shop}. No customer PII stored.`);
  return new Response(null, { status: 200 });
};