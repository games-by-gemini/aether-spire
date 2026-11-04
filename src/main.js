import * as THREE from "./vendor/three.module.js";
import { STAGES } from "./stages.js";
import { SaveManager } from "./saves.js";
import { SoundEngine } from "./audio.js";

const GAME_KEYS = new Set([
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ShiftLeft",
  "ShiftRight",
  "KeyE",
  "KeyR",
  "KeyP",
  "Escape",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
]);

const MAX_PIXEL_RATIO = 2;
const GRAVITY = -24;
const PLAYER_RADIUS = 0.58;
const MOVE_ACCEL = 32;
const MAX_SPEED = 11.5;
const JUMP_VELOCITY = 10.6;
const DOUBLE_JUMP_VELOCITY = 9.4;
const DASH_IMPULSE = 14.5;

const canvas = document.getElementById("main");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 260);

const sound = new SoundEngine();
const saveManager = new SaveManager();

// UI elements
const uiStageBadge = document.getElementById("ui-stage-badge");
const uiStageTitle = document.getElementById("ui-stage-title");
const uiStageSub = document.getElementById("ui-stage-sub");
const uiCheckpoint = document.getElementById("ui-checkpoint");
const uiShards = document.getElementById("ui-shards");
const uiTimer = document.getElementById("ui-timer");
const uiSaveState = document.getElementById("ui-save-state");
const toastBanner = document.getElementById("toast-banner");
const noticeBanner = document.getElementById("notice-banner");
const noticeText = document.getElementById("notice-text");
const btnRetrySave = document.getElementById("btn-retry-save");
const btnStages = document.getElementById("btn-stages");
const btnMute = document.getElementById("btn-mute");
const modalOverlay = document.getElementById("modal-overlay");
const stageListEl = document.getElementById("stage-list");
const btnResume = document.getElementById("btn-resume");
const btnRestartStage = document.getElementById("btn-restart-stage");

let toastTimeout = null;
function showToast(text, duration = 2400) {
  toastBanner.textContent = text;
  toastBanner.classList.add("visible");
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastBanner.classList.remove("visible");
  }, duration);
}

function showNotice(text, showRetry = false) {
  if (!text) {
    noticeBanner.style.display = "none";
    return;
  }
  noticeText.textContent = text;
  btnRetrySave.style.display = showRetry ? "inline-block" : "none";
  noticeBanner.style.display = "flex";
}

saveManager.onStatusChange = (status) => {
  if (status.type === "saved") {
    uiSaveState.textContent = "Saved";
    uiSaveState.style.color = "#34d399";
  } else if (status.type === "error") {
    uiSaveState.textContent = "Offline";
    uiSaveState.style.color = "#f87171";
    showNotice(status.message, true);
  } else if (status.type === "newer_version") {
    uiSaveState.textContent = "Read-Only";
    uiSaveState.style.color = "#fbbf24";
    showNotice(status.message, false);
  } else if (status.type === "save_warning") {
    uiSaveState.textContent = "Warning";
    uiSaveState.style.color = "#fbbf24";
    showToast(status.message, 3000);
  }
};

// Lighting & starfield
const ambientLight = new THREE.AmbientLight(0xdbeafe, 0.9);
const dirLight = new THREE.DirectionalLight(0xffffff, 2.1);
dirLight.position.set(16, 32, 22);
const playerLight = new THREE.PointLight(0x38bdf8, 2.6, 16);
scene.add(ambientLight, dirLight, playerLight);

const starGeo = new THREE.BufferGeometry();
const starCount = 900;
const starPositions = new Float32Array(starCount * 3);
const starColors = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
  starPositions[i * 3] = (Math.random() - 0.5) * 180;
  starPositions[i * 3 + 1] = (Math.random() - 0.2) * 110;
  starPositions[i * 3 + 2] = -Math.random() * 190 + 25;
  const c = new THREE.Color().setHSL(0.55 + Math.random() * 0.25, 0.85, 0.65 + Math.random() * 0.3);
  starColors[i * 3] = c.r;
  starColors[i * 3 + 1] = c.g;
  starColors[i * 3 + 2] = c.b;
}
starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
starGeo.setAttribute("color", new THREE.BufferAttribute(starColors, 3));
const starMat = new THREE.PointsMaterial({ size: 0.42, vertexColors: true, transparent: true, opacity: 0.88 });
const starField = new THREE.Points(starGeo, starMat);
scene.add(starField);

// Player Sphere (Crystalline core + outer energy rings)
const playerGroup = new THREE.Group();
const coreGeo = new THREE.OctahedronGeometry(PLAYER_RADIUS * 0.82, 2);
const coreMat = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  emissive: 0x0284c7,
  emissiveIntensity: 0.75,
  metalness: 0.35,
  roughness: 0.18,
});
const coreMesh = new THREE.Mesh(coreGeo, coreMat);

const ringGeo = new THREE.TorusGeometry(PLAYER_RADIUS * 0.96, 0.06, 12, 36);
const ringMat = new THREE.MeshStandardMaterial({
  color: 0xe0f2fe,
  emissive: 0x38bdf8,
  emissiveIntensity: 0.9,
  metalness: 0.6,
  roughness: 0.2,
});
const ringMeshA = new THREE.Mesh(ringGeo, ringMat);
const ringMeshB = new THREE.Mesh(ringGeo, ringMat);
ringMeshB.rotation.x = Math.PI / 2;
playerGroup.add(coreMesh, ringMeshA, ringMeshB);
scene.add(playerGroup);

