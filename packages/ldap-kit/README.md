# @iskra-bun/ldap-kit

LDAP y Active Directory para Iskra (experimental): verificar logins, leer usuarios y sus grupos (anidados incluidos), búsquedas paginadas y cambios por USN o fecha, con un gate para web-kit. Habla LDAP con [ldapts](https://github.com/ldapts/ldapts) detrás de una interfaz propia (`LdapTransport`).

## Instalacion

```bash
bun add @iskra-bun/ldap-kit
```

## Uso rapido

```typescript
import { LdapDirectory } from '@iskra-bun/ldap-kit'

const ldap = new LdapDirectory({
  url: 'ldaps://dc1.corp.example.com',
  baseDN: 'DC=corp,DC=example,DC=com',
  bindDN: 'svc-app@corp.example.com',
  bindPassword: process.env.LDAP_PASSWORD!,
})

const result = await ldap.authenticate(login, password, { groups: 'nested' })
if (!result.ok) console.warn('login rechazado:', result.reason)
```

Documentacion completa: https://iskra-docs.fly.dev/packages/ldap-kit/
