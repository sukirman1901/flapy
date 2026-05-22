import './style.css';
import {
  HandLandmarker,
  FilesetResolver,
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35";
import { FlappyBird, preloadAssets, SKINS, getBestScore } from './flappy.js';

const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const enableWebcamButton = document.getElementById("webcamButton");
const cameraSelect = document.getElementById("cameraSelect");
let handLandmarker = undefined;
let webcamRunning = false;
let lastVideoTime = -1;
let flappyGame = undefined;
let isPinching = false;
let gameAssets = null;

// Player Identity
window.playerName = "";

// Skin selection
let selectedSkin = 'yellow';

// === Settings (mute, change pilot) ===
const SETTINGS_KEY = 'flappySettings';
let settings = { muted: false };
try {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (raw) settings = { ...settings, ...JSON.parse(raw) };
} catch (e) {}

function persistSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
}

function applyMuteToAudio() {
  if (gameAssets && gameAssets.audio && typeof gameAssets.audio.setMuted === 'function') {
    gameAssets.audio.setMuted(settings.muted);
  }
  const stateLabel = document.getElementById('mute-state');
  if (stateLabel) stateLabel.textContent = settings.muted ? 'OFF' : 'ON';
}

function openSettings() {
  document.getElementById('settings-panel').classList.remove('hidden');
  applyMuteToAudio();
}

function closeSettings() {
  document.getElementById('settings-panel').classList.add('hidden');
}

function goBackToLogin() {
  // Pause current game if running, then surface the login screen
  if (flappyGame && flappyGame.gameState === 'PLAYING') {
    flappyGame.pause();
  }
  closeSettings();
  document.getElementById('game-ui-container').classList.add('hidden');
  document.getElementById('gameCanvas').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  buildSkinPicker();
  // Reset name buffer so user can type fresh
  window.playerName = '';
  const display = document.getElementById('name-display');
  if (display) display.innerText = '';
}

function isSkinUnlocked(skinKey) {
  return getBestScore() >= SKINS[skinKey].minScore;
}

// Pinch thresholds (slightly more forgiving than the original 0.05/0.065)
const PINCH_THRESHOLD = 0.07;
const RELEASE_THRESHOLD = 0.08;  // Small hysteresis gap so fast taps register cleanly
const PINCH_DEBOUNCE_MS = 120; // Max ~8 pinches/sec for late-game speed

// Auto-pause tracking
let lastHandSeenAt = performance.now();
const HAND_LOST_GRACE_MS = 500;

// Build VR Keyboard
function buildVirtualKeyboard() {
  const keyboardContainer = document.getElementById('vr-keyboard');
  const rows = [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
    ['DEL', 'ENTER']
  ];
  
  rows.forEach((row, index) => {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'keyboard-row';
    
    row.forEach(key => {
      const btn = document.createElement('button');
      btn.className = 'vr-key';
      if (key === 'DEL' || key === 'ENTER') btn.classList.add('key-wide');
      btn.innerText = key;
      
      btn.onclick = () => handleVirtualKeyClick(key);
      
      rowDiv.appendChild(btn);
    });
    
    keyboardContainer.appendChild(rowDiv);
  });
}

function handleVirtualKeyClick(key) {
  const nameDisplay = document.getElementById('name-display');
  
  if (key === 'DEL') {
    window.playerName = window.playerName.slice(0, -1);
  } else if (key === 'ENTER') {
    if (window.playerName.trim().length > 0) {
      startGame();
    }
  } else {
    if (window.playerName.length < 10) {
      window.playerName += key;
    }
  }
  
  nameDisplay.innerText = window.playerName + (Math.floor(Date.now() / 500) % 2 === 0 ? '_' : '');
}

function startGame() {
  // Block start until preloaded assets are ready, otherwise FlappyBird
  // would crash trying to read assets.images.base from null.
  if (!gameAssets) {
    const display = document.getElementById('name-display');
    if (display) {
      display.innerText = 'LOADING...';
      setTimeout(() => {
        display.innerText = window.playerName + (Math.floor(Date.now() / 500) % 2 === 0 ? '_' : '');
      }, 1200);
    }
    return;
  }
  
  document.getElementById('login-screen').classList.add('hidden');
  
  const gameCanvas = document.getElementById('gameCanvas');
  gameCanvas.classList.remove('hidden');
  document.getElementById('game-ui-container').classList.remove('hidden');
  
  if (!flappyGame) {
    flappyGame = new FlappyBird(gameCanvas, gameAssets, { skin: selectedSkin });
  } else {
    flappyGame.setSkin(selectedSkin);
  }
}

