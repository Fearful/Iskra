#!/usr/bin/env bun
/**
 * iskra-parity: compares a service and its replacement on a list of requests.
 *
 *   iskra-parity --legacy http://old:8080 --candidate http://new:3000 cases.json
 *   iskra-parity --legacy … --candidate … --har capture.har --ignore '$.timestamp' --mode exact --go-html-escape
 *
 * cases.json is an array of `{ name?, method?, path, headers?, body? }`. Exits
 * 1 when any case differs.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { casesFromHar, compareAll, formatReport, type ParityCase } from './parity';

const { values, positionals } = parseArgs({
    options: {
        legacy: { type: 'string' },
        candidate: { type: 'string' },
        har: { type: 'string' },
        mode: { type: 'string', default: 'json' },
        ignore: { type: 'string', multiple: true },
        header: { type: 'string', multiple: true },
        'request-header': { type: 'string', multiple: true },
        'go-html-escape': { type: 'boolean', default: false },
        'allow-write': { type: 'boolean', default: false },
    },
    allowPositionals: true,
});

if (!values.legacy || !values.candidate || (!values.har && positionals.length === 0)) {
    process.stderr.write('usage: iskra-parity --legacy URL --candidate URL (cases.json | --har file.har)\n');
    process.exit(2);
}

const cases: ParityCase[] = values.har
    ? casesFromHar(JSON.parse(readFileSync(values.har, 'utf8')))
    : (JSON.parse(readFileSync(positionals[0]!, 'utf8')) as ParityCase[]);

const results = await compareAll(cases, {
    legacy: values.legacy,
    candidate: values.candidate,
    mode: values.mode === 'exact' ? 'exact' : 'json',
    ignorePaths: values.ignore,
    ...(values.header ? { headers: values.header } : {}),
    requestHeaders: Object.fromEntries(
        (values['request-header'] ?? []).map((h) => {
            const i = h.indexOf(':');
            return [h.slice(0, i).trim(), h.slice(i + 1).trim()];
        }),
    ),
    goHtmlEscape: values['go-html-escape'],
    allowWrite: values['allow-write'],
});

process.stdout.write(`${formatReport(results)}\n`);
process.exit(results.every((r) => r.equal) ? 0 : 1);
