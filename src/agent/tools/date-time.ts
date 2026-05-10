import { Type } from "@sinclair/typebox";
import type { AgentTool } from "../types.js";

export const dateTimeTool: AgentTool = {
  name: "date_time",
  description:
    "Get the current date and time, or convert/format timestamps. Useful for answering questions about the current time, date calculations, or timezone conversions.",
  parameters: Type.Object({
    action: Type.Optional(
      Type.Union(
        [
          Type.Literal("now"),
          Type.Literal("convert"),
          Type.Literal("format"),
        ],
        {
          description:
            "Action to perform: 'now' (default) returns current time, 'convert' converts a timestamp between timezones, 'format' formats a date string",
        }
      )
    ),
    timestamp: Type.Optional(
      Type.String({
        description:
          "ISO 8601 timestamp to convert or format (e.g. '2026-01-15T10:30:00Z')",
      })
    ),
    timezone: Type.Optional(
      Type.String({
        description:
          "Target timezone for conversion (e.g. 'America/New_York', 'Asia/Shanghai', 'UTC')",
      })
    ),
    format: Type.Optional(
      Type.String({
        description:
          "Output format style: 'iso' (default), 'locale', 'date', 'time', 'full'",
      })
    ),
  }),
  execute: ({ args }) => {
    const action = (args.action as string) ?? "now";
    const timezone = args.timezone as string | undefined;
    const formatStyle = (args.format as string) ?? "iso";

    try {
      switch (action) {
        case "now": {
          const now = new Date();
          return {
            type: "text",
            content: formatOutput(now, timezone, formatStyle),
          };
        }

        case "convert":
        case "format": {
          const ts = args.timestamp as string | undefined;
          if (!ts) {
            return {
              type: "error",
              content: "timestamp is required for convert/format actions",
            };
          }
          const date = new Date(ts);
          if (isNaN(date.getTime())) {
            return { type: "error", content: `Invalid timestamp: ${ts}` };
          }
          return {
            type: "text",
            content: formatOutput(date, timezone, formatStyle),
          };
        }

        default:
          return { type: "error", content: `Unknown action: ${action}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { type: "error", content: `Date/time error: ${message}` };
    }
  },
};

function formatOutput(
  date: Date,
  timezone: string | undefined,
  style: string
): string {
  const tzOptions: Intl.DateTimeFormatOptions = timezone
    ? { timeZone: timezone }
    : {};

  switch (style) {
    case "locale":
      return date.toLocaleString("en-US", {
        ...tzOptions,
        dateStyle: "full",
        timeStyle: "long",
      });

    case "date":
      return date.toLocaleDateString("en-US", {
        ...tzOptions,
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
      });

    case "time":
      return date.toLocaleTimeString("en-US", {
        ...tzOptions,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZoneName: "short",
      });

    case "full":
      return [
        `ISO: ${date.toISOString()}`,
        `Locale: ${date.toLocaleString("en-US", { ...tzOptions, dateStyle: "full", timeStyle: "long" })}`,
        `Unix: ${Math.floor(date.getTime() / 1000)}`,
        timezone ? `Timezone: ${timezone}` : `Timezone: UTC (default)`,
      ].join("\n");

    case "iso":
    default:
      return timezone
        ? date.toLocaleString("en-US", {
            ...tzOptions,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
            timeZoneName: "short",
          })
        : date.toISOString();
  }
}
