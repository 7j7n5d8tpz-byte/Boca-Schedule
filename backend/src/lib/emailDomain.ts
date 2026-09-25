import { promises as dns } from 'node:dns';

// Can this address's domain receive mail at all? A syntactically valid address
// with a mistyped domain ("jacob@gmial.con") passes zod's `.email()` but can
// never be delivered to — and an account created with it is unreachable: no
// activation email, no password reset, no match notifications.
//
// A domain accepts mail if it publishes MX records, or — per RFC 5321 §5.1 —
// has an A/AAAA record to fall back to. Only a definitive "no such domain / no
// such record" answer rejects; a DNS timeout or server failure lets the address
// through, so a flaky resolver can never lock people out of registering.

type Resolver = Pick<typeof dns, 'resolveMx' | 'resolve4' | 'resolve6'>;

const DEFINITIVE = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);

async function hasRecords(lookup: () => Promise<unknown[]>): Promise<boolean | null> {
  try {
    return (await lookup()).length > 0;
  } catch (err: any) {
    return DEFINITIVE.has(err?.code) ? false : null;
  }
}

const TIMEOUT_MS = 3000;

export async function emailDomainAcceptsMail(email: string, resolver: Resolver = dns): Promise<boolean> {
  // A slow resolver must not hold registration hostage: no answer counts as ok.
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(true), TIMEOUT_MS); });
  try {
    return await Promise.race([lookupDomain(email, resolver), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function lookupDomain(email: string, resolver: Resolver): Promise<boolean> {
  const domain = email.split('@').pop()?.trim().toLowerCase();
  if (!domain) return false;

  const mx = await hasRecords(() => resolver.resolveMx(domain));
  if (mx !== false) return true; // has MX, or couldn't tell
  const a = await hasRecords(() => resolver.resolve4(domain));
  if (a !== false) return true;
  const aaaa = await hasRecords(() => resolver.resolve6(domain));
  return aaaa !== false;
}

// Tests and E2E register throwaway `@bocatest.internal` addresses, which by
// design resolve nowhere.
export function shouldCheckEmailDomain(): boolean {
  return process.env.NODE_ENV !== 'test';
}
