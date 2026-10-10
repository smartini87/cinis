// highscore.js – Bestenliste im localStorage: Hauptwert sind die überstandenen Nächte, danach besiegte Gegner.
// Gespeichert werden der Bestwert und die fünf besten Läufe (mit Seed und Datum).

const KEY = 'cinis.highscore.v1';

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Sortierung: mehr Nächte zuerst, bei Gleichstand mehr besiegte Gegner, dann mehr Gerettete. */
function better(a, b) {
  return a.nights - b.nights || a.kills - b.kills || a.rescued - b.rescued;
}

export function loadScores() {
  const s = storage();
  try {
    const d = s && JSON.parse(s.getItem(KEY));
    if (d && Array.isArray(d.top)) return d;
  } catch {
    /* defekter Eintrag: neu beginnen */
  }
  return { top: [] };
}

export function bestScore() {
  return loadScores().top[0] || null;
}

/** Lauf eintragen; liefert { entry, rank (0-basiert oder −1), record (neuer Bestwert?) }. */
export function recordScore(entry) {
  const d = loadScores();
  const prev = d.top[0] || null;
  d.top.push(entry);
  d.top.sort((a, b) => better(b, a));
  d.top = d.top.slice(0, 5);
  const rank = d.top.indexOf(entry);
  const record = !prev || better(entry, prev) > 0;
  try {
    storage()?.setItem(KEY, JSON.stringify(d));
  } catch {
    /* Speicher nicht verfügbar: Bestenliste nur für diese Sitzung */
  }
  return { entry, rank, record: record && entry.nights > 0 };
}
