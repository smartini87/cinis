// save.js – Spielstand in localStorage: Serialisieren/Wiederherstellen des kompletten Zustands.
// Die Welt wird aus dem Seed neu generiert; gespeichert werden nur veränderliche Daten.

const KEY = 'cinis.save.v1';
const VERSION = 1;

/** Sicherer Zugriff auf localStorage (privater Modus, Speicher voll …). */
function storage() {
  try {
    const s = window.localStorage;
    const probe = '__cinis_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function hasSave() {
  return !!peekSave();
}

/** Kurzinfo zum Spielstand für das Hauptmenü (oder null). */
export function peekSave() {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d.v !== VERSION) return null;
    return { day: d.cycle.day, savedAt: d.savedAt, settlers: d.settlers.length };
  } catch {
    return null;
  }
}

export function deleteSave() {
  storage()?.removeItem(KEY);
}

/** Aktuellen Spielstand speichern. Liefert true bei Erfolg. */
export function saveGame(game) {
  const s = storage();
  if (!s || game.over) return false;
  const bIndex = new Map(game.buildings.list.map((b, i) => [b, i]));
  const data = {
    v: VERSION,
    savedAt: Date.now(),
    seed: game.seed,
    time: game.time,
    cycle: { t: game.cycle.t, day: game.cycle.day, duskFired: game.cycle.duskFired },
    stock: game.stock,
    stats: game.stats,
    focus: game.settlers.focus,
    nameIdx: game.settlers.nameIdx,
    player: { x: game.player.x, y: game.player.y, hp: game.player.hp, inv: game.player.inv, dead: game.player.dead, respawnT: game.player.respawnT },
    // Knoten kompakt: [Menge, Timer, entfernt]
    nodes: game.world.nodes.map((n) => [n.amount, Math.round(n.timer * 10) / 10, n.removed ? 1 : 0]),
    buildings: game.buildings.list.map((b) => ({ type: b.type, tx: b.tx, ty: b.ty, hp: b.hp, timer: b.timer, growth: b.growth })),
    settlers: game.settlers.list.map((st) => ({
      name: st.name, x: st.x, y: st.y, hp: st.hp, hunger: st.hunger, thirst: st.thirst,
      hidden: !!st.hidden, home: st.home ? bIndex.get(st.home) ?? -1 : -1,
      farm: st.farm ? bIndex.get(st.farm) ?? -1 : -1, carry: st.carry, tunic: st.tunic, hair: st.hair,
    })),
    enemies: game.enemies.list.map((e) => ({ type: e.type, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, dmg: e.dmg, speed: e.speed })),
    loot: game.loot.serialize(),
    queue: game.enemies.queue,
    plan: game.enemies.plan,
    nightT: game.enemies.nightT,
  };
  try {
    s.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** Spielstand laden und auf das Spiel anwenden. Liefert true bei Erfolg. */
export function loadGame(game) {
  const s = storage();
  if (!s) return false;
  let d;
  try {
    d = JSON.parse(s.getItem(KEY));
  } catch {
    return false;
  }
  if (!d || d.v !== VERSION) return false;

  game.newGame(d.seed, { empty: true });
  game.time = d.time;
  Object.assign(game.cycle, d.cycle);
  Object.assign(game.stock, d.stock);
  Object.assign(game.stats, d.stats);

  // Ressourcenknoten
  const w = game.world;
  d.nodes.forEach(([amount, timer, removed], i) => {
    const n = w.nodes[i];
    if (!n) return;
    n.amount = amount;
    n.timer = timer;
    if (removed) w.removeNode(n);
  });

  // Gebäude (Zentrum wurde von newGame bereits angelegt)
  const blds = [];
  for (const bd of d.buildings) {
    const b = bd.type === 'center' ? game.buildings.center : game.buildings.add(bd.type, bd.tx, bd.ty);
    b.hp = bd.hp;
    b.timer = bd.timer || 0;
    b.growth = bd.growth || 0;
    blds.push(b);
  }

  // Siedler
  const st = game.settlers;
  st.focus = d.focus || 'auto';
  for (const sd of d.settlers) {
    const p = st.spawn(sd.x, sd.y);
    Object.assign(p, { name: sd.name, hp: sd.hp, hunger: sd.hunger, thirst: sd.thirst, carry: sd.carry, tunic: sd.tunic, hair: sd.hair });
    const farm = blds[sd.farm];
    if (farm && farm.type === 'farm') {
      p.job = 'farm';
      p.farm = farm;
      farm.worker = p;
    }
    const home = blds[sd.home];
    if (sd.hidden && home) {
      p.hidden = true;
      p.home = home;
      home.sleepers.push(p);
    }
  }
  st.nameIdx = d.nameIdx ?? d.settlers.length;

  // Spieler
  const pl = game.player;
  Object.assign(pl, { x: d.player.x, y: d.player.y, hp: d.player.hp, dead: !!d.player.dead, respawnT: d.player.respawnT || 0 });
  Object.assign(pl.inv, d.player.inv);
  game.camera.snap(pl.x, pl.y);

  // Gegner und Wellenplan
  const en = game.enemies;
  for (const ed of d.enemies) {
    const e = en.spawn(ed.type, ed.x, ed.y);
    Object.assign(e, { hp: ed.hp, maxHp: ed.maxHp, dmg: ed.dmg, speed: ed.speed });
  }
  game.loot.restore(d.loot);
  en.queue = d.queue || [];
  en.plan = d.plan || null;
  en.nightT = d.nightT || 0;
  return true;
}
