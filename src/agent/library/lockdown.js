import 'ses';

// This sets up the secure environment
// We disable some of the taming to allow for more flexibility

// For configuration, see https://github.com/endojs/endo/blob/master/packages/ses/docs/lockdown.md

const sesLockdown = globalThis.lockdown;
let lockeddown = false;
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
    // allow eval outside of created compartments
    // (mineflayer dep "protodef" uses eval)
    evalTaming: 'unsafeEval',
  });
}

export function wrapWithInterruptCheck(bot, apiObject) {
  const wrapped = {};
  for (const [key, value] of Object.entries(apiObject)) {
    if (typeof value === 'function') {
      wrapped[key] = function (...args) {
        if (bot && bot.interrupt_code) {
          throw new Error('FORCED_INTERRUPT: Khẩn cấp, dừng lệnh LLM ngay lập tức!');
        }
        return value.apply(this, args);
      };
    } else if (typeof value === 'object' && value !== null) {
      wrapped[key] = wrapWithInterruptCheck(bot, value);
    } else {
      wrapped[key] = value;
    }
  }
  return wrapped;
}

export const makeCompartment = (bot, endowments = {}) => {
  // Wrap standard endowments (like skills and world) to enforce forced interruptions
  const wrappedEndowments = wrapWithInterruptCheck(bot, endowments);
  return new Compartment({
    // provide untamed Math, Date, etc
    Math,
    Date,
    // standard endowments
    ...wrappedEndowments
  });
}