// Stage group container
const stageRoot = new THREE.Group();
scene.add(stageRoot);

// Dynamic stage objects
let activeStage = STAGES[0];
let platformObjects = [];
let checkpointObjects = [];
let shardObjects = [];
let boostObjects = [];
let hazardObjects = [];
let portalObject = null;
let particleBursts = [];

// Player physics & state
const player = {
  pos: new THREE.Vector3(0, 2, 0),
  vel: new THREE.Vector3(0, 0, 0),
  onGround: false,
  jumpsRemaining: 2,
  dashCooldown: 0,
  boostCooldown: 0,
  standingPlatform: null,
};

let currentStageIndex = 0;
let activeCheckpointIndex = 0;
let collectedShardIds = new Set();
let stageElapsed = 0;
let paused = false;
let stageTransitioning = false;
let cameraYaw = 0;
let cameraPitch = 0.38;
let pointerDrag = null;
let autopilot = false;

// Input state
const keysDown = new Set();
const touchVector = { x: 0, y: 0 };

function spawnParticles(pos, colorHex, count = 18) {
  const geo = new THREE.OctahedronGeometry(0.12, 0);
  const mat = new THREE.MeshBasicMaterial({ color: colorHex });
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 5.5;
    const vel = new THREE.Vector3(
      Math.cos(angle) * speed,
      2 + Math.random() * 5,
      Math.sin(angle) * speed
    );
    stageRoot.add(mesh);
    particleBursts.push({ mesh, vel, life: 0.55 + Math.random() * 0.25 });
  }
}

