// The MCP tool catalog: name, description, JSON Schema and the operation each tool runs.
// Field names are the V3 public API's, so REST, CLI and MCP speak one vocabulary.
import { list as runList } from './list.mjs';
import * as ops from './operations.mjs';

const B2B = 'B2B only: work identities and companies. Personal mailboxes and phone numbers are held back on this machine and never sent.';
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const list = (description, extra = {}) => ({ type: 'array', items: { type: 'string' }, description, ...extra });
const maxCredits = { type: 'integer', minimum: 0, maximum: 100000, description: 'The most this call may charge. Never charged past it. Calls that could cost more than 10 credits are refused without it. Above 10 it must be a number of credits the user stated; never choose it for them.' };
const purpose = { type: 'string', enum: ['b2b_outbound', 'ad_audience', 'own_customer_enrichment', 'fraud_check'], description: 'Why you are asking. Defaults to b2b_outbound.' };

const identifiers = {
  type: 'object',
  description: 'What you know about the person or company. Any one strong identifier is enough: a work email, a LinkedIn profile URL, a name with a company, or a company domain.',
  properties: {
    email: str('Work email.'),
    linkedin_url: str('LinkedIn profile URL (linkedin.com/in/...).'),
    name: str('Full name. Needs a company or another identifier with it.'),
    company_name: str('Company name.'),
    company_domain: str('Company website domain, e.g. acme.io. A full URL is accepted.'),
  },
  additionalProperties: false,
};

const seniority = { description: 'Seniority, e.g. "director+", "vp", or a list like ["vp", "c_suite"].', anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] };
const paid = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const free = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

