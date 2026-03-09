import { writeFileSync, existsSync, readFileSync, unlinkSync } from 'fs';
import * as world from '../library/world.js';
import * as skills from '../library/skills.js';
import * as mc from '../../utils/mcdata.js';
import settings from '../settings.js';
export class RecursiveTaskManager {
    constructor(agent) {
        this.agent = agent;
        this.botName = agent.name;
        this.tree_fp = `./bots/${this.botName}/task_tree.json`;

        // Root of the task tree
        this.root = null;

        // State
        this.isRunning = false;
        this.isPaused = false;
        this.cooldownUntil = 0;
        this.maxDepth = settings.recursive_task_max_depth ?? 4; // Use settings if available

        this.loadTree();
    }

    _classifyTaskFailure(reason = '') {
        const text = (reason || '').toString().toLowerCase();
        const defaultPolicy = {
            code: 'unknown_failure',
            retryable: true,
            max_attempts: 3,
            base_backoff_seconds: 15,
            max_backoff_seconds: 240
        };
        if (!text) {
            return defaultPolicy;
        }

        if (text.includes('timed out') || text.includes('timeout')) {
            return {
                code: 'timeout',
                retryable: true,
                max_attempts: 4,
                base_backoff_seconds: 20,
                max_backoff_seconds: 300
            };
        }
        if (text.includes('interrupted')) {
            return {
                code: 'interrupted',
                retryable: true,
                max_attempts: 3,
                base_backoff_seconds: 8,
                max_backoff_seconds: 90
            };
        }
        if (text.includes('no progress')) {
            return {
                code: 'no_progress',
                retryable: true,
                max_attempts: 2,
                base_backoff_seconds: 25,
                max_backoff_seconds: 120
            };
        }
        if (text.includes('code generation failed')) {
            return {
                code: 'code_generation_failed',
                retryable: true,
                max_attempts: 3,
                base_backoff_seconds: 10,
                max_backoff_seconds: 120
            };
        }
        if (text.includes('deterministic verifier')) {
            if (text.includes('inventory') || text.includes('not at destination')) {
                return {
                    code: 'verification_not_done',
                    retryable: true,
                    max_attempts: 4,
                    base_backoff_seconds: 12,
                    max_backoff_seconds: 180
                };
            }
            return {
                code: 'deterministic_failed',
                retryable: true,
                max_attempts: 3,
                base_backoff_seconds: 15,
                max_backoff_seconds: 180
            };
        }
        if (text.includes('ai verifier')) {
            return {
                code: 'ai_verification_failed',
                retryable: true,
                max_attempts: 3,
                base_backoff_seconds: 20,
                max_backoff_seconds: 180
            };
        }
        if (text.includes('invalid') || text.includes('does not exist') || text.includes('incorrectly formatted')) {
            return {
                code: 'invalid_plan',
                retryable: false,
                max_attempts: 1,
                base_backoff_seconds: 0,
                max_backoff_seconds: 0
            };
        }
        if (text.includes('execution error') || text.includes('exception')) {
            return {
                code: 'execution_error',
                retryable: true,
                max_attempts: 2,
                base_backoff_seconds: 18,
                max_backoff_seconds: 180
            };
        }
        return defaultPolicy;
    }

    /**
     * Start a new overarching mission.
     * Overwrites the current tree.
     */
    async startMission(missionPrompt) {
        const mission = (missionPrompt || '').toString().trim();
        if (!mission) {
            return 'Cannot start mission: prompt is empty.';
        }

        const now = new Date().toISOString();
        this.root = {
            id: 'root',
            desc: mission,
            status: 'pending',
            children: [],
            parent_id: null,
            attempts: 0,
            last_error: '',
            last_error_code: 'none',
            createdAt: now,
            updatedAt: now,
            completedAt: null
        };

        this.saveTree();
        this.agent.bot.emit('idle');
        return `Started recursive mission: "${mission}"`;
    }

