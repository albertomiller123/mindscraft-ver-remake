/**
 * Unit tests for text.js utilities
 */

import { wordOverlapScore, stringifyTurns, strictFormat } from '../../src/utils/text.js';
import { strict as assert } from 'assert';

console.log('Running text.js tests...\n');

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

// Test wordOverlapScore
test('wordOverlapScore: identical strings should return 1', () => {
    const result = wordOverlapScore('hello world', 'hello world');
    assert(result === 1, `Expected 1, got ${result}`);
});

test('wordOverlapScore: no overlap should return 0', () => {
    const result = wordOverlapScore('hello world', 'foo bar');
    assert(result === 0, `Expected 0, got ${result}`);
});

test('wordOverlapScore: partial overlap should return between 0 and 1', () => {
    const result = wordOverlapScore('hello world', 'hello foo');
    assert(result > 0 && result < 1, `Expected (0, 1), got ${result}`);
});

test('wordOverlapScore: empty strings should return 1', () => {
    const result = wordOverlapScore('', '');
    assert(result === 1, `Expected 1, got ${result}`);
});

test('wordOverlapScore: one empty string should return 0', () => {
    const result = wordOverlapScore('hello', '');
    assert(result === 0, `Expected 0, got ${result}`);
});

test('wordOverlapScore: null inputs should return appropriate value', () => {
    const result = wordOverlapScore(null, 'hello');
    assert(result === 0, `Expected 0, got ${result}`);
});

test('wordOverlapScore: undefined inputs should return appropriate value', () => {
    const result = wordOverlapScore(undefined, 'hello');
    assert(result === 0, `Expected 0, got ${result}`);
});

test('wordOverlapScore: case insensitive', () => {
    const result = wordOverlapScore('Hello World', 'hello world');
    assert(result === 1, `Expected 1, got ${result}`);
});

test('wordOverlapScore: ignores punctuation', () => {
    const result = wordOverlapScore('hello, world!', 'hello world');
    assert(result === 1, `Expected 1, got ${result}`);
});

test('wordOverlapScore: Jaccard index calculation', () => {
    // "hello world" vs "world foo" -> intersection: {world}, union: {hello, world, foo}
    // Jaccard = 1/3 ≈ 0.333
    const result = wordOverlapScore('hello world', 'world foo');
    assert(Math.abs(result - 0.333) < 0.01, `Expected ~0.333, got ${result}`);
});

test('wordOverlapScore: handles repeated words correctly', () => {
    // "hello hello world" vs "hello world world"
    // Sets: {hello, world} vs {hello, world}
    // Should be 1.0 (identical sets)
    const result = wordOverlapScore('hello hello world', 'hello world world');
    assert(result === 1, `Expected 1, got ${result}`);
});

test('wordOverlapScore: result should always be in [0, 1]', () => {
    const testCases = [
        ['hello', 'world'],
        ['the quick brown fox', 'the lazy dog'],
        ['a b c', 'c d e'],
        ['foo bar baz', 'bar baz qux']
    ];
    
    for (const [text1, text2] of testCases) {
        const result = wordOverlapScore(text1, text2);
        assert(result >= 0 && result <= 1, `Result ${result} for "${text1}" vs "${text2}" should be in [0, 1]`);
    }
});

// Test stringifyTurns
test('stringifyTurns: basic conversation', () => {
    const turns = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' }
    ];
    const result = stringifyTurns(turns);
    assert(result.includes('User input: Hello'), 'Should contain user input');
    assert(result.includes('Your output:\nHi there!'), 'Should contain assistant output');
});

test('stringifyTurns: empty array', () => {
    const result = stringifyTurns([]);
    assert(result === '', 'Empty array should return empty string');
});

test('stringifyTurns: system messages', () => {
    const turns = [
        { role: 'system', content: 'System info' }
    ];
    const result = stringifyTurns(turns);
    assert(result.includes('System output: System info'), 'Should contain system message');
});

// Test strictFormat
test('strictFormat: alternating user/assistant', () => {
    const turns = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' }
    ];
    const result = strictFormat(turns);
    assert(result.length === 2, 'Should have 2 messages');
    assert(result[0].role === 'user', 'First should be user');
    assert(result[1].role === 'assistant', 'Second should be assistant');
});

test('strictFormat: consecutive user messages should be combined', () => {
    const turns = [
        { role: 'user', content: 'Hello' },
        { role: 'user', content: 'How are you?' }
    ];
    const result = strictFormat(turns);
    assert(result.length === 1, 'Should combine into 1 message');
    assert(result[0].content.includes('Hello'), 'Should contain first message');
    assert(result[0].content.includes('How are you?'), 'Should contain second message');
});

test('strictFormat: consecutive assistant messages should be separated', () => {
    const turns = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
        { role: 'assistant', content: 'How can I help?' }
    ];
    const result = strictFormat(turns);
    assert(result.length === 4, 'Should insert filler message between assistant messages');
    assert(result[2].content === '_', 'Should have filler message');
});

test('strictFormat: system messages converted to user messages', () => {
    const turns = [
        { role: 'system', content: 'System info' }
    ];
    const result = strictFormat(turns);
    assert(result[0].role === 'user', 'System should be converted to user');
    assert(result[0].content.includes('SYSTEM:'), 'Should be prefixed with SYSTEM:');
});

test('strictFormat: starts with user message', () => {
    const turns = [
        { role: 'assistant', content: 'Hi' }
    ];
    const result = strictFormat(turns);
    assert(result[0].role === 'user', 'Should start with user message');
    assert(result[0].content === '_', 'Should have filler message');
});

test('strictFormat: empty array gets filler', () => {
    const result = strictFormat([]);
    assert(result.length === 1, 'Should have 1 message');
    assert(result[0].role === 'user', 'Should be user');
    assert(result[0].content === '_', 'Should be filler');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
