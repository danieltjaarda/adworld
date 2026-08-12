"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Bell } from "lucide-react";

import { markAllNotificationsReadAction } from "@/app/(dashboard)/notification-actions";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatRelativeTime } from "@/lib/analytics/format";
import { cn } from "@/lib/utils";

export type NotificationItem = {
  id: string;
  title: string;
  body: string;
  href: string | null;
  severity: "INFO" | "WARNING" | "CRITICAL";
  readAt: Date | null;
  createdAt: Date;
};

export function NotificationsMenu({
  notifications,
  unreadCount,
}: {
  notifications: NotificationItem[];
  unreadCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function markAll() {
    startTransition(async () => {
      await markAllNotificationsReadAction();
      router.refresh();
    });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="size-[18px]" />
          {unreadCount > 0 ? (
            <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-negative ring-2 ring-background" />
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
          <p className="text-[13px] font-semibold">Notifications</p>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={markAll}
              disabled={pending}
              className="text-[12px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Mark all read
            </button>
          ) : null}
        </div>

        {notifications.length === 0 ? (
          <p className="px-3.5 py-8 text-center text-[13px] text-muted-foreground">
            Nothing to report. Alerts and finished optimizations show up here.
          </p>
        ) : (
          <ul className="max-h-[380px] divide-y divide-border overflow-y-auto">
            {notifications.map((notification) => {
              const content = (
                <>
                  <span className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        "mt-1.5 size-1.5 shrink-0 rounded-full",
                        notification.severity === "CRITICAL"
                          ? "bg-negative"
                          : notification.severity === "WARNING"
                            ? "bg-warning"
                            : "bg-info",
                        notification.readAt ? "opacity-30" : "",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium leading-5 text-foreground">
                        {notification.title}
                      </span>
                      <span className="mt-0.5 block line-clamp-2 text-[12px] leading-5 text-muted-foreground">
                        {notification.body}
                      </span>
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        {formatRelativeTime(notification.createdAt)}
                      </span>
                    </span>
                  </span>
                </>
              );

              return (
                <li key={notification.id}>
                  {notification.href ? (
                    <Link
                      href={notification.href}
                      className="block px-3.5 py-3 transition-colors hover:bg-muted"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="px-3.5 py-3">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
