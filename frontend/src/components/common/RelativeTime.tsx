import { formatTimeAgo, formatRelativeTime } from "../../lib/utils";

/**
 * Renders a relative time string with a tooltip showing the absolute date/time.
 *
 * @param date - The date to display
 * @param withAgo - Use "ago" suffix style (e.g. "5m ago" vs "5m")
 * @param children - Optional extra content rendered after the relative time
 */
export function RelativeTime({
  date,
  withAgo,
  children,
}: {
  date: Date;
  withAgo?: boolean;
  children?: React.ReactNode;
}) {
  const absolute = date.toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const relative = withAgo ? formatRelativeTime(date.toISOString()) : formatTimeAgo(date);

  return (
    <span title={absolute}>
      {relative}
      {children}
    </span>
  );
}
