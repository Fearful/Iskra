---
title: LDAP Kit
description: LDAP and Active Directory logins, users, nested groups and changes, with a gate for web-kit.
---

:::caution[Experimental]
`@iskra-bun/ldap-kit` is on `0.x` and may change in a minor release (see [VERSIONING.md](https://github.com/fearful/iskra/blob/main/VERSIONING.md)). Its conformance suite runs in CI against OpenLDAP; the Active Directory behavior (reasons, nested groups in one search, USNs) is tested against recorded answers, not a domain controller.
:::

LDAP for Iskra, Active Directory first: check a login and password, read users and their groups (nested included), search page by page and read what changed. It talks LDAP through [ldapts](https://github.com/ldapts/ldapts) behind an interface of its own, `LdapTransport`: its API never shows ldapts' types, so the client can be replaced without changing yours.

```bash
bun add @iskra-bun/ldap-kit
```

## Quick start

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
    logger.warn('login refused', { login, reason: result.reason }); // never tell the client why
    return c.json({ error: 'Invalid credentials' }, 401);
}
result.user; // { dn, username, email, displayName, id, sid, memberOf, groups, disabled, locked, expiresAt, entry }
```

Every call opens a connection, binds as the service account and closes it when done; `url` is a list tried in order when a server cannot be reached (a server that answers, even with an error, is not skipped).

## Logins

`authenticate(login, password)` finds the user with the service account (exactly one match: none is `user_not_found`, several `ambiguous_user`), then binds as that user with the password.

- A refused login is `{ ok: false, reason }`, not an exception: `invalid_credentials`, `user_not_found`, `ambiguous_user`, `empty_password`, and from Active Directory's answer `account_disabled`, `account_locked`, `account_expired`, `password_expired`, `password_must_change`, `logon_not_permitted`. The reason is for logs and metrics: telling the client which one it is tells an attacker which accounts exist.
- An **empty password is refused without asking the server**: LDAP servers take it as an anonymous bind and answer success.
- The login goes into the filter escaped (RFC 4515), so `*)(uid=*` matches only itself. In AD a `DOMAIN\user` login is taken as `user`, and a user is found by `sAMAccountName` or `userPrincipalName`; `users.filter` changes it (`{login}` is the escaped login).
- `{ groups: 'direct' | 'nested' }` also reads the user's groups, as the service account (the user may not be allowed to).
- An unreachable directory, a timeout or a refused service account throw `LdapError` (below).

## Users and groups

```typescript
await ldap.findUser('ana');                 // LdapUser | null
await ldap.findUserByDN(dn);                // LdapUser | null
await ldap.groupsOf(user);                  // nested by default
await ldap.groupsOf(user, { nested: false });
```

Active Directory resolves nested groups in one search (`LDAP_MATCHING_RULE_IN_CHAIN`); on other servers `groupsOf()` follows them level by level (`member` and `uniqueMember`), cycles included, up to 16 levels. A group is `{ dn, name, id, sid, entry }`.

An `LdapUser` has `dn`, `username` (`sAMAccountName` or `uid`), `userPrincipalName`, `displayName`, `email`, `givenName`, `surname`, `id` (`objectGUID` or `entryUUID`: stable across renames), `sid`, `memberOf`, `disabled` (userAccountControl), `locked` (`lockoutTime` or ppolicy's `pwdAccountLockedTime`), `expiresAt` (`accountExpires`, null for never) and `entry`, with every attribute read. `users.attributes` reads more (`employeeID`, `department`), `users.binaryAttributes` names the binary ones.

## Searches and entries

```typescript
import { ldapFilter } from '@iskra-bun/ldap-kit';

const people = await ldap.search({ filter: ldapFilter`(&(objectClass=user)(department=${dept}))`, attributes: ['cn', 'mail'] });
for await (const page of ldap.searchPages({ filter: '(objectClass=user)' })) {
    // 500 entries at a time (the paged results control; `pageSize` changes it)
}
```

`ldapFilter` escapes the values it interpolates; `escapeFilterValue()` and `escapeDnValue()` (RFC 4514) escape one. An `LdapEntry` reads attributes by name ignoring case: `get()`, `getAll()`, `bytes()`, `number()`, `bigint()`, `guid()`, `sid()` and `date()` (GeneralizedTime or FILETIME, null for "never"). `objectGUID` and `objectSid` are read as bytes; `decodeGuid`, `encodeGuid`, `decodeSid`, `decodeFileTime`, `decodeGeneralizedTime`, `decodeAccountControl` and `filterBytes` (to search by GUID) are exported.

## Changes

```typescript
let mark = { usn: await store.get('ldap-usn') ?? 0 };
const { entries, next } = await ldap.changesSince(mark);
await store.set('ldap-usn', next.usn);
```

In Active Directory prefer a USN: `changesSince({ usn })` returns the users with a greater `uSNChanged` and the mark of the next call, the server's `highestCommittedUSN` read before the search, so a change made meanwhile comes again rather than being lost. USNs belong to one domain controller: read changes from one `url`. `changesSince({ date })` compares `whenChanged` (AD) or `modifyTimestamp` (OpenLDAP) with the app's clock. `filter` reads other objects (`(objectClass=group)`). Deleted objects are not returned.

## Health

```typescript
new HealthCheckFeature({ checks: { ldap: ldap.healthCheck() } });
```

`ping()` connects, binds as the service account and reads the root DSE: `{ url, latencyMs, rootDSE }`. `healthCheck()` wraps it for web-kit's HealthCheckFeature: `ok` with the url and latency, `error` with what failed.

## Gate for web-kit

```typescript
import { anyOf, jwt, requireActor } from '@iskra-bun/web-kit';
import { ldapPassword } from '@iskra-bun/ldap-kit/web';

app.use('/api/*', requireActor(anyOf(jwt({ jwksUri }), ldapPassword(ldap, { groups: 'nested' }))));
// c.var.actor: { kind: 'user', id: 'ana', dn, guid, email, displayName, groups: ['devs', …] }
```

`ldapPassword(ldap)` is a [gate](/packages/web-kit/#gates-who-made-the-request) that reads HTTP Basic credentials (or those `credentials(c)` returns) and checks them with `authenticate()`. Every refusal is the same 401 with the `Basic` challenge; an unreachable directory is a 503, which `anyOf` does not hide. Put a rate limit on the routes it guards: each attempt is a bind, and Active Directory locks an account after its threshold of failed ones. In OpenAPIFeature's spec it states HTTP Basic.

## Errors

`LdapError` (an `IskraError`) has the code web-kit's contract answers with: `SERVICE_UNAVAILABLE` (503) when no `url` answers or TLS fails, `TIMEOUT` (504) after `timeoutMs` (the connection is closed), `CONFIG_INVALID` (500) when the directory refuses the service account, `INTERNAL_ERROR` for another refused operation, with its `resultCode`. The original error is `cause`.

## Configuration

| Field | Default | |
| --- | --- | --- |
| `url` | | One URL or a list, tried in order. |
| `baseDN` | | Where users and groups are searched. |
| `bindDN`, `bindPassword` | | The service account (a DN, or a UPN in AD). Both required: an empty password is an anonymous bind. |
| `directory` | `'activeDirectory'` | `'openldap'` for OpenLDAP's filters and attributes (`uid`, `groupOfNames`, `entryUUID`). |
| `startTLS`, `tls` | `false` | StartTLS on `ldap://`; `tls` (`ca`, `servername`…) for it and for `ldaps://`. |
| `connectTimeoutMs`, `timeoutMs` | 5000, 10000 | Per connection and per operation. |
| `pageSize` | 500 | Entries per page. |
| `users` | | `base`, `filter` (with `{login}`), `attributes`, `binaryAttributes`. |
| `groups` | | `base`. |
| `transport` | ldapts | A factory of `LdapTransport` (`bind`, paged `search`, `close`). |

## Transport

`LdapTransport` is the contract between ldap-kit and an LDAP client: `bind(dn, password)`, `search(base, { scope, filter, attributes, binaryAttributes, pageSize, sizeLimit })` yielding pages of `{ dn, attributes }`, and `close()`, with `LdapResultError` (the server's result code) and `LdapTimeoutError` as its errors. `ldaptsTransport` is the default. The conformance suite (`test/ldap.integration.test.ts`) runs every transport it lists against the same OpenLDAP, so another implementation proves it behaves the same.
