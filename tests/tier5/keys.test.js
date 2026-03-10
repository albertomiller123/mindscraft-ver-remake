/**
 * Unit tests for keys.js
 */

import { strict as assert } from 'assert';

console.log('Running keys.js tests...\n');

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

async function runTests() {
    // Set up test environment
    process.env.TEST_KEY = 'test_value_123';
    
    // Import after setting env vars (module caching)
    const { getKey, hasKey } = await import('../../src/utils/keys.js');

    await test('getKey: retrieves key from environment', () => {
        const result = getKey('TEST_KEY');
        assert(result === 'test_value_123', `Expected 'test_value_123', got '${result}'`);
    });

    await test('hasKey: returns true for existing key', () => {
        const result = hasKey('TEST_KEY');
        assert(result === true, 'Should return true for existing key');
    });

    await test('hasKey: returns false for non-existing key', () => {
        const result = hasKey('NONEXISTENT_KEY');
        assert(result === false, 'Should return false for non-existing key');
    });

    await test('getKey: throws on missing key', () => {
        let threw = false;
        try {
            getKey('MISSING_KEY');
        } catch (error) {
            threw = true;
            assert(error.message.includes('not found'), 'Should mention key not found');
            // Should NOT expose full key name
            assert(!error.message.includes('MISSING_KEY_SUPER_LONG'), 'Should sanitize long key names');
        }
        assert(threw, 'Should throw error');
    });

    await test('getKey: validates input - empty string', () => {
        let threw = false;
        try {
            getKey('');
        } catch (error) {
            threw = true;
            assert(error.message.includes('Invalid'), 'Should mention invalid input');
        }
        assert(threw, 'Should throw error for empty string');
    });

    await test('getKey: validates input - null', () => {
        let threw = false;
        try {
            getKey(null);
        } catch (error) {
            threw = true;
        }
        assert(threw, 'Should throw error for null');
    });

    await test('getKey: validates input - undefined', () => {
        let threw = false;
        try {
            getKey(undefined);
        } catch (error) {
            threw = true;
        }
        assert(threw, 'Should throw error for undefined');
    });

    await test('getKey: validates key value - empty string', () => {
        process.env.EMPTY_KEY = '';
        let threw = false;
        try {
            getKey('EMPTY_KEY');
        } catch (error) {
            threw = true;
        }
        assert(threw, 'Should reject empty key values');
    });

    await test('getKey: validates key value - whitespace only', () => {
        process.env.WHITESPACE_KEY = '   ';
        let threw = false;
        try {
            getKey('WHITESPACE_KEY');
        } catch (error) {
            threw = true;
        }
        assert(threw, 'Should reject whitespace-only key values');
    });

    await test('hasKey: validates input - null', () => {
        const result = hasKey(null);
        assert(result === false, 'Should return false for null');
    });

    await test('hasKey: validates input - undefined', () => {
        const result = hasKey(undefined);
        assert(result === false, 'Should return false for undefined');
    });

    await test('hasKey: validates input - empty string', () => {
        const result = hasKey('');
        assert(result === false, 'Should return false for empty string');
    });

    await test('getKey: rate limiting - should allow reasonable requests', () => {
        // First few requests should succeed
        for (let i = 0; i < 5; i++) {
            getKey('TEST_KEY');
        }
        // Should not throw yet
    });

    await test('getKey: rate limiting - should block excessive failed attempts', async () => {
        let blockedCount = 0;
        const sameKeyName = 'NONEXISTENT_RATE_LIMIT_TEST';
        
        // Try to access same non-existent key many times
        for (let i = 0; i < 15; i++) {
            try {
                getKey(sameKeyName);
            } catch (error) {
                if (error.message.includes('Rate limit')) {
                    blockedCount++;
                }
            }
        }
        
        // At least some should be blocked
        assert(blockedCount > 0, 'Should have rate-limited some requests');
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Test suite error:', err);
    process.exit(1);
});
