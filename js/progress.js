// progress.js – progressive Freischaltung und Einstiegs-Questpfad. Am Anfang sieht man fast nichts:
// HUD-Teile, Gebäude und Mechaniken erscheinen erst, wenn sie relevant werden (mit kurzer Einblendung und
// einem Satz Erklärung). Ein Ziel-Banner mit Fortschritt und ein goldener Marker führen durch den Start.

import { TILE, RES } from './config.js';
import { fmtTime } from './util.js';
import { BUILDING_DEFS } from './buildings.js';

/** Freischaltbare Dinge: Bezeichnung und ein Satz Erklärung (Freischalt-Meldung). */
export const UNLOCKS = {
  'hud.carry': { label: 'Traglast', text: 'Gesammeltes trägst du bei dir, bis du es an der Flamme ablieferst.' },
  'hud.res': { label: 'Lager', text: 'Oben links siehst du, was im Lager an der Ewigen Flamme liegt.' },
  buildbar: { label: 'Bauleiste', text: 'Wähle ein Gebäude und setze es mit einem Klick.' },
  'hud.settlers': { label: 'Siedler', text: 'Links legst du fest, was deine Siedler bevorzugt sammeln.' },
  'hud.minimap': { label: 'Karte', text: 'Die Minikarte zeigt die Umgebung, Gegner und wichtige Orte.' },
  'hud.energy': { label: 'Dash', text: 'Shift: blitzschnell ausweichen (kostet Energie). Shift halten: sprinten.' },
  'hud.clock': { label: 'Tag und Nacht', text: 'Die Zeit läuft. Nachts kriechen die Aschgänger aus den Ruinen.' },
  combat: { label: 'Kampf', text: 'Leertaste oder Klick in der Nähe von Gegnern schlägt mit dem Gladius zu.' },
  demolish: { label: 'Abriss', text: 'X: Gebäude abreißen, die Hälfte der Kosten kommt zurück.' },
  'hud.inventory': { label: 'Inventar', text: 'I öffnet dein Gepäck. Werkzeug und Ausrüstung wirken, solange du sie trägst.' },
};
for (const [type, def] of Object.entries(BUILDING_DEFS)) if (type !== 'center') UNLOCKS['b:' + type] = { label: def.name, text: def.desc };

/**
 * Questpfad. Jeder Schritt: text (Banner), start (Freischaltungen beim Beginn), done (Prüfung),
 * progress (Fortschrittstext), target (Weltpunkt für den Marker), finish (Freischaltungen am Ende).
 * Schritte mit available(game) === false werden übersprungen (Mechanik noch nicht vorhanden).
 */
