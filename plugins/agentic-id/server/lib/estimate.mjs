// What a call could cost at most, worked out on this machine, for free, before anything is sent.
// The server's `cost` block in each answer stays the authority; this is the plan, not the bill.
export const RATES = {
  validate: 1, // per address with a valid, invalid or catch-all answer; unknown and rejected are free
  resolve: 1, // per ID returned; 0 for an ID the workspace already holds while it contributes
  enrich_person: 2,
  enrich_company: 1,
  enrich_phone: 5,
  find: 2, // per person delivered
  discover_account: 1, // per account delivered; an account whose size only one source confirms is free
  lookalike_account: 1,
};

const n = (v, d) => (Number.isFinite(Number(v)) && v !== undefined && v !== null ? Number(v) : d);

/** { max_credits, arithmetic, free } for a tool name (validate, resolve, ...) and its arguments. */
export function estimate(tool, args = {}) {
  const free = (why) => ({ max_credits: 0, arithmetic: why, free: true });
  switch (tool) {
    case 'validate': {
      const emails = (args.emails?.length ?? 0) + (args.email ? 1 : 0);
      if (!emails) return free('a domain-only check is free');
      return { max_credits: emails * RATES.validate, arithmetic: `${emails} address${emails === 1 ? '' : 'es'} x ${RATES.validate}`, free: false };
    }
    case 'resolve':
      return { max_credits: RATES.resolve, arithmetic: `1 ID x ${RATES.resolve} (0 if your workspace already holds it)`, free: false };
    case 'resolve_many': {
      const rows = args.records?.length ?? 0;
      return { max_credits: rows * RATES.resolve, arithmetic: `${rows} rows x ${RATES.resolve} (repeats and IDs you hold are free)`, free: false };
    }
    case 'enrich': {
      // A "contact" that names only a company is enriched (and priced) as a company.
      const all = [...(Array.isArray(args.contacts) ? args.contacts : []), ...(args.contact ? [args.contact] : [])];
      const isCompanyOnly = (c) => c && typeof c === 'object' && !c.email && !c.work_email && !c.linkedin_url && !c.linkedin && !c.name && !c.full_name && !c.first_name && !c.last_name && (c.company_domain || c.company_name || c.domain || c.company || c.website);
      const companyContacts = all.filter(isCompanyOnly).length;
      const people = all.length - companyContacts;
      const companies = (args.company ? 1 : 0) + (Array.isArray(args.companies) ? args.companies.length : 0) + companyContacts;
      const phone = (args.fields ?? []).some((f) => /phone|mobile/i.test(f)) ? RATES.enrich_phone : 0;
      const parts = [];
      if (people) parts.push(`${people} ${people === 1 ? 'person' : 'people'} x ${RATES.enrich_person + phone}`);
      if (companies) parts.push(`${companies} ${companies === 1 ? 'company' : 'companies'} x ${RATES.enrich_company}`);
      return { max_credits: people * (RATES.enrich_person + phone) + companies * RATES.enrich_company, arithmetic: parts.join(' + ') || 'nothing to enrich', free: false, per_person: RATES.enrich_person + phone };
    }
    case 'find': {
      const limit = n(args.limit, 5);
      return { max_credits: limit * RATES.find, arithmetic: `up to ${limit} people x ${RATES.find}`, free: false };
    }
    case 'discover': {
      if (args.count_only) return free('count_only is free');
      const accounts = n(args.max_accounts, 25);
      const per = args.contact_filters ? n(args.contact_filters.per_account, 1) : 0;
      const people = accounts * per;
      return {
        max_credits: accounts * RATES.discover_account + people * RATES.find,
        arithmetic: `up to ${accounts} accounts x ${RATES.discover_account}${people ? ` + ${people} people x ${RATES.find}` : ''}`,
        free: false,
      };
    }
    case 'lookalike': {
      const accounts = n(args.max_accounts, 25);
      return { max_credits: accounts * RATES.lookalike_account, arithmetic: `up to ${accounts} accounts x ${RATES.lookalike_account}`, free: false };
    }
    case 'facts':
    case 'ledger':
    case 'status':
    case 'estimate':
      return free('always free');
    default:
      return undefined;
  }
}

/** Calls whose worst case is at or below this are capped at their estimate without asking. */
export const AUTO_CAP = 10;
