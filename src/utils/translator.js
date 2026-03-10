import translate from 'google-translate-api-x';
import settings from '../agent/settings.js';

// Configuration
const MAX_MESSAGE_LENGTH = 5000; // Google Translate API limit
const ALLOWED_LANGUAGE_PATTERN = /^[a-z]{2,3}(-[A-Z]{2})?$/; // e.g., 'en', 'zh-CN'

/**
 * Sanitize and validate message input
 * @param {string} message - Input message
 * @returns {string} Sanitized message
 * @throws {Error} If input is invalid
 */
function sanitizeMessage(message) {
    if (!message || typeof message !== 'string') {
        throw new Error('Invalid message input: must be a non-empty string');
    }
    
    // Remove control characters (except newlines, tabs, carriage returns)
    const sanitized = message.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
    
    // Enforce length limit
    if (sanitized.length > MAX_MESSAGE_LENGTH) {
        throw new Error(`Message too long: ${sanitized.length} chars (max: ${MAX_MESSAGE_LENGTH})`);
    }
    
    return sanitized;
}

/**
 * Validate language code
 * @param {string} lang - Language code
 * @returns {boolean} True if valid
 */
function isValidLanguageCode(lang) {
    if (!lang || typeof lang !== 'string') return false;
    return ALLOWED_LANGUAGE_PATTERN.test(lang.toLowerCase());
}

/**
 * Translate message to user's preferred language
 * @param {string} message - Message to translate
 * @returns {Promise<string>} Translated message or original on error
 */
export async function handleTranslation(message) {
    let preferred_lang = String(settings.language || 'en').toLowerCase().trim();
    
    // Skip translation if English or invalid language
    if (!preferred_lang || preferred_lang === 'en' || preferred_lang === 'english') {
        return message;
    }
    
    // Validate language code format
    if (!isValidLanguageCode(preferred_lang)) {
        console.warn(`Invalid language code: ${preferred_lang}. Skipping translation.`);
        return message;
    }
    
    try {
        // Sanitize input
        const sanitized = sanitizeMessage(message);
        
        // Translate with timeout
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Translation timeout')), 5000)
        );
        
        const translationPromise = translate(sanitized, { to: preferred_lang });
        const translation = await Promise.race([translationPromise, timeoutPromise]);
        
        // Validate response
        if (translation && translation.text && typeof translation.text === 'string') {
            return translation.text;
        }
        
        console.warn('Invalid translation response, returning original');
        return message;
    } catch (error) {
        // Don't expose error details that might reveal API internals
        console.error('Translation failed:', error.message);
        return message;
    }
}

/**
 * Translate message to English
 * @param {string} message - Message to translate
 * @returns {Promise<string>} Translated message or original on error
 */
export async function handleEnglishTranslation(message) {
    let preferred_lang = String(settings.language || 'en').toLowerCase().trim();
    
    // Skip if already English
    if (!preferred_lang || preferred_lang === 'en' || preferred_lang === 'english') {
        return message;
    }
    
    try {
        // Sanitize input
        const sanitized = sanitizeMessage(message);
        
        // Translate with timeout
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Translation timeout')), 5000)
        );
        
        const translationPromise = translate(sanitized, { to: 'english' });
        const translation = await Promise.race([translationPromise, timeoutPromise]);
        
        // Validate response
        if (translation && translation.text && typeof translation.text === 'string') {
            return translation.text;
        }
        
        console.warn('Invalid translation response, returning original');
        return message;
    } catch (error) {
        console.error('Translation failed:', error.message);
        return message;
    }
}
