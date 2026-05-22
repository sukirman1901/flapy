import './style.css';
import {
  HandLandmarker,
  FilesetResolver,
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";
import { FlappyBird } from './flappy.js';

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
let vrCursor = null;

// Player Identity
window.playerName = "";

// Pinch calibration (defaults overwritten after calibration)
const DEFAULT_PINCH = 0.05;
const DEFAULT_RELEASE = 0.065;
let pinchThreshold = DEFAULT_PINCH;
let releaseThreshold = DEFAULT_RELEASE;
let calibrationDone = false;

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
      document.getElementById('login-screen').classList.add('hidden');
      
      // Start Game Flow
      const gameCanvas = document.getElementById('gameCanvas');
      gameCanvas.classList.remove('hidden');
      document.getElementById('game-ui-container').classList.remove('hidden');
      
      if (!flappyGame) {
        flappyGame = new FlappyBird(gameCanvas);
      }
    }
  } else {
    if (window.playerName.length < 10) {
      window.playerName += key;
    }
  }
  
  nameDisplay.innerText = window.playerName + (Math.floor(Date.now() / 500) % 2 === 0 ? '_' : '');
}

// === Pinch Calibration ===
// Captures the user's natural pinch distance over a 2 second hold
// and derives thresholds with a comfortable buffer.
const calibration = {
  active: false,
  startedAt: 0,
  samples: [],
  HOLD_MS: 2000
};

function beginCalibration() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('calibration-screen').classList.remove('hidden');
  calibration.active = true;
  calibration.startedAt = 0;
  calibration.samples = [];
}

function finishCalibration(useDefaults) {
  calibration.active = false;
  calibrationDone = true;
  
  if (!useDefaults && calibration.samples.length > 5) {
    // Use median sample as the pinch baseline (robust to outliers)
    const sorted = [...calibration.samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    // Threshold = median * 2.5 with a floor at the default. Players rarely
    // pinch as tight in-game as during a deliberate calibration hold, so we
    // need a generous buffer or flapping feels impossible.
    pinchThreshold = Math.max(DEFAULT_PINCH, median * 2.5);
    releaseThreshold = pinchThreshold * 1.4;
  } else {
    pinchThreshold = DEFAULT_PINCH;
    releaseThreshold = DEFAULT_RELEASE;
  }
  
  document.getElementById('calibration-screen').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
}

function updateCalibration(pinchDist) {
  if (!calibration.active) return;
  
  const bar = document.getElementById('calibration-bar');
  const instr = document.getElementById('calibration-instruction');
  
  // Pinch is considered "holding" if distance is below a generous default
  const HOLDING = pinchDist < 0.08;
  
  if (HOLDING) {
    if (calibration.startedAt === 0) {
      calibration.startedAt = performance.now();
      calibration.samples = [];
    }
    calibration.samples.push(pinchDist);
    
    const elapsed = performance.now() - calibration.startedAt;
    const pct = Math.min(100, (elapsed / calibration.HOLD_MS) * 100);
    if (bar) bar.style.width = pct + '%';
    if (instr) instr.innerHTML = 'HOLD STEADY...<br>' + Math.ceil((calibration.HOLD_MS - elapsed) / 1000) + 's';
    
    if (elapsed >= calibration.HOLD_MS) {
      finishCalibration(false);
    }
  } else {
    // Reset progress if user releases too early
    calibration.startedAt = 0;
    if (bar) bar.style.width = '0%';
    if (instr) instr.innerHTML = 'PINCH THUMB &amp; INDEX<br>HOLD FOR 2 SECONDS';
  }
}

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
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
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
    
    // First-time entry: route to calibration before login
    const calibrationScreen = document.getElementById('calibration-screen');
    const loginScreen = document.getElementById('login-screen');
    const gameCanvas = document.getElementById('gameCanvas');
    if (
      gameCanvas.classList.contains('hidden') &&
      loginScreen.classList.contains('hidden') &&
      calibrationScreen.classList.contains('hidden') &&
      !calibrationDone
    ) {
      // Kick off calibration flow
      beginCalibration();
    } else if (
      gameCanvas.classList.contains('hidden') &&
      loginScreen.classList.contains('hidden') &&
      calibrationScreen.classList.contains('hidden') &&
      calibrationDone
    ) {
      loginScreen.classList.remove('hidden');
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
      
      // Feed calibration if it's running
      if (calibration.active) {
        updateCalibration(pinchDist);
      }
      
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
      
      if (pinchDist < pinchThreshold) {
        if (!isPinching && (now - window.lastPinchTime > 300)) {
          isPinching = true;
          window.lastPinchTime = now;
          if (vrCursor) vrCursor.classList.add('pinching');
          
          // Spatial Click Simulation
          const elementToClick = document.elementFromPoint(screenX, screenY);
          
          if (elementToClick && (elementToClick.tagName === 'BUTTON' || elementToClick.tagName === 'SELECT' || elementToClick.classList.contains('vr-key'))) {
            // Click HTML buttons (like the Keyboard or Skip VR)
            elementToClick.click();
          } else if (!calibration.active) {
            // Otherwise, anywhere else acts as a screen tap for the game
            // (suppress flap input while calibrating)
            if (flappyGame) flappyGame.flap();
          }
        }
      } else if (pinchDist > releaseThreshold) {
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
function handleInput(e) {
  if (e.type === 'keydown' && e.code !== 'Space') return;
  if (e.type === 'keydown') e.preventDefault(); // Prevent scrolling
  
  if (flappyGame) {
    flappyGame.flap();
  }
}

window.addEventListener('touchstart', handleInput, { passive: false });
window.addEventListener('mousedown', handleInput);
window.addEventListener('keydown', handleInput);

// Build keyboard on load
document.addEventListener('DOMContentLoaded', () => {
  buildVirtualKeyboard();
  
  // Skip VR Button Logic
  const skipBtn = document.getElementById('skip-vr-btn');
  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      // Hide loading screen, skip calibration, go to login
      document.getElementById('loading-screen').classList.add('hidden');
      calibrationDone = true;
      document.getElementById('login-screen').classList.remove('hidden');
      // Stop camera attempt if any
      if (typeof stopCamera === 'function') stopCamera();
    });
  }
  
  // Skip Calibration Button: use defaults
  const skipCalBtn = document.getElementById('skip-calibration-btn');
  if (skipCalBtn) {
    skipCalBtn.addEventListener('click', () => {
      finishCalibration(true);
    });
  }
});


