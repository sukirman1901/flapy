// Static asset manifest. Centralised so we can preload everything
// upfront and switch background/bird sprites without re-fetching.
const ASSET_BASE = 'https://raw.githubusercontent.com/samuelcust/flappy-bird-assets/master';

// Pixel-art heart icon used for the lives HUD. Inline SVG so it scales
// crisply at any size and respects the currentColor for filled/empty.
export const HEART_SVG = `<svg viewBox="0 0 16 14" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" aria-hidden="true">
  <path fill="currentColor" d="M2 1h3v1H2zm9 0h3v1h-3zM1 2h2v1H1zm3 0h2v1H4zm5 0h2v1H9zm5 0h1v1h-1zM0 3h2v1H0zm4 0h2v1H4zm6 0h2v1h-2zm4 0h2v1h-2zM0 4h2v1H0zm14 0h2v1h-2zM0 5h2v1H0zm14 0h2v1h-2zM1 6h1v1H1zm13 0h1v1h-1zM2 7h2v1H2zm10 0h2v1h-2zM3 8h2v1H3zm8 0h2v1h-2zM4 9h2v1H4zm6 0h2v1h-2zM5 10h2v1H5zm4 0h2v1H9zM6 11h2v1H6zm2 0h2v1H8zM7 12h2v1H7z"/>
</svg>`;

export const SKINS = {
  yellow: { label: 'CLASSIC', minScore: 0 },
  red:    { label: 'CRIMSON', minScore: 10 },
  blue:   { label: 'AZURE',   minScore: 20 }
};

// Returns a promise that resolves once an Image has loaded (or errored).
function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(img); // resolve anyway so one bad URL doesn't block
    img.src = url;
  });
}

// Preload every sprite + audio buffer with a progress callback.
// onProgress receives a value 0..1.
export async function preloadAssets(onProgress) {
  const imageUrls = {
    base:        `${ASSET_BASE}/sprites/base.png`,
    pipeGreen:   `${ASSET_BASE}/sprites/pipe-green.png`,
    bgDay:       `${ASSET_BASE}/sprites/background-day.png`,
    bgNight:     `${ASSET_BASE}/sprites/background-night.png`,
    yellowDown:  `${ASSET_BASE}/sprites/yellowbird-downflap.png`,
    yellowMid:   `${ASSET_BASE}/sprites/yellowbird-midflap.png`,
    yellowUp:    `${ASSET_BASE}/sprites/yellowbird-upflap.png`,
    redDown:     `${ASSET_BASE}/sprites/redbird-downflap.png`,
    redMid:      `${ASSET_BASE}/sprites/redbird-midflap.png`,
    redUp:       `${ASSET_BASE}/sprites/redbird-upflap.png`,
    blueDown:    `${ASSET_BASE}/sprites/bluebird-downflap.png`,
    blueMid:     `${ASSET_BASE}/sprites/bluebird-midflap.png`,
    blueUp:      `${ASSET_BASE}/sprites/bluebird-upflap.png`,
  };
  for (let i = 0; i <= 9; i++) {
    imageUrls['num' + i] = `${ASSET_BASE}/sprites/${i}.png`;
  }
  
  const audioUrls = {
    wing:  `${ASSET_BASE}/audio/wing.wav`,
    point: `${ASSET_BASE}/audio/point.wav`,
    hit:   `${ASSET_BASE}/audio/hit.wav`
  };
  
  const audio = new AudioManager();
  const totalAssets =
    Object.keys(imageUrls).length + Object.keys(audioUrls).length;
  let loaded = 0;
  const tick = () => {
    loaded++;
    if (onProgress) onProgress(loaded / totalAssets);
  };
  
  const images = {};
  const imagePromises = Object.entries(imageUrls).map(async ([key, url]) => {
    images[key] = await loadImage(url);
    tick();
  });
  
  const audioPromises = Object.entries(audioUrls).map(async ([key, url]) => {
    await audio.loadSound(key, url);
    tick();
  });
  
  await Promise.all([...imagePromises, ...audioPromises]);
  return { images, audio };
}

// === Leaderboard helpers ===
// Stored as { entries: [{ name, score, ts }] } sorted desc.
// Backed by localStorage today; abstracted so it can be swapped for an online
// store later without touching the game class.
const LEADERBOARD_KEY = 'flappyLeaderboardV1';
const LEADERBOARD_MAX = 10;

