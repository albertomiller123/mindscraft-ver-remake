import { readFileSync } from 'fs';

let keys = {};
try {
    const data = readFileSync('./keys.json', 'utf8');
    keys = JSON.parse(data);
} catch (err) {
    console.warn('keys.json not found. Defaulting to environment variables.'); // still works with local models
}

export function getKey(name) {
    let key = keys[name];
    if (!key) {
        key = process.env[name];
    }
    if (!key) {
        // Sanitized error: don't leak key name in production logs
        const sanitized = process.env.NODE_ENV === 'production' ? 'API_KEY' : name;
        throw new Error(`API key "${sanitized}" not found in keys.json or environment variables!`);
    }
    // Validate key is non-empty string
    if (typeof key !== 'string' || key.trim().length === 0) {
        throw new Error('API key is invalid (empty or non-string)');
    }
    return key.trim();
}

export function hasKey(name) {
    return keys[name] || process.env[name];
}
