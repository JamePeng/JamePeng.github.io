// Dates without an explicit offset use Beijing time, including date-only values.
const BEIJING_OFFSET = "+08:00";
const beijingFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function parsePostDate(value, field = "date") {
  const match =
    typeof value === "string" &&
    value.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/,
    );
  const invalid = () =>
    new Error(
      `${field} 无效：${JSON.stringify(value)}。请使用 YYYY-MM-DD 或 YYYY-MM-DD HH:mm（北京时间）。`,
    );
  if (!match) throw invalid();
  const [, year, month, day, hour, minute, second, fraction, offset] = match;
  const daysInMonth = new Date(
    Date.UTC(Number(year), Number(month), 0),
  ).getUTCDate();
  if (
    Number(year) < 1000 ||
    Number(month) < 1 ||
    Number(month) > 12 ||
    Number(day) < 1 ||
    Number(day) > daysInMonth ||
    Number(hour ?? 0) > 23 ||
    Number(minute ?? 0) > 59 ||
    Number(second ?? 0) > 59
  )
    throw invalid();
  const instant = new Date(
    `${year}-${month}-${day}T${hour ?? "00"}:${minute ?? "00"}:${second ?? "00"}${fraction ?? ""}${offset ?? BEIJING_OFFSET}`,
  );
  if (!Number.isFinite(instant.getTime())) throw invalid();
  const parts = Object.fromEntries(
    beijingFormatter
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    iso: instant.toISOString(),
    timestamp: instant.getTime(),
    date,
    display:
      date.replaceAll("-", ".") +
      (hour === undefined ? "" : ` ${parts.hour}:${parts.minute}`),
  };
}

export function preparePosts(input) {
  return input
    .map((post) => {
      const published = parsePostDate(post.date, `${post.slug}.date`);
      const edited = post.updated
        ? parsePostDate(post.updated, `${post.slug}.updated`)
        : published;
      // Backdating or moving publication forward must not display an earlier edit
      // as if it happened after publication. No content edit date is invented.
      const modified =
        edited.timestamp > published.timestamp ? edited : published;
      let source;
      if (post.source) {
        let url;
        try {
          url = new URL(post.source.url);
        } catch {
          throw new Error(
            `${post.slug}.source.url 必须是有效的 https 原文链接。`,
          );
        }
        if (url.protocol !== "https:")
          throw new Error(`${post.slug}.source.url 必须使用 https。`);
        source = { name: post.source.name || "原文", url: url.href };
      }
      return {
        ...post,
        source,
        date: published.date,
        publishedAt: published.iso,
        publishedTimestamp: published.timestamp,
        displayDate: published.display,
        updated: modified.date,
        updatedAt: modified.iso,
        displayUpdated: modified.display,
        showUpdated: edited.timestamp > published.timestamp,
      };
    })
    .sort((a, b) => b.publishedTimestamp - a.publishedTimestamp);
}