export const TOOLS = [
  {
    name: 'agentic_id_validate',
    title: 'Validate work emails',
    description: `Is this mailbox real? Each address comes back valid, invalid, catch-all (the server accepts everything, so not proven), unknown (no answer; free) or rejected (malformed, disposable or personal; free). 1 credit per valid, invalid or catch-all answer. Send many addresses in one call with "emails"; repeats are checked once. ${B2B}`,
    inputSchema: {
      type: 'object',
      properties: { email: str('One work email.'), emails: list('Several work emails in one call. Lists over 1,000 are sent in batches inside max_credits.'), domain: str('A company domain: is it live and does it take mail? Free.'), purpose, max_credits: maxCredits },
      additionalProperties: false,
    },
    annotations: paid,
    run: ops.validate,
  },
  {
    name: 'agentic_id_resolve',
    title: 'Resolve to an Agentic ID',
    description:
      'Turn a work email, LinkedIn profile URL, name plus company, or a company domain into one stable Agentic ID (ic-...). "confidence" is how sure the identifier points at this ID, not how verified its facts are (see agentic_id_facts). outcome says what happened: known (already in the ledger), new (just created), review (probably a match, not sure enough to link), conflict (the identifiers point at two different IDs; nothing was merged) or unresolvable (not enough to go on; free). 1 credit per ID returned, 0 for one your workspace already holds. Use the ID with enrich, facts and ledger.',
    inputSchema: {
      type: 'object',
      properties: {
        identifiers,
        // The same fields are accepted at the top level, since callers often send them flat.
        email: str('Work email (same as identifiers.email).'),
        linkedin_url: str('LinkedIn profile URL (same as identifiers.linkedin_url).'),
        name: str('Full name (same as identifiers.name).'),
        company_name: str('Company name (same as identifiers.company_name).'),
        company_domain: str('Company domain (same as identifiers.company_domain).'),
        domain: str('Company domain (same as identifiers.company_domain).'),
        kind: { type: 'string', enum: ['person', 'company'], description: 'Inferred when omitted: a person if any person field is given.' }, spend: { type: 'boolean', description: 'Ask paid sources when the ledger cannot resolve it. Default false.' }, purpose, max_credits: maxCredits },
      additionalProperties: false,
    },
    annotations: paid,
    run: ops.resolve,
  },
  {
    name: 'agentic_id_resolve_many',
    title: 'Resolve a list and find its duplicates',
    description:
      'Resolve up to 500 rows in one call (CRM export, event list, form fills). Rows that are the same lookup are paid once, and rows that resolve to the same Agentic ID are grouped in "same_id": that is the duplicate report. Rows with only personal data are skipped, not sent. Stops at max_credits and says which rows were not run. 1 credit per ID returned.',
    inputSchema: {
      type: 'object',
      properties: { records: { type: 'array', maxItems: 500, items: identifiers, description: 'One identifier object per row, in the order of the list.' }, kind: { type: 'string', enum: ['person', 'company'] }, spend: { type: 'boolean' }, purpose, max_credits: maxCredits },
      required: ['records'],
      additionalProperties: false,
    },
    annotations: paid,
    run: ops.resolveMany,
  },
  {
    name: 'agentic_id_enrich',
    title: 'Enrich a contact or company',
    description: `Fill in missing facts: title, company, work email, firmographics. Every value comes with its level: verified (proved by a direct check or something the person did), corroborated (independent sources agree), claimed (one source said so), contradicted (newer evidence disagrees). Only verified and corroborated values are safe to act on without a check. 2 credits per person enriched, 1 per company; nothing found, nothing charged. Contact values are masked unless the key may read them. ${B2B}`,
    inputSchema: {
      type: 'object',
      properties: {
        contact: identifiers,
        contacts: { type: 'array', items: identifiers, description: 'Several people in one call. Lists over 100 are sent in batches inside max_credits.' },
        company: { type: 'object', properties: { domain: str('Company domain.'), name: str('Company name.') }, additionalProperties: false },
        fields: list('Only these fields; leave out for everything. People: work_email, linkedin_url, title, seniority, company_name, company_domain, location, city, country. Companies: name, domain, linkedin_url, industry, employees, revenue_usd, country, city, founded, description.'),
        purpose,
        max_credits: maxCredits,
      },
      additionalProperties: false,
    },
    annotations: paid,
    run: ops.enrich,
  },
  {
    name: 'agentic_id_find',
    title: 'Find people inside a company',
    description:
      'People in a role at one known company. Give account.domain (or account.id) and roles (job titles) or a seniority. Former roles, advisors and board seats never count. People already delivered to this workspace are skipped, so calling again pages forward. 2 credits per person delivered. "excluded" says why candidates were left out; "rejected" lists filter values that could not be read.',
    inputSchema: {
      type: 'object',
      properties: {
        account: { type: 'object', properties: { id: str('The company\'s Agentic ID.'), domain: str('The company\'s domain.') }, additionalProperties: false },
        roles: list('Job titles, e.g. ["VP Marketing", "Head of Growth"].'),
        seniority,
        countries: list("Where the person is (not the company's HQ), as ISO codes, e.g. [\"GB\", \"US\"]."),
        limit: { type: 'integer', minimum: 1, maximum: 25, description: 'How many people. Default 5, max 25.' },
        exclude_seen: { type: 'boolean', description: 'Skip people already delivered to this workspace. Default true.' },
        purpose,
        max_credits: maxCredits,
      },
      required: ['account'],
      additionalProperties: false,
    },
    annotations: paid,
    run: ops.find,
  },
  {
    name: 'agentic_id_discover',
    title: 'Discover new companies and people',
    description:
      'Net-new companies that match account_filters, and optionally the people in them (contact_filters). Always run it first with count_only: true: that is free and says how many match and which source would be asked. Every company returned meets every filter, checked by Agentic ID itself, not taken on a provider\'s word. 1 credit per account delivered (an account whose size only one source confirms is delivered free) plus 2 per person. Filter values that could not be read come back in "rejected", never silently dropped.',
    inputSchema: {
      type: 'object',
      properties: {
        account_filters: {
          type: 'object',
          properties: {
            industry: list('Industries in plain words, e.g. ["software", "fintech"].'),
            country: list('ISO country codes, e.g. ["GB", "US"].'),
            employees_min: { type: 'integer', minimum: 1 },
            employees_max: { type: 'integer', minimum: 1 },
            technologies: list('Technologies the company uses, e.g. ["Snowflake"].'),
            keywords: list('Words in the company description. They rank results; they filter only with keywords_required.'),
            keywords_required: { type: 'boolean' },
          },
          additionalProperties: false,
        },
        contact_filters: {
          type: 'object',
          properties: {
            job_title: list('Titles, e.g. ["CTO"].'),
            job_level: seniority,
            countries: list('Where the person is, as ISO codes.'),
            per_account: { type: 'integer', minimum: 1, maximum: 10, description: 'People per company. Default 1.' },
            min_company_size: { type: 'integer', minimum: 1, description: 'Skip people at companies smaller than this.' },
          },
          additionalProperties: false,
        },
        max_accounts: { type: 'integer', minimum: 1, maximum: 500, description: 'How many companies. Default 25.' },
        exclude_seen: { type: 'boolean', description: 'Skip companies already delivered to this workspace. Default true.' },
        count_only: { type: 'boolean', description: 'Free: how many match and which source would be asked. Nothing is delivered.' },
        purpose,
        max_credits: maxCredits,
      },
      additionalProperties: false,
    },
    annotations: paid,
    run: ops.discover,
  },
  {
    name: 'agentic_id_lookalike',
    title: 'Find companies like these',
    description:
      'Give the domains of companies you want more of (your best customers). Agentic ID works out what they share (industry, size, country, technology), searches for more like them with the same checks as discover, never returns the seeds, and ranks the results by how alike they are, with the reasons. Read "profile" first: it is the search that was run. "bigger_than_seeds" warns when the list leans to famous companies. 1 credit per account delivered.',
    inputSchema: {
      type: 'object',
      properties: { seeds: list('1 to 50 company domains. Three or more of a similar kind give a usable profile.'), max_accounts: { type: 'integer', minimum: 1, maximum: 500, description: 'How many companies. Default 25.' }, exclude_seen: { type: 'boolean' }, purpose, max_credits: maxCredits },
      required: ['seeds'],
      additionalProperties: false,
    },
    annotations: paid,
    run: ops.lookalike,
  },
  {
    name: 'agentic_id_facts',
    title: 'Check what Agentic ID can prove',
    description:
      'For one Agentic ID: each fact\'s level (verified, corroborated, claimed, contradicted), the reason, how many independent sources stand behind it, when it needs re-checking, and whether the ID is a Verified ID (and what is missing if not). Use it before acting on a value: to decide whether an email is safe to send to, or whether a title is still current. Free.',
    inputSchema: { type: 'object', properties: { id: str('An Agentic ID (ic-...) from resolve, find or discover.') }, required: ['id'], additionalProperties: false },
    annotations: free,
    run: ops.facts,
  },
  {
    name: 'agentic_id_ledger',
    title: "Show an ID's history",
    description: 'Everything that ever happened to one Agentic ID (created, linked, merged, split), oldest first, each entry hash-linked to the one before, with the whole chain re-checked ("verified"). Use it to explain why two records are the same ID, or to audit a merge. Free.',
    inputSchema: { type: 'object', properties: { id: str('An Agentic ID (ic-...).') }, required: ['id'], additionalProperties: false },
    annotations: free,
    run: ops.ledger,
  },
  {
    name: 'agentic_id_workspace',
    title: 'Show the workspace and its credits',
    description:
      'The workspace this caller acts as: credits available and held, what was spent today and in the last 30 days by tool, the latest grants and charges, how many IDs it holds, and whether it contributes (identifiers it sends help everyone resolve) or is private. Use it for "how many credits do I have", "what did that cost", "why was I charged", and before any large job. Free.',
    inputSchema: { type: 'object', properties: { recent: { type: 'integer', minimum: 0, maximum: 200, description: 'How many of the latest grants and charges to list. Default 10.' } }, additionalProperties: false },
    annotations: free,
    run: ops.workspace,
  },
  {
    name: 'agentic_id_report',
    title: 'Report what happened to a value',
    description:
      'Tell Agentic ID the outcome after a value was used: bounced (the email bounced), replied (the person answered), wrong_person (it reached someone else), confirmed (your CRM confirms it). Only for IDs this workspace holds. A bounced or wrong-person value is no longer served to this workspace and counts against the source that supplied it; a reply or confirmation is proof for this workspace. Nothing reported is shown to another workspace. One report, or up to 200 in "reports". Free.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('The Agentic ID (ic-...) the value belongs to.'),
        field: { type: 'string', enum: ['work_email', 'title', 'company_domain'], description: 'Which value was used. Default work_email.' },
        outcome: { type: 'string', enum: ['bounced', 'replied', 'wrong_person', 'confirmed'] },
        reports: {
          type: 'array',
          maxItems: 200,
          description: 'Several reports in one call, in place of id / field / outcome.',
          items: { type: 'object', properties: { id: str('Agentic ID.'), field: { type: 'string', enum: ['work_email', 'title', 'company_domain'] }, outcome: { type: 'string', enum: ['bounced', 'replied', 'wrong_person', 'confirmed'] } }, required: ['id', 'outcome'], additionalProperties: false },
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    run: ops.report,
  },
  {
    name: 'agentic_id_list',
    title: 'Work a CSV file',
    description:
      'Run one action over a whole CSV file on disk: validate (adds email_verdict, email_reason), resolve (adds agentic_id, resolve_outcome, same_id_as_row: the duplicate report), enrich (adds one column per field plus its level) or report (sends outcomes from columns agentic_id, outcome[, field]; adds report_status). The rows are read and written by the plugin and never enter the conversation. Repeats are paid once; personal emails and phones never leave this machine. Always call it first with dry_run: true: that is free and gives the row count and the most it could cost; show the user, then call again with max_credits. The result is a new file next to the input, never the input itself.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['validate', 'resolve', 'enrich', 'report'] },
        file: str('Full path of the CSV file.'),
        out: str('Where to write the result (.csv). Default: next to the input, named <name>.agentic-id.csv.'),
        dry_run: { type: 'boolean', description: 'Free: count the rows and estimate the cost. Nothing is sent.' },
        max_credits: maxCredits,
        fields: list('enrich only: the fields to fill, e.g. ["title", "work_email"].'),
        column: str('The email column, when it cannot be found by its name.'),
        columns: { type: 'object', description: 'Column names, when they cannot be found by name.', properties: { email: str('Email column.'), linkedin: str('LinkedIn URL column.'), name: str('Full name column.'), company: str('Company name column.'), domain: str('Company domain column.') }, additionalProperties: false },
        limit_rows: { type: 'integer', minimum: 1, description: 'Only the first N rows.' },
        field: { type: 'string', enum: ['work_email', 'title', 'company_domain'], description: 'report only: the field every outcome is about, when the file has no field column.' },
        purpose,
      },
      required: ['action', 'file'],
      additionalProperties: false,
    },
    annotations: paid,
    run: runList,
  },
  {
    name: 'agentic_id_login',
    title: 'Sign in to Agentic ID',
    description:
      'Sign in with an iCustomer account, or sign out. Opens the sign-in page in the browser and returns at once with the link; nothing secret passes through the conversation. Call it again after the user has signed in to confirm. Use it when status says not signed in. Never ask the user for a password, a code or an API key. Free.',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['login', 'logout'], description: 'Default login.' } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    run: ops.signIn,
  },
  {
    name: 'agentic_id_estimate',
    title: 'Estimate a call before making it',
    description: 'What a planned call could cost at most, worked out on this machine without contacting Agentic ID. Give the tool name and the arguments you would send. Use it to show the user the arithmetic before any call over 10 credits. Free.',
    inputSchema: {
      type: 'object',
      properties: { tool: { type: 'string', enum: ['validate', 'resolve', 'resolve_many', 'enrich', 'find', 'discover', 'lookalike'], description: 'The tool you plan to call.' }, arguments: { type: 'object', description: 'The arguments you would pass to it.' } },
      required: ['tool'],
      additionalProperties: false,
    },
    annotations: { ...free, openWorldHint: false },
    run: ops.estimateCall,
  },
  {
    name: 'agentic_id_status',
    title: 'Check the Agentic ID connection',
    description: 'Is the plugin set up? Says which server it talks to, whether a key is configured, which workspace the key belongs to and whether contact values come back readable or masked. Call it first when another tool fails with an auth or connection error. Free.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: free,
    run: ops.status,
  },
];

export const byName = new Map(TOOLS.map((t) => [t.name, t]));
