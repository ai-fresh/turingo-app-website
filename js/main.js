/* ============================================================
   TURINGO — main.js
   1. TuringoRenderer — Canvas-based face (1:1 macOS app spec)
   2. Global rAF animation loop
   3. Hero state cycler
   4. Copy-to-clipboard
   5. Scroll reveal
   ============================================================ */

// ── 1. LED COLORS (exact from EmotionalState.swift) ──────────

const LED_COLORS = {
  idle:      '#33b2ff',  // rgb(0.2, 0.7, 1.0)
  thinking:  '#9933ff',  // rgb(0.6, 0.3, 1.0)
  listening: '#ffbf1a',  // rgb(1.0, 0.75, 0.1)
  speaking:  '#1ae666',  // rgb(0.1, 0.9, 0.5)
  happy:     '#1af266',  // rgb(0.1, 0.95, 0.4)
  excited:   '#ffe61a',  // rgb(1.0, 0.9, 0.1)
  focused:   '#8c1aff',  // rgb(0.55, 0.1, 1.0)
  confused:  '#e666e6',  // rgb(0.9, 0.4, 0.9)
  annoyed:   '#ff4d1a',  // rgb(1.0, 0.3, 0.1)
  surprised: '#ffffff',  // rgb(1.0, 1.0, 1.0)
  sleepy:    '#6666b3',  // rgb(0.4, 0.4, 0.7)
  learning:  '#1ad9ff',  // rgb(0.1, 0.85, 1.0)
  proud:     '#ffbf1a',  // rgb(1.0, 0.75, 0.1)
  sad:       '#4d80e6',  // rgb(0.3, 0.5, 0.9)
};

// ── 2. EYE PATTERNS (4 cols × 3 rows, row-major) ─────────────
// Matches EyePattern statics in TuringoFaceView.swift exactly.

const EYE_PATTERNS = {
  open:      [0,1,1,0, 1,1,1,1, 0,1,1,0],
  happy:     [1,0,0,1, 0,1,1,0, 0,0,0,0],
  sad:       [0,0,0,0, 1,1,1,1, 1,0,0,1],
  angry:     [1,0,0,1, 1,1,1,1, 0,1,1,0],
  surprised: [1,1,1,1, 1,0,0,1, 1,1,1,1],
  sleepy:    [0,0,0,0, 0,1,1,0, 0,1,1,0],
  thinking:  [0,0,1,0, 0,1,1,1, 0,0,1,0],
  confused:  [1,0,1,0, 0,1,0,1, 1,0,1,0],
};

// State → pattern name
function eyePatternForState(state) {
  switch (state) {
    case 'idle': case 'listening': case 'speaking': return 'open';
    case 'happy': case 'proud':  return 'happy';
    case 'excited': case 'surprised': return 'surprised';
    case 'focused': case 'learning': return 'thinking'; // scan applied at render time
    case 'confused': return 'confused';
    case 'annoyed': return 'angry';
    case 'sleepy': return 'sleepy';
    case 'sad': return 'sad';
    case 'thinking': return 'thinking'; // scan applied at render time
    default: return 'open';
  }
}

// Build scan pattern: scanCol = floor(t*3) % 4
// lit column gets 1.0, all others get 0.15
function buildScanPattern(scanCol) {
  const dots = new Array(12).fill(0.15);
  for (let row = 0; row < 3; row++) {
    dots[row * 4 + scanCol] = 1.0;
  }
  return dots;
}

// eyeOpenness per state (from EmotionalState.swift)
const EYE_OPENNESS = {
  surprised: 1.45, excited: 1.45,
  listening: 1.2,  learning: 1.2,
  idle: 1.0,       happy: 1.0,    thinking: 1.0, speaking: 1.0,
  focused: 0.72,   annoyed: 0.72, confused: 0.72, proud: 0.72,
  sad: 0.85,
  sleepy: 0.28,
};

// ── 3. ANTENNA SWAY per state ────────────────────────────────
// Matches AntennaStyle switch in TuringoFaceView.swift.
// On the website "isConnected" is always true.

