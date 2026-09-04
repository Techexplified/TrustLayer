import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  // Always redirect to /app (overview), preserving query params (shop, host, etc.)
  throw redirect(`/app?${url.searchParams.toString()}`);
};

// This component is never rendered — the loader always redirects.
export default function Index() {
  return null;
}

