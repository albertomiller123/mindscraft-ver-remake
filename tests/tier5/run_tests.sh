#!/bin/bash
# Test runner for Tier 5 utilities

set -e

echo "========================================="
echo "TIER 5 UTILITIES TEST SUITE"
echo "========================================="
echo ""

FAILED=0

run_test() {
    local test_file=$1
    local test_name=$2
    
    echo "Running $test_name..."
    if node "$test_file"; then
        echo "✓ $test_name passed"
    else
        echo "✗ $test_name FAILED"
        FAILED=$((FAILED + 1))
    fi
    echo ""
}

# Run all tests
run_test "tests/tier5/math.test.js" "Math Utilities"
run_test "tests/tier5/text.test.js" "Text Utilities"
run_test "tests/tier5/keys.test.js" "Keys Management"
run_test "tests/tier5/translator.test.js" "Translator"
run_test "tests/tier5/examples.test.js" "Examples System"
run_test "tests/tier5/full_state.test.js" "Full State"

echo "========================================="
if [ $FAILED -eq 0 ]; then
    echo "✓ ALL TESTS PASSED"
    echo "========================================="
    exit 0
else
    echo "✗ $FAILED TEST SUITE(S) FAILED"
    echo "========================================="
    exit 1
fi