function antennaSwayForState(state, t) {
  switch (state) {
    case 'idle':     return Math.sin(t * 3.2) * 6;
    case 'thinking': return Math.sin(t * 8)   * 3;
    case 'speaking': return Math.sin(t * 6)   * 5 + Math.sin(t * 11) * 2;
    case 'learning': return Math.sin(t * 1.5) * 10;
    case 'proud':    return Math.sin(t * 1.0) * 2;
    case 'confused': return Math.sin(t * 15)  * 4 + Math.sin(t * 7) * 2;
    case 'excited':  return Math.sin(t * 12)  * 8;
    case 'happy':    return Math.sin(t * 4)   * 8;
    case 'listening':return Math.sin(t * 1.5) * 10;
    case 'annoyed':  return Math.sin(t * 15)  * 4 + Math.sin(t * 7) * 2;
    case 'sleepy':   return -8 + Math.sin(t * 0.8) * 2;
    case 'surprised':return Math.sin(t * 20)  * 5;
    case 'focused':  return Math.sin(t * 1.0) * 2;
    case 'sad':      return 6 + Math.sin(t * 1.2) * 1;
    default:         return Math.sin(t * 3.2) * 6;
  }
}

// ── 4. MOUTH STYLE per state ──────────────────────────────────

function mouthStyleForState(state) {
  switch (state) {
    case 'happy': case 'proud': case 'excited': return 'smile';
    case 'sad': case 'annoyed': return 'frown';
    case 'speaking': return 'talking';
    case 'surprised': return 'open';
    default: return 'flat'; // idle, thinking, listening, focused, confused, learning, sleepy
  }
}

// ── 5. TuringoRenderer ───────────────────────────────────────

class TuringoRenderer {
  constructor(canvas, state = 'idle') {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.state  = state;
    this.t      = 0;

    // blink: blinkProgress=1 means fully open, 0 means fully closed
    this.blinkTimer    = 0;
    this.blinkActive   = false;
    this.blinkProgress = 1;
    this.nextBlinkAt   = 3 + Math.random() * 3;
  }

  setState(state) {
    this.state = state;
  }

  update(dt) {
    // blink timer
    this.blinkTimer += dt;
    if (!this.blinkActive && this.blinkTimer >= this.nextBlinkAt) {
      this.blinkActive  = true;
      this.blinkTimer   = 0;
      this.nextBlinkAt  = 3 + Math.random() * 4;
    }
    if (this.blinkActive) {
      const BLINK_DUR = 0.12;
      const progress  = this.blinkTimer / BLINK_DUR;
      if (progress < 0.5) {
        this.blinkProgress = 1 - progress * 2;       // closing
      } else if (progress < 1) {
        this.blinkProgress = (progress - 0.5) * 2;  // opening
      } else {
        this.blinkActive   = false;
        this.blinkProgress = 1;
        this.blinkTimer    = 0;
      }
    }
  }

  draw(t) {
    this.t = t;
    const ctx = this.ctx;
    const W   = this.canvas.width;
    const H   = this.canvas.height;
    const s   = W / 200; // scale factor — logical size is 200×130

    ctx.clearRect(0, 0, W, H);
    this._drawAntenna(ctx, W, H, s, t);
    this._drawBody(ctx, W, H, s, t);
    this._drawEyes(ctx, W, H, s, t);
    this._drawMouth(ctx, W, H, s, t);
  }

  _ledColor() {
    return LED_COLORS[this.state] || LED_COLORS.idle;
  }

  // ── Body ────────────────────────────────────────────────────
  // drawBody: rect x=4s, y=42s, w=192s, h=84s, cornerRadius=20s
  // Fill: rgba(28,28,40,0.98)
  // Inner radial gradient overlay at opacity 0.12
  // Border: ledColor at opacity 0.25, lineWidth=1.0s
  _drawBody(ctx, W, H, s, t) {
    const color = this._ledColor();
    const x = 4 * s, y = 42 * s, w = (W - 8 * s), h = 84 * s;
    const r = 20 * s;

    // 1. Fill
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = 'rgba(28,28,40,0.98)';
    ctx.fill();
    ctx.restore();

    // 2. Inner radial gradient overlay (opacity 0.12)
    // center: (W/2, H/2 + 20*s) — matches Swift: size.width/2, size.height/2 + 20*scale
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.clip();
    const gcx = W / 2, gcy = H / 2 + 20 * s;
    const grad = ctx.createRadialGradient(gcx, gcy, 10 * s, gcx, gcy, 90 * s);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
    ctx.restore();

    // 3. Border: ledColor at opacity 0.25, lineWidth=1.0*s
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.0 * s;
    ctx.stroke();
    ctx.restore();
  }

