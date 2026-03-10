/**
 * Unit tests for math.js utilities
 */

import { cosineSimilarity } from '../../src/utils/math.js';
import { strict as assert } from 'assert';

console.log('Running math.js tests...\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch (error) {
        console.error(`✗ ${name}`);
        console.error(`  ${error.message}`);
        failed++;
    }
}

// Test 1: Normal vectors
test('cosineSimilarity: identical vectors should return 1', () => {
    const result = cosineSimilarity([1, 2, 3], [1, 2, 3]);
    assert(Math.abs(result - 1.0) < 0.0001, `Expected ~1, got ${result}`);
});

// Test 2: Orthogonal vectors
test('cosineSimilarity: orthogonal vectors should return 0', () => {
    const result = cosineSimilarity([1, 0, 0], [0, 1, 0]);
    assert(Math.abs(result) < 0.0001, `Expected ~0, got ${result}`);
});

// Test 3: Opposite vectors
test('cosineSimilarity: opposite vectors should return -1', () => {
    const result = cosineSimilarity([1, 0], [-1, 0]);
    assert(Math.abs(result + 1.0) < 0.0001, `Expected ~-1, got ${result}`);
});

// Test 4: Zero vector - main bug fix
test('cosineSimilarity: zero vector should return 0 (not NaN)', () => {
    const result = cosineSimilarity([0, 0, 0], [1, 2, 3]);
    assert(result === 0, `Expected 0, got ${result}`);
    assert(!isNaN(result), 'Result should not be NaN');
});

// Test 5: Both zero vectors
test('cosineSimilarity: both zero vectors should return 0', () => {
    const result = cosineSimilarity([0, 0], [0, 0]);
    assert(result === 0, `Expected 0, got ${result}`);
});

// Test 6: Invalid inputs
test('cosineSimilarity: null inputs should return 0', () => {
    const result = cosineSimilarity(null, [1, 2, 3]);
    assert(result === 0, `Expected 0, got ${result}`);
});

test('cosineSimilarity: undefined inputs should return 0', () => {
    const result = cosineSimilarity(undefined, [1, 2, 3]);
    assert(result === 0, `Expected 0, got ${result}`);
});

test('cosineSimilarity: empty arrays should return 0', () => {
    const result = cosineSimilarity([], []);
    assert(result === 0, `Expected 0, got ${result}`);
});

test('cosineSimilarity: mismatched lengths should return 0', () => {
    const result = cosineSimilarity([1, 2], [1, 2, 3]);
    assert(result === 0, `Expected 0, got ${result}`);
});

// Test 7: Handle NaN values
test('cosineSimilarity: NaN values should be treated as 0', () => {
    const result = cosineSimilarity([1, NaN, 3], [1, 2, 3]);
    assert(!isNaN(result), 'Result should not be NaN');
});

// Test 8: Handle undefined elements
test('cosineSimilarity: undefined elements should be treated as 0', () => {
    const result = cosineSimilarity([1, undefined, 3], [1, 2, 3]);
    assert(!isNaN(result), 'Result should not be NaN');
});

// Test 9: Result should be clamped to [-1, 1]
test('cosineSimilarity: result should be in [-1, 1]', () => {
    const result = cosineSimilarity([1, 2, 3], [2, 4, 6]);
    assert(result >= -1 && result <= 1, `Result ${result} should be in [-1, 1]`);
});

// Test 10: Large vectors
test('cosineSimilarity: large vectors should work', () => {
    const a = new Array(1000).fill(1);
    const b = new Array(1000).fill(1);
    const result = cosineSimilarity(a, b);
    assert(Math.abs(result - 1.0) < 0.0001, `Expected ~1, got ${result}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
