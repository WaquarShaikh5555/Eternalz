'use strict';

/**
 * Open-ended visual requests need a direction and an exact preview. A model
 * should not turn words such as "improve the look" into an arbitrary channel
 * name and immediately execute it.
 */

const DESIGN_OPTIONS = Object.freeze([
  Object.freeze({
    id: 'minimal',
    label: 'Clean & minimal',
    emoji: '✨',
    description: 'Simple names, tidy categories and a restrained colour palette.',
    prompt: 'Use a clean, minimal visual direction with readable names, tidy categories and restrained colours.',
  }),
  Object.freeze({
    id: 'community',
    label: 'Welcoming community',
    emoji: '💬',
    description: 'Friendly navigation and a warm, approachable community style.',
    prompt: 'Use a welcoming community direction with clear navigation, friendly naming and warm accessible colours.',
  }),
  Object.freeze({
    id: 'gaming',
    label: 'Gaming & esports',
    emoji: '🎮',
    description: 'Energetic but readable styling suited to gaming communities.',
    prompt: 'Use an energetic gaming/esports direction while keeping names readable and avoiding clutter.',
  }),
]);

function isOpenEndedDesignRequest(prompt) {
  const text = String(prompt || '').trim().split(/\r?\n/, 1)[0].trim();
  if (!text || text.length > 500) return false;
  if (/^(?:please\s+)?(?:improve|redesign|revamp|beautify|organize|organise)(?:\s+the)?\s+server[.!?]*$/i.test(text)) {
    return true;
  }
  if (/^(?:make|improve)\s+(?:the\s+)?server\s+better[.!?]*$/i.test(text)) return true;
  const freeChoice = /\b(?:change|do|make)\s+(?:whatever|anything)\s+you\s+want\b/i.test(text);
  if (freeChoice) return true;
  const explicitTarget = /<[#@][^>]+>|\b(?:rename|renaming|create|creating|delete|deleting|set|setting|change|changing)\b[^.!?\n]*\bto\s+\S+/i.test(text);
  if (explicitTarget) return false;

  const visual = /\b(?:looks?|appearance|aesthetic|design|layout|theme|style|visual|beautif\w*)\b/i.test(text);
  const broad = /\b(?:server|overall|everything|anything|whatever)\b/i.test(text);
  const openAction = /\b(?:improv\w*|redesign|revamp|refresh|change|make|better|whatever)\b/i.test(text);
  return visual && broad && openAction;
}

function getDesignOption(id) {
  return DESIGN_OPTIONS.find((option) => option.id === id) || null;
}

function applyDesignChoice(prompt, optionId) {
  const option = getDesignOption(optionId);
  if (!option) throw new Error('Unknown design direction.');
  return [
    String(prompt || '').trim(),
    '',
    `Design direction selected by the administrator: ${option.label}. ${option.prompt}`,
    'Use the current server entities and their existing purposes as anchors. Never use instruction wording (for example "look improving") as a resource name. Suggest a small coherent set of useful changes; do not make an arbitrary cosmetic rename merely to produce an action.',
  ].join('\n');
}

/** Reject the observed low-value model behaviour before it can be executed. */
function designPlanProblem(actions = []) {
  for (const action of actions) {
    const name = action.args?.name;
    if (typeof name !== 'string') continue;
    const normalised = name.toLowerCase().replace(/[_-]+/g, ' ');
    if (/\b(?:look(?:s)?\s+improv\w*|improv\w*\s+(?:the\s+)?looks?|change\s+whatever|make\s+(?:it\s+)?better|overall\s+looks?)\b/.test(normalised)
        || /^(?:look|looks|improve|improving|improvement|better|overall|change|whatever|server)(?:\s+(?:look|looks|improve|improving|improvement|better|overall|change|whatever|server))*$/.test(normalised)) {
      return `The proposed name "${name}" repeats the instruction instead of describing a useful server entity.`;
    }
  }
  return null;
}

module.exports = {
  DESIGN_OPTIONS,
  isOpenEndedDesignRequest,
  getDesignOption,
  applyDesignChoice,
  designPlanProblem,
};
