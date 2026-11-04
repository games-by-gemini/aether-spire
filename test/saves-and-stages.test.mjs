import assert from "node:assert/strict";
import { STAGES } from "../src/stages.js";
import {
  parseSemver,
  isNewer,
  createDefaultProgress,
  migrateProgress,
  mergeProgress,
  SaveManager,
} from "../src/saves.js";

async function runTests() {
  // 1. STAGES validation
  assert.equal(STAGES.length, 5);
  const ids = new Set();
  for (const stage of STAGES) {
    ids.add(stage.id);
    assert.ok(stage.name.length > 0);
    assert.ok(stage.checkpoints.length >= 2, `Stage ${stage.id} must have at least 2 checkpoints`);
    assert.ok(stage.platforms.length >= 6, `Stage ${stage.id} must have at least 6 platforms`);
    assert.ok(stage.shards.length >= 5, `Stage ${stage.id} must have at least 5 shards`);
    assert.ok(stage.portal && typeof stage.portal.z === "number");
  }
  assert.deepEqual([...ids], [1, 2, 3, 4, 5]);
  console.log("PASS: 5 3D stages validated");

  // 2. SemVer comparison
  assert.equal(isNewer("1.0.0", "0.1.0-beta.1"), true);
  assert.equal(isNewer("1.0.0", "1.0.0-beta.1"), true);
  assert.equal(isNewer("1.0.0-beta.1", "1.0.0"), false);
  assert.equal(isNewer("1.2.0", "1.1.9"), true);
  assert.equal(isNewer("1.0.0", "1.0.0"), false);
  assert.deepEqual(parseSemver("1.2.3-beta.4"), {
    major: 1,
    minor: 2,
    patch: 3,
    prerelease: "beta.4",
  });
  console.log("PASS: SemVer version comparison validated");

  // 3. Migration & multi-tab merging
  const def = createDefaultProgress();
  assert.equal(def.currentStage, 1);
  assert.equal(def.currentCheckpoint, 0);
  assert.equal(def.unlockedStage, 1);

  const migrated = migrateProgress({
    level: 3,
    checkpoint: 2,
    currentStageShards: [301, 302],
    completedStages: {
      1: { bestTime: 24.5, shardsCollected: 5, totalShards: 5, stars: 3, completions: 2 },
      2: { bestTime: 33.1, shardsCollected: 4, totalShards: 6, stars: 2, completions: 1 },
    },
  });
  assert.equal(migrated.currentStage, 3);
  assert.equal(migrated.unlockedStage, 3);
  assert.equal(migrated.currentCheckpoint, 2);
  assert.deepEqual(migrated.currentStageShards, [301, 302]);

  const tabA = migrateProgress({
    currentStage: 4,
    unlockedStage: 4,
    completedStages: {
      2: { bestTime: 35.0, shardsCollected: 4, totalShards: 6, stars: 2, completions: 1 },
    },
  });
  const tabB = migrateProgress({
    currentStage: 2,
    unlockedStage: 2,
    completedStages: {
      2: { bestTime: 29.8, shardsCollected: 6, totalShards: 6, stars: 3, completions: 2 },
    },
  });
  const merged = mergeProgress(tabA, tabB);
  assert.equal(merged.unlockedStage, 4);
  assert.equal(merged.completedStages[2].bestTime, 29.8);
  assert.equal(merged.completedStages[2].stars, 3);
  console.log("PASS: Save migration and multi-tab merging validated");

  // 4. End-to-end SaveManager persistence & restoration
  const mgr1 = new SaveManager();
  await mgr1.init();
  await mgr1.writeProgress({
    currentStage: 3,
    currentCheckpoint: 1,
    currentStageShards: [301, 302, 303],
    unlockedStage: 3,
    completedStages: {
      1: { bestTime: 22.1, shardsCollected: 5, totalShards: 5, stars: 3, completions: 1 },
      2: { bestTime: 31.4, shardsCollected: 5, totalShards: 6, stars: 2, completions: 1 },
    },
  });

  const mgr2 = new SaveManager();
  const res = await mgr2.init();
  assert.equal(res.ok, true);
  assert.equal(res.hadExistingSave, true);
  assert.equal(mgr2.progress.currentStage, 3);
  assert.equal(mgr2.progress.currentCheckpoint, 1);
  assert.deepEqual(mgr2.progress.currentStageShards, [301, 302, 303]);
  assert.equal(mgr2.progress.unlockedStage, 3);
  assert.equal(mgr2.progress.completedStages[1].stars, 3);
  console.log("PASS: SaveManager end-to-end persistence and restoration validated");
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