// Build skin picker on login screen. Locked skins show a padlock and a hint.
function buildSkinPicker() {
  const container = document.getElementById('skin-picker');
  if (!container) return;
  container.innerHTML = '';
  
  Object.entries(SKINS).forEach(([key, info]) => {
    const unlocked = isSkinUnlocked(key);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'skin-option' + (selectedSkin === key ? ' selected' : '') + (unlocked ? '' : ' locked');
    btn.disabled = !unlocked;
    btn.dataset.skin = key;
    
    const previewKey = key + 'Mid';
    const previewSrc = gameAssets && gameAssets.images[previewKey] ? gameAssets.images[previewKey].src : '';
    
    btn.innerHTML = `
      <img src="${previewSrc}" alt="${info.label}" class="pixel-art skin-preview">
      <span class="skin-label">${info.label}</span>
      <span class="skin-meta">${unlocked ? 'READY' : 'BEST ' + info.minScore}</span>
    `;
    
    btn.addEventListener('click', () => {
      if (!unlocked) return;
      selectedSkin = key;
      buildSkinPicker(); // re-render selection state
    });
    
    container.appendChild(btn);
  });
}

// Calibration was removed in an earlier iteration; the constants above
// are now the only thresholds used.

// Blinking cursor loop for name display
setInterval(() => {
  const nameDisplay = document.getElementById('name-display');
  if (nameDisplay && !document.getElementById('login-screen').classList.contains('hidden')) {
    nameDisplay.innerText = window.playerName + (Math.floor(Date.now() / 500) % 2 === 0 ? '_' : '');
  }
}, 500);

// Initialize MediaPipe HandLandmarker
const createHandLandmarker = async () => {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
  );
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numHands: 2
  });
  
  // Enable the button once the model is loaded
  enableWebcamButton.textContent = "Enable";
  enableWebcamButton.disabled = false;
  enableWebcamButton.classList.remove("skeleton");
};

// Disable button initially until model loads
enableWebcamButton.textContent = "Loading...";
enableWebcamButton.disabled = true;
createHandLandmarker();

// Check if webcam access is supported.
const hasGetUserMedia = () => !!navigator.mediaDevices?.getUserMedia;

// Fetch available cameras
async function getCameras() {
  try {
    // Try to request permission to get labels, but don't fail if it throws (e.g., broken default camera)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(track => track.stop());
    } catch (e) {
      console.warn("Could not get initial camera permission (maybe broken camera). Will enumerate devices anyway.", e);
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(device => device.kind === 'videoinput');
    
    cameraSelect.innerHTML = '';
    if (videoDevices.length === 0) {
      cameraSelect.innerHTML = '<option value="">No cameras found</option>';
      return;
    }

    videoDevices.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.text = device.label || `Camera ${index + 1}`;
      cameraSelect.appendChild(option);
    });
    cameraSelect.disabled = false;
    cameraSelect.classList.remove("skeleton");
  } catch (err) {
    console.error("Error fetching cameras", err);
    cameraSelect.innerHTML = '<option value="">Error finding cameras</option>';
  }
}

if (hasGetUserMedia()) {
  getCameras();
  enableWebcamButton.addEventListener("click", toggleCam);
  
  // Switch camera if selection changes while running
  cameraSelect.addEventListener("change", () => {
    if (webcamRunning) {
      stopCamera();
      startCamera();
    }
  });
} else {
  console.warn("getUserMedia() is not supported by your browser");
}

function stopCamera() {
  const stream = video.srcObject;
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
  document.querySelector('.video-container').classList.remove('playing');
  
  // Clear the canvas when stopped
  const canvasCtx = document.getElementById("output_canvas").getContext("2d");
  const canvasElement = document.getElementById("output_canvas");
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

  document.querySelector('.camera-skeleton').style.display = 'none';
  document.getElementById('game-ui-container').classList.add('hidden');
  document.getElementById('gameCanvas').classList.add('hidden');
}

function startCamera() {
  const selectedDeviceId = cameraSelect.value;
  const constraints = {
    video: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true
  };
  document.querySelector('.camera-skeleton').style.display = 'block';

  navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
    video.srcObject = stream;
    // Play explicitly for Safari compatibility
    video.play().catch(e => console.error("Play failed:", e));
    
    // Start predicting immediately. The predictWebcam loop will wait 
    // until video dimensions are ready (prevents Safari loadeddata issues).
    predictWebcam();
  }).catch((err) => {
    console.error("Camera error:", err);
    alert("Gagal mengakses kamera. Silakan periksa izin di pengaturan browser Anda.");
    webcamRunning = false;
    enableWebcamButton.innerText = "ENABLE WEBCAM";
  });
}

