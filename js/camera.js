// camera.js – Kamera mit weichem Folgen, ganzzahligem Pixel-Zoom und Kartenbegrenzung.

import { TILE, MAP_W, MAP_H } from './config.js';
import { clamp } from './util.js';

export class Camera {
  constructor() {
    this.x = 0;           // Mittelpunkt in Weltkoordinaten
    this.y = 0;
    this.zoom = 3;        // Bildschirmpixel pro Weltpixel (ganzzahlig für Pixel-Look)
    this.zoomBias = 0;    // Spieler-Anpassung per Mausrad
    this.vw = 800;        // Viewport in Canvas-Pixeln
    this.vh = 600;
    this.shake = 0;       // Bildschirmwackeln (Restdauer)
    this.shakeMag = 0;
  }

  resize(w, h) {
    this.vw = w;
    this.vh = h;
    this.updateZoom();
  }

  /** Basiszoom so wählen, dass ~40 Kacheln in der Breite sichtbar sind. */
  updateZoom() {
    const base = clamp(Math.floor(Math.min(this.vw / 480, this.vh / 290)), 2, 6);
    this.zoom = clamp(base + this.zoomBias, 1, 8);
  }

  addZoom(d) {
    this.zoomBias = clamp(this.zoomBias + d, -3, 3);
    this.updateZoom();
  }

  get viewW() {
    return this.vw / this.zoom;
  }
  get viewH() {
    return this.vh / this.zoom;
  }

  /** Sofort auf Position springen. */
  snap(x, y) {
    this.x = x;
    this.y = y;
    this.clampToMap();
  }

  follow(tx, ty, dt) {
    const k = 1 - Math.exp(-dt * 8);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
    this.clampToMap();
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt);
  }

  addShake(mag, dur = 0.25) {
    this.shakeMag = Math.max(this.shakeMag * (this.shake > 0 ? 1 : 0), mag);
    this.shake = Math.max(this.shake, dur);
  }

  clampToMap() {
    const mw = MAP_W * TILE, mh = MAP_H * TILE;
    const hw = this.viewW / 2, hh = this.viewH / 2;
    this.x = mw > hw * 2 ? clamp(this.x, hw, mw - hw) : mw / 2;
    this.y = mh > hh * 2 ? clamp(this.y, hh, mh - hh) : mh / 2;
  }

  /** Linke obere Ecke der Sicht (auf Bildschirmpixel gerundet). */
  get left() {
    return Math.round((this.x - this.viewW / 2) * this.zoom) / this.zoom;
  }
  get top() {
    return Math.round((this.y - this.viewH / 2) * this.zoom) / this.zoom;
  }

  /** Setzt die Weltransformation auf den Kontext (inkl. Wackeln). */
  apply(ctx) {
    let sx = 0, sy = 0;
    if (this.shake > 0) {
      sx = Math.round((Math.random() - 0.5) * this.shakeMag * 2);
      sy = Math.round((Math.random() - 0.5) * this.shakeMag * 2);
    }
    ctx.setTransform(this.zoom, 0, 0, this.zoom, Math.round(-this.left * this.zoom) + sx, Math.round(-this.top * this.zoom) + sy);
  }

  screenToWorld(px, py) {
    return { x: px / this.zoom + this.left, y: py / this.zoom + this.top };
  }
  worldToScreen(wx, wy) {
    return { x: (wx - this.left) * this.zoom, y: (wy - this.top) * this.zoom };
  }

  /** Ist ein Rechteck (Weltkoordinaten) sichtbar? */
  visible(x, y, w, h, margin = 32) {
    const l = this.left, t = this.top;
    return x + w > l - margin && x < l + this.viewW + margin && y + h > t - margin && y < t + this.viewH + margin;
  }
}
