// Bounded English wording support for the synthetic application, not a prose verifier.
export const WORDING_CHECKER_VERSION = "synthetic-wording.v2";

const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];
const monthPattern = months
  .map((month) => `${month}|${month.slice(0, 3)}\\.?`)
  .join("|");
const namedDate = `(?:${monthPattern})\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+(?:${monthPattern}),?\\s+\\d{4}`;
const values = new RegExp(
  `(?:[\\w.+-]+@example\\.com|\\b(?:\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}:\\d{2}Z)?|${namedDate}|\\d{1,2}/\\d{1,2}/\\d{4}|(?:TCK|SKU|WH|USR|ORD|EVT)-[A-Z0-9]+|\\d{2}:\\d{2}|\\d+(?:\\.\\d+)?)\\b)`,
  "gi"
);

function dateKey(year, month, day) {
  if (![year, month, day].every(Number.isInteger)) return null;
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > days[month - 1]) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function calendarValue(value) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})Z)?$/.exec(value);
  if (iso) {
    if (iso[4] !== undefined && (+iso[4] > 23 || +iso[5] > 59 || +iso[6] > 59))
      return null;
    return dateKey(+iso[1], +iso[2], +iso[3]);
  }
  const parts = value.replace(/[.,]/g, "").toLowerCase().split(/\s+/);
  if (parts.length !== 3) return null;
  const dayFirst = /^\d+$/.test(parts[0]);
  const name = parts[dayFirst ? 1 : 0];
  const month =
    months.findIndex((entry) =>
      [entry.toLowerCase(), entry.slice(0, 3).toLowerCase()].includes(name)
    ) + 1;
  return dateKey(+parts[2], month, +parts[dayFirst ? 0 : 1]);
}

export function hasUnsupportedWordingValue(summary, facts) {
  const permitted = new Set(),
    dates = new Set();
  const collect = (value) => {
    if (value && typeof value === "object") {
      for (const child of Object.values(value)) collect(child);
    } else if (typeof value === "string" || typeof value === "number") {
      const authored = String(value);
      permitted.add(authored);
      const date = calendarValue(authored);
      if (date) {
        dates.add(date);
        if (/^\d{4}-\d{2}-\d{2}T/.test(authored)) {
          permitted.add(date);
          permitted.add(authored.slice(11, 16));
        }
      }
    }
  };
  collect(facts);
  for (const match of summary.matchAll(values)) {
    const value = match[0];
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      if (!calendarValue(value) || !permitted.has(value)) return true;
    } else if (
      /^\d{4}-\d{2}-\d{2}$/.test(value) ||
      (/[a-z]/i.test(value) && /\s/.test(value))
    ) {
      const date = calendarValue(value);
      if (!date || !dates.has(date)) return true;
    } else if (
      !permitted.has(value) &&
      !(/^\d+(?:\.\d+)?$/.test(value) && permitted.has(String(Number(value))))
    )
      return true;
  }
  return false;
}

export function positiveCompletionText(summary) {
  const expanded = summary.replace(
    /\b(has|have|had|was|were|is|are)n['’]t\b/gi,
    "$1 not"
  );
  const actions =
    /\b(?:sent|paid|refunded|committed|applied|reassigned|transferred|completed|executed|delivered|approved|prepared|drafted|cancelled)\b/gi;
  return expanded.replace(actions, (word, offset) => {
    // Only the action span is masked. A later affirmative clause still gets checked.
    const prefix = expanded
      .slice(Math.max(0, offset - 120), offset)
      .split(/[.!?;,\n]|\b(?:but|however|and)\b/i)
      .at(-1);
    const negated =
      /\b(?:not|never)\s+(?:(?:been|be|already|yet)\s+){0,2}$/i.test(prefix) ||
      /\b(?:no (?:action|refund|payment|adjustment|invitation|invite)|nothing)\s+(?:(?:has|have|had|was|were|is|are)\s+)?(?:been\s+)?$/i.test(
        prefix
      );
    const prospective =
      /\b(?:can|could|may|might|will|would|shall)\s+(?:only\s+)?be\s+$/i.test(prefix);
    return negated || prospective ? " ".repeat(word.length) : word;
  });
}
