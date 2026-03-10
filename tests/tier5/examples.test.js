/**
 * Unit tests for examples.js
 */

import { Examples } from '../../src/utils/examples.js';
import { strict as assert } from 'assert';

console.log('Running examples.js tests...\n');

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

// Mock embedding model
class MockEmbedModel {
    constructor(shouldFail = false) {
        this.shouldFail = shouldFail;
        this.embedCount = 0;
    }
    
    async embed(text) {
        this.embedCount++;
        if (this.shouldFail) {
            throw new Error('Embedding failed');
        }
        // Return simple mock embedding based on text length
        return new Array(10).fill(text.length / 100);
    }
}

async function runTests() {
    const testExamples = [
        [
            { role: 'user', content: 'User: How do I mine?' },
            { role: 'assistant', content: 'Use pickaxe' }
        ],
        [
            { role: 'user', content: 'User: How do I craft?' },
            { role: 'assistant', content: 'Use crafting table' }
        ],
        [
            { role: 'user', content: 'User: How do I build?' },
            { role: 'assistant', content: 'Place blocks' }
        ]
    ];

    await test('Examples: constructor initializes correctly', () => {
        const ex = new Examples(null, 2);
        assert(ex.select_num === 2, 'Should set select_num');
        assert(Array.isArray(ex.examples), 'Should initialize examples array');
        assert(typeof ex.embeddings === 'object', 'Should initialize embeddings object');
    });

    await test('Examples: load with no model', async () => {
        const ex = new Examples(null, 2);
        await ex.load(testExamples);
        assert(ex.examples.length === 3, 'Should load all examples');
        assert(Object.keys(ex.embeddings).length === 0, 'Should not create embeddings without model');
    });

    await test('Examples: load with select_num = 0', async () => {
        const ex = new Examples(new MockEmbedModel(), 0);
        await ex.load(testExamples);
        assert(ex.examples.length === 3, 'Should load examples');
        assert(Object.keys(ex.embeddings).length === 0, 'Should not create embeddings when select_num is 0');
    });

    await test('Examples: load with model creates embeddings', async () => {
        const model = new MockEmbedModel();
        const ex = new Examples(model, 2);
        await ex.load(testExamples);
        
        assert(Object.keys(ex.embeddings).length === 3, 'Should create embeddings for all examples');
        assert(model.embedCount === 3, 'Should call embed 3 times');
    });

    await test('Examples: load handles embedding failures gracefully', async () => {
        const model = new MockEmbedModel(true); // Will fail
        const ex = new Examples(model, 2);
        await ex.load(testExamples);
        
        // Individual failures are caught, but model stays enabled
        // Should have empty embeddings due to all failures
        assert(Object.keys(ex.embeddings).length === 0, 'Should have no embeddings on failure');
        // Model can still be used (will try again on next load)
    });

    await test('Examples: load validates input', async () => {
        const ex = new Examples(null, 2);
        let threw = false;
        try {
            await ex.load('not an array');
        } catch (error) {
            threw = true;
            assert(error.message.includes('array'), 'Should mention array requirement');
        }
        assert(threw, 'Should throw for invalid input');
    });

    await test('Examples: load prevents race conditions', async () => {
        const model = new MockEmbedModel();
        const ex = new Examples(model, 2);
        
        // Start two loads concurrently
        const promise1 = ex.load(testExamples.slice(0, 2));
        const promise2 = ex.load(testExamples.slice(1, 3));
        
        await Promise.all([promise1, promise2]);
        
        // Should not have corrupted embeddings
        assert(Object.keys(ex.embeddings).length > 0, 'Should have embeddings');
    });

    await test('Examples: turnsToText converts correctly', () => {
        const ex = new Examples(null, 2);
        const turns = [
            { role: 'user', content: 'User: hello' },
            { role: 'assistant', content: 'hi' },
            { role: 'user', content: 'User: how are you' }
        ];
        
        const text = ex.turnsToText(turns);
        assert(text.includes('hello'), 'Should include user content');
        assert(text.includes('how are you'), 'Should include second user content');
        assert(!text.includes('hi'), 'Should not include assistant content');
    });

    await test('Examples: turnsToText handles invalid input', () => {
        const ex = new Examples(null, 2);
        const result = ex.turnsToText(null);
        assert(result === '', 'Should return empty string for null');
    });

    await test('Examples: turnsToText handles malformed turns', () => {
        const ex = new Examples(null, 2);
        const turns = [
            { role: 'user', content: null },
            { role: 'user' }, // missing content
            { role: 'user', content: 'valid' }
        ];
        
        const text = ex.turnsToText(turns);
        assert(text.includes('valid'), 'Should handle valid turns');
    });

    await test('Examples: getRelevant with select_num = 0', async () => {
        const ex = new Examples(null, 0);
        await ex.load(testExamples);
        const result = await ex.getRelevant([{ role: 'user', content: 'User: test' }]);
        assert(result.length === 0, 'Should return empty array when select_num is 0');
    });

    await test('Examples: getRelevant with no examples', async () => {
        const ex = new Examples(null, 2);
        await ex.load([]);
        const result = await ex.getRelevant([{ role: 'user', content: 'User: test' }]);
        assert(result.length === 0, 'Should return empty array when no examples');
    });

    await test('Examples: getRelevant without model uses word overlap', async () => {
        const ex = new Examples(null, 2);
        await ex.load(testExamples);
        const result = await ex.getRelevant([{ role: 'user', content: 'User: How do I mine diamonds?' }]);
        
        assert(result.length <= 2, 'Should return at most select_num examples');
        assert(result.length > 0, 'Should return at least one example');
    });

    await test('Examples: getRelevant with model uses embeddings', async () => {
        const model = new MockEmbedModel();
        const ex = new Examples(model, 2);
        await ex.load(testExamples);
        
        const result = await ex.getRelevant([{ role: 'user', content: 'User: mining question' }]);
        assert(result.length <= 2, 'Should return at most select_num examples');
    });

    await test('Examples: getRelevant returns deep copy', async () => {
        const ex = new Examples(null, 2);
        await ex.load(testExamples);
        const result = await ex.getRelevant([{ role: 'user', content: 'User: test' }]);
        
        // Modify result
        result[0][0].content = 'MODIFIED';
        
        // Original should be unchanged
        assert(!testExamples[0][0].content.includes('MODIFIED'), 'Should not modify original');
    });

    await test('Examples: getRelevant waits for ongoing load', async () => {
        const model = new MockEmbedModel();
        const ex = new Examples(model, 2);
        
        // Start load (don't await)
        const loadPromise = ex.load(testExamples);
        
        // Try to get relevant while loading
        const resultPromise = ex.getRelevant([{ role: 'user', content: 'User: test' }]);
        
        await Promise.all([loadPromise, resultPromise]);
        
        const result = await resultPromise;
        assert(Array.isArray(result), 'Should return array after waiting for load');
    });

    await test('Examples: createExampleMessage formats correctly', async () => {
        const ex = new Examples(null, 2);
        await ex.load(testExamples);
        const message = await ex.createExampleMessage([{ role: 'user', content: 'User: test' }]);
        
        assert(message.includes('Examples of how to respond'), 'Should have header');
        assert(message.includes('Example 1:'), 'Should have example labels');
    });

    await test('Examples: createExampleMessage with no examples', async () => {
        const ex = new Examples(null, 2);
        await ex.load([]);
        const message = await ex.createExampleMessage([{ role: 'user', content: 'User: test' }]);
        
        assert(message === '', 'Should return empty string when no examples');
    });

    await test('Examples: getRelevant does not mutate examples order', async () => {
        const ex = new Examples(null, 2);
        await ex.load(testExamples);
        
        const originalOrder = ex.examples.map(e => e[0].content);
        
        await ex.getRelevant([{ role: 'user', content: 'User: test' }]);
        
        const newOrder = ex.examples.map(e => e[0].content);
        
        assert.deepEqual(originalOrder, newOrder, 'Should not mutate original examples order');
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Test suite error:', err);
    process.exit(1);
});