export function getLeaderboard() {
  try {
    const raw = localStorage.getItem(LEADERBOARD_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data.entries)) return data.entries;
    }
  } catch (e) {
    // ignore parse errors
  }
  // Migrate from legacy single-score record
  const legacy = localStorage.getItem('flappyHighScoreObj');
  if (legacy) {
    try {
      const d = JSON.parse(legacy);
      if (d && d.score) {
        return [{ name: d.name || 'ANON', score: d.score, ts: Date.now() }];
      }
    } catch (e) {}
  }
  return [];
}

export function submitScore(name, score) {
  const entries = getLeaderboard();
  entries.push({
    name: (name || 'ANON').slice(0, 10).toUpperCase(),
    score: score | 0,
    ts: Date.now()
  });
  entries.sort((a, b) => b.score - a.score || a.ts - b.ts);
  const trimmed = entries.slice(0, LEADERBOARD_MAX);
  localStorage.setItem(LEADERBOARD_KEY, JSON.stringify({ entries: trimmed }));
  // Find rank of the just-added entry (1-based, -1 if not in top 10)
  const rank = trimmed.findIndex(
    (e) => e.name === (name || 'ANON').slice(0, 10).toUpperCase() && e.score === (score | 0)
  );
  return { entries: trimmed, rank: rank === -1 ? -1 : rank + 1 };
}

export function getBestScore() {
  const entries = getLeaderboard();
  return entries.length ? entries[0].score : 0;
}

export class AudioManager {
  constructor() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioContext();
    this.buffers = {};
  }

  async loadSound(name, url) {
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      this.buffers[name] = audioBuffer;
    } catch (e) {
      console.error(`Failed to load sound ${name}:`, e);
    }
  }

  play(name, volume = 0.5) {
    if (!this.buffers[name]) return;
    
    // Resume context if suspended (browser policy)
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    const source = this.ctx.createBufferSource();
    source.buffer = this.buffers[name];
    
    const gainNode = this.ctx.createGain();
    gainNode.gain.value = volume;
    
    source.connect(gainNode);
    gainNode.connect(this.ctx.destination);
    source.start(0);
  }
}

