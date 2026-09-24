# @iskra-bun/db-oracle

Soporte para Oracle Database en Iskra a traves de un puente/sidecar (IPC). Permite ejecutar consultas contra Oracle desde una app Iskra sin acoplar el cliente nativo al proceso principal.

## Instalacion

```bash
bun add @iskra-bun/db-oracle @iskra-bun/core oracledb
```

El puente corre con **Node.js** (`node` tiene que estar en el `PATH`) y usa `oracledb` (peer dependency).

## Uso rapido

```typescript
import { App } from '@iskra-bun/core'
import { OracleDriver } from '@iskra-bun/db-oracle'

// La conexion se configura por variables de entorno:
//   ORA_CONN (p. ej. "db-host:1521/FREEPDB1"), ORA_USER, ORA_PASSWORD
const oracle = new OracleDriver()
const app = new App({ name: 'mi-app' })
app.register(oracle)

await app.start() // falla si el puente no puede conectarse a Oracle

const rows = await oracle.query('SELECT * FROM users WHERE id = :1', [42])
```

`new OracleDriver(bridgePath?, timeoutMs = 30000, startTimeoutMs = 30000)`: `start()` espera a que el puente se conecte (o falla con el error de Oracle); cada consulta tiene su propio timeout. Si `ORA_CONN` no esta definida, el driver no arranca y lo avisa en el log.

## Estado

Experimental. Implementacion via puente/sidecar (protocolo request/response JSON sobre stdio con un proceso Node). Cada consulta se ejecuta con `autoCommit`, asi que todavia no hay transacciones; tampoco pooling de conexiones.

## Documentacion

Guia completa: [@iskra-bun/db-kit](https://iskra-docs.fly.dev/es/packages/db-kit/)

## Licencia

AGPL-3.0-or-later
