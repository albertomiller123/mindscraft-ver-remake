import 'ses';

// This sets up the secure environment
// We disable some of the taming to allow for more flexibility

// For configuration, see https://github.com/endojs/endo/blob/master/packages/ses/docs/lockdown.md

const sesLockdown = globalThis.lockdown;
let lockeddown = false;

/**
 * Initialize SES lockdown with security hardening
 * WARNING: evalTaming is 'unsafeEval' due to mineflayer dependency (protodef)
 * This means eval() is available in the global scope but NOT in compartments
 */
export function lockdown() {
  if (lockeddown) return;
  if (typeof sesLockdown !== 'function') {
    throw new Error('SES lockdown is not available.');
  }
  lockeddown = true;
  sesLockdown({
    // basic devex and quality of life improvements
    localeTaming: 'unsafe',
    consoleTaming: 'unsafe',
    errorTaming: 'unsafe',
    stackFiltering: 'verbose',
    // SECURITY RISK: allow eval outside of created compartments
    // Required by mineflayer dependency "protodef" which uses eval
    // Compartments still cannot use eval due to separate global scope
    evalTaming: 'unsafeEval',
  });
}

/**
 * Wrap API object with interrupt checks and prototype pollution protection
 * @param {Object} bot - Bot instance with interrupt_code flag
 * @param {Object} apiObject - Object to wrap (skills, world, etc.)
 * @returns {Object} Wrapped object with security hardening
 */
export function wrapWithInterruptCheck(bot, apiObject) {
  if (!apiObject || typeof apiObject !== 'object') {
    return apiObject;
  }
  
  // Prevent prototype pollution attacks
  const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];
  
  const wrapped = {};
  for (const [key, value] of Object.entries(apiObject)) {
    // Block dangerous prototype properties
    if (FORBIDDEN_KEYS.includes(key)) {
      console.warn(`Blocked attempt to wrap forbidden key: ${key}`);
      continue;
    }
    
    if (typeof value === 'function') {
      wrapped[key] = function (...args) {
        // Check for forced interrupt
        if (bot && bot.interrupt_code) {
          throw new Error('FORCED_INTERRUPT: Khẩn cấp, dừng lệnh LLM ngay lập tức!');
        }
        return value.apply(this, args);
      };
      // Preserve function name for debugging
      Object.defineProperty(wrapped[key], 'name', { value: key });
    } else if (typeof value === 'object' && value !== null) {
      // Recursively wrap nested objects
      wrapped[key] = wrapWithInterruptCheck(bot, value);
    } else {
      // Primitive values
      wrapped[key] = value;
    }
  }
  
  // Freeze the wrapped object to prevent modifications
  return Object.freeze(wrapped);
}

/**
 * Create a hardened Compartment for LLM code execution
 * @param {Object} bot - Bot instance
 * @param {Object} endowments - Additional globals to provide (skills, world, etc.)
 * @returns {Compartment} Secure compartment instance
 */
export const makeCompartment = (bot, endowments = {}) => {
  // Wrap standard endowments (like skills and world) to enforce forced interruptions
  const wrappedEndowments = wrapWithInterruptCheck(bot, endowments);
  
  // Create safer versions of Math and Date
  const safeMath = Object.freeze({ ...Math });
  const safeDate = {
    now: Date.now.bind(Date),
    // Don't expose Date constructor to prevent timing attacks
  };
  
  return new Compartment({
    // Provide tamed Math and Date
    Math: safeMath,
    Date: Object.freeze(safeDate),
    // Standard endowments (wrapped)
    ...wrappedEndowments,
    // Additional security: block eval in compartment
    // (even though evalTaming is 'unsafeEval' in global scope)
    eval: undefined,
    Function: undefined,
  });
}