export class FlappyBird {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ images: Record<string, HTMLImageElement>, audio: AudioManager }} assets
   * @param {{ skin?: string }} [opts]
   */
  constructor(canvas, assets, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.assets = assets;
    this.audio = assets.audio;
    
    this.skin = opts.skin && SKINS[opts.skin] ? opts.skin : 'yellow';
    this.applySkin();
    
    // Static sprites
    this.baseImg = assets.images.base;
    this.pipeImg = assets.images.pipeGreen;
    this.bgDayImg = assets.images.bgDay;
    this.bgNightImg = assets.images.bgNight;
    
    // Number sprites for live score
    this.numImgs = [];
    for (let i = 0; i <= 9; i++) {
      this.numImgs.push(assets.images['num' + i]);
    }
    
    this.birdFrameIndex = 0;
    this.birdAnimationTimer = 0;
    this.baseX = 0;
    this.flashAlpha = 0;
    
    // Resize
    this.resize();
    this.resize();
    this._resizeHandler = () => this.resize();
    window.addEventListener('resize', this._resizeHandler);
    
    this.lastTime = performance.now();
    this.reset();
    
    // Start loop
    requestAnimationFrame((time) => this.gameLoop(time));
  }
  
  applySkin() {
    const map = {
      yellow: ['yellowDown', 'yellowMid', 'yellowUp'],
      red:    ['redDown',    'redMid',    'redUp'],
      blue:   ['blueDown',   'blueMid',   'blueUp']
    };
    const keys = map[this.skin] || map.yellow;
    this.birdFrames = keys.map(k => this.assets.images[k]);
  }
  
  setSkin(skin) {
    if (!SKINS[skin]) return;
    this.skin = skin;
    this.applySkin();
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.ctx.imageSmoothingEnabled = false;
  }

  reset() {
    this.bird = {
      x: this.canvas.width / 3,
      y: this.canvas.height / 2,
      velocity: 0,
      radius: 12, // Hitbox radius (diperkecil agar tidak gampang nabrak)
      width: 51,  // 34 * 1.5
      height: 36, // 24 * 1.5
      gravity: 1500, // Gravitasi diturunkan (jatuh lebih lambat)
      jump: -500,    // Loncatan disesuaikan
      rotation: 0
    };
    
    this.pipes = [];
    this.pipeWidth = 80;
    this.pipeGap = 280; // Celah diperlebar untuk ruang Piranha Plant
    this.basePipeSpeed = 220;
    this.pipeSpawnTimer = 0;
    this.flashDuration = 0;
    this.elapsed = 0; // Game-clock for piranha animation
    
    // Lives system: each collision costs one heart instead of instant game over
    this.maxLives = 3;
    this.lives = this.maxLives;
    this.invulnTimer = 0;
    this.updateLivesUI();
    
    this.score = 0;
    this.flashAlpha = 0;
    
    this.gameState = 'START';
    document.getElementById('game-start').classList.remove('hidden');
    document.getElementById('game-over').classList.add('hidden');
    const livesEl = document.getElementById('lives-container');
    if (livesEl) livesEl.classList.remove('hidden');
  }
  
  updateLivesUI() {
    const container = document.getElementById('lives-container');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < this.maxLives; i++) {
      const heart = document.createElement('span');
      heart.className = 'heart ' + (i < this.lives ? 'filled' : 'empty');
      heart.innerHTML = HEART_SVG;
      container.appendChild(heart);
    }
  }
  
  /**
   * Take one hit. Returns true if the run continues, false if game over.
   * On a non-fatal hit we respawn the bird mid-air and clear nearby pipes
   * so the player is not instantly hit again, plus a short invulnerability.
   */
  takeDamage() {
    if (this.gameState !== 'PLAYING' || this.invulnTimer > 0) return true;
    this.lives--;
    this.flashAlpha = 1;
    this.audio.play('hit');
    this.updateLivesUI();
    
    if (this.lives <= 0) {
      this.triggerGameOver();
      return false;
    }
    
    // Respawn: reset bird to mid-air, clear close pipes, grant invuln
    this.bird.y = this.canvas.height / 2;
    this.bird.velocity = 0;
    this.bird.rotation = 0;
    this.invulnTimer = 1.5;
    const safeZone = 250;
    this.pipes = this.pipes.filter((p) => {
      const center = p.x + this.pipeWidth / 2;
      return Math.abs(center - this.bird.x) > safeZone;
    });
    return true;
  }

  flap() {
    if (this.gameState === 'PAUSED') return; // ignore taps while paused
    if (this.gameState === 'START') {
      this.gameState = 'PLAYING';
      document.getElementById('game-start').classList.add('hidden');
      this.bird.velocity = this.bird.jump;
    } else if (this.gameState === 'GAMEOVER') {
      this.reset();
    } else if (this.gameState === 'PLAYING') {
      this.bird.velocity = this.bird.jump;
    }
    
    // Play zero-latency sound
    this.audio.play('wing');
  }

  pause() {
    if (this.gameState !== 'PLAYING') return;
    this.gameState = 'PAUSED';
    const overlay = document.getElementById('pause-overlay');
    if (overlay) overlay.classList.remove('hidden');
  }

  resume() {
    if (this.gameState !== 'PAUSED') return;
    this.gameState = 'PLAYING';
    const overlay = document.getElementById('pause-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  update(dt) {
    // Decrease flash alpha
    if (this.flashAlpha > 0) {
      this.flashAlpha -= dt * 2; // Fade out flash
      if (this.flashAlpha < 0) this.flashAlpha = 0;
    }

    // Frozen state: render only, no physics
    if (this.gameState === 'PAUSED') {
      return;
    }
    
    // Game-clock advances during all non-paused states (drives piranha anim)
    this.elapsed += dt;
    if (this.invulnTimer > 0) this.invulnTimer = Math.max(0, this.invulnTimer - dt);

    if (this.gameState === 'START') {
      this.baseX -= this.basePipeSpeed * dt;
      if (this.baseX <= -336) { // base.png width is 336
        this.baseX = 0;
      }
      
      // Bobbing bird animation
      this.birdAnimationTimer += dt;
      if (this.birdAnimationTimer > 0.1) {
        this.birdFrameIndex = (this.birdFrameIndex + 1) % 3;
        this.birdAnimationTimer = 0;
      }
      return;
    }

    if (this.gameState === 'GAMEOVER') {
      // Pipes and ground stop moving, but bird falls to the ground
      const floorY = this.canvas.height - 112; // base height is 112
      if (this.bird.y + this.bird.radius < floorY) {
        this.bird.velocity += this.bird.gravity * dt;
        this.bird.y += this.bird.velocity * dt;
        
        // Aggressively rotate nose down when dead
        this.bird.rotation = Math.min(Math.PI / 2, this.bird.rotation + (dt * 10));
      } else {
        // Snap to floor
        this.bird.y = floorY - this.bird.radius;
      }
      return;
    }

    // Scroll base
    this.baseX -= this.basePipeSpeed * dt;
    if (this.baseX <= -336) {
      this.baseX = 0;
    }
    
    // Bird animation (flap faster when moving up, stop when falling fast)
    this.birdAnimationTimer += dt;
    if (this.bird.velocity < 0) {
       // Flapping
       if (this.birdAnimationTimer > 0.05) {
         this.birdFrameIndex = (this.birdFrameIndex + 1) % 3;
         this.birdAnimationTimer = 0;
       }
    } else {
       // Falling
       this.birdFrameIndex = 1; // Midflap
    }

    // Physics
    this.bird.velocity += this.bird.gravity * dt;
    this.bird.y += this.bird.velocity * dt;
    
    // Calculate rotation based on velocity
    // Max rotation down is 90 deg (PI/2), max up is -20 deg (-PI/9)
    let targetRotation = Math.min(Math.PI / 2, Math.max(-Math.PI / 9, (this.bird.velocity * 0.1) * Math.PI / 180));
    this.bird.rotation = targetRotation;

    // Floor & Ceiling collision: instant game over (no respawn from floor)
    const floorY = this.canvas.height - 112; // base height is 112
    if (this.bird.y + this.bird.radius > floorY || this.bird.y - this.bird.radius < 0) {
      this.triggerGameOver();
      return;
    }

    // Generate pipes based on time and speed
    const currentSpeed = this.basePipeSpeed + (this.score * 15);
    this.pipeSpawnTimer += dt;
    const spawnInterval = 400 / currentSpeed; // Fixed pixel distance between pipes
    
    if (this.pipeSpawnTimer > spawnInterval) {
      this.pipeSpawnTimer = 0;
      
      const minPipeHeight = 50;
      const maxPipeHeight = this.canvas.height - 112 - this.pipeGap - minPipeHeight;
      const topHeight = Math.floor(Math.random() * (maxPipeHeight - minPipeHeight + 1)) + minPipeHeight;
      
      this.pipes.push({
        x: this.canvas.width,
        topHeight: topHeight,
        bottomY: topHeight + this.pipeGap,
        passed: false,
        hasPiranha: Math.random() < 0.4, // 40% chance
        piranhaOffset: Math.random() * Math.PI * 2 // random animation offset
      });
    }

    // Update pipes (Delta Time)
    for (let i = this.pipes.length - 1; i >= 0; i--) {
      let p = this.pipes[i];
      p.x -= currentSpeed * dt;

      // Update piranha offset using game-clock (resilient to tab suspension)
      if (p.hasPiranha) {
        // progress goes from 0 to 1 and back to 0
        const progress = (Math.sin(this.elapsed * 3.33 + p.piranhaOffset) + 1) / 2;
        p.currentPiranhaHeight = progress * 60; // Max 60px out of pipe
      } else {
        p.currentPiranhaHeight = 0;
      }

      // Collision detection (using circular hitbox)
      const hitTop = (this.bird.x + this.bird.radius > p.x && this.bird.x - this.bird.radius < p.x + this.pipeWidth && this.bird.y - this.bird.radius < p.topHeight);
      const hitBottom = (this.bird.x + this.bird.radius > p.x && this.bird.x - this.bird.radius < p.x + this.pipeWidth && this.bird.y + this.bird.radius > p.bottomY - p.currentPiranhaHeight);
      
      if (hitTop || hitBottom) {
        if (!this.takeDamage()) return;
      }

      // Score update
      if (!p.passed && p.x + this.pipeWidth < this.bird.x - this.bird.width / 2) {
        this.score++;
        p.passed = true;
        this.audio.play('point');
      }

      // Remove off-screen pipes
      if (p.x + this.pipeWidth < 0) {
        this.pipes.splice(i, 1);
      }
    }
    
    if (this.gameState === 'GAMEOVER') {
      document.getElementById('game-over').classList.remove('hidden');
    }
  }

  triggerGameOver() {
    if (this.gameState === 'GAMEOVER') return;
    this.gameState = 'GAMEOVER';
    this.flashAlpha = 1; // trigger white flash
    this.audio.play('hit');
    
    // Hide lives HUD on game over
    const livesEl = document.getElementById('lives-container');
    if (livesEl) livesEl.classList.add('hidden');
    
    // Submit score and update leaderboard
    const playerName = window.playerName || 'ANON';
    const submission = submitScore(playerName, this.score);
    const top = submission.entries;
    const best = top.length ? top[0] : null;
    
    // Update UI
    document.getElementById('game-start').classList.add('hidden');
    const gameOverUI = document.getElementById('game-over');
    if (gameOverUI) {
      gameOverUI.classList.remove('hidden');
      document.getElementById('final-score').innerText = this.score;
      
      const bestDisplay = document.getElementById('best-score');
      if (best) {
        bestDisplay.innerText = `${best.score} (${best.name.slice(0, 4)})`;
      } else {
        bestDisplay.innerText = '0';
      }
      
      // Medal Logic (Using Emoji since asset repository lacks medal images)
      const medalIcon = document.getElementById('medal-icon');
      if (this.score >= 40) medalIcon.innerText = '🏆'; // Platinum/Crown
      else if (this.score >= 30) medalIcon.innerText = '🥇'; // Gold
      else if (this.score >= 20) medalIcon.innerText = '🥈'; // Silver
      else if (this.score >= 10) medalIcon.innerText = '🥉'; // Bronze
      else medalIcon.innerText = ''; // No medal
      
      medalIcon.style.display = this.score >= 10 ? 'block' : 'none';
      
      // Render leaderboard list with current player highlighted
      const board = document.getElementById('leaderboard-list');
      if (board) {
        board.innerHTML = '';
        if (top.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'leaderboard-empty';
          empty.innerText = 'NO SCORES YET';
          board.appendChild(empty);
        } else {
          top.forEach((entry, idx) => {
            const row = document.createElement('div');
            row.className = 'leaderboard-row';
            const isMe = (idx + 1) === submission.rank;
            if (isMe) row.classList.add('is-me');
            row.innerHTML = `
              <span class="lb-rank">${idx + 1}</span>
              <span class="lb-name">${entry.name}</span>
              <span class="lb-score">${entry.score}</span>
            `;
            board.appendChild(row);
          });
        }
      }
      
      // Show rank message
      const rankMsg = document.getElementById('rank-message');
      if (rankMsg) {
        if (submission.rank === 1) {
          rankMsg.innerText = 'NEW BEST!';
          rankMsg.style.display = 'block';
        } else if (submission.rank > 0) {
          rankMsg.innerText = `RANK #${submission.rank}`;
          rankMsg.style.display = 'block';
        } else {
          rankMsg.style.display = 'none';
        }
      }
    }
  }

  // Background flips to night every 10 score for variety
  isNight() {
    return Math.floor(this.score / 10) % 2 === 1;
  }
  
  draw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Draw Background (cover-fit, scrolls with no parallax)
    const bg = this.isNight() ? this.bgNightImg : this.bgDayImg;
    if (bg && bg.complete && bg.naturalWidth !== 0) {
      // Tile horizontally to cover any aspect ratio
      const ratio = bg.naturalHeight / bg.naturalWidth;
      const drawH = this.canvas.height;
      const drawW = drawH / ratio;
      let bx = 0;
      while (bx < this.canvas.width) {
        this.ctx.drawImage(bg, bx, 0, drawW, drawH);
        bx += drawW;
      }
    } else {
      this.ctx.fillStyle = this.isNight() ? '#1a1a3e' : '#4ec0ca';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    
    // Draw Pipes
    this.ctx.fillStyle = '#22c55e'; // Fallback if image fails
    this.pipes.forEach(p => {
      if (this.pipeImg.complete && this.pipeImg.naturalHeight !== 0) {
        const pipeH = this.pipeWidth * (320 / 52); // Natural ratio
        
        // Draw top pipe (flipped vertically)
        this.ctx.save();
        this.ctx.translate(p.x + this.pipeWidth / 2, p.topHeight);
        this.ctx.scale(1, -1);
        this.ctx.drawImage(this.pipeImg, -this.pipeWidth / 2, 0, this.pipeWidth, pipeH);
        // Extend the tube if the pipe is too short to reach the top of screen
        if (pipeH < p.topHeight) {
          // Slice a 10px tall piece of the tube and stretch it
          this.ctx.drawImage(this.pipeImg, 0, 50, 52, 10, -this.pipeWidth / 2, pipeH - 2, this.pipeWidth, p.topHeight - pipeH + 4);
        }
        this.ctx.restore();
        
        // Draw Piranha Plant
        if (p.hasPiranha && p.currentPiranhaHeight > 0) {
          const px = p.x + this.pipeWidth / 2;
          const py = p.bottomY - p.currentPiranhaHeight + 20; // 20px is head base
          const pSize = 3; // Pixel multiplier
          
          this.ctx.save();
          this.ctx.translate(px, py);
          
          // Rotate head up/down slightly based on animation
          this.ctx.rotate(Math.sin(this.elapsed * 5) * 0.1);
          
          // Draw Stem
          this.ctx.fillStyle = '#000000';
          this.ctx.fillRect(-3 * pSize, 0, 6 * pSize, p.currentPiranhaHeight);
          this.ctx.fillStyle = '#16a34a';
          this.ctx.fillRect(-2 * pSize, 0, 4 * pSize, p.currentPiranhaHeight);
          
          // Draw Head Base (Pixel Circle)
          this.ctx.fillStyle = '#000000'; // Outline
          this.ctx.fillRect(-4*pSize, -9*pSize, 8*pSize, 18*pSize);
          this.ctx.fillRect(-6*pSize, -8*pSize, 12*pSize, 16*pSize);
          this.ctx.fillRect(-8*pSize, -6*pSize, 16*pSize, 12*pSize);
          this.ctx.fillRect(-9*pSize, -4*pSize, 18*pSize, 8*pSize);
          
          this.ctx.fillStyle = '#dc2626'; // Red Inner
          this.ctx.fillRect(-3*pSize, -8*pSize, 6*pSize, 16*pSize);
          this.ctx.fillRect(-5*pSize, -7*pSize, 10*pSize, 14*pSize);
          this.ctx.fillRect(-7*pSize, -5*pSize, 14*pSize, 10*pSize);
          this.ctx.fillRect(-8*pSize, -3*pSize, 16*pSize, 6*pSize);
          
          // White Dots
          this.ctx.fillStyle = '#ffffff';
          this.ctx.fillRect(-5*pSize, 2*pSize, 2*pSize, 2*pSize);
          this.ctx.fillRect(3*pSize, -2*pSize, 3*pSize, 3*pSize);
          this.ctx.fillRect(-3*pSize, -5*pSize, 2*pSize, 2*pSize);
          
          // Mouth Animation
          const mouthOpen = (Math.sin(this.elapsed * 6.67) + 1) / 2;
          const openAmount = Math.floor(mouthOpen * 7); // 0 to 6 pixels
          
          if (openAmount > 0) {
            // Erase V-shape for mouth
            this.ctx.globalCompositeOperation = 'destination-out';
            for (let y = 0; y < openAmount; y++) {
               const width = openAmount - y;
               this.ctx.fillRect(-width * pSize, (-9 + y) * pSize, width * 2 * pSize, pSize);
            }
            this.ctx.globalCompositeOperation = 'source-over';
            
            // Draw Black Outline for mouth
            this.ctx.fillStyle = '#000000';
            for (let y = 0; y < openAmount; y++) {
               const width = openAmount - y;
               this.ctx.fillRect((-width - 1) * pSize, (-9 + y) * pSize, pSize, pSize);
               this.ctx.fillRect((width) * pSize, (-9 + y) * pSize, pSize, pSize);
            }
            
            // Draw White Teeth
            this.ctx.fillStyle = '#ffffff';
            for (let y = 0; y < openAmount; y++) {
               const width = openAmount - y;
               if (y % 2 === 0) {
                  this.ctx.fillRect((-width) * pSize, (-9 + y) * pSize, pSize, pSize);
                  this.ctx.fillRect((width - 1) * pSize, (-9 + y) * pSize, pSize, pSize);
               }
            }
          }
          
          this.ctx.restore();
        }
        
        // Draw bottom pipe
        this.ctx.drawImage(this.pipeImg, p.x, p.bottomY, this.pipeWidth, pipeH);
        // Extend the tube if the pipe is too short to reach the bottom of screen
        if (p.bottomY + pipeH < this.canvas.height) {
          this.ctx.drawImage(this.pipeImg, 0, 50, 52, 10, p.x, p.bottomY + pipeH - 2, this.pipeWidth, this.canvas.height - (p.bottomY + pipeH) + 4);
        }
      } else {
        // Fallback simple neon pipes
        this.ctx.shadowColor = '#4ade80';
        this.ctx.shadowBlur = 15;
        this.ctx.fillRect(p.x, 0, this.pipeWidth, p.topHeight);
        this.ctx.fillRect(p.x, p.bottomY, this.pipeWidth, this.canvas.height - p.bottomY);
        this.ctx.shadowBlur = 0;
      }
    });

    // Draw Base (Scrolling Ground)
    const baseHeight = 112; // Flappy bird base height
    const floorY = this.canvas.height - baseHeight;
    
    let drawX = this.baseX;
    while (drawX < this.canvas.width) {
      if (this.baseImg.complete && this.baseImg.naturalWidth !== 0) {
        this.ctx.drawImage(this.baseImg, drawX, floorY, 336, baseHeight);
      } else {
        this.ctx.fillStyle = '#ded895';
        this.ctx.fillRect(drawX, floorY, 336, baseHeight);
      }
      drawX += 336;
    }

    // Draw Bird (skip every other frame while invulnerable for blink effect)
    const blinkHide = this.invulnTimer > 0 && Math.floor(this.invulnTimer * 12) % 2 === 0;
    if (!blinkHide) {
      this.ctx.save();
      this.ctx.translate(this.bird.x, this.bird.y);
      this.ctx.rotate(this.bird.rotation);
      
      const birdImg = this.birdFrames[this.birdFrameIndex];
      if (birdImg && birdImg.complete) {
        this.ctx.drawImage(birdImg, -this.bird.width / 2, -this.bird.height / 2, this.bird.width, this.bird.height);
      } else {
        this.ctx.fillStyle = '#eab308';
        this.ctx.beginPath();
        this.ctx.arc(0, 0, this.bird.radius, 0, Math.PI * 2);
        this.ctx.fill();
      }
      this.ctx.restore();
    }
    
    // Draw Screen Flash Effect
    if (this.flashAlpha > 0) {
      this.ctx.fillStyle = `rgba(255, 255, 255, ${this.flashAlpha})`;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    
    // Draw Live Pixel Score (only during PLAYING, not GAMEOVER)
    if (this.gameState === 'PLAYING' || this.gameState === 'PAUSED') {
      const scoreStr = this.score.toString();
      const numWidth = 24 * 1.5; // Scale by 1.5
      const numHeight = 36 * 1.5;
      const totalWidth = scoreStr.length * numWidth;
      const startX = (this.canvas.width - totalWidth) / 2;
      const startY = 100; // 100px from top
      
      for (let i = 0; i < scoreStr.length; i++) {
        const digit = parseInt(scoreStr[i]);
        const img = this.numImgs[digit];
        if (img.complete && img.naturalWidth !== 0) {
          this.ctx.drawImage(img, startX + (i * numWidth), startY, numWidth, numHeight);
        }
      }
    }
  }

  gameLoop(time) {
    // Calculate Delta Time in seconds
    let dt = (time - this.lastTime) / 1000;
    this.lastTime = time;
    
    // Cap dt to prevent huge jumps when tab is inactive or AI lags heavily
    if (dt > 0.1) dt = 0.1;
    
    this.update(dt);
    this.draw();
    
    requestAnimationFrame((t) => this.gameLoop(t));
  }
}
