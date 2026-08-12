"use server";

import { revalidatePath } from "next/cache";

import { requireAuth } from "@/lib/auth/context";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/notifications/service";

export async function markAllNotificationsReadAction(): Promise<void> {
  const context = await requireAuth();
  await markAllNotificationsRead(context.organization.id);
  revalidatePath("/", "layout");
}

export async function markNotificationReadAction(notificationId: string): Promise<void> {
  const context = await requireAuth();
  await markNotificationRead(context.organization.id, notificationId);
  revalidatePath("/", "layout");
}