  // ── LED Eye ──────────────────────────────────────────────────
  // drawLEDEye: 4 cols × 3 rows
  _drawLEDEye(ctx, cx, cy, s, t, blink, pulse) {
    const state = this.state;
    const color = this._ledColor();
    const cols = 4, rows = 3;
    const dotW = 5.0 * s;
    const dotH = 4.5 * s;
    const gapX = 4.0 * s;
    const openness = EYE_OPENNESS[state] ?? 1.0;
    const gapY = 4.0 * s * Math.max(0.3, Math.min(1.6, openness));
    const totalW = cols * dotW + (cols - 1) * gapX;
    const totalH = rows * dotH + (rows - 1) * gapY;

    // Determine pattern dots
    let dots;
    if (state === 'thinking' || state === 'learning') {
      const scanCol = Math.floor(t * 3) % 4;
      dots = buildScanPattern(scanCol);
    } else {
      dots = EYE_PATTERNS[eyePatternForState(state)] || EYE_PATTERNS.open;
    }

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col;
        let brightness = dots[idx];

        // Blink: compress rows toward center
        // rowF = row - (rows-1)/2 = row - 1.0
        const rowF = row - 1.0;
        const blinkFactor = Math.max(0, 1.0 - Math.abs(rowF) * (1.0 - blink) * 1.5);
        brightness *= blinkFactor;

        // Pulse on lit dots (brightness > 0.5)
        if (brightness > 0.5) {
          brightness *= (0.75 + pulse * 0.25);
        }

        const dx = col * (dotW + gapX) - totalW / 2 + dotW / 2;
        const dy = row * (dotH + gapY) - totalH / 2 + dotH / 2;

        const rx = cx + dx - dotW / 2;
        const ry = cy + dy - dotH / 2;

        if (brightness < 0.05) {
          // Dim placeholder dot
          ctx.save();
          ctx.globalAlpha = 0.12;
          ctx.fillStyle = 'rgb(77,77,128)';
          ctx.beginPath();
          ctx.roundRect(rx, ry, dotW, dotH, 1.5 * s);
          ctx.fill();
          ctx.restore();
          continue;
        }

        // Glow ellipse: inset -1.5s, opacity = brightness * 0.30
        ctx.save();
        ctx.globalAlpha = brightness * 0.30;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(
          cx + dx, cy + dy,
          (dotW / 2 + 1.5 * s), (dotH / 2 + 1.5 * s),
          0, 0, Math.PI * 2
        );
        ctx.fill();
        ctx.restore();

        // Dot fill: roundedRect, opacity = 0.3 + brightness * 0.7
        ctx.save();
        ctx.globalAlpha = 0.3 + brightness * 0.7;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(rx, ry, dotW, dotH, 1.5 * s);
        ctx.fill();
        ctx.restore();

        // Specular highlight (brightness > 0.7)
        if (brightness > 0.7) {
          ctx.save();
          ctx.globalAlpha = brightness * 0.5;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.roundRect(
            rx + 1 * s,
            ry + 0.5 * s,
            dotW * 0.45,
            dotH * 0.4,
            1 * s
          );
          ctx.fill();
          ctx.restore();
        }
      }
    }
  }

  _drawEyes(ctx, W, H, s, t) {
    const pulse = (Math.sin(t * 2.5) + 1) / 2;
    const blink = this.blinkProgress;

    // Eye centers: leftEyeCX = W/2 - 40*s, rightEyeCX = W/2 + 40*s
    // eyeCY = H/2 + 16*s  (= 65+16=81 at s=1)
    const leftEyeCX  = W / 2 - 40 * s;
    const rightEyeCX = W / 2 + 40 * s;
    const eyeCY      = H / 2 + 16 * s;

    this._drawLEDEye(ctx, leftEyeCX,  eyeCY, s, t, blink, pulse);
    this._drawLEDEye(ctx, rightEyeCX, eyeCY, s, t, blink, pulse);
  }

  // ── Mouth ────────────────────────────────────────────────────
  // cx = W/2, cy = H/2 + 36*s, w = 40*s
  _drawMouth(ctx, W, H, s, t) {
    const color = this._ledColor();
    const cx = W / 2;
    const cy = H / 2 + 36 * s;
    const w  = 40 * s;
    const style = mouthStyleForState(this.state);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle   = color;
    ctx.lineCap     = 'round';

    switch (style) {
      case 'flat': {
        // horizontal line from (cx-w/2, cy) to (cx+w/2, cy)
        // opacity=0.5, lineWidth=2*s
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 2 * s;
        ctx.beginPath();
        ctx.moveTo(cx - w / 2, cy);
        ctx.lineTo(cx + w / 2, cy);
        ctx.stroke();
        break;
      }
      case 'smile': {
        // quadCurve from (cx-w/2, cy-2s) to (cx+w/2, cy-2s), control=(cx, cy+8s)
        // lineWidth=2.5s
        ctx.globalAlpha = 1.0;
        ctx.lineWidth = 2.5 * s;
        ctx.beginPath();
        ctx.moveTo(cx - w / 2, cy - 2 * s);
        ctx.quadraticCurveTo(cx, cy + 8 * s, cx + w / 2, cy - 2 * s);
        ctx.stroke();
        break;
      }
      case 'frown': {
        // quadCurve from (cx-w/2, cy+4s) to (cx+w/2, cy+4s), control=(cx, cy-4s)
        // lineWidth=2.5s
        ctx.globalAlpha = 1.0;
        ctx.lineWidth = 2.5 * s;
        ctx.beginPath();
        ctx.moveTo(cx - w / 2, cy + 4 * s);
        ctx.quadraticCurveTo(cx, cy - 4 * s, cx + w / 2, cy + 4 * s);
        ctx.stroke();
        break;
      }
      case 'talking': {
        // 5 vertical bars, spec from drawMouth .talking case
        // dx = (i-2)*9*s, wave=sin(t*8+i*0.8), dotH=(3+(wave+1)*3)*s
        // x=cx+dx-2.5s, width=5s
        for (let i = 0; i < 5; i++) {
          const dx   = (i - 2) * 9 * s;
          const wave = Math.sin(t * 8 + i * 0.8);
          const barH = (3 + (wave + 1) * 3) * s;
          const bx   = cx + dx - 2.5 * s;
          const by   = cy - barH / 2;
          ctx.globalAlpha = 0.7 + (wave + 1) * 0.15;
          ctx.beginPath();
          ctx.roundRect(bx, by, 5 * s, barH, 1.5 * s);
          ctx.fill();
        }
        break;
      }
      case 'open': {
        // rect cx-10s, cy-4s, width=20s, height=8s, cornerRadius=3s, opacity=0.8
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.roundRect(cx - 10 * s, cy - 4 * s, 20 * s, 8 * s, 3 * s);
        ctx.fill();
        break;
      }
    }

    ctx.restore();
  }

  // ── Antenna ──────────────────────────────────────────────────
  // baseX = W/2 (cx), baseY = 48*s
  // stemLen = 28*s, ballR = 5.5*s
  // On website: isConnected = true always
  _drawAntenna(ctx, W, H, s, t) {
    const color  = this._ledColor();
    const cx     = W / 2;
    const baseY  = 48 * s;
    const stemLen = 28 * s;
    const ballR  = 5.5 * s;
    const pulse  = (Math.sin(t * 4.5) + 1) / 2;

    // sway in logical units * s
    const swayLogical = antennaSwayForState(this.state, t);
    const sway  = swayLogical * s;
    const sway2 = sway * 0.5;

    // Stem: bezier from (cx, baseY) to (cx+sway, baseY-stemLen)
    // control1=(cx+sway2, baseY-stemLen*0.35), control2=(cx+sway, baseY-stemLen*0.7)
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2.0 * s;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, baseY);
    ctx.bezierCurveTo(
      cx + sway2,  baseY - stemLen * 0.35,
      cx + sway,   baseY - stemLen * 0.7,
      cx + sway,   baseY - stemLen
    );
    ctx.stroke();
    ctx.restore();

    const ballCX = cx + sway;
    const ballCY = baseY - stemLen - 5 * s;

    // Outer glow: ellipse radius=ballR*2.8, opacity=0.25+pulse*0.45
    ctx.save();
    ctx.globalAlpha = 0.25 + pulse * 0.45;
    const gR = ballR * 2.8;
    const gGrad = ctx.createRadialGradient(ballCX, ballCY, 0, ballCX, ballCY, gR);
    gGrad.addColorStop(0, color);
    gGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gGrad;
    ctx.beginPath();
    ctx.ellipse(ballCX, ballCY, gR, gR, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Ball: radialGradient white→ledColor, center offset (-1s,-1.5s) for specular
    ctx.save();
    const bGrad = ctx.createRadialGradient(
      ballCX - 1 * s, ballCY - 1.5 * s, 0,
      ballCX,          ballCY,           ballR
    );
    bGrad.addColorStop(0, '#ffffff');
    bGrad.addColorStop(1, color);
    ctx.fillStyle = bGrad;
    ctx.beginPath();
    ctx.arc(ballCX, ballCY, ballR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Two arcs at ballR+6s and ballR+12s
    // startAngle=220°, endAngle=320°, clockwise=false (anticlockwise in canvas terms)
    // arc1 opacity: 0.55+pulse*0.35, arc2 opacity: 0.3+pulse*0.25
    const arcStart = 220 * Math.PI / 180;
    const arcEnd   = 320 * Math.PI / 180;
    for (let arc = 1; arc <= 2; arc++) {
      const arcR   = ballR + arc * 6 * s;
      const arcOpa = arc === 1 ? (0.55 + pulse * 0.35) : (0.3 + pulse * 0.25);
      ctx.save();
      ctx.globalAlpha = arcOpa;
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1.5 * s;
      ctx.lineCap     = 'round';
      ctx.beginPath();
      ctx.arc(ballCX, ballCY, arcR, arcStart, arcEnd, false);
      ctx.stroke();
      ctx.restore();
    }
  }
}

