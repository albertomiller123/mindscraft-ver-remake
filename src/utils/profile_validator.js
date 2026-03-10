/**
 * Profile and Settings Validation Utility
 * Provides schema validation, path sanitization, and type checking for configuration files
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

/**
 * Sanitize and validate a file path to prevent path traversal attacks
 * @param {string} filepath - The path to validate
 * @param {string} baseDir - Base directory to restrict access to (default: project root)
 * @returns {{valid: boolean, sanitized: string|null, error: string|null}}
 */
export function sanitizeFilePath(filepath, baseDir = PROJECT_ROOT) {
    if (typeof filepath !== 'string' || !filepath.trim()) {
        return {
            valid: false,
            sanitized: null,
            error: 'Path must be a non-empty string'
        };
    }

    try {
        // Resolve to absolute path
        const resolvedPath = path.resolve(baseDir, filepath);
        
        // Check if resolved path is within the base directory
        if (!resolvedPath.startsWith(path.resolve(baseDir))) {
            return {
                valid: false,
                sanitized: null,
                error: `Path traversal detected: ${filepath} resolves outside base directory`
            };
        }

        // Check for suspicious patterns
        const suspiciousPatterns = [
            /\.\./,  // Parent directory
            /~\//,   // Home directory
            /^\/etc/, // System directories
            /^\/root/,
            /^C:\\Windows/i,
            /^C:\\Program Files/i
        ];

        for (const pattern of suspiciousPatterns) {
            if (pattern.test(filepath)) {
                return {
                    valid: false,
                    sanitized: null,
                    error: `Suspicious path pattern detected: ${filepath}`
                };
            }
        }

        return {
            valid: true,
            sanitized: resolvedPath,
            error: null
        };
    } catch (err) {
        return {
            valid: false,
            sanitized: null,
            error: `Path resolution error: ${err.message}`
        };
    }
}

/**
 * Validate JSON schema against settings_spec
 * @param {object} data - The data to validate
 * @param {object} spec - The specification schema
 * @returns {{valid: boolean, errors: Array<string>}}
 */
export function validateAgainstSpec(data, spec) {
    const errors = [];

    // Check required fields
    for (const [key, fieldSpec] of Object.entries(spec)) {
        if (fieldSpec.required && !(key in data)) {
            errors.push(`Missing required field: ${key}`);
        }
    }

    // Type checking
    for (const [key, value] of Object.entries(data)) {
        if (!(key in spec)) {
            // Unknown field - could warn but not error
            continue;
        }

        const fieldSpec = spec[key];
        const expectedType = fieldSpec.type;
        const actualType = Array.isArray(value) ? 'array' : typeof value;

        if (expectedType === 'number' && actualType !== 'number') {
            errors.push(`Field '${key}' should be ${expectedType}, got ${actualType}`);
        } else if (expectedType === 'string' && actualType !== 'string') {
            errors.push(`Field '${key}' should be ${expectedType}, got ${actualType}`);
        } else if (expectedType === 'boolean' && actualType !== 'boolean') {
            errors.push(`Field '${key}' should be ${expectedType}, got ${actualType}`);
        } else if (expectedType === 'array' && !Array.isArray(value)) {
            errors.push(`Field '${key}' should be ${expectedType}, got ${actualType}`);
        } else if (expectedType === 'object' && (actualType !== 'object' || Array.isArray(value))) {
            errors.push(`Field '${key}' should be ${expectedType}, got ${actualType}`);
        }

        // Check enum/options
        if (fieldSpec.options && !fieldSpec.options.includes(value)) {
            errors.push(`Field '${key}' has invalid value '${value}'. Allowed: ${fieldSpec.options.join(', ')}`);
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Safe JSON parsing with error handling
 * @param {string} jsonString - JSON string to parse
 * @param {string} source - Source identifier for error messages
 * @returns {{success: boolean, data: object|null, error: string|null}}
 */
export function safeJsonParse(jsonString, source = 'unknown') {
    if (typeof jsonString !== 'string') {
        return {
            success: false,
            data: null,
            error: `Expected string, got ${typeof jsonString}`
        };
    }

    try {
        const data = JSON.parse(jsonString);
        return {
            success: true,
            data,
            error: null
        };
    } catch (err) {
        return {
            success: false,
            data: null,
            error: `JSON parse error in ${source}: ${err.message}`
        };
    }
}

/**
 * Safely merge profile objects with prototype pollution protection
 * @param {object} target - Target object
 * @param {object} source - Source object to merge
 * @returns {object} Merged object
 */
export function safeProfileMerge(target, source) {
    if (!source || typeof source !== 'object') {
        return target;
    }

    const result = { ...target };

    for (const key of Object.keys(source)) {
        // Prevent prototype pollution
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            console.warn(`Skipping dangerous key in profile merge: ${key}`);
            continue;
        }

        // Only copy own properties
        if (!Object.prototype.hasOwnProperty.call(source, key)) {
            continue;
        }

        const value = source[key];

        // Deep merge for nested objects
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            result[key] = safeProfileMerge(result[key] || {}, value);
        } else {
            result[key] = value;
        }
    }

    return result;
}

/**
 * Validate a profile object structure
 * @param {object} profile - Profile to validate
 * @returns {{valid: boolean, errors: Array<string>}}
 */
export function validateProfile(profile) {
    const errors = [];

    if (!profile || typeof profile !== 'object') {
        return {
            valid: false,
            errors: ['Profile must be an object']
        };
    }

    // Required fields
    if (!profile.name || typeof profile.name !== 'string') {
        errors.push('Profile must have a valid "name" field');
    }

    // Check for dangerous content (only if explicitly set, not inherited)
    if (Object.prototype.hasOwnProperty.call(profile, '__proto__')) {
        errors.push('Profile contains prototype pollution attempt');
    }
    
    if (Object.prototype.hasOwnProperty.call(profile, 'constructor') && 
        profile.constructor !== Object && 
        typeof profile.constructor === 'object' &&
        Object.prototype.hasOwnProperty.call(profile.constructor, 'prototype')) {
        errors.push('Profile contains prototype pollution attempt');
    }

    // Validate modes if present
    if (profile.modes && typeof profile.modes !== 'object') {
        errors.push('Profile "modes" must be an object');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Add schema version to profile if missing
 * @param {object} profile - Profile object
 * @param {string} version - Version string (default: '1.0.0')
 * @returns {object} Profile with version
 */
export function addProfileVersion(profile, version = '1.0.0') {
    if (!profile.schema_version) {
        profile.schema_version = version;
    }
    return profile;
}