// Toggle the live webcam view and start detection.
function toggleCam(event) {
  if (!handLandmarker) {
    console.log("Wait! objectDetector not loaded yet.");
    return;
  }

  if (webcamRunning === true) {
    webcamRunning = false;
    enableWebcamButton.innerText = "Enable";
    stopCamera();
  } else {
    webcamRunning = true;
    enableWebcamButton.innerText = "Disable";
    startCamera();
  }
}

async function predictWebcam() {
  // Wait until video has dimensions and is ready
  if (video.videoWidth === 0 || video.videoHeight === 0 || video.readyState < 2) {
    if (webcamRunning === true) {
      window.requestAnimationFrame(predictWebcam);
    }
    return;
  }

  // Set internal resolution to match video
  canvasElement.width = video.videoWidth;
  canvasElement.height = video.videoHeight;

  // Now let's start detecting the stream.
  let startTimeMs = performance.now();
  if (lastVideoTime !== video.currentTime) {
    lastVideoTime = video.currentTime;
    let results = { landmarks: [] };
    try {
      results = handLandmarker.detectForVideo(video, startTimeMs);
    } catch (e) {
      console.warn("Detection skipped this frame:", e);
    }

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    // Draw the video frame to the canvas
    canvasCtx.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);
    
    // Hide the offline text and skeleton, hide loading
    document.querySelector('.video-container').classList.add('playing');
    document.querySelector('.camera-skeleton').style.display = 'none';
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) loadingScreen.classList.add('hidden');
    
    // First-time entry: route directly to login (calibration removed)
    const loginScreen = document.getElementById('login-screen');
    const gameCanvas = document.getElementById('gameCanvas');
    if (
      gameCanvas.classList.contains('hidden') &&
      loginScreen.classList.contains('hidden')
    ) {
      loginScreen.classList.remove('hidden');
      buildSkinPicker();
    }
    
    if (results.landmarks && results.landmarks.length > 0) {
      lastHandSeenAt = performance.now();
      
      // Auto-resume if game was paused due to lost hand
      if (flappyGame && flappyGame.gameState === 'PAUSED') {
        flappyGame.resume();
      }
      
      const firstHand = results.landmarks[0];
      const thumbTip = firstHand[4];
      const indexTip = firstHand[8];
      
      // Calculate 3D distance between thumb and index
      const pinchDist = Math.hypot(
        thumbTip.x - indexTip.x, 
        thumbTip.y - indexTip.y, 
        (thumbTip.z || 0) - (indexTip.z || 0)
      );
      
      // VR Spatial Cursor Mapping
      // X is mirrored: (1 - x)
      const screenX = (1 - indexTip.x) * window.innerWidth;
      const screenY = indexTip.y * window.innerHeight;
      
      const vrCursor = document.getElementById('vr-cursor');
      if (vrCursor) {
        vrCursor.style.display = 'block';
        vrCursor.style.left = `${screenX}px`;
        vrCursor.style.top = `${screenY}px`;
      }
      
      const now = Date.now();
      window.lastPinchTime = window.lastPinchTime || 0;
      
      if (pinchDist < PINCH_THRESHOLD) {
        if (!isPinching && (now - window.lastPinchTime > PINCH_DEBOUNCE_MS)) {
          isPinching = true;
          window.lastPinchTime = now;
          if (vrCursor) vrCursor.classList.add('pinching');
          
          // Spatial Click Simulation
          const elementToClick = document.elementFromPoint(screenX, screenY);
          
          if (elementToClick && (elementToClick.tagName === 'BUTTON' || elementToClick.tagName === 'SELECT' || elementToClick.classList.contains('vr-key'))) {
            // Click HTML buttons (like the Keyboard or Skip VR)
            elementToClick.click();
          } else {
            // Otherwise, anywhere else acts as a screen tap for the game
            if (flappyGame) flappyGame.flap();
          }
        }
      } else if (pinchDist > RELEASE_THRESHOLD) {
        isPinching = false;
        if (vrCursor) vrCursor.classList.remove('pinching');
      }

      // Draw the hand skeleton lines for user guidance
      const drawingUtils = new DrawingUtils(canvasCtx);
      for (const landmarks of results.landmarks) {
        // Draw the connections (lines)
        drawingUtils.drawConnectors(
          landmarks,
          HandLandmarker.HAND_CONNECTIONS,
          {
            color: "#06b6d4", // Cyan accent
            lineWidth: 4
          }
        );
        // Draw the landmarks (dots)
        drawingUtils.drawLandmarks(landmarks, {
          color: "#f8fafc", // White
          lineWidth: 2,
          radius: 4
        });
      }
    } else {
      // No hand detected this frame
      const elapsedSinceHand = performance.now() - lastHandSeenAt;
      if (
        flappyGame &&
        flappyGame.gameState === 'PLAYING' &&
        elapsedSinceHand > HAND_LOST_GRACE_MS
      ) {
        flappyGame.pause();
      }
      // Hide cursor when no hand
      const vrCursor = document.getElementById('vr-cursor');
      if (vrCursor) vrCursor.style.display = 'none';
    }
    canvasCtx.restore();
  }

  // Call this function again to keep predicting when the browser is ready.
  if (webcamRunning === true) {
    window.requestAnimationFrame(predictWebcam);
  }
}

