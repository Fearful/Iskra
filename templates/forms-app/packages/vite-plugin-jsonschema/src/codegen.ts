import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { transformJsonSchemaToZod, type JsonSchema } from './transform.ts';

export interface SchemaEntry {
    id: string;
    schema: JsonSchema;
}

export function generateZodFile(entry: SchemaEntry, outputPath: string): string {
    const zodSource = transformJsonSchemaToZod(entry.schema);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, zodSource, 'utf-8');
    return zodSource;
}
