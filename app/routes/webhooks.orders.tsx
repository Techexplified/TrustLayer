import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { handleOrderWebhook } from "../lib/syncEngine.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`[TrustLayer Webhook] Received ${topic} for ${shop}`);
  await handleOrderWebhook(shop, topic, payload);

  return new Response();
};