// ── 6. GLOBAL ANIMATION LOOP ─────────────────────────────────

const allRenderers = [];
let rafLastTime    = null;
const rafStartTime = Date.now();

function rafLoop(ts) {
  if (rafLastTime === null) rafLastTime = ts;
  const dt = Math.min((ts - rafLastTime) / 1000, 0.1); // seconds, capped at 100ms
  rafLastTime = ts;
  const t = (Date.now() - rafStartTime) / 1000;

  for (const r of allRenderers) {
    r.update(dt);
    r.draw(t);
  }

  requestAnimationFrame(rafLoop);
}

// ── 7. FACE WIDGET INIT ──────────────────────────────────────

const STATE_CYCLE = [
  'idle', 'listening', 'thinking', 'speaking',
  'happy', 'excited', 'focused', 'confused',
  'sleepy', 'annoyed', 'surprised', 'learning',
  'proud', 'sad',
];
let currentStateIdx = 0;
let heroRenderer    = null;

function initFaceWidget() {
  document.querySelectorAll('.turingo-canvas').forEach(canvas => {
    const state    = canvas.dataset.state || 'idle';
    const renderer = new TuringoRenderer(canvas, state);
    allRenderers.push(renderer);

    if (canvas.dataset.hero === 'true') {
      heroRenderer = renderer;
    }
  });

  // Start global rAF loop
  requestAnimationFrame(rafLoop);

  // Cycle hero through all states
  if (heroRenderer) {
    setInterval(() => {
      currentStateIdx = (currentStateIdx + 1) % STATE_CYCLE.length;
      const newState  = STATE_CYCLE[currentStateIdx];
      heroRenderer.setState(newState);

      const heroCanvas = document.querySelector('.turingo-canvas[data-hero="true"]');
      if (heroCanvas) heroCanvas.dataset.state = newState;

      const indicator = document.querySelector('.state-indicator');
      if (indicator) indicator.textContent = newState;
    }, 2800);
  }
}


