/**
 * TIER 8: Configuration & Data - Validation Tests
 * Tests for profile loading, schema validation, and security
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { 
    sanitizeFilePath, 
    safeJsonParse, 
    validateProfile,
    safeProfileMerge,
    validateAgainstSpec
} from '../../src/utils/profile_validator.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DIR = path.join(__dirname, '../../tmp/test_profiles');

before(() => {
    // Create test directory
    mkdirSync(TEST_DIR, { recursive: true });
});

describe('TIER 8: Configuration & Data Validation', () => {
    
    describe('Path Sanitization', () => {
        it('should validate safe paths', () => {
            const result = sanitizeFilePath('./profiles/gpt.json');
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.error, null);
        });

        it('should reject path traversal attempts', () => {
            const result = sanitizeFilePath('../../../etc/passwd');
            assert.strictEqual(result.valid, false);
            assert.match(result.error, /traversal/i);
        });

        it('should reject home directory access', () => {
            const result = sanitizeFilePath('~/sensitive.json');
            assert.strictEqual(result.valid, false);
        });

        it('should reject empty paths', () => {
            const result = sanitizeFilePath('');
            assert.strictEqual(result.valid, false);
        });

        it('should reject non-string paths', () => {
            const result = sanitizeFilePath(null);
            assert.strictEqual(result.valid, false);
        });
    });

    describe('JSON Parsing Safety', () => {
        it('should parse valid JSON', () => {
            const result = safeJsonParse('{"name":"test"}', 'test.json');
            assert.strictEqual(result.success, true);
            assert.deepStrictEqual(result.data, { name: 'test' });
        });

        it('should handle malformed JSON gracefully', () => {
            const result = safeJsonParse('{invalid json}', 'bad.json');
            assert.strictEqual(result.success, false);
            assert.match(result.error, /parse error/i);
        });

        it('should reject non-string input', () => {
            const result = safeJsonParse(12345, 'number.json');
            assert.strictEqual(result.success, false);
        });
    });

    describe('Profile Structure Validation', () => {
        it('should validate correct profile', () => {
            const profile = { name: 'test_bot', modes: {} };
            const result = validateProfile(profile);
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.errors.length, 0);
        });

        it('should reject profile without name', () => {
            const profile = { modes: {} };
            const result = validateProfile(profile);
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('name')));
        });

        it('should reject non-object profile', () => {
            const result = validateProfile('not an object');
            assert.strictEqual(result.valid, false);
        });

        it('should detect prototype pollution attempt', () => {
            // Note: Using __proto__ in object literal doesn't create an own property,
            // it sets the prototype chain. This is actually safe behavior from JavaScript.
            // To test our validation, we create a JSON string that would have __proto__ as key
            const maliciousJson = '{"name":"malicious","__proto__":{"isAdmin":true}}';
            const parsed = JSON.parse(maliciousJson);
            
            // After JSON.parse, __proto__ IS an own property (this is the security risk)
            assert.ok(Object.hasOwn(parsed, '__proto__'), '__proto__ should be own property after JSON.parse');
            
            const result = validateProfile(parsed);
            assert.strictEqual(result.valid, false, 'Should reject profiles with __proto__ key');
            assert.ok(result.errors.some(e => e.includes('pollution')), 'Should mention pollution in errors');
        });
    });

    describe('Profile Merging Safety', () => {
        it('should merge profiles correctly', () => {
            const base = { a: 1, b: 2 };
            const override = { b: 3, c: 4 };
            const result = safeProfileMerge(base, override);
            
            assert.strictEqual(result.a, 1);
            assert.strictEqual(result.b, 3);
            assert.strictEqual(result.c, 4);
        });

        it('should prevent prototype pollution', () => {
            const base = {};
            const malicious = {
                __proto__: { isAdmin: true },
                constructor: { prototype: { isAdmin: true } }
            };
            
            const result = safeProfileMerge(base, malicious);
            
            // Should not have isAdmin on result or its prototype
            assert.strictEqual(result.isAdmin, undefined);
            assert.strictEqual(Object.prototype.isAdmin, undefined);
        });

        it('should deep merge nested objects', () => {
            const base = { modes: { a: true, b: false } };
            const override = { modes: { b: true, c: true } };
            const result = safeProfileMerge(base, override);
            
            assert.strictEqual(result.modes.a, true);
            assert.strictEqual(result.modes.b, true);
            assert.strictEqual(result.modes.c, true);
        });

        it('should handle null/undefined sources', () => {
            const base = { a: 1 };
            const result1 = safeProfileMerge(base, null);
            const result2 = safeProfileMerge(base, undefined);
            
            assert.deepStrictEqual(result1, base);
            assert.deepStrictEqual(result2, base);
        });
    });

    describe('Settings Spec Validation', () => {
        it('should validate required fields', () => {
            const spec = {
                name: { type: 'string', required: true },
                port: { type: 'number', required: false }
            };
            
            const data = { name: 'test' };
            const result = validateAgainstSpec(data, spec);
            assert.strictEqual(result.valid, true);
        });

        it('should detect missing required fields', () => {
            const spec = {
                name: { type: 'string', required: true }
            };
            
            const data = {};
            const result = validateAgainstSpec(data, spec);
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('name')));
        });

        it('should validate types', () => {
            const spec = {
                port: { type: 'number' },
                name: { type: 'string' }
            };
            
            const data = { port: 'not a number', name: 123 };
            const result = validateAgainstSpec(data, spec);
            assert.strictEqual(result.valid, false);
            assert.strictEqual(result.errors.length, 2);
        });

        it('should validate enum options', () => {
            const spec = {
                mode: { type: 'string', options: ['survival', 'creative'] }
            };
            
            const data = { mode: 'invalid' };
            const result = validateAgainstSpec(data, spec);
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('Allowed')));
        });
    });

    describe('Real Profile Files', () => {
        it('should load all default profiles without errors', () => {
            const profiles = [
                './profiles/defaults/_default.json',
                './profiles/defaults/survival.json',
                './profiles/defaults/assistant.json',
                './profiles/defaults/creative.json',
                './profiles/defaults/god_mode.json'
            ];

            for (const profilePath of profiles) {
                const pathResult = sanitizeFilePath(profilePath);
                assert.strictEqual(pathResult.valid, true, `Path validation failed for ${profilePath}`);
                
                const content = readFileSync(pathResult.sanitized, 'utf8');
                const jsonResult = safeJsonParse(content, profilePath);
                assert.strictEqual(jsonResult.success, true, `JSON parse failed for ${profilePath}`);
            }
        });

        it('should load individual agent profiles', () => {
            const profiles = [
                './profiles/gpt.json',
                './profiles/claude.json',
                './profiles/gemini.json'
            ];

            for (const profilePath of profiles) {
                const pathResult = sanitizeFilePath(profilePath);
                assert.strictEqual(pathResult.valid, true);
                
                const content = readFileSync(pathResult.sanitized, 'utf8');
                const jsonResult = safeJsonParse(content, profilePath);
                assert.strictEqual(jsonResult.success, true);
                
                const validation = validateProfile(jsonResult.data);
                assert.strictEqual(validation.valid, true, 
                    `Profile validation failed for ${profilePath}: ${validation.errors.join(', ')}`);
            }
        });

        it('should load task profiles', () => {
            const profiles = [
                './profiles/tasks/crafting_profile.json',
                './profiles/tasks/construction_profile.json',
                './profiles/tasks/cooking_profile.json'
            ];

            for (const profilePath of profiles) {
                try {
                    const pathResult = sanitizeFilePath(profilePath);
                    assert.strictEqual(pathResult.valid, true);
                    
                    const content = readFileSync(pathResult.sanitized, 'utf8');
                    const jsonResult = safeJsonParse(content, profilePath);
                    assert.strictEqual(jsonResult.success, true);
                } catch (err) {
                    assert.fail(`Failed to load ${profilePath}: ${err.message}`);
                }
            }
        });
    });

    describe('Settings Spec Schema', () => {
        it('should have valid settings_spec.json', () => {
            const specPath = sanitizeFilePath('./src/mindcraft/public/settings_spec.json');
            assert.strictEqual(specPath.valid, true);
            
            const content = readFileSync(specPath.sanitized, 'utf8');
            const jsonResult = safeJsonParse(content, 'settings_spec.json');
            assert.strictEqual(jsonResult.success, true);
            
            const spec = jsonResult.data;
            
            // Check all fields have type definitions
            for (const [key, field] of Object.entries(spec)) {
                assert.ok(field.type, `Field '${key}' missing type definition`);
            }
        });
    });
});
