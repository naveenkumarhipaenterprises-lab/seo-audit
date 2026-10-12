import "server-only";
import { cookies } from "next/headers";
import { OWNER_COOKIE, ownerIdFromToken } from "./owner";

/** Owner id for server components and route handlers. */
export async function currentOwnerId(): Promise<string | null> {
  const jar = await cookies();
  return ownerIdFromToken(jar.get(OWNER_COOKIE)?.value);
}
