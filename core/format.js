const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** @typedef {string | number | Date | null | undefined} DateInput */

/** @param {unknown} value */
export function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {unknown} name */
export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  const value = ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
  return value || "X";
}

/** @param {number} hue */
export function avatarColors(hue) {
  return {
    bg: `oklch(0.62 0.14 ${hue})`,
    bg2: `oklch(0.48 0.15 ${hue})`,
  };
}

/**
 * @param {DateInput} iso
 * @param {DateInput} [now]
 */
function absDate(iso, now = new Date()) {
  const d = iso instanceof Date ? new Date(iso.getTime()) : new Date(/** @type {string | number} */ (iso));
  if (Number.isNaN(d.getTime())) return "";
  const nowD = now instanceof Date ? now : new Date(/** @type {string | number} */ (now));
  const label = `${MON[d.getMonth()]} ${d.getDate()}`;
  if (!Number.isNaN(nowD.getTime()) && d.getFullYear() !== nowD.getFullYear()) {
    return `${label}, ${d.getFullYear()}`;
  }
  return label;
}

/**
 * @param {DateInput} iso
 * @param {DateInput} [now]
 */
export function relativeDate(iso, now = new Date()) {
  const then = iso instanceof Date
    ? iso.getTime()
    : new Date(/** @type {string | number} */ (iso)).getTime();
  const nowMs = now instanceof Date
    ? now.getTime()
    : new Date(/** @type {string | number} */ (now)).getTime();
  if (!then || Number.isNaN(then) || Number.isNaN(nowMs)) return "";
  const seconds = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return absDate(iso, now);
}

/** @param {DateInput} iso */
export function fullDate(iso) {
  const d = iso instanceof Date ? new Date(iso.getTime()) : new Date(/** @type {string | number} */ (iso));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}
