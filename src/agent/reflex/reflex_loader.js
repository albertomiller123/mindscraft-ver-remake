import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import * as skills from '../library/skills.js';
import * as world from '../library/world.js';
import Vec3 from 'vec3';

export class ReflexLoader {
    constructor(agent) {
        this.agent = agent;
        this.botName = agent.name;
        this.reflexes_dir = `./bots/${this.botName}/reflexes`;
        this.reflex_stats_fp = `${this.reflexes_dir}/_stats.json`;

        // This holds the exact functions loaded from JS, mapped by threat name
        this.activeReflexHandlers = new Map();
        this.reflexStats = {};

        this._loadReflexStats();
        // NOTE: startListening() and loadReflexes() are called by agent.js after bot is ready
    }

    _loadReflexStats() {
        try {
            if (!fs.existsSync(this.reflex_stats_fp)) {
                this.reflexStats = {};
                return;
            }
            const raw = fs.readFileSync(this.reflex_stats_fp, 'utf8');
            const parsed = JSON.parse(raw);
            this.reflexStats = (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (err) {
            console.warn('[ReflexLoader] Failed to load reflex stats, resetting:', err.message);
            this.reflexStats = {};
        }
    }

    _saveReflexStats() {
        try {
            fs.mkdirSync(this.reflexes_dir, { recursive: true });
            fs.writeFileSync(this.reflex_stats_fp, JSON.stringify(this.reflexStats, null, 2), 'utf8');
        } catch (err) {
            console.warn('[ReflexLoader] Failed to save reflex stats:', err.message);
        }
    }

    _ensureReflexStat(threatName) {
        if (!this.reflexStats[threatName]) {
            this.reflexStats[threatName] = {
                trigger_count: 0,
                success_count: 0,
                failure_count: 0,
                timeout_count: 0,
                decay_level: 0,
                last_trigger_at: null,
                last_success_at: null,
                last_failure_at: null,
                disabled_until: null,
                last_error: ''
            };
        }
        return this.reflexStats[threatName];
    }

    _recordReflexResult(threatName, outcome, errorMessage = '') {
        const stats = this._ensureReflexStat(threatName);
        const nowIso = new Date().toISOString();
        stats.trigger_count += 1;
        stats.last_trigger_at = nowIso;
        if (outcome === 'success') {
            stats.success_count += 1;
            stats.last_success_at = nowIso;
            stats.last_error = '';
            stats.decay_level = Math.max(0, (stats.decay_level || 0) - 1);
        } else if (outcome === 'timeout') {
            stats.timeout_count += 1;
            stats.failure_count += 1;
            stats.last_failure_at = nowIso;
            stats.last_error = errorMessage || 'timeout';
        } else {
            stats.failure_count += 1;
            stats.last_failure_at = nowIso;
            stats.last_error = errorMessage || 'failure';
        }

        const triggerCount = Math.max(1, stats.trigger_count);
        const successRate = stats.success_count / triggerCount;
        if (stats.trigger_count >= 5 && successRate < 0.2) {
            stats.decay_level = (stats.decay_level || 0) + 1;
            const disableMs = Math.min(5 * 60 * 1000 * stats.decay_level, 60 * 60 * 1000);
            stats.disabled_until = new Date(Date.now() + disableMs).toISOString();
        } else if (outcome === 'success') {
            stats.disabled_until = null;
        }

        this._saveReflexStats();
    }

    startListening() {
        // NOTE: health listener is handled by agent.js unified listener.
        // agent.js calls this._triggerReflex(amount) directly when damage occurs.
        // This method is kept for compatibility but no longer registers its own listener.
    }

    async _triggerReflex(attackerName, amount) {
        if (this.activeReflexHandlers.size === 0) return;
        const bot = this.agent.bot;

        // Try to find specific handler, or fallback to general
        let safeThreatName = attackerName.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
        let handler = this.activeReflexHandlers.get(safeThreatName);
        let selectedThreatName = safeThreatName;
        if (!handler) {
            handler = this.activeReflexHandlers.get('general');
            selectedThreatName = 'general';
        }

        if (!handler) return; // No reflex learned for this threat yet
        const stats = this._ensureReflexStat(selectedThreatName);
        if (stats.disabled_until) {
            const disabledUntilMs = Date.parse(stats.disabled_until);
            if (Number.isFinite(disabledUntilMs) && disabledUntilMs > Date.now()) {
                return;
            }
            stats.disabled_until = null;
        }

        try {
            // Push the reflex to Action Manager as an emergency forced action
            // This replaces the leaky Promise.race design
            const actionLabel = `reflex_${selectedThreatName}`;

            // We don't await the `runAction` here so we don't block the caller (usually an event listener)
            // The ActionManager will handle the timing out and interruption internally safely.
            this.agent.actions.runAction(
                actionLabel,
                async () => {
                    await handler(bot, attackerName, amount, skills, world, Vec3);
                },
                { timeout: 0.15, forceInterrupt: true } // ~9 seconds timeout (0.15 min)
            ).then((result) => {
                if (result && result.success) {
                    this._recordReflexResult(selectedThreatName, 'success');
                } else if (result && result.timedout) {
                    this._recordReflexResult(selectedThreatName, 'timeout', result.reason);
                } else {
                    this._recordReflexResult(selectedThreatName, 'failure', result ? result.reason : 'unknown');
                }
            }).catch((err) => {
                console.error('[ReflexLoader] Reflex execution failed inside ActionManager:', err.message);
                this._recordReflexResult(selectedThreatName, 'failure', err.message);
            });

        } catch (err) {
            console.error('[ReflexLoader] Failed to start reflex execution:', err.message);
            this._recordReflexResult(selectedThreatName, 'failure', err?.message || String(err));
        }
    }

    async loadReflexes() {
        if (!fs.existsSync(this.reflexes_dir)) return;

        const files = fs.readdirSync(this.reflexes_dir);
        const MAX_REFLEX_HANDLERS = settings.reflex_max_active_handlers ?? 20; // Use settings if available
        let loaded = this.activeReflexHandlers.size;

        for (const file of files) {
            if (!file.startsWith('reflex_') || !file.endsWith('.js')) continue;

            const threatName = file.replace('reflex_', '').replace('.js', '');
            if (this.activeReflexHandlers.has(threatName)) continue; // Already loaded

            if (loaded >= MAX_REFLEX_HANDLERS) {
                console.warn(`[ReflexLoader] Max reflex handler limit (${MAX_REFLEX_HANDLERS}) reached. Skipping: ${file}`);
                // In Phase 7: We could implement an LRU eviction here if needed, 
                // but for now we just respect the hard limit to prevent OOM.
                break;
            }

            const fp = path.resolve(`${this.reflexes_dir}/${file}`);

            try {
                // Unload cache if it was loaded before
                const moduleUrl = url.pathToFileURL(fp).href + '?t=' + Date.now();
                const loadedModule = await import(moduleUrl);

                if (typeof loadedModule.handleReflex === 'function') {
                    this.activeReflexHandlers.set(threatName, loadedModule.handleReflex);
                    loaded++;
                    console.log(`[ReflexLoader] Successfully hot-loaded reflex handler for threat: ${threatName}`);
                } else {
                    console.error(`[ReflexLoader] ${file} does not export 'handleReflex' function.`);
                }
            } catch (err) {
                console.error(`[ReflexLoader] Failed to load reflex module ${file}:`, err);
            }
        }
    }
}
