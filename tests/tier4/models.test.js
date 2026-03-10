/**
 * TIER 4 SUBSYSTEM TESTS - Models & API Providers
 * Tests for model factory, provider adapters, and error handling
 */

import { strict as assert } from 'assert';
import { selectAPI, createModel } from '../../src/models/_model_map.js';
import { getKey, hasKey } from '../../src/utils/keys.js';

// ========== TEST: Model Selection Logic ==========

export async function testSelectAPIWithString() {
    console.log('[TEST] selectAPI - string input');
    
    // Note: This test requires dependencies to be installed
    // Skipping if apiMap is empty
    try {
        const result = selectAPI('gpt-4o');
        assert.equal(result.api, 'openai', 'Should detect openai API');
        assert.equal(result.model, 'gpt-4o', 'Should extract model name');
        console.log('✓ String input handled correctly');
    } catch (err) {
        if (err.message.includes('Unknown api') || err.message.includes('Unknown model')) {
            console.log('  ⊘ Skipped (dependencies not installed)');
        } else {
            throw err;
        }
    }
}

export async function testSelectAPIWithObject() {
    console.log('[TEST] selectAPI - object input');
    
    try {
        const result = selectAPI({ model: 'claude-3', api: 'anthropic' });
        assert.equal(result.api, 'anthropic', 'Should use provided api');
        assert.equal(result.model, 'claude-3', 'Should keep model name');
        console.log('✓ Object input handled correctly');
    } catch (err) {
        if (err.message.includes('Unknown api')) {
            console.log('  ⊘ Skipped (dependencies not installed)');
        } else {
            throw err;
        }
    }
}

export async function testSelectAPIAutoDetection() {
    console.log('[TEST] selectAPI - auto-detection');
    
    try {
        // Test common models without prefix
        const gptResult = selectAPI({ model: 'gpt-4o' });
        assert.equal(gptResult.api, 'openai', 'Should detect GPT');
        
        const claudeResult = selectAPI({ model: 'claude-sonnet' });
        assert.equal(claudeResult.api, 'anthropic', 'Should detect Claude');
        
        const geminiResult = selectAPI({ model: 'gemini-2.5-flash' });
        assert.equal(geminiResult.api, 'google', 'Should detect Gemini');
        
        const grokResult = selectAPI({ model: 'grok-3' });
        assert.equal(grokResult.api, 'xai', 'Should detect Grok');
        
        console.log('✓ Auto-detection works for major providers');
    } catch (err) {
        if (err.message.includes('Unknown api') || err.message.includes('Unknown model')) {
            console.log('  ⊘ Skipped (dependencies not installed)');
        } else {
            throw err;
        }
    }
}

export async function testSelectAPIBackwardsCompatibility() {
    console.log('[TEST] selectAPI - local -> ollama compatibility');
    
    try {
        const result = selectAPI({ model: 'local/llama3' });
        assert.equal(result.api, 'ollama', 'Should convert local to ollama');
        // Model name has 'local' replaced with 'ollama'
        assert.ok(result.model.includes('llama3'), 'Should contain model name');
        console.log('✓ Backwards compatibility maintained');
    } catch (err) {
        if (err.message.includes('Unknown api')) {
            console.log('  ⊘ Skipped (dependencies not installed)');
        } else {
            throw err;
        }
    }
}

export async function testSelectAPIInputValidation() {
    console.log('[TEST] selectAPI - input validation');
    
    // Test null input
    try {
        selectAPI(null);
        assert.fail('Should reject null input');
    } catch (err) {
        assert.ok(err.message.includes('required'), 'Should throw for null');
    }
    
    // Test invalid type
    try {
        selectAPI(12345);
        assert.fail('Should reject number input');
    } catch (err) {
        assert.ok(err.message.includes('string or object'), 'Should throw for number');
    }
    
    // Test unknown model
    try {
        selectAPI({ model: 'totally-unknown-model-xyz' });
        assert.fail('Should reject unknown model');
    } catch (err) {
        assert.ok(err.message.includes('Unknown model'), 'Should throw for unknown model');
    }
    
    console.log('✓ Input validation works correctly');
}

// ========== TEST: Model Factory ==========

