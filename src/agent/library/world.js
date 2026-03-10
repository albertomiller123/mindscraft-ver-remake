import pf from 'mineflayer-pathfinder';
import * as mc from '../../utils/mcdata.js';

export function getItemId(itemName) {
    /**
     * Get the item ID for a given item name.
     * @param {string} itemName
     * @returns {number} the item ID
     */
    return mc.getItemId(itemName);
}

// TTL cache for expensive per-tick world queries
const _cache = new Map();
const MAX_CACHE_SIZE = 1000; // Prevent memory leak

function _getCached(key) {
    const entry = _cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > entry.ttl) {
        _cache.delete(key);
        return null;
    }
    return entry.value;
}

function _setCached(key, value, ttlMs) {
    // FIX: Evict old entries when cache grows too large
    if (_cache.size >= MAX_CACHE_SIZE) {
        const oldestKey = _cache.keys().next().value;
        _cache.delete(oldestKey);
    }
    _cache.set(key, { value, ts: Date.now(), ttl: ttlMs });
}

// Periodic cleanup to remove expired entries
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of _cache.entries()) {
        if (now - entry.ts > entry.ttl) {
            _cache.delete(key);
        }
    }
}, 60000); // Clean up every 60 seconds

function logWorldAction(bot, message) {
    if (bot && typeof bot.output === 'string') {
        bot.output += message + '\n';
    }
}

export function getAgentFromBot(bot) {
    return bot?.mindcraft_agent || null;
}

export function getBot(bot) {
    /**
     * Get the reference to the minecraft bot.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {MinecraftBot} the minecraft bot.
     * @example
     * let bot = world.getBot(bot);
     **/
    return bot;
}


export function getNearestFreeSpace(bot, size = 1, distance = 8) {
    /**
     * Get the nearest empty space with solid blocks beneath it of the given size.
     * @param {Bot} bot - The bot to get the nearest free space for.
     * @param {number} size - The (size x size) of the space to find, default 1.
     * @param {number} distance - The maximum distance to search, default 8.
     * @returns {Vec3} - The south west corner position of the nearest free space.
     * @example
     * let position = world.getNearestFreeSpace(bot, 1, 8);
     **/
    let empty_pos = bot.findBlocks({
        matching: (block) => {
            return block && block.name == 'air';
        },
        maxDistance: distance,
        count: 1000
    });
    for (let i = 0; i < empty_pos.length; i++) {
        let empty = true;
        for (let x = 0; x < size; x++) {
            for (let z = 0; z < size; z++) {
                let top = bot.blockAt(empty_pos[i].offset(x, 0, z));
                let bottom = bot.blockAt(empty_pos[i].offset(x, -1, z));
                if (!top || top.name !== 'air' || !bottom || bottom.drops.length == 0 || !bottom.diggable) {
                    empty = false;
                    break;
                }
            }
            if (!empty) break;
        }
        if (empty) {
            return empty_pos[i];
        }
    }
}


export function getBlockAtPosition(bot, x = 0, y = 0, z = 0) {
    /**
    * Get a block from the bot's relative position 
    * @param {Bot} bot - The bot to get the block for.
    * @param {number} x - The relative x offset to serach, default 0.
    * @param {number} y - The relative y offset to serach, default 0.
    * @param {number} y - The relative z offset to serach, default 0. 
    * @returns {Block} - The nearest block.
    * @example
    * let blockBelow = world.getBlockAtPosition(bot, 0, -1, 0);
    * let blockAbove = world.getBlockAtPosition(bot, 0, 2, 0); since minecraft position is at the feet
    **/
    let block = bot.blockAt(bot.entity.position.offset(x, y, z));
    if (!block) block = { name: 'air' };

    return block;
}


export function getSurroundingBlocks(bot) {
    /**
     * Get the surrounding blocks from the bot's environment.
     * @param {Bot} bot - The bot to get the block for.
     * @returns {string[]} - A list of block results as strings.
     * @example
     **/
    // Create a list of block position results that can be unpacked.
    let res = [];
    res.push(`Block Below: ${getBlockAtPosition(bot, 0, -1, 0).name}`);
    res.push(`Block at Legs: ${getBlockAtPosition(bot, 0, 0, 0).name}`);
    res.push(`Block at Head: ${getBlockAtPosition(bot, 0, 1, 0).name}`);

    return res;
}


