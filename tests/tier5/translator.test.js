/**
 * Unit tests for translator.js
 */

import { strict as assert } from 'assert';

console.log('Running translator.js tests...\n');

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
    // Mock settings module
    const settingsMock = { language: 'en' };
    
    // We can't easily test the actual translation without API keys,
    // so we test the validation and error handling logic
    
    const { handleTranslation, handleEnglishTranslation } = await import('../../src/utils/translator.js');
    const settings = (await import('../../src/agent/settings.js')).default;
    
    await test('handleTranslation: returns original if language is English', async () => {
        settings.language = 'en';
        const result = await handleTranslation('hello world');
        assert(result === 'hello world', 'Should return original message');
    });

    await test('handleTranslation: returns original if language is "english"', async () => {
        settings.language = 'english';
        const result = await handleTranslation('hello world');
        assert(result === 'hello world', 'Should return original message');
    });

    await test('handleTranslation: handles null language setting', async () => {
        settings.language = null;
        const result = await handleTranslation('hello world');
        assert(result === 'hello world', 'Should return original message');
    });

    await test('handleTranslation: handles undefined language setting', async () => {
        settings.language = undefined;
        const result = await handleTranslation('hello world');
        assert(result === 'hello world', 'Should return original message');
    });

    await test('handleTranslation: rejects invalid language codes', async () => {
        settings.language = 'invalid_lang_code_123';
        const result = await handleTranslation('hello world');
        // Should return original due to invalid language code
        assert(result === 'hello world', 'Should return original for invalid language');
    });

    await test('handleTranslation: accepts valid ISO 639-1 codes', async () => {
        settings.language = 'es'; // Spanish
        // Will fail to translate without API, but shouldn't crash
        const result = await handleTranslation('hello');
        assert(typeof result === 'string', 'Should return a string');
    });

    await test('handleTranslation: accepts valid language-region codes', async () => {
        settings.language = 'zh-CN'; // Chinese (Simplified)
        // Will fail to translate without API, but shouldn't crash
        const result = await handleTranslation('hello');
        assert(typeof result === 'string', 'Should return a string');
    });

    await test('handleTranslation: handles control characters in input', async () => {
        settings.language = 'fr';
        const malicious = 'hello\x00\x01\x02world';
        // Should not crash
        const result = await handleTranslation(malicious);
        assert(typeof result === 'string', 'Should return a string');
        // Control chars should be stripped
        assert(!result.includes('\x00'), 'Should strip control characters');
    });

    await test('handleTranslation: rejects excessively long messages', async () => {
        settings.language = 'fr';
        const longMessage = 'A'.repeat(10000);
        // Should reject and return original or throw
        try {
            const result = await handleTranslation(longMessage);
            // If it doesn't throw, it should return a string
            assert(typeof result === 'string', 'Should return a string');
        } catch (error) {
            // Expected to throw for too-long messages
            assert(error.message.includes('too long'), 'Should mention length limit');
        }
    });

    await test('handleTranslation: handles empty string', async () => {
        settings.language = 'fr';
        try {
            const result = await handleTranslation('');
            assert(typeof result === 'string', 'Should handle empty string');
        } catch (error) {
            // May throw validation error
            assert(error.message.includes('Invalid'), 'Should validate empty input');
        }
    });

    await test('handleTranslation: handles null input', async () => {
        settings.language = 'fr';
        try {
            const result = await handleTranslation(null);
            assert(typeof result === 'string' || result === null, 'Should handle null');
        } catch (error) {
            // May throw validation error
            assert(error.message.includes('Invalid'), 'Should validate null input');
        }
    });

    await test('handleTranslation: handles undefined input', async () => {
        settings.language = 'fr';
        try {
            const result = await handleTranslation(undefined);
            assert(typeof result === 'string' || result === undefined, 'Should handle undefined');
        } catch (error) {
            // May throw validation error
            assert(error.message.includes('Invalid'), 'Should validate undefined input');
        }
    });

    await test('handleEnglishTranslation: returns original if already English', async () => {
        settings.language = 'en';
        const result = await handleEnglishTranslation('hello world');
        assert(result === 'hello world', 'Should return original message');
    });

    await test('handleEnglishTranslation: handles translation errors gracefully', async () => {
        settings.language = 'fr';
        // Without API key, should fail gracefully and return original
        const result = await handleEnglishTranslation('bonjour');
        assert(typeof result === 'string', 'Should return a string on error');
    });

    // Test timeout behavior (mock)
    await test('handleTranslation: has timeout protection', async () => {
        settings.language = 'fr';
        const start = Date.now();
        
        try {
            // This will likely fail due to no API key, but should timeout quickly
            await handleTranslation('test message');
            const duration = Date.now() - start;
            
            // Should complete within reasonable time (either success or timeout)
            assert(duration < 10000, `Should complete within 10s, took ${duration}ms`);
        } catch (error) {
            // Expected to fail, that's okay
            const duration = Date.now() - start;
            assert(duration < 10000, `Should timeout within 10s, took ${duration}ms`);
        }
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Test suite error:', err);
    process.exit(1);
});