export const QUESTS = [
  {
    id: 'move',
    text: (g) => (g.input.usingTouch ? 'Ziehe links auf dem Bildschirm, um zu laufen' : 'Bewege dich mit WASD'),
    done: (g, q) => q.moved > 48,
  },
  {
    id: 'wood',
    text: () => 'Sammle Holz: halte E an einem Baum',
    progress: (g, q) => `Holz ${Math.min(10, q.wood)}/10`,
    done: (g, q) => q.wood >= 10,
    target: (g) => nearestNode(g, 'tree'),
  },
  {
    id: 'stone',
    text: () => 'Brich Stein aus den Säulentrümmern',
    progress: (g, q) => `Stein ${Math.min(5, q.stone)}/5`,
    done: (g, q) => q.stone >= 5,
    target: (g) => nearestNode(g, 'rock'),
  },
  {
    id: 'deliver',
    text: () => 'Bring alles zur Ewigen Flamme',
    done: (g, q) => q.delivered > 0 && g.player.carried === 0,
    target: (g) => g.buildings.center,
    finish: ['hud.res'],
  },
  {
    id: 'hut',
    start: ['buildbar', 'b:hut'],
    text: (g) => (g.buildings.countAll('hut') ? 'Liefere Holz und Stein an die Baustelle (E)' : `Setze eine Hütte (Taste ${BUILDING_DEFS.hut.key} oder Bauleiste)`),
    progress: (g) => {
      const b = g.buildings.list.find((x) => x.type === 'hut' && x.site);
      return b ? `Baufortschritt ${Math.round(g.buildings.siteProgress(b) * 100)} %` : '';
    },
    done: (g) => g.buildings.count('hut') > 0,
    target: (g) => g.buildings.list.find((x) => x.type === 'hut' && x.site) || g.buildings.center,
    finish: ['hud.settlers', 'hud.minimap'],
  },
  {
    id: 'find',
    text: () => 'Finde Überlebende – folge dem goldenen Pfeil',
    done: (g) => g.settlers.list.some((s) => s.mode === 'follow') || g.settlers.colony.length > 0,
    target: (g) => nearestCamp(g),
  },
  {
    id: 'bring',
    text: (g) => {
      const s = g.settlers.list.find((o) => o.mode === 'follow');
      return s ? `Bring ${s.name} zur Siedlung – sie folgt dir` : 'Bring die Überlebenden zur Siedlung';
    },
    done: (g) => g.settlers.colony.length > 0,
    target: (g) => (g.settlers.list.some((o) => o.mode === 'follow') ? g.buildings.center : nearestCamp(g)),
  },
  {
    id: 'farm',
    start: ['b:farm'],
    text: () => 'Baue eine Farm – sie ernährt deine Siedler',
    done: (g) => g.buildings.count('farm') > 0,
    target: (g) => g.buildings.center,
    finish: ['b:well'],
  },
  {
    id: 'night',
    start: ['hud.energy', 'combat', 'hud.clock'],
    text: (g) => (g.cycle.isNight ? 'Überstehe die Nacht – verteidige die Flamme' : 'Die Nacht naht – kehr rechtzeitig zur Flamme zurück'),
    progress: (g) => (g.cycle.isNight ? `Morgengrauen in ${fmtTime(g.cycle.timeToDawn)}` : `Nacht in ${fmtTime(g.cycle.timeToNight)}`),
    done: (g) => g.cycle.day >= 2,
    target: (g) => g.buildings.center,
  },
  {
    id: 'defense',
    start: ['b:wall', 'b:gate', 'b:tower', 'demolish'],
    text: () => 'Sichere die Flamme: Baue einen Turm',
    done: (g) => g.buildings.count('tower') > 0,
    target: (g) => g.buildings.center,
  },
  {
    id: 'upgrade',
    text: () => 'Entfache die Flamme auf Stufe 2 (E an der Flamme)',
    progress: (g) => {
      const c = g.flame.next && g.flame.next.cost;
      return c ? Object.entries(c).map(([k, n]) => `${RES[k].name} ${Math.min(n, Math.floor((g.stock[k] || 0) + g.player.inv.count(k)))}/${n}`).join(' · ') : '';
    },
    done: (g) => g.flame.level >= 2,
    target: (g) => g.buildings.center,
  },
  {
    id: 'workbench',
    start: ['b:workbench', 'hud.inventory'],
    text: () => 'Baue eine Werkbank',
    done: (g) => g.buildings.count('workbench') > 0,
    target: (g) => g.buildings.list.find((b) => b.type === 'workbench') || g.buildings.center,
  },
  {
    id: 'craft',
    text: () => 'Stelle an der Werkbank oder Flamme etwas her (E)',
    done: (g) => (g.stats.crafted || 0) > 0,
    target: (g) => g.buildings.list.find((b) => b.type === 'workbench' && !b.site) || g.buildings.center,
  },
];

/** Nächstes Lager mit wartenden Siedlern (Ziel des Markers). */
function nearestCamp(g) {
  const p = g.player;
  let best = null, bd = Infinity;
  for (const s of g.settlers.list) {
    if (s.mode !== 'waiting' || !s.poi) continue;
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    if (d < bd) {
      bd = d;
      best = s.poi;
    }
  }
  return best ? { x: best.x, y: best.y, type: 'camp' } : null;
}