export function getFirstBlockAboveHead(bot, ignore_types = null, distance = 32) {
    /**
    * Searches a column from the bot's position for the first solid block above its head
    * @param {Bot} bot - The bot to get the block for.
    * @param {string[]} ignore_types - The names of the blocks to ignore.
    * @param {number} distance - The maximum distance to search, default 32.
    * @returns {string} - The fist block above head.
    * @example
    * let firstBlockAboveHead = world.getFirstBlockAboveHead(bot, null, 32);
    **/
    // if ignore_types is not a list, make it a list.
    let ignore_blocks = [];
    if (ignore_types === null) ignore_blocks = ['air', 'cave_air'];
    else {
        if (!Array.isArray(ignore_types))
            ignore_types = [ignore_types];
        for (let ignore_type of ignore_types) {
            if (mc.getBlockId(ignore_type)) ignore_blocks.push(ignore_type);
        }
    }
    // The block above, stops when it finds a solid block .
    let block_above = { name: 'air' };
    let height = 0
    for (let i = 0; i < distance; i++) {
        let block = bot.blockAt(bot.entity.position.offset(0, i + 2, 0));
        if (!block) block = { name: 'air' };
        // Ignore and continue
        if (ignore_blocks.includes(block.name)) continue;
        // Defaults to any block
        block_above = block;
        height = i;
        break;
    }

    if (ignore_blocks.includes(block_above.name)) return 'none';

    return `${block_above.name} (${height} blocks up)`;
}


export function getNearestBlocks(bot, block_types = null, distance = 8, count = 10000) {
    /**
     * Get a list of the nearest blocks of the given types.
     * @param {Bot} bot - The bot to get the nearest block for.
     * @param {string[]} block_types - The names of the blocks to search for.
     * @param {number} distance - The maximum distance to search, default 16.
     * @param {number} count - The maximum number of blocks to find, default 10000.
     * @returns {Block[]} - The nearest blocks of the given type.
     * @example
     * let woodBlocks = world.getNearestBlocks(bot, ['oak_log', 'birch_log'], 16, 1);
     **/
    // if blocktypes is not a list, make it a list
    let block_ids = [];
    if (block_types === null) {
        block_ids = mc.getAllBlockIds(['air']);
    }
    else {
        if (!Array.isArray(block_types))
            block_types = [block_types];
        for (let block_type of block_types) {
            block_ids.push(mc.getBlockId(block_type));
        }
    }
    return getNearestBlocksWhere(bot, block_ids, distance, count);
}

export function getNearestBlocksWhere(bot, predicate, distance = 8, count = 10000) {
    /**
     * Get a list of the nearest blocks that satisfy the given predicate.
     * @param {Bot} bot - The bot to get the nearest blocks for.
     * @param {function} predicate - The predicate to filter the blocks.
     * @param {number} distance - The maximum distance to search, default 16.
     * @param {number} count - The maximum number of blocks to find, default 10000.
     * @returns {Block[]} - The nearest blocks that satisfy the given predicate.
     * @example
     * let waterBlocks = world.getNearestBlocksWhere(bot, block => block.name === 'water', 16, 10);
     **/
    const positions = bot.findBlocks({ matching: predicate, maxDistance: distance, count: count });
    // FIX: Filter out null blocks from unloaded chunks
    const blocks = positions
        .map(position => bot.blockAt(position))
        .filter(block => block !== null);
    
    if (blocks.length < positions.length) {
        console.warn(`[world] ${positions.length - blocks.length} blocks in unloaded chunks, skipped`);
    }
    return blocks;
}


export function getNearestBlock(bot, block_type, distance = 16) {
    /**
    * Get the nearest block of the given type.
    * @param {Bot} bot - The bot to get the nearest block for.
    * @param {string} block_type - The name of the block to search for.
    * @param {number} distance - The maximum distance to search, default 16.
    * @returns {Block} - The nearest block of the given type.
    * @example
    * let coalBlock = world.getNearestBlock(bot, 'coal_ore', 16);
    **/
    let blocks = getNearestBlocks(bot, block_type, distance, 1);
    if (blocks.length > 0) {
        return blocks[0];
    }
    return null;
}


export function getNearbyEntities(bot, maxDistance = 16) {
    let entities = [];
    for (const entity of Object.values(bot.entities)) {
        const distance = entity.position.distanceTo(bot.entity.position);
        if (distance > maxDistance) continue;
        entities.push({ entity: entity, distance: distance });
    }
    entities.sort((a, b) => a.distance - b.distance);
    let res = [];
    for (let i = 0; i < entities.length; i++) {
        res.push(entities[i].entity);
    }
    return res;
}

