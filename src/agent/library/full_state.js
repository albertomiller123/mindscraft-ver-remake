import { 
    getPosition,
    getBiomeName,
    getNearbyPlayerNames,
    getInventoryCounts,
    getNearbyEntityTypes,
    getBlockAtPosition,
    getFirstBlockAboveHead
} from "./world.js";
import convoManager from '../conversation.js';

/**
 * Get complete bot state with validation
 * @param {Object} agent - Agent instance
 * @returns {Object} Full state object
 * @throws {Error} If agent or bot is invalid
 */
export function getFullState(agent) {
    // Validate input
    if (!agent || typeof agent !== 'object') {
        throw new Error('Invalid agent: must be an object');
    }
    
    const bot = agent.bot;
    
    // Validate bot instance
    if (!bot || typeof bot !== 'object') {
        throw new Error('Invalid bot: agent.bot is missing or invalid');
    }
    
    // Check critical bot properties
    if (!bot.entity) {
        throw new Error('Bot not fully initialized: missing entity');
    }

    // Get position with fallback
    let position = { x: 0, y: 0, z: 0 };
    try {
        const pos = getPosition(bot);
        if (pos && typeof pos.x === 'number' && typeof pos.y === 'number' && typeof pos.z === 'number') {
            position = {
                x: Number(pos.x.toFixed(2)),
                y: Number(pos.y.toFixed(2)),
                z: Number(pos.z.toFixed(2))
            };
        }
    } catch (error) {
        console.error('Error getting position:', error.message);
    }

    // Get weather with safe access
    let weather = 'Clear';
    try {
        if (bot.thunderState && bot.thunderState > 0) weather = 'Thunderstorm';
        else if (bot.rainState && bot.rainState > 0) weather = 'Rain';
    } catch (error) {
        console.error('Error getting weather:', error.message);
    }

    // Get time with safe access
    let timeOfDay = 0;
    let timeLabel = 'Night';
    try {
        if (bot.time && typeof bot.time.timeOfDay === 'number') {
            timeOfDay = bot.time.timeOfDay;
            if (timeOfDay < 6000) timeLabel = 'Morning';
            else if (timeOfDay < 12000) timeLabel = 'Afternoon';
        }
    } catch (error) {
        console.error('Error getting time:', error.message);
    }

    // Get surrounding blocks with fallback
    let below = 'unknown';
    let legs = 'air';
    let head = 'air';
    try {
        const belowBlock = getBlockAtPosition(bot, 0, -1, 0);
        below = belowBlock && belowBlock.name ? belowBlock.name : 'unknown';
        
        const legsBlock = getBlockAtPosition(bot, 0, 0, 0);
        legs = legsBlock && legsBlock.name ? legsBlock.name : 'air';
        
        const headBlock = getBlockAtPosition(bot, 0, 1, 0);
        head = headBlock && headBlock.name ? headBlock.name : 'air';
    } catch (error) {
        console.error('Error getting surrounding blocks:', error.message);
    }

    // Get nearby players with safe access
    let players = [];
    let bots = [];
    try {
        players = getNearbyPlayerNames(bot) || [];
        if (convoManager && typeof convoManager.getInGameAgents === 'function') {
            bots = convoManager.getInGameAgents().filter(b => b !== agent.name);
            players = players.filter(p => !bots.includes(p));
        }
    } catch (error) {
        console.error('Error getting nearby players:', error.message);
    }

    // Get equipment with safe access
    let helmet = null;
    let chestplate = null;
    let leggings = null;
    let boots = null;
    let heldItem = null;
    let inventoryItems = [];
    let inventorySlots = 0;
    
    try {
        if (bot.inventory && bot.inventory.slots) {
            helmet = bot.inventory.slots[5];
            chestplate = bot.inventory.slots[6];
            leggings = bot.inventory.slots[7];
            boots = bot.inventory.slots[8];
            inventorySlots = bot.inventory.slots.length || 0;
            
            if (typeof bot.inventory.items === 'function') {
                inventoryItems = bot.inventory.items();
            }
        }
        
        if (bot.heldItem) {
            heldItem = bot.heldItem.name;
        }
    } catch (error) {
        console.error('Error getting inventory:', error.message);
    }

    // Build state object with safe access to all properties
    const state = {
        name: agent.name || 'unknown',
        gameplay: {
            position,
            dimension: (bot.game && bot.game.dimension) || 'unknown',
            gamemode: (bot.game && bot.game.gameMode) || 'unknown',
            health: Math.round(Number(bot.health) || 0),
            hunger: Math.round(Number(bot.food) || 0),
            biome: (() => {
                try {
                    return getBiomeName(bot) || 'unknown';
                } catch (e) {
                    return 'unknown';
                }
            })(),
            weather,
            timeOfDay,
            timeLabel
        },
        action: {
            current: (() => {
                try {
                    return (agent.isIdle && agent.isIdle()) ? 'Idle' : 
                           (agent.actions && agent.actions.currentActionLabel) || 'Unknown';
                } catch (e) {
                    return 'Unknown';
                }
            })(),
            isIdle: (() => {
                try {
                    return agent.isIdle ? agent.isIdle() : true;
                } catch (e) {
                    return true;
                }
            })()
        },
        surroundings: {
            below,
            legs,
            head,
            firstBlockAboveHead: (() => {
                try {
                    return getFirstBlockAboveHead(bot, null, 32) || 'unknown';
                } catch (e) {
                    return 'unknown';
                }
            })()
        },
        inventory: {
            counts: (() => {
                try {
                    return getInventoryCounts(bot) || {};
                } catch (e) {
                    return {};
                }
            })(),
            stacksUsed: inventoryItems.length,
            totalSlots: inventorySlots,
            equipment: {
                helmet: helmet && helmet.name ? helmet.name : null,
                chestplate: chestplate && chestplate.name ? chestplate.name : null,
                leggings: leggings && leggings.name ? leggings.name : null,
                boots: boots && boots.name ? boots.name : null,
                mainHand: heldItem
            }
        },
        nearby: {
            humanPlayers: players,
            botPlayers: bots,
            entityTypes: (() => {
                try {
                    const entities = getNearbyEntityTypes(bot) || [];
                    return entities.filter(t => t !== 'player' && t !== 'item');
                } catch (e) {
                    return [];
                }
            })()
        },
        modes: {
            summary: (() => {
                try {
                    return (bot.modes && bot.modes.getMiniDocs) ? bot.modes.getMiniDocs() : {};
                } catch (e) {
                    return {};
                }
            })()
        }
    };

    return state;
}