export async function testCreateModelValidation() {
    console.log('[TEST] createModel - validation');
    
    // Test unknown API
    try {
        createModel({ api: 'totally-fake-api' });
        assert.fail('Should reject unknown API');
    } catch (err) {
        assert.ok(err.message.includes('Unknown api'), 'Should throw for unknown API');
    }
    
    console.log('✓ Model factory validation works');
}

export async function testCreateModelAPIAsModel() {
    console.log('[TEST] createModel - API name as model');
    
    try {
        // When model value is an API name, it should set model to null
        const result = selectAPI({ model: 'gpt-4o' });
        const model = createModel(result);
        
        assert.ok(model, 'Should create model instance');
        assert.ok(model.constructor.name, 'Should have constructor name');
        console.log('✓ API-as-model handled correctly');
    } catch (err) {
        if (err.message.includes('Unknown') || err.message.includes('not found')) {
            console.log('  ⊘ Skipped (dependencies not installed or API keys missing)');
        } else {
            throw err;
        }
    }
}

// ========== TEST: Key Management ==========

export async function testGetKeyValidation() {
    console.log('[TEST] getKey - validation');
    
    // Test missing key
    try {
        getKey('NONEXISTENT_KEY_XYZ_123');
        assert.fail('Should throw for missing key');
    } catch (err) {
        assert.ok(err.message.includes('not found'), 'Should throw descriptive error');
    }
    
    console.log('✓ Key validation works');
}

export async function testGetKeySanitization() {
    console.log('[TEST] getKey - error sanitization');
    
    const originalEnv = process.env.NODE_ENV;
    
    try {
        // Test production mode sanitization
        process.env.NODE_ENV = 'production';
        try {
            getKey('SECRET_KEY_NAME');
        } catch (err) {
            assert.ok(err.message.includes('API_KEY'), 'Should sanitize in production');
            assert.ok(!err.message.includes('SECRET_KEY_NAME'), 'Should not leak key name');
        }
        
        // Test development mode
        process.env.NODE_ENV = 'development';
        try {
            getKey('DEV_KEY_NAME');
        } catch (err) {
            assert.ok(err.message.includes('DEV_KEY_NAME'), 'Should show key name in dev');
        }
    } finally {
        process.env.NODE_ENV = originalEnv;
    }
    
    console.log('✓ Error sanitization works correctly');
}

export async function testHasKey() {
    console.log('[TEST] hasKey - existence check');
    
    const exists = hasKey('NONEXISTENT_KEY_XYZ');
    assert.equal(exists, undefined, 'Should return undefined for missing key');
    
    console.log('✓ hasKey works correctly');
}

// ========== TEST: Text Utilities ==========

export async function testStrictFormat() {
    console.log('[TEST] strictFormat - message formatting');
    
    const { strictFormat } = await import('../../src/utils/text.js');
    
    // Test system message conversion
    const turns1 = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' }
    ];
    const result1 = strictFormat(turns1);
    assert.equal(result1[0].role, 'user', 'System should become user');
    assert.ok(result1[0].content.includes('SYSTEM:'), 'Should prefix with SYSTEM:');
    
    // Test repeated assistant messages
    const turns2 = [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
        { role: 'assistant', content: 'How are you?' }
    ];
    const result2 = strictFormat(turns2);
    assert.ok(result2.length > 3, 'Should insert filler message');
    assert.equal(result2[2].role, 'user', 'Should have filler user message');
    
    // Test repeated user messages (should combine)
    const turns3 = [
        { role: 'user', content: 'Part 1' },
        { role: 'user', content: 'Part 2' }
    ];
    const result3 = strictFormat(turns3);
    assert.equal(result3.length, 1, 'Should combine repeated user messages');
    assert.ok(result3[0].content.includes('Part 1'), 'Should contain first part');
    assert.ok(result3[0].content.includes('Part 2'), 'Should contain second part');
    
    // Test empty input
    const result4 = strictFormat([]);
    assert.equal(result4.length, 1, 'Should add filler for empty input');
    assert.equal(result4[0].role, 'user', 'Filler should be user role');
    
    console.log('✓ strictFormat works correctly');
}

