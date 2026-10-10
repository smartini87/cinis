// input.js – Tastatur, Maus und Touch. Hält gedrückte Tasten und Flanken (pro Frame).

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();      // aktuell gehaltene Tasten (KeyboardEvent.code)
    this.pressed = new Set();   // in diesem Frame neu gedrückt
    this.mouse = { x: 0, y: 0, down: false, clicked: false, rightClicked: false, wheel: 0, inside: false };
    this.usingTouch = false;
    // Virtueller Joystick (Touch): Ursprung + aktuelle Auslenkung in Canvas-Pixeln
    this.stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };
    this.tapId = -1;
    this._bind();
  }

  _toCanvas(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const sx = this.canvas.width / r.width, sy = this.canvas.height / r.height;
    return { x: (clientX - r.left) * sx, y: (clientY - r.top) * sy };
  }

  _bind() {
    const c = this.canvas;
    window.addEventListener('keydown', (e) => {
      if (e.target && e.target.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.down = false;
      this.stick.active = false;
    });

    c.addEventListener('mousemove', (e) => {
      const p = this._toCanvas(e.clientX, e.clientY);
      this.mouse.x = p.x;
      this.mouse.y = p.y;
      this.mouse.inside = true;
      this.usingTouch = false;
    });
    c.addEventListener('mouseleave', () => (this.mouse.inside = false));
    c.addEventListener('mousedown', (e) => {
      const p = this._toCanvas(e.clientX, e.clientY);
      this.mouse.x = p.x;
      this.mouse.y = p.y;
      if (e.button === 0) {
        this.mouse.down = true;
        this.mouse.clicked = true;
      } else if (e.button === 2) {
        this.mouse.rightClicked = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.down = false;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.mouse.wheel += Math.sign(e.deltaY);
    }, { passive: false });

    // Touch: linke Bildschirmhälfte = Joystick, sonst Tippen = Aktion/Bauen an der Stelle
    c.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.usingTouch = true;
      for (const t of e.changedTouches) {
        const p = this._toCanvas(t.clientX, t.clientY);
        if (p.x < this.canvas.width * 0.4 && !this.stick.active) {
          Object.assign(this.stick, { active: true, id: t.identifier, ox: p.x, oy: p.y, x: p.x, y: p.y });
        } else if (this.tapId < 0) {
          this.tapId = t.identifier;
          this.mouse.x = p.x;
          this.mouse.y = p.y;
          this.mouse.inside = true;
          this.mouse.down = true;
          this.mouse.clicked = true;
        }
      }
    }, { passive: false });
    c.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const p = this._toCanvas(t.clientX, t.clientY);
        if (t.identifier === this.stick.id) {
          this.stick.x = p.x;
          this.stick.y = p.y;
        } else if (t.identifier === this.tapId) {
          this.mouse.x = p.x;
          this.mouse.y = p.y;
        }
      }
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.stick.id) {
          this.stick.active = false;
          this.stick.id = -1;
        } else if (t.identifier === this.tapId) {
          this.tapId = -1;
          this.mouse.down = false;
        }
      }
    };
    c.addEventListener('touchend', end);
    c.addEventListener('touchcancel', end);
  }

  isDown(...codes) {
    return codes.some((c) => this.keys.has(c));
  }
  wasPressed(...codes) {
    return codes.some((c) => this.pressed.has(c));
  }

  /** Bewegungsrichtung aus WASD/Pfeiltasten bzw. Joystick, normiert auf Länge <= 1. */
  axis() {
    let x = 0, y = 0;
    if (this.isDown('KeyA', 'ArrowLeft')) x -= 1;
    if (this.isDown('KeyD', 'ArrowRight')) x += 1;
    if (this.isDown('KeyW', 'ArrowUp')) y -= 1;
    if (this.isDown('KeyS', 'ArrowDown')) y += 1;
    if (this.stick.active) {
      const dx = this.stick.x - this.stick.ox, dy = this.stick.y - this.stick.oy;
      const maxR = 60 * (window.devicePixelRatio || 1);
      const len = Math.hypot(dx, dy);
      if (len > 8) {
        const k = Math.min(1, len / maxR) / len;
        x += dx * k;
        y += dy * k;
      }
    }
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  /** Flanken zurücksetzen – nach der Verarbeitung eines Frames aufrufen. */
  endFrame() {
    this.pressed.clear();
    this.mouse.clicked = false;
    this.mouse.rightClicked = false;
    this.mouse.wheel = 0;
  }
}
