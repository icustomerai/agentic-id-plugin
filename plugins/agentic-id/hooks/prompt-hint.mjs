#!/usr/bin/env node
// UserPromptSubmit hook: when a prompt looks like a company, people, list or credits question,
// add one short reminder that this plugin answers it. In sessions with many tools installed the
// plugin's tools are loaded on demand and its instructions may not be in view, and Claude then
// answers from memory: an invented list, a guessed count, "you spent nothing".
//
// It reads the prompt only to match words; it writes nothing, logs nothing and sends nothing.
const TOPIC = /\b(compan(y|ies)|accounts?|leads?|prospects?|contacts?|decision[- ]makers?|buying (group|committee)|lookalikes?|icp|enrich|de-?dup|duplicates?|csv|list of|work emails?|email addresses?|bounced?|mailbox|linkedin|domain|credits?|spen[dt]|charged?|agentic[ -]?id|workspace|sign(ed)? (me )?(in|out)|log ?in)\b|[a-z0-9-]+\.(com|io|co|ai|net|org|de|uk|so|dev)\b/i;
const DATA_VERB = /\b(find|get|give|list|how many|identify|who (is|are)|look ?up|resolve|check|verify|validate|clean|build|count|what did i|how much|sign|log)\b/i;

export function hintFor(prompt) {
  if (typeof prompt !== 'string' || prompt.length > 20_000) return null;
  if (!TOPIC.test(prompt) || !DATA_VERB.test(prompt)) return null;
  return [
    'The Agentic ID plugin is installed. If this request is about identifying or counting companies or people, checking emails, building or cleaning a list, credits or spend, or signing in, use its tools (search your tools for "agentic_id"; load them if they are deferred). Do not answer such a request from memory: a company list or count you were not given by a tool is invented.',
    'Credits and "what did I spend / on what": agentic_id_workspace (the server record), never the local log alone.',
    'Above 10 credits the user must have stated a number of credits; otherwise show the free count or estimate and ask.',
    'If the request is about something else, ignore this note.',
  ].join(' ');
}

async function main() {
  try {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const hint = hintFor(payload.prompt);
    if (hint) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: hint } }));
  } catch {
    /* never get in the way of a prompt */
  }
}

if (process.argv[1]?.endsWith('prompt-hint.mjs')) await main();