export function getNearestEntityWhere(bot, predicate, maxDistance = 16) {
    return bot.nearestEntity(entity => predicate(entity) && bot.entity.position.distanceTo(entity.position) < maxDistance);
}


export function getNearbyPlayers(bot, maxDistance) {
    if (maxDistance == null) maxDistance = 16;
    let players = [];
    for (const entity of Object.values(bot.entities)) {
        const distance = entity.position.distanceTo(bot.entity.position);
        if (distance > maxDistance) continue;
        if (entity.type == 'player' && entity.username != bot.username) {
            players.push({ entity: entity, distance: distance });
        }
    }
    players.sort((a, b) => a.distance - b.distance);
    let res = [];
    for (let i = 0; i < players.length; i++) {
        res.push(players[i].entity);
    }
    return res;
}

// Helper function to get villager profession from metadata
export function getVillagerProfession(entity) {
    // Villager profession mapping based on metadata
    const professions = {
        0: 'Unemployed',
        1: 'Armorer',
        2: 'Butcher',
        3: 'Cartographer',
        4: 'Cleric',
        5: 'Farmer',
        6: 'Fisherman',
        7: 'Fletcher',
        8: 'Leatherworker',
        9: 'Librarian',
        10: 'Mason',
        11: 'Nitwit',
        12: 'Shepherd',
        13: 'Toolsmith',
        14: 'Weaponsmith'
    };

    if (entity.metadata && entity.metadata[18]) {
        // Check if metadata[18] is an object with villagerProfession property
        if (typeof entity.metadata[18] === 'object' && entity.metadata[18].villagerProfession !== undefined) {
            const professionId = entity.metadata[18].villagerProfession;
            const level = entity.metadata[18].level || 1;
            const professionName = professions[professionId] || 'Unknown';
            return `${professionName} L${level}`;
        }
        // Fallback for direct profession ID
        else if (typeof entity.metadata[18] === 'number') {
            const professionId = entity.metadata[18];
            return professions[professionId] || 'Unknown';
        }
    }

    // If we can't determine profession but it's an adult villager
    if (entity.metadata && entity.metadata[16] !== 1) { // Not a baby
        return 'Adult';
    }

    return 'Unknown';
}


export function getInventoryStacks(bot) {
    let inventory = [];
    for (const item of bot.inventory.items()) {
        if (item != null) {
            inventory.push(item);
        }
    }
    return inventory;
}


export function getInventoryCounts(bot) {
    /**
     * Get an object representing the bot's inventory.
     * @param {Bot} bot - The bot to get the inventory for.
     * @returns {object} - An object with item names as keys and counts as values.
     * @example
     * let inventory = world.getInventoryCounts(bot);
     * let oakLogCount = inventory['oak_log'];
     * let hasWoodenPickaxe = inventory['wooden_pickaxe'] > 0;
     **/
    let inventory = {};
    for (const item of bot.inventory.items()) {
        if (item != null) {
            if (inventory[item.name] == null) {
                inventory[item.name] = 0;
            }
            inventory[item.name] += item.count;
        }
    }
    return inventory;
}


export function getCraftableItems(bot) {
    /**
     * Get a list of all items that can be crafted with the bot's current inventory.
     * @param {Bot} bot - The bot to get the craftable items for.
     * @returns {string[]} - A list of all items that can be crafted.
     * @example
     * let craftableItems = world.getCraftableItems(bot);
     **/
    const cacheKey = `craftable_${bot.username}`;
    const cached = _getCached(cacheKey);
    if (cached) return cached;

    let table = getNearestBlock(bot, 'crafting_table');
    if (!table) {
        for (const item of bot.inventory.items()) {
            if (item != null && item.name === 'crafting_table') {
                table = item;
                break;
            }
        }
    }
    let res = [];
    for (const item of mc.getAllItems()) {
        let recipes = bot.recipesFor(item.id, null, 1, table);
        if (recipes.length > 0)
            res.push(item.name);
    }
    _setCached(cacheKey, res, 3000); // 3s TTL
    return res;
}


export function getPosition(bot) {
    /**
     * Get your position in the world (Note that y is vertical).
     * @param {Bot} bot - The bot to get the position for.
     * @returns {Vec3} - An object with x, y, and x attributes representing the position of the bot.
     * @example
     * let position = world.getPosition(bot);
     * let x = position.x;
     **/
    return bot.entity.position;
}


