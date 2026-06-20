import type { StorageConfig } from "./base";
import { BaseStorageAdapter } from "./base";
import { LocalStorageAdapter } from "./adapters/local";

/**
 * Crea e inicializa el adaptador de almacenamiento correcto segun la configuracion.
 * El adaptador de S3/MinIO se importa de forma lazy para evitar cargar el SDK de AWS
 * en entornos que solo usan almacenamiento local.
 */
export async function createStorageAdapter(
    config: StorageConfig
): Promise<BaseStorageAdapter> {
    if (config.adapter === "local") {
        return new LocalStorageAdapter(config);
    }

    if (config.adapter === "s3" || config.adapter === "minio") {
        const { S3StorageAdapter } = await import("./adapters/s3");
        return new S3StorageAdapter(config);
    }

    throw new Error(
        `Adaptador de almacenamiento no soportado: "${config.adapter}". Usa "local", "s3" o "minio".`
    );
}
