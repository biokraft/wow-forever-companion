// What the advisor may help with, given to both backends as part of the system prompt, and
// the line the welcome screen shows (overlay/index.html carries it as static markup).
export const ADVICE_RULES = 'Never give rotation advice or real-time combat calls (what to press, when to interrupt, where to stand during a fight). Help with leveling, quests, routes, gear, talents, professions and preparation only. If asked for live combat help, say this tool does not do that.';

// How the overlay companion offers reply chips (overlay/src/choices.js parses them), given to
// both overlay backends next to ADVICE_RULES. Terminal chats are never told this syntax.
export const CHOICES_RULES = 'Reply chips: when your answer ends with a question that has a few clear answers, you may offer them as chips the player clicks instead of typing. Put the block at the very end of the answer, with nothing after it: a line <choices> (or <choices multi> when the player may pick several), then 2 to 6 options, one per line, each a short plain-text answer of at most 40 characters, then a line </choices>. Use at most one block per answer, never for open questions, and not on every answer. The player can always type their own answer instead.';

export const AI_NOTICE = 'Answers come from an AI and can be wrong.';
