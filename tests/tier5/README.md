# Tier 5 Tests - Utilities & Helpers

## Overview
Comprehensive test suite for Tier 5 utilities covering math, text, keys, translator, examples, lockdown, full_state, and skill_library.

## Prerequisites

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Setup
For keys tests, set test environment variables:
```bash
export TEST_KEY=test_value_123
```

## Running Tests

### Run All Tests
```bash
bash tests/tier5/run_tests.sh
```

### Run Individual Tests
```bash
# Math utilities
node tests/tier5/math.test.js

# Text utilities
node tests/tier5/text.test.js

# Keys management
node tests/tier5/keys.test.js

# Translator (requires google-translate-api-x)
node tests/tier5/translator.test.js

# Examples system
node tests/tier5/examples.test.js

# Full state (requires mineflayer dependencies)
node tests/tier5/full_state.test.js
```

## Test Coverage

### ✅ Fully Tested (No External Dependencies)
- **math.js**: 13 tests covering cosine similarity edge cases
- **text.js**: 21 tests covering word overlap, Jaccard index, and turn formatting
- **keys.js**: 14 tests covering validation, rate limiting, and security
- **examples.js**: 19 tests covering embeddings, caching, and race conditions

### ⚠️ Requires Dependencies
- **translator.js**: Requires `google-translate-api-x` package
- **full_state.js**: Requires `mineflayer-pathfinder` and related packages
- **skill_library.js**: Requires full dependency chain
- **lockdown.js**: Integration tests require SES environment

## Expected Output

### Success (All Tests Pass)
```
=========================================
TIER 5 UTILITIES TEST SUITE
=========================================

Running Math Utilities...
✓ Math Utilities passed

Running Text Utilities...
✓ Text Utilities passed

... (more tests)

=========================================
✓ ALL TESTS PASSED
=========================================
```

### With Dependencies Missing
Some tests will be skipped if dependencies are not installed. Install via:
```bash
npm install
```

## Test Environment

- **Node.js**: v18+ recommended (for structuredClone support)
- **Type**: ES Modules
- **Test Framework**: Native Node.js assertions (no external framework)

## Known Issues

1. **translator.test.js**: Will fail without API key or network access
2. **full_state.test.js**: Requires full mineflayer stack
3. **Rate limiting tests**: Use short time windows for fast execution

## CI/CD Integration

To run in CI:
```bash
#!/bin/bash
npm install
export TEST_KEY=test_value_123
bash tests/tier5/run_tests.sh || exit 1
```

## Adding New Tests

1. Create `tests/tier5/<module>.test.js`
2. Follow existing test structure:
   - Import module
   - Define test() helper
   - Use strict assertions
   - Run tests async
3. Add to `run_tests.sh`
4. Document in this README
