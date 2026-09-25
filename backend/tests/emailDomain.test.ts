import { describe, it, expect } from 'vitest';
import { emailDomainAcceptsMail } from '../src/lib/emailDomain.js';

const fail = (code: string) => () => Promise.reject(Object.assign(new Error(code), { code }));
const ok = (records: unknown[]) => () => Promise.resolve(records);

function resolver(r: { mx?: () => Promise<any[]>; a?: () => Promise<any[]>; aaaa?: () => Promise<any[]> }) {
  return {
    resolveMx: (r.mx ?? fail('ENODATA')) as any,
    resolve4: (r.a ?? fail('ENODATA')) as any,
    resolve6: (r.aaaa ?? fail('ENODATA')) as any,
  };
}

describe('emailDomainAcceptsMail', () => {
  it('accepts a domain with MX records', async () => {
    expect(await emailDomainAcceptsMail('a@gmail.com', resolver({ mx: ok([{ exchange: 'mx', priority: 1 }]) }))).toBe(true);
  });

  it('accepts a domain with only an A record (implicit MX)', async () => {
    expect(await emailDomainAcceptsMail('a@example.dk', resolver({ a: ok(['1.2.3.4']) }))).toBe(true);
  });

  it('rejects a domain that does not exist', async () => {
    const r = resolver({ mx: fail('ENOTFOUND'), a: fail('ENOTFOUND'), aaaa: fail('ENOTFOUND') });
    expect(await emailDomainAcceptsMail('a@gmial.con', r)).toBe(false);
  });

  it('lets the address through when DNS itself is failing', async () => {
    expect(await emailDomainAcceptsMail('a@gmail.com', resolver({ mx: fail('ETIMEOUT') }))).toBe(true);
    expect(await emailDomainAcceptsMail('a@gmail.com', resolver({ mx: fail('ESERVFAIL') }))).toBe(true);
  });

  it('rejects an address with no domain', async () => {
    expect(await emailDomainAcceptsMail('a@', resolver({}))).toBe(false);
  });
});
