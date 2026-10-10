// player.js – der Spieler: Bewegung, Zeichnen. (Sammeln, Kampf und Inventar folgen in späteren Phasen.)

import { TILE } from './config.js';
import { drawHumanoid } from './sprites.js';

export class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.r = 4;           // Kollisionsradius
    this.speed = 72;      // Welteinheiten pro Sekunde
    this.flip = false;
    this.walk = 0;        // Laufanimationsphase
    this.moving = false;
    this.aimX = 1;        // Blickrichtung (normiert)
    this.aimY = 0;
  }

  get tx() {
    return Math.floor(this.x / TILE);
  }
  get ty() {
    return Math.floor(this.y / TILE);
  }

  update(dt, game) {
    const { input, world } = game;
    const ax = input.axis();
    this.moving = ax.x !== 0 || ax.y !== 0;
    if (this.moving) {
      world.moveEntity(this, ax.x * this.speed * dt, ax.y * this.speed * dt, this.r, world.solidFriendly);
      this.walk += dt * 12;
      this.aimX = ax.x;
      this.aimY = ax.y;
      const l = Math.hypot(this.aimX, this.aimY);
      this.aimX /= l;
      this.aimY /= l;
      if (ax.x !== 0) this.flip = ax.x < 0;
    } else {
      this.walk = 0;
    }
  }

  draw(ctx) {
    drawHumanoid(ctx, this.x, this.y, {
      flip: this.flip, walk: this.moving ? this.walk : 0,
      tunic: '#a8322c', skin: '#c99a6e', helmet: '#b8a04a', plume: '#c0392b', belt: '#6b4a2a',
    });
  }
}
