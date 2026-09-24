export {
    scaffold,
    listTemplates,
    isEmptyDir,
    rewritePackageJson,
    WORKSPACE_REPLACEMENT_RANGE,
    EXCLUDED_ENTRIES,
} from './scaffold.ts';
export type { ScaffoldOptions, ScaffoldResult } from './scaffold.ts';
export { parseArgs, run } from './cli.ts';
export type { ParsedArgs } from './cli.ts';
