import { readFileSync } from 'fs';

let keys = {};
const keyAccessLog = new Map(); // Track failed access attempts
const MAX_FAILED_ATTEMPTS = 10;
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute

try {
    const data = readFileSync('./keys.json', 'utf8');
    keys = JSON.parse(data);
    // Validate keys structure
    if (typeof keys !== 'object' || keys === null) {
        console.warn('Invalid keys.json format. Defaulting to environment variables.');
        keys = {};
    }
} catch (err) {
    if (err.code !== 'ENOENT') {
        // Log non-file-not-found errors without exposing paths
        console.warn('Error loading keys.json. Defaulting to environment variables.');
    }
    keys = {};
}

/**
 * Check rate limiting for key access attempts
 * @private
 */
function checkRateLimit(name) {
    const now = Date.now();
    const record = keyAccessLog.get(name) || { count: 0, firstAttempt: now };
    
    // Reset if outside window
    if (now - record.firstAttempt > RATE_LIMIT_WINDOW_MS) {
        keyAccessLog.set(name, { count: 1, firstAttempt: now });
        return true;
    }
    
    record.count++;
    keyAccessLog.set(name, record);
    
    if (record.count > MAX_FAILED_ATTEMPTS) {
        console.error(`Rate limit exceeded for key access: ${name.substring(0, 10)}...`);
        return false;
    }
    return true;
}

/**
 * Sanitize key name for error messages
 * @private
 */
function sanitizeKeyName(name) {
    if (!name || typeof name !== 'string') return '[invalid]';
    // Only show first few chars to prevent enumeration
    return name.length > 10 ? name.substring(0, 10) + '...' : name;
}

/**
 * Get API key from keys.json or environment variables
 * @param {string} name - Key name (e.g., 'OPENAI_API_KEY')
 * @returns {string} The API key
 * @throws {Error} If key not found or rate limited
 */
export function getKey(name) {
    // Validate input
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        throw new Error('Invalid key name provided');
    }
    
    // Check rate limiting
    if (!checkRateLimit(name)) {
        throw new Error('Rate limit exceeded for key access. Please try again later.');
    }
    
    let key = keys[name];
    if (!key) {
        key = process.env[name];
    }
    
    if (!key || typeof key !== 'string' || key.trim().length === 0) {
        // Sanitized error: don't leak full key name in production logs
        const sanitized = process.env.NODE_ENV === 'production' ? 'API_KEY' : sanitizeKeyName(name);
        throw new Error(`API key not found or invalid: ${sanitized}`);
    }
    
    return key.trim();
}

/**
 * Check if API key exists without throwing
 * @param {string} name - Key name
 * @returns {boolean} True if key exists
 */
export function hasKey(name) {
    if (!name || typeof name !== 'string') {
        return false;
    }
    const key = keys[name] || process.env[name];
    return !!(key && typeof key === 'string' && key.trim().length > 0);
}