function buildStageScene(stageNumber, checkpointIndex = 0, restoredShardIds = [], restoredElapsed = 0) {
  const stageIdx = Math.max(0, Math.min(STAGES.length - 1, stageNumber - 1));
  currentStageIndex = stageIdx;
  activeStage = STAGES[stageIdx];

  // Clear previous stage meshes
  while (stageRoot.children.length > 0) {
    stageRoot.remove(stageRoot.children[0]);
  }
  platformObjects = [];
  checkpointObjects = [];
  shardObjects = [];
  boostObjects = [];
  hazardObjects = [];
  particleBursts = [];

  scene.background = new THREE.Color(activeStage.theme.skyTop);
  scene.fog = new THREE.FogExp2(activeStage.theme.fogColor, 0.011);
  coreMat.color.setHex(activeStage.theme.primary);
  coreMat.emissive.setHex(activeStage.theme.secondary);
  playerLight.color.setHex(activeStage.theme.primary);

  // Build platforms
  for (const p of activeStage.platforms) {
    const group = new THREE.Group();
    const topGeo = new THREE.BoxGeometry(p.w, p.h, p.d);
    const topMat = new THREE.MeshStandardMaterial({
      color: p.color,
      roughness: 0.35,
      metalness: 0.45,
    });
    const mesh = new THREE.Mesh(topGeo, topMat);
    group.add(mesh);

    // Glowing trim rim around platform top
    const trimGeo = new THREE.BoxGeometry(p.w + 0.08, 0.12, p.d + 0.08);
    const trimMat = new THREE.MeshStandardMaterial({
      color: activeStage.theme.primary,
      emissive: activeStage.theme.primary,
      emissiveIntensity: 0.55,
      roughness: 0.2,
    });
    const trim = new THREE.Mesh(trimGeo, trimMat);
    trim.position.y = p.h * 0.5 - 0.08;
    group.add(trim);

    group.position.set(p.x, p.y, p.z);
    stageRoot.add(group);
    platformObjects.push({
      data: p,
      group,
      baseX: p.x,
      baseY: p.y,
      baseZ: p.z,
      prevX: p.x,
      prevY: p.y,
      prevZ: p.z,
      dx: 0,
      dy: 0,
      dz: 0,
    });
  }

  // Build checkpoints
  activeCheckpointIndex = Math.max(
    0,
    Math.min(activeStage.checkpoints.length - 1, checkpointIndex)
  );
  activeStage.checkpoints.forEach((cp, idx) => {
    const group = new THREE.Group();
    const padGeo = new THREE.CylinderGeometry(1.15, 1.3, 0.22, 24);
    const isReached = idx <= activeCheckpointIndex;
    const padMat = new THREE.MeshStandardMaterial({
      color: isReached ? 0x10b981 : 0x38bdf8,
      emissive: isReached ? 0x059669 : 0x0284c7,
      emissiveIntensity: 0.8,
    });
    const pad = new THREE.Mesh(padGeo, padMat);
    group.add(pad);

    // Pylon crystal
    const pylonGeo = new THREE.OctahedronGeometry(0.42, 0);
    const pylonMat = new THREE.MeshStandardMaterial({
      color: isReached ? 0x34d399 : 0x7dd3fc,
      emissive: isReached ? 0x10b981 : 0x38bdf8,
      emissiveIntensity: 1.0,
    });
    const pylon = new THREE.Mesh(pylonGeo, pylonMat);
    pylon.position.y = 1.35;
    group.add(pylon);

    group.position.set(cp.x, cp.y - 0.5, cp.z);
    stageRoot.add(group);
    checkpointObjects.push({ data: cp, index: idx, group, padMat, pylonMat, pylon });
  });

  // Build boost pads
  for (const bp of activeStage.boostPads) {
    const group = new THREE.Group();
    const geo = new THREE.BoxGeometry(1.9, 0.2, 1.9);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0xeab308,
      emissiveIntensity: 0.95,
    });
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);

    const ringGeoBp = new THREE.TorusGeometry(0.75, 0.07, 10, 24);
    const ringMeshBp = new THREE.Mesh(ringGeoBp, mat);
    ringMeshBp.rotation.x = Math.PI / 2;
    ringMeshBp.position.y = 0.28;
    group.add(ringMeshBp);

    group.position.set(bp.x, bp.y, bp.z);
    stageRoot.add(group);
    boostObjects.push({ data: bp, group, ringMeshBp });
  }

  // Build Aether Shards
  collectedShardIds = new Set(restoredShardIds);
  for (const s of activeStage.shards) {
    const collected = collectedShardIds.has(s.id);
    const group = new THREE.Group();
    const crystalGeo = new THREE.OctahedronGeometry(0.48, 0);
    const crystalMat = new THREE.MeshStandardMaterial({
      color: activeStage.theme.accent,
      emissive: activeStage.theme.accent,
      emissiveIntensity: 0.95,
      metalness: 0.3,
      roughness: 0.1,
    });
    const crystal = new THREE.Mesh(crystalGeo, crystalMat);
    group.add(crystal);

    const haloGeo = new THREE.TorusGeometry(0.68, 0.04, 8, 24);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    group.add(halo);

    group.position.set(s.x, s.y, s.z);
    group.visible = !collected;
    stageRoot.add(group);
    shardObjects.push({ data: s, group, crystal, halo, collected });
  }

  // Build laser sweepers
  for (const hz of activeStage.hazards) {
    const group = new THREE.Group();
    const hubGeo = new THREE.CylinderGeometry(0.45, 0.55, 0.9, 16);
    const hubMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.7,
      roughness: 0.3,
    });
    const hub = new THREE.Mesh(hubGeo, hubMat);
    group.add(hub);

    const beamGeo = new THREE.CylinderGeometry(0.11, 0.11, hz.length * 2, 12);
    beamGeo.rotateZ(Math.PI / 2);
    const beamMat = new THREE.MeshStandardMaterial({
      color: activeStage.theme.hazard,
      emissive: activeStage.theme.hazard,
      emissiveIntensity: 1.25,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = 0.15;
    group.add(beam);

    group.position.set(hz.x, hz.y, hz.z);
    stageRoot.add(group);
    hazardObjects.push({ data: hz, group, beam, angle: hz.phase || 0 });
  }

  // Build Warp Portal at the end of the stage
  const pGroup = new THREE.Group();
  const outerRingGeo = new THREE.TorusGeometry(2.1, 0.18, 16, 48);
  const outerRingMat = new THREE.MeshStandardMaterial({
    color: activeStage.theme.primary,
    emissive: activeStage.theme.primary,
    emissiveIntensity: 1.1,
  });
  const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);

  const innerRingGeo = new THREE.TorusGeometry(1.45, 0.1, 14, 36);
  const innerRingMat = new THREE.MeshStandardMaterial({
    color: activeStage.theme.accent,
    emissive: activeStage.theme.accent,
    emissiveIntensity: 1.3,
  });
  const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);

  const corePortalGeo = new THREE.CircleGeometry(1.35, 32);
  const corePortalMat = new THREE.MeshBasicMaterial({
    color: activeStage.theme.secondary,
    transparent: true,
    opacity: 0.48,
    side: THREE.DoubleSide,
  });
  const coreDisk = new THREE.Mesh(corePortalGeo, corePortalMat);

  const portalLight = new THREE.PointLight(activeStage.theme.primary, 3.5, 18);
  pGroup.add(outerRing, innerRing, coreDisk, portalLight);
  pGroup.position.set(activeStage.portal.x, activeStage.portal.y, activeStage.portal.z);
  stageRoot.add(pGroup);
  portalObject = { group: pGroup, outerRing, innerRing, coreDisk, pos: activeStage.portal };

  stageElapsed = restoredElapsed || 0;
  respawnAtActiveCheckpoint(false);
  updateHUD();
  renderStageModalList();
}

function respawnAtActiveCheckpoint(countReset = true) {
  const cp =
    activeStage.checkpoints[activeCheckpointIndex] || activeStage.checkpoints[0];
  player.pos.set(cp.x, cp.y + 0.9, cp.z);
  player.vel.set(0, 0, 0);
  player.onGround = false;
  player.jumpsRemaining = 2;
  player.dashCooldown = 0;
  cameraYaw = 0;

  if (countReset) {
    sound.fall();
    saveManager.writeProgress({
      totalResets: (saveManager.progress.totalResets || 0) + 1,
    });
    showToast(`Respawned at ${cp.label}`);
  }
}

