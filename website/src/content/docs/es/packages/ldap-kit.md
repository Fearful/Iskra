---
title: LDAP Kit
description: Logins, usuarios, grupos anidados y cambios de LDAP y Active Directory, con un gate para web-kit.
---

:::caution[Experimental]
`@iskra-bun/ldap-kit` está en `0.x` y puede cambiar en una versión minor (ver [VERSIONING.md](https://github.com/fearful/iskra/blob/main/VERSIONING.md)). Su suite de conformidad corre en CI contra OpenLDAP; el comportamiento de Active Directory (motivos, grupos anidados en una búsqueda, USNs) se prueba contra respuestas grabadas, no contra un controlador de dominio.
:::

LDAP para Iskra, Active Directory primero: verificar un login y contraseña, leer usuarios y sus grupos (anidados incluidos), buscar página por página y leer qué cambió. Habla LDAP con [ldapts](https://github.com/ldapts/ldapts) detrás de una interfaz propia, `LdapTransport`: su API nunca muestra los tipos de ldapts, así que el cliente se puede reemplazar sin cambiar la tuya.

```bash
bun add @iskra-bun/ldap-kit
```

## Inicio rápido

```typescript
import { LdapDirectory } from '@iskra-bun/ldap-kit';

const ldap = new LdapDirectory({
    url: ['ldaps://dc1.corp.example.com', 'ldaps://dc2.corp.example.com'],
    baseDN: 'DC=corp,DC=example,DC=com',
    bindDN: 'svc-app@corp.example.com',
    bindPassword: process.env.LDAP_PASSWORD!,
    tls: { ca: await Bun.file('/etc/ssl/corp-ca.pem').text() },
});

const result = await ldap.authenticate(login, password, { groups: 'nested' });
if (!result.ok) {
    logger.warn('login rechazado', { login, reason: result.reason }); // nunca le digas al cliente por qué
    return c.json({ error: 'Invalid credentials' }, 401);
}
result.user; // { dn, username, email, displayName, id, sid, memberOf, groups, disabled, locked, expiresAt, entry }
```

Cada llamada abre una conexión, hace bind con la cuenta de servicio y la cierra al terminar; `url` es una lista que se prueba en orden cuando un servidor no responde (uno que responde, aunque sea con un error, no se saltea).

## Logins

`authenticate(login, password)` busca al usuario con la cuenta de servicio (exactamente una coincidencia: ninguna es `user_not_found`, varias `ambiguous_user`) y después hace bind como ese usuario con la contraseña.

- Un login rechazado es `{ ok: false, reason }`, no una excepción: `invalid_credentials`, `user_not_found`, `ambiguous_user`, `empty_password`, y según la respuesta de Active Directory `account_disabled`, `account_locked`, `account_expired`, `password_expired`, `password_must_change`, `logon_not_permitted`. El motivo es para logs y métricas: decirle al cliente cuál es le dice a un atacante qué cuentas existen.
- Una **contraseña vacía se rechaza sin preguntarle al servidor**: los servidores LDAP la toman como un bind anónimo y responden éxito.
- El login entra al filtro escapado (RFC 4515), así que `*)(uid=*` solo coincide consigo mismo. En AD un login `DOMINIO\usuario` se toma como `usuario`, y el usuario se busca por `sAMAccountName` o `userPrincipalName`; `users.filter` lo cambia (`{login}` es el login escapado).
- `{ groups: 'direct' | 'nested' }` también lee los grupos del usuario, con la cuenta de servicio (el usuario puede no tener permiso).
- Un directorio inalcanzable, un timeout o una cuenta de servicio rechazada lanzan `LdapError` (abajo).

## Usuarios y grupos

```typescript
await ldap.findUser('ana');                 // LdapUser | null
await ldap.findUserByDN(dn);                // LdapUser | null
await ldap.groupsOf(user);                  // anidados por defecto
await ldap.groupsOf(user, { nested: false });
```

Active Directory resuelve los grupos anidados en una búsqueda (`LDAP_MATCHING_RULE_IN_CHAIN`); en otros servidores `groupsOf()` los sigue nivel por nivel (`member` y `uniqueMember`), ciclos incluidos, hasta 16 niveles. Un grupo es `{ dn, name, id, sid, entry }`.

Un `LdapUser` tiene `dn`, `username` (`sAMAccountName` o `uid`), `userPrincipalName`, `displayName`, `email`, `givenName`, `surname`, `id` (`objectGUID` o `entryUUID`: no cambia al renombrarlo), `sid`, `memberOf`, `disabled` (userAccountControl), `locked` (`lockoutTime` o el `pwdAccountLockedTime` de ppolicy), `expiresAt` (`accountExpires`, null si no vence) y `entry`, con cada atributo leído. `users.attributes` lee más (`employeeID`, `department`), `users.binaryAttributes` nombra los binarios.

## Búsquedas y entradas

```typescript
import { ldapFilter } from '@iskra-bun/ldap-kit';

const people = await ldap.search({ filter: ldapFilter`(&(objectClass=user)(department=${dept}))`, attributes: ['cn', 'mail'] });
for await (const page of ldap.searchPages({ filter: '(objectClass=user)' })) {
    // 500 entradas por vez (el control de resultados paginados; `pageSize` lo cambia)
}
```

`ldapFilter` escapa los valores que interpola; `escapeFilterValue()` y `escapeDnValue()` (RFC 4514) escapan uno. Un `LdapEntry` lee atributos por nombre sin importar mayúsculas: `get()`, `getAll()`, `bytes()`, `number()`, `bigint()`, `guid()`, `sid()` y `date()` (GeneralizedTime o FILETIME, null para "nunca"). `objectGUID` y `objectSid` se leen como bytes; se exportan `decodeGuid`, `encodeGuid`, `decodeSid`, `decodeFileTime`, `decodeGeneralizedTime`, `decodeAccountControl` y `filterBytes` (para buscar por GUID).

## Cambios

```typescript
let mark = { usn: await store.get('ldap-usn') ?? 0 };
const { entries, next } = await ldap.changesSince(mark);
await store.set('ldap-usn', next.usn);
```

En Active Directory conviene un USN: `changesSince({ usn })` devuelve los usuarios con un `uSNChanged` mayor y la marca de la próxima llamada, el `highestCommittedUSN` del servidor leído antes de la búsqueda, así un cambio hecho mientras tanto vuelve a venir en vez de perderse. Los USN son de un controlador de dominio: lee los cambios de una sola `url`. `changesSince({ date })` compara `whenChanged` (AD) o `modifyTimestamp` (OpenLDAP) con el reloj de la app. `filter` lee otros objetos (`(objectClass=group)`). Los objetos borrados no se devuelven.

## Salud

```typescript
new HealthCheckFeature({ checks: { ldap: ldap.healthCheck() } });
```

`ping()` se conecta, hace bind con la cuenta de servicio y lee el root DSE: `{ url, latencyMs, rootDSE }`. `healthCheck()` lo envuelve para el HealthCheckFeature de web-kit: `ok` con la url y la latencia, `error` con lo que falló.

## Gate para web-kit

```typescript
import { anyOf, jwt, requireActor } from '@iskra-bun/web-kit';
import { ldapPassword } from '@iskra-bun/ldap-kit/web';

app.use('/api/*', requireActor(anyOf(jwt({ jwksUri }), ldapPassword(ldap, { groups: 'nested' }))));
// c.var.actor: { kind: 'user', id: 'ana', dn, guid, email, displayName, groups: ['devs', …] }
```

`ldapPassword(ldap)` es un [gate](/es/packages/web-kit/#gates-quién-hizo-el-request) que lee credenciales HTTP Basic (o las que devuelva `credentials(c)`) y las verifica con `authenticate()`. Todo rechazo es el mismo 401 con el desafío `Basic`; un directorio inalcanzable es un 503, que `anyOf` no oculta. Pon un rate limit en las rutas que protege: cada intento es un bind, y Active Directory bloquea una cuenta después de su umbral de intentos fallidos. En el spec de OpenAPIFeature declara HTTP Basic.

## Errores

`LdapError` (un `IskraError`) tiene el código con el que responde el contrato de web-kit: `SERVICE_UNAVAILABLE` (503) cuando ninguna `url` responde o falla TLS, `TIMEOUT` (504) después de `timeoutMs` (la conexión se cierra), `CONFIG_INVALID` (500) cuando el directorio rechaza la cuenta de servicio, `INTERNAL_ERROR` para otra operación rechazada, con su `resultCode`. El error original es `cause`.

## Configuración

| Campo | Default | |
| --- | --- | --- |
| `url` | | Una URL o una lista, en orden. |
| `baseDN` | | Dónde se buscan usuarios y grupos. |
| `bindDN`, `bindPassword` | | La cuenta de servicio (un DN, o un UPN en AD). Ambos obligatorios: una contraseña vacía es un bind anónimo. |
| `directory` | `'activeDirectory'` | `'openldap'` para los filtros y atributos de OpenLDAP (`uid`, `groupOfNames`, `entryUUID`). |
| `startTLS`, `tls` | `false` | StartTLS en `ldap://`; `tls` (`ca`, `servername`…) para él y para `ldaps://`. |
| `connectTimeoutMs`, `timeoutMs` | 5000, 10000 | Por conexión y por operación. |
| `pageSize` | 500 | Entradas por página. |
| `users` | | `base`, `filter` (con `{login}`), `attributes`, `binaryAttributes`. |
| `groups` | | `base`. |
| `transport` | ldapts | Una fábrica de `LdapTransport` (`bind`, `search` paginado, `close`). |

## Transporte

`LdapTransport` es el contrato entre ldap-kit y un cliente LDAP: `bind(dn, password)`, `search(base, { scope, filter, attributes, binaryAttributes, pageSize, sizeLimit })` que entrega páginas de `{ dn, attributes }`, y `close()`, con `LdapResultError` (el código de resultado del servidor) y `LdapTimeoutError` como errores. `ldaptsTransport` es el default. La suite de conformidad (`test/ldap.integration.test.ts`) corre cada transporte que lista contra el mismo OpenLDAP, así otra implementación demuestra que se comporta igual.
