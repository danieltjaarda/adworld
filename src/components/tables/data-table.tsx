import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A compact, server-rendered table. Sorting is a link, not client state, so a sorted
 * view is shareable and the rows never need to ship to the browser.
 */

export type Column<T> = {
  key: string;
  header: string;
  align?: "left" | "right";
  width?: string;
  sortable?: boolean;
  render: (row: T) => React.ReactNode;
  /** Hidden below the given breakpoint to keep mobile readable. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
};

const HIDE_CLASS: Record<NonNullable<Column<unknown>["hideBelow"]>, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  buildSortHref,
  emptyState,
  footer,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sort?: { key: string; direction: "asc" | "desc" };
  buildSortHref?: (key: string, direction: "asc" | "desc") => string;
  emptyState?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  if (rows.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => {
              const isSorted = sort?.key === column.key;
              const nextDirection: "asc" | "desc" =
                isSorted && sort?.direction === "desc" ? "asc" : "desc";

              return (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  className={cn(
                    column.align === "right" && "text-right",
                    column.hideBelow && HIDE_CLASS[column.hideBelow],
                  )}
                >
                  {column.sortable && buildSortHref ? (
                    <Link
                      href={buildSortHref(column.key, nextDirection)}
                      scroll={false}
                      className={cn(
                        "inline-flex items-center gap-1 transition-colors hover:text-foreground",
                        isSorted && "text-foreground",
                        column.align === "right" && "flex-row-reverse",
                      )}
                    >
                      {column.header}
                      {isSorted ? (
                        sort?.direction === "desc" ? (
                          <ArrowDown className="size-3" aria-hidden />
                        ) : (
                          <ArrowUp className="size-3" aria-hidden />
                        )
                      ) : null}
                    </Link>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    column.align === "right" && "text-right",
                    column.hideBelow && HIDE_CLASS[column.hideBelow],
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer ? (
          <tfoot>
            <tr>
              <td colSpan={columns.length} className="border-t border-border bg-muted/40 px-3 py-2">
                {footer}
              </td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

/** Primary cell: a strong label with a quiet second line. */
export function CellStack({
  primary,
  secondary,
  className,
}: {
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="truncate text-[13px] font-medium text-foreground">{primary}</div>
      {secondary ? (
        <div className="truncate text-[12px] leading-4 text-muted-foreground">{secondary}</div>
      ) : null}
    </div>
  );
}

export function NumberCell({
  value,
  muted,
  className,
}: {
  value: string;
  muted?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("tabular text-[13px]", muted && "text-muted-foreground", className)}>
      {value}
    </span>
  );
}