function updateHUD() {
  uiStageBadge.textContent = `STAGE ${activeStage.id} OF ${STAGES.length}`;
  uiStageTitle.textContent = activeStage.name;
  uiStageSub.textContent = activeStage.subtitle;
  uiCheckpoint.textContent = `${activeCheckpointIndex + 1} / ${activeStage.checkpoints.length}`;
  uiShards.textContent = `${collectedShardIds.size} / ${activeStage.shards.length}`;
  uiTimer.textContent = `${stageElapsed.toFixed(1)}s`;
  btnMute.textContent = sound.muted ? "Audio: Off" : "Audio: On";
}

function renderStageModalList() {
  stageListEl.innerHTML = "";
  const unlocked = saveManager.progress.unlockedStage || 1;
  const completed = saveManager.progress.completedStages || {};

  for (const st of STAGES) {
    const isUnlocked = st.id <= unlocked;
    const isCurrent = st.id === activeStage.id;
    const record = completed[st.id];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `stage-item${isCurrent ? " active" : ""}${!isUnlocked ? " locked" : ""}`;
    btn.disabled = !isUnlocked;

    const stars = record ? "★".repeat(record.stars) + "☆".repeat(3 - record.stars) : "☆☆☆";
    const bestText = record
      ? `${stars} • Best ${record.bestTime.toFixed(1)}s • ${record.shardsCollected}/${st.shards.length} Shards`
      : isUnlocked
      ? "Unlocked — Ready"
      : "Locked — Clear previous stage";

    btn.innerHTML = `
      <div>
        <div style="font-weight: 700; font-size: 15px;">Stage ${st.id}: ${st.name}</div>
        <div style="font-size: 12px; color: #94a3b8; margin-top: 2px;">${st.subtitle}</div>
      </div>
      <div class="stage-meta">${bestText}</div>
    `;

    if (isUnlocked) {
      btn.addEventListener("click", () => {
        selectStage(st.id);
        setModalOpen(false);
      });
    }
    stageListEl.appendChild(btn);
  }
}

function setModalOpen(open) {
  paused = Boolean(open);
  sound.setPaused(paused);
  if (paused) {
    renderStageModalList();
    modalOverlay.classList.add("open");
  } else {
    modalOverlay.classList.remove("open");
  }
}

async function selectStage(stageId, checkpointIdx = 0) {
  const unlocked = Math.max(saveManager.progress.unlockedStage || 1, stageId);
  buildStageScene(stageId, checkpointIdx, [], 0);
  await saveManager.writeProgress({
    currentStage: stageId,
    currentCheckpoint: checkpointIdx,
    currentStageShards: [],
    currentStageElapsed: 0,
    unlockedStage: unlocked,
  });
  showToast(`Entered Stage ${stageId}: ${activeStage.name}`);
}

function triggerJump() {
  sound.unlock();
  if (paused || stageTransitioning) return;
  if (player.onGround) {
    player.vel.y = JUMP_VELOCITY;
    player.onGround = false;
    player.jumpsRemaining = 1;
    sound.jump();
    spawnParticles(player.pos, activeStage.theme.primary, 10);
  } else if (player.jumpsRemaining > 0) {
    player.vel.y = DOUBLE_JUMP_VELOCITY;
    player.jumpsRemaining = 0;
    sound.jump();
    spawnParticles(player.pos, activeStage.theme.accent, 14);
  }
}

function triggerDash() {
  sound.unlock();
  if (paused || stageTransitioning || player.dashCooldown > 0) return;
  player.dashCooldown = 0.85;
  const forwardX = -Math.sin(cameraYaw);
  const forwardZ = -Math.cos(cameraYaw);
  player.vel.x += forwardX * DASH_IMPULSE;
  player.vel.z += forwardZ * DASH_IMPULSE;
  player.vel.y = Math.max(player.vel.y, 3.2);
  sound.dash();
  spawnParticles(player.pos, activeStage.theme.secondary, 16);
}

async function completeCurrentStage() {
  if (stageTransitioning) return;
  stageTransitioning = true;
  sound.stageClear();
  spawnParticles(player.pos, 0xfacc15, 32);

  const stageId = activeStage.id;
  const totalShardsInStage = activeStage.shards.length;
  const collectedCount = collectedShardIds.size;
  let stars = 1;
  if (collectedCount >= Math.ceil(totalShardsInStage * 0.6)) stars = 2;
  if (collectedCount === totalShardsInStage && stageElapsed <= activeStage.parTime) stars = 3;

  const prevRecord = saveManager.progress.completedStages?.[stageId];
  const updatedRecord = {
    bestTime:
      prevRecord?.bestTime > 0
        ? Math.min(prevRecord.bestTime, Number(stageElapsed.toFixed(2)))
        : Number(stageElapsed.toFixed(2)),
    shardsCollected: Math.max(prevRecord?.shardsCollected || 0, collectedCount),
    totalShards: totalShardsInStage,
    stars: Math.max(prevRecord?.stars || 0, stars),
    completions: (prevRecord?.completions || 0) + 1,
  };

  const nextStageId = stageId < STAGES.length ? stageId + 1 : 1;
  const nextUnlocked = Math.max(
    saveManager.progress.unlockedStage || 1,
    Math.min(STAGES.length, stageId + 1)
  );

  const completedStages = {
    ...(saveManager.progress.completedStages || {}),
    [stageId]: updatedRecord,
  };

  let sumShards = 0;
  for (const rec of Object.values(completedStages)) {
    sumShards += rec.shardsCollected || 0;
  }

  await saveManager.writeProgress({
    currentStage: nextStageId,
    currentCheckpoint: 0,
    currentStageShards: [],
    currentStageElapsed: 0,
    unlockedStage: nextUnlocked,
    completedStages,
    totalShards: sumShards,
  });

  showToast(
    stageId < STAGES.length
      ? `Stage ${stageId} Clear! Advancing to Stage ${nextStageId}...`
      : `Spire Ascended! All 5 Stages Mastered — Looping to Stage 1!`
  );

  setTimeout(() => {
    stageTransitioning = false;
    buildStageScene(nextStageId, 0, [], 0);
  }, 950);
}

