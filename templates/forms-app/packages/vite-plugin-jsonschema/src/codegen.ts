import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { transformJsonSchemaToZod } from './transform.ts';

export interface SchemaEntry {
    id: string;
    schema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
}

export function generateZodFile(entry: SchemaEntry, outputPath: string): string {
    const zodSource = transformJsonSchemaToZod(entry.schema as any);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, zodSource, 'utf-8');
    return zodSource;
}
