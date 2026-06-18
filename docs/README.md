# Iskra Framework — Documentacion

Bienvenido a la documentacion de Iskra, un framework modular basado en Bun para construir aplicaciones de alto rendimiento con arquitectura hexagonal.

## Indice

| Documento | Descripcion |
|-----------|-------------|
| [Arquitectura](./arquitectura.md) | Arquitectura hexagonal, capas, patrones de diseno |
| [Core](./core.md) | Clase `App`, ciclo de vida, eventos, DI, logger |
| [Web Kit](./web-kit.md) | Servidor HTTP con Hono, Kernel, Features |
| [DB Kit](./db-kit.md) | Base de datos con Drizzle ORM, drivers, migraciones |
| [Socket Kit](./socket-kit.md) | WebSocket nativo de Bun, router, broadcast |
| [KV Kit](./kv-kit.md) | Key-Value store con Redis y memoria |
| [Worker Kit](./worker-kit.md) | Cola de jobs con BullMQ |
| [Process Kit](./process-kit.md) | Gestion de procesos externos (Python, binarios) |
| [Configuracion](./configuracion.md) | Sistema de config con c12, Zod, variables de entorno |
| [Despliegue](./despliegue.md) | Docker, CI/CD con GitLab, ambientes |
| [Migraciones](./migraciones.md) | Sistema de migraciones con Drizzle Kit |
| [SDKs](./sdks.md) | Clientes para otros lenguajes (Java, Python, Go) |

## Inicio Rapido

```bash
# Clonar el repo
git clone <tu-repo> iskra-app
cd iskra-app

# Instalar dependencias
bun install

# Correr los tests
bun test

# Iniciar un template de ejemplo
cd templates/starter-app
bun run src/main.ts
```

## Requisitos

- **Bun** v1.0 o superior
- **Node.js** v18+ (para algunas dependencias nativas)
- **Redis** (para worker-kit y kv-kit con adapter redis)