export function getNearbyEntityTypes(bot) {
    /**
     * Get a list of all nearby mob types.
     * @param {Bot} bot - The bot to get nearby mobs for.
     * @returns {string[]} - A list of all nearby mobs.
     * @example
     * let mobs = world.getNearbyEntityTypes(bot);
     **/
    let mobs = getNearbyEntities(bot, 16);
    let found = [];
    for (let i = 0; i < mobs.length; i++) {
        if (!found.includes(mobs[i].name)) {
            found.push(mobs[i].name);
        }
    }
    return found;
}

export function isEntityType(name) {
    /**
     * Check if a given name is a valid entity type.
     * @param {string} name - The name of the entity type to check.
     * @returns {boolean} - True if the name is a valid entity type, false otherwise.
     */
    return mc.getEntityId(name) !== null;
}

export function getNearbyPlayerNames(bot) {
    /**
     * Get a list of all nearby player names.
     * @param {Bot} bot - The bot to get nearby players for.
     * @returns {string[]} - A list of all nearby players.
     * @example
     * let players = world.getNearbyPlayerNames(bot);
     **/
    let players = getNearbyPlayers(bot, 64);
    let found = [];
    for (let i = 0; i < players.length; i++) {
        if (!found.includes(players[i].username) && players[i].username != bot.username) {
            found.push(players[i].username);
        }
    }
    return found;
}


export function getNearbyBlockTypes(bot, distance = 16) {
    /**
     * Get a list of all nearby block names.
     * @param {Bot} bot - The bot to get nearby blocks for.
     * @param {number} distance - The maximum distance to search, default 16.
     * @returns {string[]} - A list of all nearby blocks.
     * @example
     * let blocks = world.getNearbyBlockTypes(bot);
     **/
    const cacheKey = `blockTypes_${bot.username}_${distance}`;
    const cached = _getCached(cacheKey);
    if (cached) return cached;

    let blocks = getNearestBlocks(bot, null, distance);
    let found = [];
    // FIX: Add null check for blocks[i]
    for (let i = 0; i < blocks.length; i++) {
        if (blocks[i] && blocks[i].name && !found.includes(blocks[i].name)) {
            found.push(blocks[i].name);
        }
    }
    _setCached(cacheKey, found, 2000); // 2s TTL
    return found;
}

export async function isClearPath(bot, target) {
    /**
     * Check if there is a path to the target that requires no digging or placing blocks.
     * @param {Bot} bot - The bot to get the path for.
     * @param {Entity} target - The target to path to.
     * @returns {boolean} - True if there is a clear path, false otherwise.
     */
    let movements = new pf.Movements(bot)
    movements.canDig = false;
    movements.canPlaceOn = false;
    movements.canOpenDoors = false;
    let goal = new pf.goals.GoalNear(target.position.x, target.position.y, target.position.z, 1);
    let path = await bot.pathfinder.getPathTo(movements, goal, 100);
    return path.status === 'success';
}

export function shouldPlaceTorch(bot) {
    if (!bot.modes.isOn('torch_placing') || bot.interrupt_code) return false;
    const pos = getPosition(bot);
    // TODO: check light level instead of nearby torches, block.light is broken
    let nearest_torch = getNearestBlock(bot, 'torch', 6);
    if (!nearest_torch)
        nearest_torch = getNearestBlock(bot, 'wall_torch', 6);
    if (!nearest_torch) {
        const block = bot.blockAt(pos);
        let has_torch = bot.inventory.items().find(item => item.name === 'torch');
        return has_torch && block?.name === 'air';
    }
    return false;
}

export function getBiomeName(bot) {
    /**
     * Get the name of the biome the bot is in.
     * @param {Bot} bot - The bot to get the biome for.
     * @returns {string} - The name of the biome.
     * @example
     * let biome = world.getBiomeName(bot);
     **/
    const biomeId = bot.world.getBiome(bot.entity.position);
    return mc.getAllBiomes()[biomeId].name;
}

export function listActions(bot) {
    /**
     * List names of all saved learned actions for this bot.
     * @param {Bot} bot - The bot requesting the action list.
     * @returns {string[]} - Learned action names.
     * @example
     * let actions = world.listActions(bot);
     **/
    const agent = getAgentFromBot(bot);
    if (!agent || !agent.coder) {
        logWorldAction(bot, 'Cannot list actions: coder is not available.');
        return [];
    }
    return agent.coder.getLearnedActions();
}

