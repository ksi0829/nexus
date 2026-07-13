export const KST_TIME_ZONE = "Asia/Seoul";

type DateInput = string | number | Date | null | undefined;

type DateParts = {
  year: string;
  month: string;
  day: string;
};

const kstDatePartFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: KST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function toValidDate(value: DateInput) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getKstDateParts(value: DateInput): DateParts | null {
  const date = toValidDate(value);
  if (!date) return null;

  const parts = kstDatePartFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) return null;
  return { year, month, day };
}

export function getTodayKstDate() {
  return formatKstDate(new Date());
}

export function formatKstDate(value: DateInput, fallback = "-") {
  const parts = getKstDateParts(value);
  if (!parts) return fallback;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getKstDateKey(value: DateInput, fallback = "") {
  return formatKstDate(value, fallback);
}

export function formatKstMonthKey(value: DateInput, fallback = "unknown") {
  const parts = getKstDateParts(value);
  if (!parts) return fallback;
  return `${parts.year}-${parts.month}`;
}

export function formatKstShortDate(value: DateInput, fallback = "") {
  const parts = getKstDateParts(value);
  if (!parts) return fallback;
  return `${Number(parts.month)}/${Number(parts.day)}`;
}

export function formatKstMonthDay(value: DateInput, fallback = "") {
  const parts = getKstDateParts(value);
  if (!parts) return fallback;
  return `${Number(parts.month)}. ${Number(parts.day)}.`;
}

export function formatKstDateKorean(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  },
  fallback = "-"
) {
  const date = toValidDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST_TIME_ZONE,
    ...options,
  }).format(date);
}

export function formatKstDateTime(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "long",
    timeStyle: "short",
  },
  fallback = "-"
) {
  return formatKstDateKorean(value, options, fallback);
}

export function formatKstTime(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
  },
  fallback = ""
) {
  const date = toValidDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST_TIME_ZONE,
    ...options,
  }).format(date);
}

export function isSameKstDate(a: DateInput, b: DateInput) {
  const left = getKstDateKey(a);
  const right = getKstDateKey(b);
  return Boolean(left && right && left === right);
}