    pauseMission(paused = true) {
        this.isPaused = paused;
        return `Mission ${paused ? 'paused' : 'resumed'}.`;
    }

    clearMission() {
        this.root = null;
        this.isRunning = false;
        this.saveTree();
        return 'Mission cleared.';
    }

    /**
     * Reset any 'in_progress' leaf nodes back to 'pending' after bot death.
     * Prevents the tree from getting stuck when bot respawns.
     */
    resetOnDeath() {
        if (!this.root) return;
        this.isRunning = false;
        this._resetInProgressNodes(this.root);
        this.saveTree();
        console.log('[TaskTree] Reset in_progress nodes after death.');
    }

    _resetInProgressNodes(node) {
        if (!node) return;
        if (node.status === 'in_progress') {
            node.status = 'pending';
        }
        if (node.children) {
            for (const child of node.children) {
                this._resetInProgressNodes(child);
            }
        }
    }

    getMissionStatus() {
        if (!this.root) return 'No active mission.';
        if (this.root.status === 'done') return `Mission "${this.root.desc}" is complete.`;
        return `Mission "${this.root.desc}" is ${this.isPaused ? 'paused' : 'active'}.`;
    }

    /**
     * Reconstruct 'parent' references after loading from JSON
     */
    _linkParents(node, parentNode) {
        if (!node) return;
        node._parentNode = parentNode;
        if (node.children) {
            for (const child of node.children) {
                this._linkParents(child, node);
            }
        }
    }

    _normalizeTaskDesc(rawDesc) {
        if (typeof rawDesc === 'string') {
            const text = rawDesc.trim();
            return text.length > 0 ? text : 'Unnamed task';
        }
        if (rawDesc && typeof rawDesc === 'object') {
            if (typeof rawDesc.desc !== 'undefined') {
                return this._normalizeTaskDesc(rawDesc.desc);
            }
            if (typeof rawDesc.description !== 'undefined') {
                return this._normalizeTaskDesc(rawDesc.description);
            }
            try {
                const text = JSON.stringify(rawDesc);
                return text && text.length > 0 ? text : 'Unnamed task';
            } catch (_err) {
                return 'Unnamed task';
            }
        }
        if (rawDesc === null || typeof rawDesc === 'undefined') {
            return 'Unnamed task';
        }
        return String(rawDesc);
    }

    _sanitizeTreeNode(node) {
        if (!node || typeof node !== 'object') {
            return;
        }
        node.desc = this._normalizeTaskDesc(node.desc);
        if (!Array.isArray(node.children)) {
            node.children = [];
        }
        if (typeof node.last_error !== 'string') {
            node.last_error = String(node.last_error || '');
        }
        if (typeof node.last_error_code !== 'string') {
            node.last_error_code = 'none';
        }
        for (const child of node.children) {
            this._sanitizeTreeNode(child);
        }
    }

    loadTree() {
        if (!existsSync(this.tree_fp)) {
            this.root = null;
            return;
        }
        try {
            const data = JSON.parse(readFileSync(this.tree_fp, 'utf8'));
            if (!data || !data.id || data.id !== 'root') {
                this.root = null;
                return;
            }
            this.root = data;
            this._sanitizeTreeNode(this.root);
            this._linkParents(this.root, null);
        } catch (err) {
            console.warn('Failed to load recursive task tree:', err);
            this.root = null;
        }
    }

    saveTree() {
        try {
            if (!this.root) {
                if (existsSync(this.tree_fp)) {
                    unlinkSync(this.tree_fp);
                }
                return;
            }
            // We need to strip the circular _parentNode reference before serializing
            const stripParents = (node) => {
                const cleanNode = { ...node };
                delete cleanNode._parentNode;
                if (cleanNode.children) {
                    cleanNode.children = cleanNode.children.map(stripParents);
                }
                return cleanNode;
            };

            this.root.updatedAt = new Date().toISOString();
            const cleanRoot = stripParents(this.root);
            writeFileSync(this.tree_fp, JSON.stringify(cleanRoot, null, 2), 'utf8');
        } catch (err) {
            console.warn('Failed to save recursive task tree:', err);
        }
    }

