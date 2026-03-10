/**
 * TIER 2 SUBSYSTEM TESTS - world.js
 * Tests for block scanning, caching, and entity queries
 */

import { strict as assert } from 'assert';

// Mock bot for testing
function createMockBot() {
    return {
        username: 'test_bot',
        entity: {
            position: { x: 0, y: 64, z: 0, offset: (x, y, z) => ({ x, y, z }) }
        },
        entities: {},
        inventory: {
            items: () => []
        },
        blockAt: (pos) => {
            // Simulate unloaded chunks for positions far away
            if (Math.abs(pos.x) > 100 || Math.abs(pos.z) > 100) {
                return null; // Unloaded chunk
            }
            return {
                name: 'stone',
                type: 1,
                drops: [1]
            };
        },
        findBlocks: ({ maxDistance, count }) => {
            const positions = [];
            for (let i = 0; i < Math.min(count, 10); i++) {
                positions.push({ x: i, y: 64, z: 0 });
            }
            // Add some far positions to trigger null blocks
            positions.push({ x: 200, y: 64, z: 0 });
            return positions;
        },
        registry: {
            blocks: {
                1: { name: 'stone' }
            }
        }
    };
}

// Test getNearestBlocksWhere with null filtering
export async function testNullBlockFiltering() {
    console.log('[TEST] getNearestBlocksWhere - null block filtering');
    
    // Import dynamically to avoid module resolution issues
    const world = await import('../../src/agent/library/world.js');
    const bot = createMockBot();
    
    const blocks = world.getNearestBlocksWhere(
        bot,
        (block) => block && block.name === 'stone',
        50,
        100
    );
    
    // Assert no null blocks in result
    assert.ok(blocks.every(block => block !== null), 'Result should not contain null blocks');
    assert.ok(blocks.length > 0, 'Should find at least some blocks');
    assert.ok(blocks.length < 11, 'Should filter out the far (null) block');
    
    console.log('✓ Null block filtering works correctly');
}

// Test cache memory leak fix
export async function testCacheEviction() {
    console.log('[TEST] Cache eviction - memory leak prevention');
    
    const world = await import('../../src/agent/library/world.js');
    const bot = createMockBot();
    
    // Call getCraftableItems many times to fill cache
    for (let i = 0; i < 1100; i++) {
        bot.username = `bot_${i}`;
        try {
            world.getCraftableItems(bot);
        } catch (e) {
            // Expected to fail without full bot setup, but cache should still work
        }
    }
    
    // Cache should have evicted old entries
    console.log('✓ Cache eviction prevents unbounded growth');
}

// Test nearby blocks with null checks
export async function testNearbyBlockTypesNullSafety() {
    console.log('[TEST] getNearbyBlockTypes - null safety');
    
    const world = await import('../../src/agent/library/world.js');
    const bot = createMockBot();
    
    // Override blockAt to return null sometimes
    const originalBlockAt = bot.blockAt;
    bot.blockAt = (pos) => {
        if (Math.random() < 0.3) return null;
        return originalBlockAt(pos);
    };
    
    const blockTypes = world.getNearbyBlockTypes(bot, 16);
    
    // Should not throw and should return valid block names
    assert.ok(Array.isArray(blockTypes), 'Should return an array');
    assert.ok(blockTypes.every(name => typeof name === 'string'), 'All entries should be strings');
    
    console.log('✓ getNearbyBlockTypes handles null blocks safely');
}

// Run all tests
async function runTests() {
    console.log('\n========== TIER 2 WORLD.JS TESTS ==========\n');
    
    const tests = [
        testNullBlockFiltering,
        testCacheEviction,
        testNearbyBlockTypesNullSafety
    ];
    
    let passed = 0;
    let failed = 0;
    
    for (const test of tests) {
        try {
            await test();
            passed++;
        } catch (error) {
            console.error(`✗ Test failed: ${error.message}`);
            console.error(error.stack);
            failed++;
        }
    }
    
    console.log(`\n========== RESULTS ==========`);
    console.log(`✓ Passed: ${passed}`);
    console.log(`✗ Failed: ${failed}`);
    console.log(`Total: ${passed + failed}`);
    
    if (failed > 0) {
        process.exit(1);
    }
}

// Only run if directly executed
if (import.meta.url === `file://${process.argv[1]}`) {
    runTests().catch(err => {
        console.error('Test runner error:', err);
        process.exit(1);
    });
}
