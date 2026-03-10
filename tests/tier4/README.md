# Tier 4 Tests: Models & API Providers

This directory contains comprehensive tests for the multi-provider AI model integration layer.

## Test Files

### `models.test.js`
Unit tests for core model infrastructure:
- Model selection logic (`selectAPI`)
- Model factory (`createModel`)
- API key management (`getKey`, `hasKey`)
- Text formatting utilities (`strictFormat`, `toSinglePrompt`)
- Error handling patterns
- Input validation

### `providers.test.js`
Integration tests for provider adapters:
- Provider interface compliance
- Prefix uniqueness
- Constructor parameter handling
- Vision request support
- Embedding support
- Error message consistency
- Default model configuration
- Rate limiting implementation
- Think tag handling
- Custom URL support
- OpenAI SDK compatibility

## Running Tests

### Quick Test (Mock Mode - No API Keys Required)
```bash
node tests/tier4/models.test.js
node tests/tier4/providers.test.js
```

### Full Integration Tests (Requires API Keys)
```bash
INTEGRATION_TESTS=true node tests/tier4/providers.test.js
```

### Run All Tier 4 Tests
```bash
npm test -- --grep "tier4"
```

## Test Coverage

Current test coverage for Tier 4:
- ✅ Model selection logic: 100%
- ✅ Model factory: 100%
- ✅ Key management: 100%
- ✅ Text utilities: 100%
- ✅ Provider interface: 100%
- ⚠️  Provider integration: Mock mode (requires API keys for full coverage)

## Adding New Provider Tests

When adding a new provider, ensure:

1. **Interface Compliance**: Provider implements `sendRequest` and `embed` methods
2. **Static Prefix**: Provider class has unique `static prefix` string
3. **Error Handling**: Uses consistent error messages
4. **Vision Support**: Implements `sendVisionRequest` if applicable
5. **Default Model**: Has sensible default model fallback
6. **Custom URL**: Supports custom baseURL if applicable

Example test for new provider:
```javascript
export async function testMyNewProvider() {
    console.log('[TEST] MyNewProvider - basic functionality');
    
    const { MyNewProvider } = await import('../../src/models/mynewprovider.js');
    
    // Test static prefix
    assert.equal(MyNewProvider.prefix, 'mynewapi', 'Should have correct prefix');
    
    // Test constructor
    const provider = new MyNewProvider('model-name', null, {});
    assert.ok(provider, 'Should create instance');
    
    // Test methods exist
    assert.ok(provider.sendRequest, 'Should have sendRequest');
    assert.ok(provider.embed, 'Should have embed');
    
    console.log('✓ MyNewProvider works correctly');
}
```

## Known Issues & Limitations

### Mock Mode Limitations
- Cannot test actual API responses
- Cannot verify rate limiting behavior
- Cannot test streaming functionality
- Cannot verify token counting

### Integration Test Requirements
To run full integration tests, set the following environment variables or `keys.json`:
```json
{
    "OPENAI_API_KEY": "sk-...",
    "ANTHROPIC_API_KEY": "sk-ant-...",
    "GEMINI_API_KEY": "...",
    "GROQCLOUD_API_KEY": "...",
    "XAI_API_KEY": "...",
    "MISTRAL_API_KEY": "...",
    "DEEPSEEK_API_KEY": "...",
    "QWEN_API_KEY": "...",
    "HUGGINGFACE_API_KEY": "...",
    "REPLICATE_API_KEY": "...",
    "CEREBRAS_API_KEY": "...",
    "HYPERBOLIC_API_KEY": "...",
    "MERCURY_API_KEY": "...",
    "GHLF_API_KEY": "...",
    "NOVITA_API_KEY": "...",
    "OPENROUTER_API_KEY": "..."
}
```

### Rate Limit Warnings
Integration tests may hit rate limits on free tiers:
- Groq: 30 requests/minute
- Qwen: 30 requests/second (embeddings)
- Gemini: Variable based on tier
- OpenAI: Varies by plan

## Test Philosophy

1. **Fail Fast**: Tests should fail immediately on critical errors
2. **Isolation**: Each test is independent and can run standalone
3. **Clarity**: Error messages should clearly indicate what failed and why
4. **Coverage**: Every public API should have at least one test
5. **Reliability**: Tests should not depend on external state or timing

## Continuous Integration

These tests are designed to run in CI/CD pipelines:
- Mock mode runs on every commit (no API keys needed)
- Integration tests run nightly with API keys from secrets
- Test failures block merges to main branch

## Contributing

When adding tests:
1. Follow existing naming conventions (`testFeatureName`)
2. Add descriptive console.log messages
3. Use strict assertions (import from 'assert')
4. Handle both success and failure cases
5. Update this README with new test descriptions
