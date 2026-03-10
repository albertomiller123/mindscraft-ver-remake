# TIER 2 Subsystem Tests

## Running Tests

### Individual test files:
```bash
node tests/tier2/world.test.js
node tests/tier2/mcdata.test.js
node tests/tier2/tasks.test.js
```

### All tests:
```bash
npm test  # (after adding test script to package.json)
```

## Test Coverage

### world.js Tests
- ✓ Null block filtering in getNearestBlocksWhere()
- ✓ Cache eviction to prevent memory leaks
- ✓ Null safety in getNearbyBlockTypes()

### mcdata.js Tests
- ✓ Recursive depth limiting (prevents stack overflow)
- ✓ Circular dependency detection
- ✓ Base item identification
- ✓ Missing ingredients calculation
- ✓ Leftover calculation

### tasks.js Tests
- ✓ Concurrent progress updates (race condition fix)
- ✓ Invalid JSON handling
- ✓ Item presence validation
- ✓ Hell's Kitchen agent-specific logic
- ✓ Task timeout handling

## Expected Output

Each test should print:
```
========== TIER 2 [FILE].JS TESTS ==========

[TEST] test_name - description
✓ test passed

========== RESULTS ==========
✓ Passed: N
✗ Failed: 0
Total: N
```

## Test Environment Requirements

- Node.js 18+
- No external dependencies required for unit tests
- Integration tests would require a running Minecraft server

## Known Limitations

1. **Mock Bots**: Tests use simplified mock bots, not full mineflayer instances
2. **No Integration Tests**: These are unit tests only, not full end-to-end
3. **File I/O**: Race condition tests are simplified simulations
4. **Recipe Data**: mcdata tests depend on minecraft-data being loaded

## Adding New Tests

1. Create test file in `tests/tier2/`
2. Follow the pattern:
   - Import assert
   - Export async test functions
   - Use descriptive console.log messages
   - Include runTests() function
   - Handle cleanup in finally blocks

3. Update this README with new test descriptions