    /**
     * Find the next leaf node that is ready to execute (DFS).
     * If a pending node has no children, it's evaluated. If it's too complex, we decompose it.
     */
    _findNextLeaf(node) {
        if (!node) return null;

        // If node is done or failed beyond retry, skip
        if (node.status === 'done' || node.status === 'failed') return null;

        // If it has children, search depth-first
        if (node.children && node.children.length > 0) {
            for (const child of node.children) {
                const leaf = this._findNextLeaf(child);
                if (leaf) return leaf;
            }
            // If all children are processed, update this node's status
            this._updateNodeStatusFromChildren(node);
            return null;
        }

        // It's a leaf node. Check cooldown
        if (node.status === 'pending' || node.status === 'in_progress') {
            if (node.next_attempt_after) {
                const nextAttemptAt = Date.parse(node.next_attempt_after);
                if (nextAttemptAt > Date.now()) {
                    return null; // Still in cooldown
                }
            }
            return node;
        }

        return null;
    }

    _updateNodeStatusFromChildren(node) {
        if (!node.children || node.children.length === 0) return;

        let allDone = true;
        let anyFailed = false;

        for (const child of node.children) {
            if (child.status !== 'done') allDone = false;
            if (child.status === 'failed') anyFailed = true;
        }

        if (allDone) {
            node.status = 'done';
            node.last_error = '';
            node.last_error_code = 'none';
        } else if (anyFailed) {
            node.status = 'failed';
            node.last_error = 'A child task failed permanently.';
            node.last_error_code = 'child_failed';
        }
    }

    /**
     * Generate the collapsed context for prompting.
     * Expands the path to the active node, collapses other siblings.
     */
    getCollapsedContext(activeNode) {
        if (!this.root || !activeNode) return '';

        // Get path from root to active node
        const path = new Set();
        let curr = activeNode;
        while (curr) {
            path.add(curr.id);
            curr = curr._parentNode;
        }

        let context = `Mission: ${this.root.desc}\n`;

        const buildTreeString = (node, depth) => {
            if (node.id === 'root') {
                return node.children.map(c => buildTreeString(c, 1)).join('');
            }

            const indent = '  '.repeat(depth - 1);
            let str = `${indent}- ${node.desc}`;

            if (node.id === activeNode.id) {
                str += ' [ACTIVE: YOU ARE DOING THIS NOW]\n';
            } else if (node.status === 'done') {
                str += ' [✓]\n';
            } else if (node.status === 'failed') {
                str += ' [Failed]\n';
            } else {
                str += '\n';
            }

            // Only expand children if this node is on the path to the active node
            if (path.has(node.id) && node.children && node.children.length > 0) {
                str += node.children.map(c => buildTreeString(c, depth + 1)).join('');
            } else if (node.children && node.children.length > 0) {
                str += `${indent}  + [${node.children.length} sub-tasks collapsed]\n`;
            }

            return str;
        };

        context += buildTreeString(this.root, 1);
        return context;
    }