export function saveAction(bot, actionName, sourceCode, metadata = null) {
    /**
     * Save reusable code as a learned action script.
     * @param {Bot} bot - The bot saving the action.
     * @param {string} actionName - Name used to store and reference the action.
     * @param {string} sourceCode - JavaScript source code to save.
     * @param {object|null} metadata - Optional metadata: required_items, preferred_dimension, preferred_biome, tags.
     * @returns {boolean} - True if save succeeded, false otherwise.
     * @example
     * world.saveAction(bot, 'collect_wood_v1', 'await skills.collectBlock(bot, "oak_log", 8);');
     **/
    const agent = getAgentFromBot(bot);
    if (!agent || !agent.coder) {
        logWorldAction(bot, 'Cannot save action: coder is not available.');
        return false;
    }
    const res = agent.coder.saveLearnedAction(actionName, sourceCode, false, metadata);
    logWorldAction(bot, res.message);
    return res.success;
}

export function optimizeAction(bot, actionName, sourceCode, metadata = null) {
    /**
     * Update an existing learned action with improved source code.
     * @param {Bot} bot - The bot updating the action.
     * @param {string} actionName - Name of the learned action.
     * @param {string} sourceCode - New JavaScript source code.
     * @param {object|null} metadata - Optional metadata update.
     * @returns {boolean} - True if update succeeded, false otherwise.
     * @example
     * world.optimizeAction(bot, 'collect_wood_v1', 'await skills.collectBlock(bot, "oak_log", 16);');
     **/
    const agent = getAgentFromBot(bot);
    if (!agent || !agent.coder) {
        logWorldAction(bot, 'Cannot optimize action: coder is not available.');
        return false;
    }
    const res = agent.coder.saveLearnedAction(actionName, sourceCode, true, metadata);
    logWorldAction(bot, res.message);
    return res.success;
}

export async function runAction(bot, actionName) {
    /**
     * Execute a saved learned action by name.
     * @param {Bot} bot - The bot running the learned action.
     * @param {string} actionName - Name of the action to run.
     * @returns {Promise<boolean>} - True if action ran successfully.
     * @example
     * await world.runAction(bot, 'collect_wood_v1');
     **/
    const agent = getAgentFromBot(bot);
    if (!agent || !agent.coder) {
        logWorldAction(bot, 'Cannot run action: coder is not available.');
        return false;
    }
    const res = await agent.coder.runLearnedAction(actionName);
    logWorldAction(bot, res.message);
    return res.success;
}

export function getActionMetadata(bot, actionName) {
    /**
     * Get metadata stored for a saved learned action.
     * @param {Bot} bot - The bot requesting metadata.
     * @param {string} actionName - Name of the learned action.
     * @returns {object|null} - Metadata object or null if unavailable.
     **/
    const agent = getAgentFromBot(bot);
    if (!agent || !agent.coder) {
        logWorldAction(bot, 'Cannot fetch action metadata: coder is not available.');
        return null;
    }
    return agent.coder.getLearnedActionMetadata(actionName);
}

export function recommendActions(bot, limit = 5) {
    /**
     * Recommend saved actions for the current world context.
     * @param {Bot} bot - The bot requesting recommendations.
     * @param {number} limit - Max recommendations to return.
     * @returns {Array} - Recommended action objects with score and summary.
     **/
    const agent = getAgentFromBot(bot);
    if (!agent || !agent.coder) {
        logWorldAction(bot, 'Cannot recommend actions: coder is not available.');
        return [];
    }
    let biome = null;
    try {
        biome = getBiomeName(bot);
    } catch (_err) {
        biome = null;
    }
    const context = {
        inventory_counts: getInventoryCounts(bot),
        dimension: bot?.game?.dimension || null,
        biome
    };
    return agent.coder.getLearnedActionRecommendations(context, limit);
}

export async function checkNearbyChest(bot, itemName, count = 1) {
    /**
     * Check if a nearby chest contains enough of a specific item.
     * @param {Bot} bot - The bot to search for.
     * @param {string} itemName - The item to look for.
     * @param {number} count - Minimum count needed, default 1.
     * @returns {Promise<boolean>} - True if chest nearby has enough of the item.
     * @example
     * let found = await world.checkNearbyChest(bot, 'oak_log', 4);
     **/
    if (!itemName) {
        logWorldAction(bot, 'checkNearbyChest: itemName is required.');
        return false;
    }
    const chest = getNearestBlock(bot, 'chest', 16);
    if (!chest) return false;
    try {
        const window = await bot.openContainer(chest);
        const items = window.containerItems();
        const found = items
            .filter(i => i && i.name === itemName)
            .reduce((sum, i) => sum + i.count, 0);
        window.close();
        return found >= count;
    } catch (err) {
        logWorldAction(bot, `checkNearbyChest error: ${err.message}`);
        return false;
    }
}
