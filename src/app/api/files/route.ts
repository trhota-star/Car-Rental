import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { log } from "@/lib/auth-log";
import { getFileForViewer } from "@/server/files";

// Private uploads (driving licences, damage photos). Never served from public/.
// 401 without a session; 404 when the file is missing or the viewer is neither
// the owner nor an admin (so existence is not revealed).
export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const key = request.nextUrl.searchParams.get("key") ?? "";
  const file = key ? await getFileForViewer({ key, viewerId: session.user.id }) : null;
  if (!file) return Response.json({ error: "not found" }, { status: 404 });

  log("info", "file.served", { viewerId: session.user.id, key });
  const ext = key.split(".").pop() ?? "bin";
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `inline; filename="document.${ext}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