// Poll Gamepad API every frame
let prevGamepadJump = false;
let prevGamepadDash = false;
let prevGamepadStart = false;
function readGamepadInput() {
  if (!navigator.getGamepads) return { x: 0, y: 0, camX: 0 };
  const pads = navigator.getGamepads();
  for (const pad of pads) {
    if (!pad || !pad.connected) continue;
    const lx = Math.abs(pad.axes[0] || 0) > 0.15 ? pad.axes[0] : 0;
    const ly = Math.abs(pad.axes[1] || 0) > 0.15 ? pad.axes[1] : 0;
    const rx = Math.abs(pad.axes[2] || 0) > 0.15 ? pad.axes[2] : 0;

    const jumpPressed = Boolean(pad.buttons[0]?.pressed);
    const dashPressed = Boolean(pad.buttons[1]?.pressed || pad.buttons[2]?.pressed);
    const startPressed = Boolean(pad.buttons[9]?.pressed);

    if (jumpPressed && !prevGamepadJump) triggerJump();
    if (dashPressed && !prevGamepadDash) triggerDash();
    if (startPressed && !prevGamepadStart) setModalOpen(!paused);

    prevGamepadJump = jumpPressed;
    prevGamepadDash = dashPressed;
    prevGamepadStart = startPressed;

    return { x: lx, y: ly, camX: rx };
  }
  return { x: 0, y: 0, camX: 0 };
}