// ── 8. COPY TO CLIPBOARD ─────────────────────────────────────

function initCopyButtons() {
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const codeBlock = btn.closest('.code-block');
      const pre = codeBlock.querySelector('pre');
      const text = pre.innerText || pre.textContent;
      const lang = document.documentElement.lang || 'pl';
      const copiedLabel = lang === 'en' ? '✓ copied' : '✓ skopiowano';
      const defaultLabel = lang === 'en' ? 'copy' : 'kopiuj';

      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = copiedLabel;
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = defaultLabel;
          btn.classList.remove('copied');
        }, 2000);
      }).catch(() => {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity  = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        btn.textContent = copiedLabel;
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = defaultLabel;
          btn.classList.remove('copied');
        }, 2000);
      });
    });
  });
}


// ── 9. SCROLL REVEAL ─────────────────────────────────────────

function initScrollReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}


// ── 10. VIDEO PLAYER ──────────────────────────────────────────

let _switchVideoLang = null;

function initVideoPlayer() {
  const video   = document.getElementById('demo-video');
  const overlay = document.getElementById('video-overlay');
  const title   = document.getElementById('video-overlay-title');
  if (!video) return;

  const VIDEOS = {
    pl: { src: 'videos/turingo-demo-pl.mp4', poster: 'videos/thumb-pl.jpg', label: 'Demo — Polski' },
    en: { src: 'videos/turingo-demo-en.mp4', poster: 'videos/thumb-en.jpg', label: 'Demo — English' },
  };

  function switchLang(lang) {
    const v = VIDEOS[lang];
    video.pause();
    video.src = v.src;
    video.poster = v.poster;
    title.textContent = v.label;
    overlay.classList.remove('hidden');
    video.load();
  }

  _switchVideoLang = switchLang;

  overlay.addEventListener('click', () => {
    overlay.classList.add('hidden');
    video.play();
  });

  video.addEventListener('ended', () => {
    overlay.classList.remove('hidden');
  });
}


