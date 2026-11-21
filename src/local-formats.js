// vCard and iCalendar use CRLF and fold content lines at 75 octets.
const encoder = new TextEncoder();
export function foldLine(line) {
  let result = "",
    used = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (used + bytes > 75) {
      result += "\r\n ";
      used = 1;
    }
    result += char;
    used += bytes;
  }
  return result;
}
export function escapeText(text) {
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw Error("control");
  return text
    .replaceAll("\\", "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/[,;]/g, "\\$&");
}