function stepSimulation(dt, timeSec) {
  if (paused || stageTransitioning) return;

  stageElapsed += dt;
  if (player.dashCooldown > 0) player.dashCooldown = Math.max(0, player.dashCooldown - dt);
  if (player.boostCooldown > 0) player.boostCooldown = Math.max(0, player.boostCooldown - dt);

  // Update moving platforms
  for (const plat of platformObjects) {
    plat.prevX = plat.group.position.x;
    plat.prevY = plat.group.position.y;
    plat.prevZ = plat.group.position.z;
    if (plat.data.move) {
      const { axis, amp, speed, phase } = plat.data.move;
      const offset = Math.sin(timeSec * speed + (phase || 0)) * amp;
      if (axis === "x") plat.group.position.x = plat.baseX + offset;
      if (axis === "y") plat.group.position.y = plat.baseY + offset;
      if (axis === "z") plat.group.position.z = plat.baseZ + offset;
    }
    plat.dx = plat.group.position.x - plat.prevX;
    plat.dy = plat.group.position.y - plat.prevY;
    plat.dz = plat.group.position.z - plat.prevZ;
  }

  // Carry player with standing platform
  if (player.onGround && player.standingPlatform) {
    player.pos.x += player.standingPlatform.dx;
    player.pos.y += player.standingPlatform.dy;
    player.pos.z += player.standingPlatform.dz;
  }

  // Input gathering
  const gp = readGamepadInput();
  if (gp.camX) cameraYaw -= gp.camX * 2.2 * dt;

  let moveX = gp.x + touchVector.x;
  let moveZ = gp.y + touchVector.y;

  if (keysDown.has("KeyA") || keysDown.has("ArrowLeft")) moveX -= 1;
  if (keysDown.has("KeyD") || keysDown.has("ArrowRight")) moveX += 1;
  if (keysDown.has("KeyW") || keysDown.has("ArrowUp")) moveZ -= 1;
  if (keysDown.has("KeyS") || keysDown.has("ArrowDown")) moveZ += 1;

  // Autopilot mode for demo/recording or AI testing
  if (autopilot) {
    const target = activeStage.portal;
    const dx = target.x - player.pos.x;
    const dz = target.z - player.pos.z;
    moveX = Math.max(-1, Math.min(1, dx * 0.65));
    moveZ = dz < 0 ? -1 : 0.5;
    if (player.onGround && Math.sin(timeSec * 3.5) > 0.92) {
      triggerJump();
    }
  }

  const len = Math.hypot(moveX, moveZ);
  if (len > 1) {
    moveX /= len;
    moveZ /= len;
  }

  const cosY = Math.cos(cameraYaw);
  const sinY = Math.sin(cameraYaw);
  const worldDirX = moveX * cosY + moveZ * sinY;
  const worldDirZ = moveZ * cosY - moveX * sinY;

  const accel = player.onGround ? MOVE_ACCEL : MOVE_ACCEL * 0.65;
  player.vel.x += worldDirX * accel * dt;
  player.vel.z += worldDirZ * accel * dt;

  // Friction
  const damping = player.onGround ? Math.pow(0.04, dt) : Math.pow(0.35, dt);
  player.vel.x *= damping;
  player.vel.z *= damping;

  const horizSpeed = Math.hypot(player.vel.x, player.vel.z);
  if (horizSpeed > MAX_SPEED && player.dashCooldown < 0.5 && player.boostCooldown <= 0) {
    player.vel.x = (player.vel.x / horizSpeed) * MAX_SPEED;
    player.vel.z = (player.vel.z / horizSpeed) * MAX_SPEED;
  }

  // Gravity
  player.vel.y += GRAVITY * dt;

  const prevBottom = player.pos.y - PLAYER_RADIUS;
  player.pos.x += player.vel.x * dt;
  player.pos.y += player.vel.y * dt;
  player.pos.z += player.vel.z * dt;

  // Platform collisions
  player.onGround = false;
  player.standingPlatform = null;
  for (const plat of platformObjects) {
    const px = plat.group.position.x;
    const py = plat.group.position.y;
    const pz = plat.group.position.z;
    const halfW = plat.data.w * 0.5 + PLAYER_RADIUS * 0.72;
    const halfD = plat.data.d * 0.5 + PLAYER_RADIUS * 0.72;
    const topY = py + plat.data.h * 0.5;
    const bottomY = py - plat.data.h * 0.5;

    if (
      Math.abs(player.pos.x - px) <= halfW &&
      Math.abs(player.pos.z - pz) <= halfD
    ) {
      const currBottom = player.pos.y - PLAYER_RADIUS;
      if (
        player.vel.y <= 0 &&
        prevBottom >= topY - 0.55 &&
        currBottom <= topY + 0.12
      ) {
        player.pos.y = topY + PLAYER_RADIUS;
        player.vel.y = 0;
        player.onGround = true;
        player.jumpsRemaining = 2;
        player.standingPlatform = plat;
      } else if (player.pos.y + PLAYER_RADIUS > bottomY && currBottom < topY) {
        // Side nudge
        const dx = player.pos.x - px;
        const dz = player.pos.z - pz;
        if (Math.abs(dx) / halfW > Math.abs(dz) / halfD) {
          player.pos.x = px + Math.sign(dx) * halfW;
          player.vel.x *= -0.3;
        } else {
          player.pos.z = pz + Math.sign(dz) * halfD;
          player.vel.z *= -0.3;
        }
      }
    }
  }

  // Boost pad collisions
  for (const bp of boostObjects) {
    bp.ringMeshBp.rotation.z += dt * 3.5;
    const dist = player.pos.distanceTo(bp.group.position);
    if (dist < 1.35 && player.boostCooldown <= 0) {
      player.boostCooldown = 0.45;
      player.vel.set(bp.data.vx, bp.data.vy, bp.data.vz);
      player.onGround = false;
      player.jumpsRemaining = 1;
      sound.boost();
      spawnParticles(bp.group.position, 0xfacc15, 20);
    }
  }

  // Checkpoint activation & automatic Arcadible Save
  for (const cp of checkpointObjects) {
    cp.pylon.rotation.y += dt * 2.2;
    cp.pylon.position.y = 1.35 + Math.sin(timeSec * 3 + cp.index) * 0.15;
    if (cp.index > activeCheckpointIndex) {
      const dist = Math.hypot(
        player.pos.x - cp.data.x,
        player.pos.y - cp.data.y,
        player.pos.z - cp.data.z
      );
      if (dist < 2.2) {
        activeCheckpointIndex = cp.index;
        cp.padMat.color.setHex(0x10b981);
        cp.padMat.emissive.setHex(0x059669);
        cp.pylonMat.color.setHex(0x34d399);
        cp.pylonMat.emissive.setHex(0x10b981);
        sound.checkpoint();
        spawnParticles(player.pos, 0x34d399, 24);
        showToast(`Checkpoint Saved: ${cp.data.label}`);
        saveManager.writeProgress({
          currentStage: activeStage.id,
          currentCheckpoint: activeCheckpointIndex,
          currentStageShards: Array.from(collectedShardIds),
          currentStageElapsed: Number(stageElapsed.toFixed(1)),
        });
      }
    }
  }

  // Shard collection & automatic Arcadible Save
  shardObjects.forEach((sh, idx) => {
    if (sh.collected) return;
    sh.crystal.rotation.y += dt * 2.6;
    sh.crystal.rotation.x += dt * 1.1;
    sh.halo.rotation.z -= dt * 2.0;
    sh.group.position.y = sh.data.y + Math.sin(timeSec * 3.2 + idx) * 0.18;

    const dist = player.pos.distanceTo(sh.group.position);
    if (dist < 1.25) {
      sh.collected = true;
      sh.group.visible = false;
      collectedShardIds.add(sh.data.id);
      sound.shard(collectedShardIds.size - 1);
      spawnParticles(sh.group.position, activeStage.theme.accent, 18);
      saveManager.writeProgress({
        currentStage: activeStage.id,
        currentCheckpoint: activeCheckpointIndex,
        currentStageShards: Array.from(collectedShardIds),
        currentStageElapsed: Number(stageElapsed.toFixed(1)),
      });
    }
  });

  // Hazard sweepers
  for (const hz of hazardObjects) {
    hz.angle += hz.data.speed * dt;
    hz.group.rotation.y = hz.angle;
    const dx = player.pos.x - hz.data.x;
    const dz = player.pos.z - hz.data.z;
    const dy = Math.abs(player.pos.y - (hz.data.y + 0.15));
    if (dy < 0.78) {
      const cosA = Math.cos(-hz.angle);
      const sinA = Math.sin(-hz.angle);
      const localX = dx * cosA - dz * sinA;
      const localZ = dx * sinA + dz * cosA;
      if (Math.abs(localX) <= hz.data.length + PLAYER_RADIUS * 0.7 && Math.abs(localZ) < 0.48) {
        spawnParticles(player.pos, activeStage.theme.hazard, 22);
        respawnAtActiveCheckpoint(true);
        return;
      }
    }
  }

  // Portal rotation & stage completion check
  if (portalObject) {
    portalObject.outerRing.rotation.z += dt * 1.5;
    portalObject.innerRing.rotation.z -= dt * 2.4;
    portalObject.innerRing.rotation.y = Math.sin(timeSec * 2) * 0.35;
    const distToPortal = player.pos.distanceTo(portalObject.group.position);
    if (distToPortal < 2.25) {
      completeCurrentStage();
      return;
    }
  }

  // Abyss fall check
  if (player.pos.y < -10) {
    respawnAtActiveCheckpoint(true);
  }

  // Update particle bursts
  for (let i = particleBursts.length - 1; i >= 0; i--) {
    const b = particleBursts[i];
    b.life -= dt;
    if (b.life <= 0) {
      stageRoot.remove(b.mesh);
      particleBursts.splice(i, 1);
    } else {
      b.vel.y -= 9.8 * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      b.mesh.scale.setScalar(Math.max(0.01, b.life * 1.5));
    }
  }

  // Update player mesh & camera
  playerGroup.position.copy(player.pos);
  coreMesh.rotation.x += player.vel.z * dt * 1.2;
  coreMesh.rotation.z -= player.vel.x * dt * 1.2;
  ringMeshA.rotation.y += dt * 2.4;
  ringMeshB.rotation.x += dt * 1.9;
  playerLight.position.copy(player.pos).add(new THREE.Vector3(0, 1.5, 0));

  const camDist = 8.8;
  const camHeight = 4.2;
  const targetCamX = player.pos.x + Math.sin(cameraYaw) * camDist;
  const targetCamZ = player.pos.z + Math.cos(cameraYaw) * camDist;
  const targetCamY = player.pos.y + camHeight;
  camera.position.lerp(new THREE.Vector3(targetCamX, targetCamY, targetCamZ), Math.min(1, dt * 8.5));
  camera.lookAt(player.pos.x, player.pos.y + 0.65, player.pos.z - 2.2);

  updateHUD();
}