// ── 11. LANGUAGE SWITCHER ─────────────────────────────────────

function applyLang(lang) {
  document.documentElement.lang = lang;

  document.querySelectorAll('[data-pl]:not([data-pl-html])').forEach(el => {
    el.textContent = el.dataset[lang] || el.dataset.pl;
  });

  document.querySelectorAll('[data-pl-html]').forEach(el => {
    const key = lang === 'en' ? 'enHtml' : 'plHtml';
    el.innerHTML = el.dataset[key] || el.dataset.plHtml;
  });

  document.title = lang === 'en'
    ? 'Turingo — AI Companion for macOS'
    : 'Turingo — AI Companion dla macOS';

  const btn = document.getElementById('lang-toggle');
  if (btn) btn.textContent = lang === 'pl' ? '🇬🇧 EN' : '🇵🇱 PL';

  if (_switchVideoLang) _switchVideoLang(lang);

  const waitlistFrame = document.getElementById('waitlist-frame');
  if (waitlistFrame) {
    waitlistFrame.src = `https://st.backend.onelo.tools/api/waitlist/turingo-app?lang=${lang}`;
  }
}

function initLangSwitcher() {
  const saved = localStorage.getItem('turingoLang');
  const browser = navigator.language || navigator.userLanguage || 'pl';
  const lang = saved || (browser.startsWith('pl') ? 'pl' : 'en');
  applyLang(lang);

  const btn = document.getElementById('lang-toggle');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const next = document.documentElement.lang === 'pl' ? 'en' : 'pl';
    applyLang(next);
    localStorage.setItem('turingoLang', next);
  });
}


// ── INIT ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initFaceWidget();
  initCopyButtons();
  initScrollReveal();
  initVideoPlayer();
  initLangSwitcher();
});

function handleCtaSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('cta-email').value;
  console.log('[CTA] email:', email);
  document.getElementById('cta-form').style.display = 'none';
  document.getElementById('cta-success').style.display = 'block';
}
