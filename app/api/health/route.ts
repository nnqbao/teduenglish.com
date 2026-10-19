import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

export const dynamic = "force-dynamic";

export async function GET() {
  // On the server, talk to the self-hosted backend directly rather than through the public proxy.
  const url = process.env.CONVEX_SELF_HOSTED_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  try {
    if (!url) throw new Error("Convex URL is not set");
    const home = await new ConvexHttpClient(url).query(api.site.home, {});
    return Response.json({ status: "ok", backend: "convex", folders: home.folders.length });
  } catch {
    return Response.json({ status: "error", backend: "convex" }, { status: 503 });
  }
}
