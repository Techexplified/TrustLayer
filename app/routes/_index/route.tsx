import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { login } from "../../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  // Always redirect to /app (overview), preserving query params (shop, host, etc.)
  throw redirect(`/app?${url.searchParams.toString()}`);

  // If host is present, the app is already loaded within embedded Shopify Admin iframe
  if (url.searchParams.get("host")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  // If shop is provided without host (install from Shopify App Store or automated check),
  // immediately initiate OAuth via login(request), which redirects to the OAuth install grant screen.
  if (url.searchParams.get("shop")) {
    return await login(request);
  }

  // Fallback for direct browser visits without shop: redirect to /auth/login
  throw redirect(`/auth/login`);
};

// This component is never rendered — the loader always redirects.
export default function Index() {
  return null;
}