    _normalizePrimitiveTarget(rawTarget) {
        if (!rawTarget) {
            return null;
        }
        let text = this._normalizeTaskDesc(rawTarget)
            .toLowerCase()
            .replace(/[^a-z0-9_ ]/g, ' ')
            .replace(/\b(the|a|an|nearest|nearby|basic|some)\b/g, ' ')
            .replace(/\b(block|item|resource|resources)\b/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return this.agent._normalizeTaskItemName(text);
    }

    _extractPrimitiveTaskAction(taskDesc) {
        const desc = this._normalizeTaskDesc(taskDesc).toLowerCase();
        if (!desc) {
            return null;
        }

        let match = desc.match(/\b(?:move|go|walk|travel|head|run|stroll)\s+to\s+(?:the\s+)?(?:nearest\s+)?([a-z0-9_ ]+?)\s+block\b/);
        if (match) {
            const itemName = this._normalizePrimitiveTarget(match[1]);
            if (itemName && mc.getBlockId(itemName) != null) {
                return { type: 'goto_block', itemName };
            }
        }

        // Fix: Support more survival keywords
        match = desc.match(/\b(?:eat|consume|gobble|drink)\s+(?:the\s+)?([a-z0-9_ ]+?)\b/);
        if (match) {
            const itemName = this._normalizePrimitiveTarget(match[1]);
            if (itemName && (mc.getItemId(itemName) != null || itemName.includes('food'))) {
                return { type: 'eat_item', itemName };
            }
        }

        match = desc.match(/\b(?:break|mine|dig|harvest|destroy|hit)\s+(?:the\s+)?([a-z0-9_ ]+?)\s+block\b/);
        if (match) {
            const itemName = this._normalizePrimitiveTarget(match[1]);
            if (itemName && mc.getBlockId(itemName) != null) {
                return { type: 'break_block', itemName };
            }
        }

        match = desc.match(/\b(?:collect|gather|get|obtain)\s*(\d+)?\s*([a-z0-9_]{2,80})(?:\s+from|\s+in|\s*$)/);
        if (match) {
            const quantity = Number.parseInt(match[1] || '1', 10);
            const itemName = this._normalizePrimitiveTarget(match[2]);
            if (itemName && Number.isFinite(quantity) && quantity > 0 && mc.getBlockId(itemName) != null) {
                return { type: 'collect_block', itemName, quantity };
            }
        }

        match = desc.match(/\b(?:craft|make)\s*(\d+)?\s*([a-z0-9_ ]{2,80})/);
        if (match) {
            const quantity = Number.parseInt(match[1] || '1', 10);
            const itemName = this._normalizePrimitiveTarget(match[2]);
            if (itemName && Number.isFinite(quantity) && quantity > 0 && mc.getItemId(itemName) != null) {
                return { type: 'craft_item', itemName, quantity };
            }
        }

        match = desc.match(/\b(?:smelt|cook)\s*(\d+)?\s*([a-z0-9_ ]{2,80})/);
        if (match) {
            const quantity = Number.parseInt(match[1] || '1', 10);
            const itemName = this._normalizePrimitiveTarget(match[2]);
            if (itemName && Number.isFinite(quantity) && quantity > 0 && mc.getItemId(itemName) != null) {
                return { type: 'smelt_item', itemName, quantity };
            }
        }

        match = desc.match(/\b(?:kill|attack|hunt)\s+(?:the\s+)?([a-z0-9_ ]{2,80})/);
        if (match) {
            const entityType = match[1].trim().replace(/\s+/g, '_');
            if (entityType) {
                return { type: 'attack_entity', entityType };
            }
        }

        return null;
    }

    async _runPrimitiveTask(leaf) {
        const primitive = this._extractPrimitiveTaskAction(leaf?.desc);
        if (!primitive) {
            return null;
        }
        const bot = this.agent.bot;
        const timeout = settings.code_timeout_mins ?? 10;
        return await this.agent.actions.runAction(
            `node:${leaf.id}:primitive:${primitive.type}`,
            async () => {
                if (primitive.type === 'goto_block') {
                    await skills.goToNearestBlock(bot, primitive.itemName, 2, 48);
                    return;
                }
                if (primitive.type === 'break_block') {
                    const nearest = world.getNearestBlock(bot, primitive.itemName, 48);
                    if (!nearest) {
                        skills.log(bot, `Could not find ${primitive.itemName} nearby.`);
                        return;
                    }
                    await skills.breakBlockAt(bot, nearest.position.x, nearest.position.y, nearest.position.z);
                    return;
                }
                if (primitive.type === 'collect_block') {
                    await skills.collectBlock(bot, primitive.itemName, primitive.quantity);
                    return;
                }
                if (primitive.type === 'craft_item') {
                    await skills.craftRecipe(bot, primitive.itemName, primitive.quantity);
                    return;
                }
                if (primitive.type === 'smelt_item') {
                    await skills.smeltItem(bot, primitive.itemName, primitive.quantity);
                    return;
                }
                if (primitive.type === 'attack_entity') {
                    await skills.attackNearest(bot, primitive.entityType, true);
                    return;
                }
                if (primitive.type === 'eat_item') {
                    await skills.eatFood(bot, primitive.itemName);
                }
            },
            { timeout, protectedAction: true }
        );
    }

    /**
     * Create children for a node using the AI prompter.
     */
    async _decomposeNode(node) {
        // Calculate depth
        let depth = 0;
        let curr = node;
        while (curr) {
            depth++;
            curr = curr._parentNode;
        }

        if (depth >= this.maxDepth) {
            console.log(`Maximum task depth (${this.maxDepth}) reached for: "${node.desc}". Forcing atomic execution.`);
            return false;
        }

        console.log(`Decomposing task (depth ${depth}): "${node.desc}"`);

        // Fast-path: check if it's already a simple command (like "goto", "collect 1") using agent's deterministic check
        const intent = this.agent._extractTaskIntent(node.desc);
        if (intent && (intent.type === 'collect' || intent.type === 'craft' || intent.type === 'place' || intent.type === 'goto')) {
            // It's primitive enough to execute directly
            return false;
        }

        // Call AI to decompose
        // We'll reuse promptLongTermPlan but tweak the prompt slightly in prompter.js or just pass the node desc
        const plan = await this.agent.prompter.promptLongTermPlan(`Decompose this task into concrete actionable sub-tasks (1-5 tasks). If the task is already an atomic action (like collecting 1 block, crafting, moving), return an empty tasks list.\nTask: ${node.desc}`);

        if (!plan || !plan.tasks || plan.tasks.length === 0) {
            // Couldn't decompose or AI thinks it's atomic
            return false;
        }

        const childNodes = [];
        for (let index = 0; index < plan.tasks.length; index++) {
            const task = plan.tasks[index];
            const desc = this._normalizeTaskDesc(task);
            if (!desc || desc === 'Unnamed task') {
                continue;
            }
            childNodes.push({
                id: `${node.id}_${index}`,
                desc,
                status: 'pending',
                children: [],
                _parentNode: node,
                attempts: 0,
                last_error: '',
                last_error_code: 'none',
                next_attempt_after: null
            });
        }
        if (childNodes.length === 0) {
            return false;
        }
        node.children = childNodes;

        this.saveTree();
        return true;
    }

    /**
     * Main execution loop for the recursive task tree.
     */
    async maybeRunMission() {
        if (!this.root || this.isPaused) return false;
        if (this.isRunning) return false;
        if (Date.now() < this.cooldownUntil) return false;
        if (!this.agent.isIdle() || this.agent.self_prompter.isActive() || this.agent.actions.resume_func) return false;

        const handledSafety = await this.agent._runSafetyManagerIfNeeded();
        if (handledSafety) {
            this.cooldownUntil = Date.now() + 1000; // Reduced cooldown
            return false;
        }

        let leaf = this._findNextLeaf(this.root);

        if (!leaf) {
            if (this.root.status === 'done' || this.root.status === 'failed') {
                if (!this.root.completedAt) {
                    this.root.completedAt = new Date().toISOString();
                    this.saveTree();
                    this.agent.openChat(`Completed recursive mission: ${this.root.desc}. Status: ${this.root.status}`);
                }
            }
            return false;
        }

        // We found a leaf. Is it primitive enough, or should we decompose it?
        // We do lazy decomposition here.
        if (leaf.status === 'pending' && leaf.attempts === 0) {
            const decomposed = await this._decomposeNode(leaf);
            if (decomposed) {
                // If we broke it down, we should now find the real leaf
                leaf = this._findNextLeaf(leaf);
                if (!leaf) return false; // Shouldn't happen
            }
        }

        // B5: Health Gate - check before execution
        if (this.agent.bot) {
            const leafDescText = this._normalizeTaskDesc(leaf?.desc).toLowerCase();
            const parentDescText = leaf._parentNode ? this._normalizeTaskDesc(leaf._parentNode.desc).toLowerCase() : '';
            const isEatOrRetreat = leafDescText.includes('eat') || leafDescText.includes('safe') || leafDescText.includes('heal') || parentDescText.includes('recover');

            // Fix 1.6: Prevent infinite loop of adding .safe nodes.
            // Don't add if leaf is already a safety node or has a safety child.
            const hasSafetyChild = leaf.children && leaf.children.some(c => c.id.endsWith('.safe'));

            if (!isEatOrRetreat && !hasSafetyChild && (this.agent.bot.health <= 6 || this.agent.bot.food <= 6)) {
                console.log(`[HealthGate] Health/food is critical (${this.agent.bot.health}/${this.agent.bot.food}). Halting current task to prioritize survival.`);
                // Insert a survival task as a child so we do it first
                leaf.status = 'pending';
                leaf.children = [{
                    _parentNode: leaf,
                    id: leaf.id + '.safe',
                    desc: "Eat available food from inventory or get to safety.",
                    status: 'pending',
                    children: [], // BUG L4 Fix: Ensure leaf nature
                    attempts: 0,
                    last_error: '',
                    last_error_code: 'none',
                    next_attempt_after: null,
                }, ...(leaf.children || [])];
                this.saveTree();
                return false; // BUG L7 Fix: indicate mission interrupted by survival task
            }
        }

        // Set up for execution
        this.isRunning = true;
        leaf.status = 'in_progress';
        leaf.last_error = '';
        leaf.last_error_code = 'none';
        leaf.next_attempt_after = null;
        this.saveTree();

        // Progress Timeout: snapshot bot position and inventory before execution
        let prePos = null;
        let preItemCount = 0;
        let preInventorySnapshot = {};
        try {
            const botEntity = this.agent.bot?.entity;
            if (botEntity && botEntity.position) {
                prePos = { x: botEntity.position.x, y: botEntity.position.y, z: botEntity.position.z };
            }
            preInventorySnapshot = world.getInventoryCounts(this.agent.bot);
            preItemCount = Object.values(preInventorySnapshot).reduce((sum, c) => sum + c, 0);
        } catch (_err) {
            // Best-effort snapshot
        }

        const markTaskFailure = async (reason) => {
            const policy = this._classifyTaskFailure(reason);
            leaf.attempts += 1;
            leaf.last_error = `[${policy.code}] ${reason}`;
            leaf.last_error_code = policy.code;
            const shouldRetry = policy.retryable && leaf.attempts < policy.max_attempts;
            if (shouldRetry && policy.base_backoff_seconds > 0) {
                const backoffSeconds = Math.min(
                    policy.base_backoff_seconds * (2 ** (leaf.attempts - 1)),
                    policy.max_backoff_seconds
                );
                leaf.next_attempt_after = new Date(Date.now() + backoffSeconds * 1000).toISOString();
            } else {
                leaf.next_attempt_after = null;
            }

            // Try fallback tasks
            const fallbackTasks = this.agent._deriveFallbackTasks(leaf, reason);
            const supportsFallback = ['verification_not_done', 'deterministic_failed', 'ai_verification_failed', 'no_progress', 'execution_error', 'unknown_failure'].includes(policy.code);
            if (fallbackTasks.length > 0 && leaf.attempts <= 2 && supportsFallback) {
                // Add fallback tasks as children PRECEDING this leaf by re-wrapping this leaf
                const originalDesc = leaf.desc;
                const originalAttempts = leaf.attempts;
                const originalLastError = leaf.last_error;
                const originalLastErrorCode = leaf.last_error_code;
                const originalNextAttemptAfter = leaf.next_attempt_after;
                leaf.desc = `Recover from failure and complete: ${originalDesc}`;
                leaf.attempts = 0; // Reset attempts for the newly wrapped node
                leaf.last_error_code = 'none';

                leaf.children = fallbackTasks.map((desc, i) => ({
                    id: `${leaf.id}_fb${i}`,
                    desc: desc,
                    status: 'pending',
                    children: [],
                    _parentNode: leaf,
                    attempts: 0,
                    last_error: '',
                    last_error_code: 'none',
                    next_attempt_after: null
                }));
                // Add the original task back at the end of the fallbacks
                leaf.children.push({
                    id: `${leaf.id}_orig`,
                    desc: originalDesc,
                    status: 'pending',
                    children: [],
                    _parentNode: leaf,
                    attempts: originalAttempts,
                    last_error: originalLastError,
                    last_error_code: originalLastErrorCode,
                    next_attempt_after: originalNextAttemptAfter
                });
                leaf.last_error += ` Derived ${fallbackTasks.length} fallback tasks.`;
                leaf.status = 'pending'; // Go back to picking children
            } else if (!policy.retryable || leaf.attempts >= policy.max_attempts) {
                leaf.status = 'failed';
                leaf.next_attempt_after = null;
                // Recursive tree: we don't replan the whole tree here, we just fail the node.
                // The parent will notice and might fail, propagating upwards, or we could ask AI to repair the parent.
            } else {
                leaf.status = 'pending';
            }
        };

        const collapsedContext = this.getCollapsedContext(leaf);
        let actionOutput = '';
        let generatedCode = '';
        const previousRequestId = this.agent.current_request_id;
        const leafRequestId = this.agent._nextRequestId(`recursive_${leaf.id}`);
        this.agent.current_request_id = leafRequestId;

        try {
            const primitiveResult = await this._runPrimitiveTask(leaf);
            let runResult = primitiveResult;
            if (!runResult) {
                const safeTaskForPrompt = leaf.desc.replaceAll('(', '[').replaceAll(')', ']');
                const tempHistory = {
                    getHistory: () => {
                        const history = this.agent.history.getHistory();
                        history.push({
                            role: 'system',
                            content: `You are executing a node in a recursive task tree.\n\n${collapsedContext}\n\nReuse world.runAction(action_name) when useful.`
                        });
                        history.push({
                            role: 'user',
                            content: `!newAction(${safeTaskForPrompt})`
                        });
                        return history;
                    }
                };

                runResult = await this.agent.actions.runAction(
                    `node:${leaf.id}`,
                    async () => {
                        generatedCode = await this.agent.coder.generateCode(tempHistory);
                    },
                    {
                        timeout: settings.code_timeout_mins ?? 10,
                        protectedAction: true
                    }
                );
            } else {
                generatedCode = '// primitive task executor';
            }

            actionOutput = runResult?.message || '';
            if (!generatedCode || generatedCode.startsWith('Code generation failed') || generatedCode.includes('Action failed')) {
                await markTaskFailure('Code generation failed.');
            } else if (runResult?.timedout) {
                await markTaskFailure('Task timed out.');
            } else if (runResult?.interrupted) {
                await markTaskFailure('Task was interrupted.');
            } else if (runResult?.success === false) {
                await markTaskFailure(`Execution result: ${runResult.reason || runResult.message || 'failed'}`);
            } else {
                const deterministicCheck = this.agent._deterministicTaskCheck(leaf);
                if (deterministicCheck.certain && deterministicCheck.done) {
                    // HARD VERIFICATION: For resource gathering tasks, ensure inventory actually increased
                    const sourceTaskKeywords = ['collect', 'mine', 'gather', 'dig', 'get', 'pick', 'take', 'harvest'];
                    const leafDescLow = this._normalizeTaskDesc(leaf.desc).toLowerCase();
                    const isSourceTask = sourceTaskKeywords.some(kw => leafDescLow.includes(kw));

                    if (isSourceTask) {
                        const postInv = world.getInventoryCounts(this.agent.bot);
                        const progress = Object.entries(postInv).some(([item, count]) => count > (preInventorySnapshot[item] || 0));
                        if (!progress) {
                            console.warn(`[HardVerify] Task "${leaf.desc}" claimed done but inventory did not increase. Forcing retry.`);
                            await markTaskFailure(`Hard Verification: Inventory did not increase after gathering task. Bot might have missed the item entities.`);
                        } else {
                            leaf.status = 'done';
                        }
                    } else {
                        leaf.status = 'done';
                    }

                    if (leaf.status === 'done') {
                        leaf.last_error = '';
                        leaf.last_error_code = 'none';
                        leaf.next_attempt_after = null;
                    }
                } else if (deterministicCheck.certain && !deterministicCheck.done) {
                    await markTaskFailure(`Deterministic verifier: ${deterministicCheck.reason}`);
                } else {
                    const verify = await this.agent.prompter.promptLongTermTaskCheck(
                        { mission: this.root.desc }, // Mock plan object for prompter
                        leaf,
                        `${generatedCode}\n\n${actionOutput}`
                    );
                    if (verify.done) {
                        leaf.status = 'done';
                        leaf.last_error = '';
                        leaf.last_error_code = 'none';
                        leaf.next_attempt_after = null;
                    } else {
                        await markTaskFailure(`AI verifier: ${verify.reason}`);
                    }
                }
            }
        } catch (err) {
            console.error('Error executing recursive task node:', err);
            await markTaskFailure(`Execution error: ${err.message}`);
        } finally {
            this.agent.current_request_id = previousRequestId;
        }

        // Progress Timeout: check if bot made any progress during execution
        // Skip for crafting/smelting tasks where standing still is expected
        const stationaryTaskKeywords = ['craft', 'smelt', 'cook', 'chest', 'furnace', 'brew', 'enchant', 'anvil', 'trade', 'wait', 'eat'];
        const leafDescProgress = this._normalizeTaskDesc(leaf.desc).toLowerCase();
        const isStationaryTask = stationaryTaskKeywords.some(kw => leafDescProgress.includes(kw));

        if (leaf.status !== 'done' && leaf.status !== 'failed' && !isStationaryTask) {
            try {
                let moved = false;
                let itemsChanged = false;
                const botEntity = this.agent.bot?.entity;
                if (botEntity && botEntity.position && prePos) {
                    const dx = botEntity.position.x - prePos.x;
                    const dy = botEntity.position.y - prePos.y;
                    const dz = botEntity.position.z - prePos.z;
                    moved = Math.sqrt(dx * dx + dy * dy + dz * dz) > 1;
                }
                const inv = world.getInventoryCounts(this.agent.bot);
                const postItemCount = Object.values(inv).reduce((sum, c) => sum + c, 0);
                // Items changed = gained OR lost (crafting transforms items)
                itemsChanged = postItemCount !== preItemCount;

                if (!moved && !itemsChanged) {
                    console.log(`[ProgressTimeout] Leaf "${leaf.desc}" made no progress (no movement, no item changes).`);
                    await markTaskFailure('No progress detected: bot did not move or change inventory.');
                }
            } catch (_err) {
                // Best-effort check
            }
        }

        this.isRunning = false;

        // After executing a leaf, check if its parent is now done
        let curr = leaf._parentNode;
        while (curr) {
            this._updateNodeStatusFromChildren(curr);
            curr = curr._parentNode;
        }

        this.saveTree();
        this.agent.bot.emit('idle');
        return true; // We ran something
    }
}
