import { arcadible } from "./vendor/arcadible-sdk/index.js";

const PROGRESS_KEY = "progress";
const SETTINGS_KEY = "settings";
const SCHEMA_VERSION = 1;

export function parseSemver(version) {
  if (!version || typeof version !== "string") return null;
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || null,
  };
}

// Returns true if versionA is strictly newer than versionB according to SemVer.
export function isNewer(versionA, versionB) {
  const a = parseSemver(versionA);
  const b = parseSemver(versionB);
  if (!a || !b) return false;
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  if (a.patch !== b.patch) return a.patch > b.patch;
  if (!a.prerelease && b.prerelease) return true;
  if (a.prerelease && !b.prerelease) return false;
  if (a.prerelease && b.prerelease) return a.prerelease > b.prerelease;
  return false;
}

export function createDefaultProgress() {
  return {
    schemaVersion: SCHEMA_VERSION,
    currentStage: 1,
    currentCheckpoint: 0,
    currentStageShards: [],
    currentStageElapsed: 0,
    unlockedStage: 1,
    completedStages: {},
    totalShards: 0,
    totalResets: 0,
    updatedAt: Date.now(),
  };
}

export function migrateProgress(raw) {
  const base = createDefaultProgress();
  if (!raw || typeof raw !== "object") return base;

  const currentStage = Math.max(1, Math.min(5, Number(raw.currentStage ?? raw.stage ?? raw.level ?? 1) || 1));
  const unlockedStage = Math.max(
    currentStage,
    Math.min(5, Number(raw.unlockedStage ?? raw.maxStage ?? currentStage) || 1)
  );
  const currentCheckpoint = Math.max(0, Number(raw.currentCheckpoint ?? raw.checkpoint ?? 0) || 0);
  const currentStageShards = Array.isArray(raw.currentStageShards)
    ? raw.currentStageShards.filter((id) => typeof id === "number")
    : [];
  const currentStageElapsed = Math.max(0, Number(raw.currentStageElapsed) || 0);

  const completedStages = {};
  if (raw.completedStages && typeof raw.completedStages === "object") {
    for (const [k, v] of Object.entries(raw.completedStages)) {
      if (v && typeof v === "object") {
        completedStages[k] = {
          bestTime: Number(v.bestTime) || 0,
          shardsCollected: Number(v.shardsCollected) || 0,
          totalShards: Number(v.totalShards) || 0,
          stars: Math.max(1, Math.min(3, Number(v.stars) || 1)),
          completions: Math.max(1, Number(v.completions) || 1),
        };
      }
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    currentStage,
    currentCheckpoint,
    currentStageShards,
    currentStageElapsed,
    unlockedStage,
    completedStages,
    totalShards: Math.max(0, Number(raw.totalShards) || 0),
    totalResets: Math.max(0, Number(raw.totalResets) || 0),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

// Merge two progress states so multi-tab writes never lose unlocked stages or best records.
export function mergeProgress(olderOrOtherTab, latestLocal) {
  if (!olderOrOtherTab) return latestLocal;
  const a = migrateProgress(olderOrOtherTab);
  const b = migrateProgress(latestLocal);

  const mergedCompleted = { ...a.completedStages };
  for (const [stageId, record] of Object.entries(b.completedStages)) {
    const prev = mergedCompleted[stageId];
    if (!prev) {
      mergedCompleted[stageId] = { ...record };
    } else {
      mergedCompleted[stageId] = {
        bestTime:
          prev.bestTime > 0 && record.bestTime > 0
            ? Math.min(prev.bestTime, record.bestTime)
            : Math.max(prev.bestTime, record.bestTime),
        shardsCollected: Math.max(prev.shardsCollected, record.shardsCollected),
        totalShards: Math.max(prev.totalShards, record.totalShards),
        stars: Math.max(prev.stars, record.stars),
        completions: Math.max(prev.completions, record.completions),
      };
    }
  }

  return {
    ...b,
    unlockedStage: Math.max(a.unlockedStage, b.unlockedStage),
    completedStages: mergedCompleted,
    totalShards: Math.max(a.totalShards, b.totalShards),
    totalResets: Math.max(a.totalResets, b.totalResets),
    updatedAt: Date.now(),
  };
}

export class SaveManager {
  constructor() {
    this.ready = false;
    this.where = "game";
    this.build = null;
    this.loadError = null;
    this.fromNewerVersion = false;
    this.newerVersionString = null;
    this.progress = createDefaultProgress();
    this.settings = { muted: false, cameraSensitivity: 1.0 };
    this.hadExistingSave = false;
    this.onStatusChange = null;
  }

  notify(status) {
    if (typeof this.onStatusChange === "function") {
      this.onStatusChange(status);
    }
  }

  async init() {
    await arcadible.ready;
    this.ready = true;
    this.where = arcadible.saves.where || "game";
    this.build = arcadible.build || null;

    await this.loadSettings();
    return await this.loadProgress();
  }

  async loadSettings() {
    try {
      const raw = await arcadible.saves.read(SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.settings = {
          muted: Boolean(parsed.muted),
          cameraSensitivity: Number(parsed.cameraSensitivity) || 1.0,
        };
      }
    } catch {
      // Settings fallback silently per Arcadible best practices
    }
  }

  async saveSettings(partial) {
    this.settings = { ...this.settings, ...partial };
    try {
      await arcadible.saves.write(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // Ignore settings write failure
    }
  }

  async loadProgress() {
    this.loadError = null;
    try {
      const rawStr = await arcadible.saves.read(PROGRESS_KEY);
      let info = null;
      try {
        info = arcadible.saves.infoSync(PROGRESS_KEY);
      } catch {
        info = await arcadible.saves.info(PROGRESS_KEY).catch(() => null);
      }

      if (info?.version && this.build?.version && isNewer(info.version, this.build.version)) {
        this.fromNewerVersion = true;
        this.newerVersionString = info.version;
      } else {
        this.fromNewerVersion = false;
        this.newerVersionString = null;
      }

      if (rawStr) {
        this.hadExistingSave = true;
        const parsed = JSON.parse(rawStr);
        this.progress = migrateProgress(parsed);
      } else {
        this.hadExistingSave = false;
        this.progress = createDefaultProgress();
      }
      return { ok: true, progress: this.progress, hadExistingSave: this.hadExistingSave };
    } catch (err) {
      const code = err?.code || "unavailable";
      this.loadError = {
        code,
        message: err?.message || "Saves could not be reached. Retry before saving over progress.",
      };
      this.notify({ type: "error", code, message: this.loadError.message });
      return { ok: false, error: this.loadError, progress: this.progress };
    }
  }

  async writeProgress(patch = {}) {
    // Never overwrite a player's progress if the initial load failed or came from a newer version
    if (this.loadError) {
      return { ok: false, skipped: "load_error" };
    }

    // Read before write (sync from memory after ready) to merge multi-tab state
    let latestSynced = null;
    if (this.ready) {
      try {
        const info = arcadible.saves.infoSync(PROGRESS_KEY);
        if (info?.version && this.build?.version && isNewer(info.version, this.build.version)) {
          this.fromNewerVersion = true;
          this.newerVersionString = info.version;
        }
        const existingStr = arcadible.saves.readSync(PROGRESS_KEY);
        if (existingStr) {
          latestSynced = JSON.parse(existingStr);
        }
      } catch {
        // Sync read throws unavailable only if saves took >10s and still haven't arrived
      }
    }

    const updatedLocal = migrateProgress({
      ...this.progress,
      ...patch,
      updatedAt: Date.now(),
    });
    this.progress = mergeProgress(latestSynced, updatedLocal);

    if (this.fromNewerVersion) {
      this.notify({
        type: "newer_version",
        message: `Save belongs to newer version v${this.newerVersionString}; playing without overwriting.`,
      });
      return { ok: false, skipped: "newer_version" };
    }

    const payload = JSON.stringify(this.progress);
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await arcadible.saves.write(PROGRESS_KEY, payload);
        this.notify({ type: "saved", progress: this.progress });
        return { ok: true, progress: this.progress };
      } catch (err) {
        const code = err?.code || "unavailable";
        const retryable = code === "busy" || code === "timeout" || code === "unavailable";
        if (retryable && attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 350));
          continue;
        }
        this.notify({
          type: "save_warning",
          code,
          message:
            code === "full" || code === "too_large" || code === "too_many"
              ? "Device save storage is full."
              : "Could not save right now; will retry at next checkpoint.",
        });
        return { ok: false, code };
      }
    }
  }
}