// Universal Input (Mobile Touch, Mouse Click, Spacebar)
// Single shared cooldown so mobile's synthetic mousedown after touchstart
// doesn't double-flap.
let lastInputAt = 0;
const INPUT_COOLDOWN_MS = 80;

function handleInput(e) {
  if (e.type === 'keydown' && e.code !== 'Space') return;
  if (e.type === 'keydown') e.preventDefault(); // Prevent scrolling
  
  // If the touch/click landed on an interactive UI element, let it handle
  // itself. Prevents flap-on-button-tap when playing without VR.
  const target = e.target;
  if (target && target.closest && target.closest('button, select, .vr-key, input')) {
    return;
  }
  
  const now = performance.now();
  if (now - lastInputAt < INPUT_COOLDOWN_MS) return;
  lastInputAt = now;
  
  if (flappyGame) {
    flappyGame.flap();
  }
}

window.addEventListener('touchstart', handleInput, { passive: false });
window.addEventListener('mousedown', handleInput);
window.addEventListener('keydown', handleInput);

// Mobile viewport: lock 100dvh by writing pixel value as fallback for browsers
// that don't support dvh (and to handle dynamic toolbar resize).
function setViewportHeight() {
  document.documentElement.style.setProperty('--vh', window.innerHeight * 0.01 + 'px');
}
setViewportHeight();
window.addEventListener('resize', setViewportHeight);
window.addEventListener('orientationchange', setViewportHeight);

// Build keyboard on load
document.addEventListener('DOMContentLoaded', async () => {
  buildVirtualKeyboard();
  
  // Skip VR Button Logic
  const skipBtn = document.getElementById('skip-vr-btn');
  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      // Hide loading screen, go to login
      document.getElementById('loading-screen').classList.add('hidden');
      document.getElementById('login-screen').classList.remove('hidden');
      buildSkinPicker();
      // Stop camera attempt if any
      if (typeof stopCamera === 'function') stopCamera();
    });
  }
  
  // Settings panel wiring
  const settingsBtn = document.getElementById('settings-btn');
  const settingsPanel = document.getElementById('settings-panel');
  if (settingsBtn && settingsPanel) {
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (settingsPanel.classList.contains('hidden')) openSettings();
      else closeSettings();
    });
    document.addEventListener('click', (e) => {
      if (settingsPanel.classList.contains('hidden')) return;
      if (!settingsPanel.contains(e.target) && e.target !== settingsBtn && !settingsBtn.contains(e.target)) {
        closeSettings();
      }
    });
  }
  const muteBtn = document.getElementById('toggle-mute-btn');
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      settings.muted = !settings.muted;
      persistSettings();
      applyMuteToAudio();
    });
  }
  const pilotBtn = document.getElementById('change-pilot-btn');
  if (pilotBtn) pilotBtn.addEventListener('click', goBackToLogin);
  const closeBtn = document.getElementById('close-settings-btn');
  if (closeBtn) closeBtn.addEventListener('click', closeSettings);
  
  // Preload all sprite + audio assets with progress feedback
  const progressFill = document.getElementById('asset-progress-fill');
  const progressLabel = document.getElementById('asset-progress-label');
  try {
    gameAssets = await preloadAssets((p) => {
      const pct = Math.round(p * 100);
      if (progressFill) progressFill.style.width = pct + '%';
      if (progressLabel) progressLabel.textContent = `LOADING ASSETS ${pct}%`;
    });
    if (progressLabel) progressLabel.textContent = 'CONNECTING TO VR CAMERA...';
    applyMuteToAudio();
  } catch (e) {
    console.error('Asset preload failed:', e);
    if (progressLabel) progressLabel.textContent = 'ASSETS FAILED, CONTINUING...';
  }
});