function resize() {
  const width = canvas.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || window.innerHeight;
  const aspect = width / Math.max(1, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.setSize(width, height, false);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}

let lastTime = performance.now();
function frame(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  const timeSec = now / 1000;
  stepSimulation(dt, timeSec);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// Event listeners
addEventListener("contextmenu", (e) => e.preventDefault());

addEventListener("keydown", (e) => {
  sound.unlock();
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  keysDown.add(e.code);

  if (e.repeat) return;
  if (e.code === "Space") triggerJump();
  if (e.code === "ShiftLeft" || e.code === "ShiftRight" || e.code === "KeyE") triggerDash();
  if (e.code === "KeyR") respawnAtActiveCheckpoint(true);
  if (e.code === "KeyP" || e.code === "Escape") setModalOpen(!paused);

  // Quick stage select for unlocked stages
  if (e.code.startsWith("Digit")) {
    const num = Number(e.code.replace("Digit", ""));
    if (num >= 1 && num <= STAGES.length && num <= (saveManager.progress.unlockedStage || 1)) {
      selectStage(num, 0);
    }
  }
});

addEventListener("keyup", (e) => {
  keysDown.delete(e.code);
});

// Mouse camera orbit
canvas.addEventListener(
  "touchstart",
  (e) => {
    sound.unlock();
    e.preventDefault();
  },
  { passive: false }
);

canvas.addEventListener("pointerdown", (e) => {
  sound.unlock();
  canvas.setPointerCapture(e.pointerId);
  pointerDrag = { id: e.pointerId, x: e.clientX, y: e.clientY };
});

canvas.addEventListener("pointermove", (e) => {
  if (pointerDrag?.id !== e.pointerId) return;
  const dx = e.clientX - pointerDrag.x;
  pointerDrag.x = e.clientX;
  cameraYaw -= dx * 0.0065 * (saveManager.settings.cameraSensitivity || 1.0);
});

function endPointerDrag(e) {
  if (pointerDrag?.id === e.pointerId) pointerDrag = null;
}
canvas.addEventListener("pointerup", endPointerDrag);
canvas.addEventListener("pointercancel", endPointerDrag);

// Touch virtual joystick & buttons
const joystickEl = document.getElementById("touch-joystick");
const knobEl = document.getElementById("touch-knob");
let joyPointerId = null;

joystickEl.addEventListener("pointerdown", (e) => {
  sound.unlock();
  e.stopPropagation();
  joystickEl.setPointerCapture(e.pointerId);
  joyPointerId = e.pointerId;
  updateJoystick(e);
});

joystickEl.addEventListener("pointermove", (e) => {
  if (e.pointerId !== joyPointerId) return;
  updateJoystick(e);
});

function resetJoystick(e) {
  if (e.pointerId !== joyPointerId) return;
  joyPointerId = null;
  touchVector.x = 0;
  touchVector.y = 0;
  knobEl.style.transform = "translate(-50%, -50%)";
}
joystickEl.addEventListener("pointerup", resetJoystick);
joystickEl.addEventListener("pointercancel", resetJoystick);

function updateJoystick(e) {
  const rect = joystickEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const maxR = rect.width * 0.36;
  let dx = e.clientX - cx;
  let dy = e.clientY - cy;
  const dist = Math.hypot(dx, dy);
  if (dist > maxR) {
    dx = (dx / dist) * maxR;
    dy = (dy / dist) * maxR;
  }
  touchVector.x = dx / maxR;
  touchVector.y = dy / maxR;
  knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}

document.getElementById("touch-jump").addEventListener("pointerdown", (e) => {
  e.stopPropagation();
  triggerJump();
});
document.getElementById("touch-dash").addEventListener("pointerdown", (e) => {
  e.stopPropagation();
  triggerDash();
});

// UI Buttons
btnStages.addEventListener("click", () => {
  sound.unlock();
  setModalOpen(!paused);
});
btnResume.addEventListener("click", () => setModalOpen(false));
btnRestartStage.addEventListener("click", () => {
  selectStage(activeStage.id, 0);
  setModalOpen(false);
});
btnMute.addEventListener("click", () => {
  sound.unlock();
  const nextMuted = !sound.muted;
  sound.setMuted(nextMuted);
  saveManager.saveSettings({ muted: nextMuted });
  updateHUD();
});
btnRetrySave.addEventListener("click", async () => {
  const res = await saveManager.loadProgress();
  if (res.ok) {
    showNotice("");
    const p = res.progress;
    buildStageScene(p.currentStage, p.currentCheckpoint, p.currentStageShards, p.currentStageElapsed);
    showToast("Save Loaded Successfully!");
  }
});

// Pause & save continuously when page hides or blurs
function handleVisibilityOrHide() {
  if (document.hidden) {
    sound.setPaused(true);
    saveManager.writeProgress({
      currentStage: activeStage.id,
      currentCheckpoint: activeCheckpointIndex,
      currentStageShards: Array.from(collectedShardIds),
      currentStageElapsed: Number(stageElapsed.toFixed(1)),
    });
  } else if (!paused) {
    sound.setPaused(false);
  }
}
document.addEventListener("visibilitychange", handleVisibilityOrHide);
addEventListener("pagehide", () => {
  saveManager.writeProgress({
    currentStage: activeStage.id,
    currentCheckpoint: activeCheckpointIndex,
    currentStageShards: Array.from(collectedShardIds),
    currentStageElapsed: Number(stageElapsed.toFixed(1)),
  });
});
addEventListener("blur", () => {
  sound.setPaused(true);
});
addEventListener("focus", () => {
  if (!paused) sound.setPaused(false);
});

new ResizeObserver(resize).observe(canvas);
resize();

// Expose clean controller hook for testing & store media recording
window.__aetherGame = {
  getState: () => ({
    stage: activeStage.id,
    stageName: activeStage.name,
    checkpoint: activeCheckpointIndex,
    shards: Array.from(collectedShardIds),
    unlockedStage: saveManager.progress.unlockedStage,
    completedStages: saveManager.progress.completedStages,
    where: saveManager.where,
    playerPos: { x: player.pos.x, y: player.pos.y, z: player.pos.z },
  }),
  warpToCheckpoint: async (cpIdx) => {
    activeCheckpointIndex = Math.max(0, Math.min(activeStage.checkpoints.length - 1, cpIdx));
    const cp = activeStage.checkpoints[activeCheckpointIndex];
    player.pos.set(cp.x, cp.y + 0.9, cp.z);
    player.vel.set(0, 0, 0);
    await saveManager.writeProgress({
      currentStage: activeStage.id,
      currentCheckpoint: activeCheckpointIndex,
      currentStageShards: Array.from(collectedShardIds),
      currentStageElapsed: Number(stageElapsed.toFixed(1)),
    });
    updateHUD();
  },
  completeStageNow: async () => {
    await completeCurrentStage();
  },
  loadStage: async (stageId, cpIdx = 0) => {
    await selectStage(stageId, cpIdx);
  },
  setAutopilot: (enabled) => {
    autopilot = Boolean(enabled);
  },
};

// Startup: await arcadible.ready, load saved stage/checkpoint progress, and resume where player left off
const initResult = await saveManager.init();
sound.setMuted(saveManager.settings.muted);

if (saveManager.where === "memory") {
  showNotice("Progress won't be kept after you close the game (browser storage is restricted).", false);
}

const p = saveManager.progress;
buildStageScene(p.currentStage, p.currentCheckpoint, p.currentStageShards, p.currentStageElapsed);

if (initResult.ok && initResult.hadExistingSave) {
  const cpLabel =
    activeStage.checkpoints[activeCheckpointIndex]?.label || `Checkpoint ${activeCheckpointIndex + 1}`;
  showToast(`Resumed Stage ${activeStage.id}: ${activeStage.name} (${cpLabel})`, 3200);
}

requestAnimationFrame(frame);
