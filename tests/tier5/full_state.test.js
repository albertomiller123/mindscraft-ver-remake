/**
 * Unit tests for full_state.js
 */

import { strict as assert } from 'assert';

console.log('Running full_state.js tests...\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
    return (async () => {
        try {
            await fn();
            console.log(`✓ ${name}`);
            passed++;
        } catch (error) {
            console.error(`✗ ${name}`);
            console.error(`  ${error.message}`);
            failed++;
        }
    })();
}

// Mock bot and agent
function createMockBot(overrides = {}) {
    return {
        entity: { position: { x: 10, y: 64, z: 20 } },
        game: { dimension: 'overworld', gameMode: 'survival' },
        health: 20,
        food: 20,
        thunderState: 0,
        rainState: 0,
        time: { timeOfDay: 1000 },
        inventory: {
            slots: [null, null, null, null, null, null, null, null, null],
            items: () => []
        },
        heldItem: null,
        modes: {
            getMiniDocs: () => ({})
        },
        ...overrides
    };
}

function createMockAgent(botOverrides = {}) {
    return {
        name: 'TestBot',
        bot: createMockBot(botOverrides),
        isIdle: () => true,
        actions: { currentActionLabel: 'Idle' }
    };
}

// Mock world functions
const mockWorldFunctions = {
    getPosition: (bot) => bot.entity.position,
    getBiomeName: () => 'plains',
    getNearbyPlayerNames: () => [],
    getInventoryCounts: () => ({}),
    getNearbyEntityTypes: () => [],
    getBlockAtPosition: () => ({ name: 'air' }),
    getFirstBlockAboveHead: () => 'air'
};