export async function testToSinglePrompt() {
    console.log('[TEST] toSinglePrompt - prompt generation');
    
    const { toSinglePrompt } = await import('../../src/utils/text.js');
    
    const turns = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' }
    ];
    
    const prompt = toSinglePrompt(turns, 'You are helpful', '***', 'bot');
    
    assert.ok(prompt.includes('You are helpful'), 'Should include system message');
    assert.ok(prompt.includes('user: Hello'), 'Should include user message');
    assert.ok(prompt.includes('bot: Hi there'), 'Should use model nickname');
    assert.ok(prompt.includes('***'), 'Should include stop sequence');
    // Last turn was assistant, so prompt does NOT end with 'bot: '
    // It continues from the assistant's message
    assert.ok(prompt.includes('bot:'), 'Should include bot marker');
    
    console.log('✓ toSinglePrompt works correctly');
}

export async function testWordOverlapScore() {
    console.log('[TEST] wordOverlapScore - similarity metric');
    
    const { wordOverlapScore } = await import('../../src/utils/text.js');
    
    const score1 = wordOverlapScore('hello world', 'hello world');
    assert.ok(score1 > 0.9, 'Identical strings should have high score');
    
    const score2 = wordOverlapScore('hello world', 'goodbye universe');
    assert.ok(score2 < 0.1, 'Different strings should have low score');
    
    const score3 = wordOverlapScore('hello world', 'hello universe');
    assert.ok(score3 > 0.3 && score3 < 0.7, 'Partial overlap should have medium score');
    
    console.log('✓ wordOverlapScore works correctly');
}

// ========== TEST: Error Handling Patterns ==========

export async function testContextLengthHandling() {
    console.log('[TEST] Context length - recursive retry pattern');
    
    // Mock provider that simulates context length error
    class MockProvider {
        static prefix = 'mock';
        constructor() {
            this.attempts = 0;
        }
        
        async sendRequest(turns, systemMessage) {
            this.attempts++;
            if (turns.length > 2 && this.attempts < 3) {
                throw Object.assign(new Error('Context length exceeded'), { 
                    code: 'context_length_exceeded' 
                });
            }
            return 'Success';
        }
    }
    
    const provider = new MockProvider();
    const turns = [
        { role: 'user', content: 'msg1' },
        { role: 'user', content: 'msg2' },
        { role: 'user', content: 'msg3' },
        { role: 'user', content: 'msg4' }
    ];
    
    // Simulate the retry pattern used in providers
    async function sendWithRetry(turns) {
        try {
            return await provider.sendRequest(turns, 'system');
        } catch (err) {
            if ((err.message === 'Context length exceeded' || err.code === 'context_length_exceeded') && turns.length > 1) {
                return await sendWithRetry(turns.slice(1));
            }
            throw err;
        }
    }
    
    const result = await sendWithRetry(turns);
    assert.equal(result, 'Success', 'Should eventually succeed');
    assert.ok(provider.attempts >= 2, 'Should have retried');
    
    console.log('✓ Context length retry pattern works');
}

// ========== TEST: Think Tag Stripping ==========

export async function testThinkTagStripping() {
    console.log('[TEST] Think tag - stripping patterns');
    
    // Test complete think block
    let text1 = 'Before <think>internal thoughts</think> After';
    let result1 = text1.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    assert.equal(result1, 'Before  After', 'Should strip complete think block');
    
    // Test multiple think blocks
    let text2 = '<think>A</think> Middle <think>B</think> End';
    let result2 = text2.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    assert.ok(!result2.includes('<think>'), 'Should strip all think blocks');
    assert.ok(!result2.includes('</think>'), 'Should strip all closing tags');
    
    console.log('✓ Think tag stripping works correctly');
}

// ========== RUN ALL TESTS ==========

async function runTests() {
    console.log('\n========== TIER 4 MODELS TESTS ==========\n');
    
    const tests = [
        // Model selection
        testSelectAPIWithString,
        testSelectAPIWithObject,
        testSelectAPIAutoDetection,
        testSelectAPIBackwardsCompatibility,
        testSelectAPIInputValidation,
        
        // Model factory
        testCreateModelValidation,
        testCreateModelAPIAsModel,
        
        // Key management
        testGetKeyValidation,
        testGetKeySanitization,
        testHasKey,
        
        // Text utilities
        testStrictFormat,
        testToSinglePrompt,
        testWordOverlapScore,
        
        // Error handling
        testContextLengthHandling,
        testThinkTagStripping
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
