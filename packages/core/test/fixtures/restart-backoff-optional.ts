// Type-level fixture: RestartBackoffConfig should allow omitting the
// documented-default fields (initialMs/maxMs/factor), per their JSDoc defaults
// and the consumer's `?.x ?? default` read pattern.
import type { RestartBackoffConfig } from '../../src/types';

// All three fields omitted (consumer supplies defaults).
const empty: RestartBackoffConfig = {};

// Partial overrides must also be allowed.
const partial: RestartBackoffConfig = { factor: 3 };

export { empty, partial };