async function runTests() {
    // Mock the world module
    await import('../../src/agent/library/world.js').catch(() => {
        // Module might not exist or might have dependencies
    });
    
    const { getFullState } = await import('../../src/agent/library/full_state.js');

    await test('getFullState: validates agent input', async () => {
        let threw = false;
        try {
            getFullState(null);
        } catch (error) {
            threw = true;
            assert(error.message.includes('Invalid agent'), 'Should mention invalid agent');
        }
        assert(threw, 'Should throw for null agent');
    });

    await test('getFullState: validates bot exists', async () => {
        let threw = false;
        try {
            getFullState({ name: 'test' }); // missing bot
        } catch (error) {
            threw = true;
            assert(error.message.includes('Invalid bot'), 'Should mention invalid bot');
        }
        assert(threw, 'Should throw for missing bot');
    });

    await test('getFullState: validates bot.entity exists', async () => {
        let threw = false;
        try {
            const agent = createMockAgent({ entity: null });
            getFullState(agent);
        } catch (error) {
            threw = true;
            assert(error.message.includes('not fully initialized'), 'Should mention initialization');
        }
        assert(threw, 'Should throw for missing entity');
    });

    await test('getFullState: returns complete state for valid bot', async () => {
        const agent = createMockAgent();
        const state = getFullState(agent);
        
        assert(state.name === 'TestBot', 'Should have agent name');
        assert(state.gameplay, 'Should have gameplay section');
        assert(state.action, 'Should have action section');
        assert(state.surroundings, 'Should have surroundings section');
        assert(state.inventory, 'Should have inventory section');
        assert(state.nearby, 'Should have nearby section');
        assert(state.modes, 'Should have modes section');
    });

    await test('getFullState: handles missing position gracefully', async () => {
        const agent = createMockAgent({
            entity: { position: null }
        });
        
        const state = getFullState(agent);
        // Should have default position
        assert(typeof state.gameplay.position.x === 'number', 'Should have numeric x');
        assert(typeof state.gameplay.position.y === 'number', 'Should have numeric y');
        assert(typeof state.gameplay.position.z === 'number', 'Should have numeric z');
    });

    await test('getFullState: handles missing game info gracefully', async () => {
        const agent = createMockAgent({
            game: null
        });
        
        const state = getFullState(agent);
        assert(state.gameplay.dimension === 'unknown', 'Should have fallback dimension');
        assert(state.gameplay.gamemode === 'unknown', 'Should have fallback gamemode');
    });

    await test('getFullState: handles missing health/food gracefully', async () => {
        const agent = createMockAgent({
            health: undefined,
            food: undefined
        });
        
        const state = getFullState(agent);
        assert(state.gameplay.health === 0, 'Should default health to 0');
        assert(state.gameplay.hunger === 0, 'Should default hunger to 0');
    });

    await test('getFullState: handles weather states correctly', async () => {
        const agentThunder = createMockAgent({ thunderState: 1 });
        const stateThunder = getFullState(agentThunder);
        assert(stateThunder.gameplay.weather === 'Thunderstorm', 'Should detect thunderstorm');
        
        const agentRain = createMockAgent({ rainState: 1 });
        const stateRain = getFullState(agentRain);
        assert(stateRain.gameplay.weather === 'Rain', 'Should detect rain');
        
        const agentClear = createMockAgent({ thunderState: 0, rainState: 0 });
        const stateClear = getFullState(agentClear);
        assert(stateClear.gameplay.weather === 'Clear', 'Should detect clear weather');
    });

    await test('getFullState: calculates time labels correctly', async () => {
        const agentMorning = createMockAgent({ time: { timeOfDay: 1000 } });
        const stateMorning = getFullState(agentMorning);
        assert(stateMorning.gameplay.timeLabel === 'Morning', 'Should detect morning');
        
        const agentAfternoon = createMockAgent({ time: { timeOfDay: 8000 } });
        const stateAfternoon = getFullState(agentAfternoon);
        assert(stateAfternoon.gameplay.timeLabel === 'Afternoon', 'Should detect afternoon');
        
        const agentNight = createMockAgent({ time: { timeOfDay: 13000 } });
        const stateNight = getFullState(agentNight);
        assert(stateNight.gameplay.timeLabel === 'Night', 'Should detect night');
    });

    await test('getFullState: handles missing time gracefully', async () => {
        const agent = createMockAgent({ time: null });
        const state = getFullState(agent);
        
        assert(state.gameplay.timeOfDay === 0, 'Should default timeOfDay to 0');
        assert(typeof state.gameplay.timeLabel === 'string', 'Should have time label');
    });

    await test('getFullState: handles missing inventory gracefully', async () => {
        const agent = createMockAgent({ inventory: null });
        const state = getFullState(agent);
        
        assert(state.inventory.stacksUsed === 0, 'Should default stacks to 0');
        assert(state.inventory.totalSlots === 0, 'Should default slots to 0');
        assert(typeof state.inventory.equipment === 'object', 'Should have equipment object');
    });

    await test('getFullState: handles equipped items correctly', async () => {
        const agent = createMockAgent({
            inventory: {
                slots: [
                    null, null, null, null, null,
                    { name: 'diamond_helmet' },
                    { name: 'diamond_chestplate' },
                    { name: 'diamond_leggings' },
                    { name: 'diamond_boots' }
                ],
                items: () => []
            },
            heldItem: { name: 'diamond_sword' }
        });
        
        const state = getFullState(agent);
        assert(state.inventory.equipment.helmet === 'diamond_helmet', 'Should detect helmet');
        assert(state.inventory.equipment.chestplate === 'diamond_chestplate', 'Should detect chestplate');
        assert(state.inventory.equipment.leggings === 'diamond_leggings', 'Should detect leggings');
        assert(state.inventory.equipment.boots === 'diamond_boots', 'Should detect boots');
        assert(state.inventory.equipment.mainHand === 'diamond_sword', 'Should detect held item');
    });

    await test('getFullState: handles missing isIdle gracefully', async () => {
        const agent = {
            name: 'TestBot',
            bot: createMockBot(),
            // missing isIdle and actions
        };
        
        const state = getFullState(agent);
        assert(typeof state.action.current === 'string', 'Should have action string');
        assert(typeof state.action.isIdle === 'boolean', 'Should have isIdle boolean');
    });

    await test('getFullState: handles missing modes gracefully', async () => {
        const agent = createMockAgent({ modes: null });
        const state = getFullState(agent);
        
        assert(typeof state.modes.summary === 'object', 'Should have modes summary');
    });

    await test('getFullState: does not throw on partial data', async () => {
        const agent = {
            name: 'PartialBot',
            bot: {
                entity: { position: { x: 0, y: 0, z: 0 } },
                // Missing most properties
            }
        };
        
        const state = getFullState(agent);
        // Should complete without throwing
        assert(state.name === 'PartialBot', 'Should have name');
        assert(typeof state.gameplay === 'object', 'Should have gameplay');
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Test suite error:', err);
    process.exit(1);
});