function nearestNode(g, type) {
  const p = g.player;
  let best = null, bd = Infinity;
  for (let dy = -14; dy <= 14; dy++) {
    for (let dx = -14; dx <= 14; dx++) {
      const n = g.world.nodeAtTile(p.tx + dx, p.ty + dy);
      if (!n || n.removed || n.amount <= 0 || n.type !== type) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
  }
  return best;
}

export class Progress {
  constructor(game) {
    this.game = game;
    this.unlocked = new Set();
    this.quest = 0;          // Index des aktuellen Questschritts
    this.done = false;       // Einstieg abgeschlossen (oder übersprungen)
    this.state = this.fresh();
    this.started = -1;       // Schritt, dessen start-Freischaltungen schon liefen
    this.blueprints = new Set(); // gefundene Baupläne (aus Feindlagern)
  }

  /** Bauplan aufnehmen; liefert true, wenn er neu ist. */
  addBlueprint(key) {
    if (this.blueprints.has(key)) return false;
    this.blueprints.add(key);
    return true;
  }

  /** Zähler des aktuellen Schritts. */
  fresh() {
    return { moved: 0, wood: 0, stone: 0, delivered: 0 };
  }

  has(key) {
    return this.done || this.unlocked.has(key);
  }

  /** Etwas freischalten; mit Meldung und Einblendung im HUD, sofern nicht quiet. */
  unlock(key, quiet = false) {
    if (this.unlocked.has(key)) return false;
    this.unlocked.add(key);
    const info = UNLOCKS[key];
    if (!quiet && info && this.game.state !== 'menu') {
      this.game.ui.reveal(key);
      this.game.ui.toast(`<b>Neu: ${info.label}</b> – ${info.text}`, 'unlock');
      this.game.audio.play('unlock');
    }
    return true;
  }

  /** Alles freischalten (Tutorial überspringen). */
  unlockAll() {
    for (const k of Object.keys(UNLOCKS)) this.unlocked.add(k);
    this.done = true;
    this.quest = QUESTS.length;
  }

  get step() {
    return this.done ? null : QUESTS[this.quest] || null;
  }

  /** Läuft die Tageszeit schon? (Bis zum Nacht-Schritt bleibt es heller Tag.) */
  get clockRunning() {
    return this.has('hud.clock');
  }

  /** Ereignisse aus dem Spiel (Sammeln, Abliefern, Bewegen) für die Questzähler. */
  notify(kind, a, n = 1) {
    const s = this.state;
    if (kind === 'gather') {
      if (a === 'wood') s.wood += n;
      else if (a === 'stone') s.stone += n;
      this.unlock('hud.carry');
    } else if (kind === 'deposit') s.delivered += n;
    else if (kind === 'move') s.moved += n;
  }

  update() {
    if (this.done) return;
    let q = this.step;
    while (q && q.available && !q.available(this.game)) q = this.advance();
    if (!q) return;
    if (this.started !== this.quest) {
      this.started = this.quest;
      for (const k of q.start || []) this.unlock(k);
    }
    if (q.done(this.game, this.state)) {
      for (const k of q.finish || []) this.unlock(k);
      this.game.audio.play('questDone');
      this.advance();
    }
  }

  advance() {
    this.quest++;
    this.state = this.fresh();
    if (this.quest >= QUESTS.length) {
      this.done = true;
      for (const k of Object.keys(UNLOCKS)) this.unlock(k, true);
      this.game.ui.applyUnlocks();
      this.game.ui.toast('Du kennst nun die Grundlagen. Halte die Ewige Flamme am Leben – so viele Nächte wie möglich!', 'good');
      return null;
    }
    return this.step;
  }

  /** Banner: { text, progress } oder null. */
  banner() {
    const q = this.step;
    if (!q) return null;
    return { text: q.text(this.game), progress: q.progress ? q.progress(this.game, this.state) : '' };
  }

  /** Zielpunkt des Markers in Weltkoordinaten oder null. */
  target() {
    const q = this.step;
    if (!q || !q.target) return null;
    const t = q.target(this.game);
    if (!t) return null;
    const h = t.type === 'center' ? 52 : t.type === 'tree' ? 30 : t.type === 'camp' ? 34 : t.tx !== undefined && t.size ? t.size * TILE + 10 : 16;
    return { x: t.x, y: t.y, h };
  }

  serialize() {
    return { unlocked: [...this.unlocked], quest: this.quest, done: this.done, state: this.state, blueprints: [...this.blueprints] };
  }

  restore(d) {
    if (!d) {
      this.unlockAll();
      return;
    }
    this.unlocked = new Set(d.unlocked || []);
    this.quest = d.quest || 0;
    this.done = !!d.done;
    this.state = { ...this.fresh(), ...(d.state || {}) };
    this.blueprints = new Set(d.blueprints || []);
    this.started = this.quest;
  }
}
