import { safeErrorDetails } from '../safeErrorDetails';

describe('safeErrorDetails', () => {
  it('preserves useful non-secret connection failure fields', () => {
    const error = Object.assign(new Error('connect ECONNREFUSED 10.0.0.4:5432'), {
      code: 'ECONNREFUSED',
      syscall: 'connect',
      address: '10.0.0.4',
      port: 5432,
    });

    expect(safeErrorDetails(error)).toEqual({
      name: 'Error',
      message: 'connect ECONNREFUSED 10.0.0.4:5432',
      code: 'ECONNREFUSED',
      syscall: 'connect',
      address: '10.0.0.4',
      port: 5432,
    });
  });

  it('redacts connection strings and configured secrets from messages', () => {
    const databaseUrl = 'postgresql://marketdesk:super-secret@db.example.com:5432/app';
    const details = safeErrorDetails(
      new Error(`could not connect to ${databaseUrl}; password=super-secret`),
      [databaseUrl, 'super-secret'],
    );

    expect(details.message).toContain('[redacted]');
    expect(details.message).not.toContain(databaseUrl);
    expect(details.message).not.toContain('super-secret');
    expect(JSON.stringify(details)).not.toContain('marketdesk:');
  });

  it('does not serialize arbitrary properties or non-Error values', () => {
    const error = Object.assign(new Error('failed'), {
      connectionString: 'postgresql://user:secret@db/app',
      password: 'secret',
    });
    expect(JSON.stringify(safeErrorDetails(error))).not.toContain('secret');
    expect(safeErrorDetails({ message: 'postgresql://user:secret@db/app' })).toEqual({
      name: 'Error',
      message: 'Unknown startup error',
    });
  });

  it('redacts configured secrets from every emitted string field', () => {
    const secret = 'configured-startup-secret';
    const error = Object.assign(new Error(`message=${secret}`), {
      name: `name-${secret}`,
      code: `code-${secret}`,
      syscall: `syscall-${secret}`,
      address: `postgresql://user:${secret}@db.example.com/app`,
      port: `port-${secret}`,
    });

    const serialized = JSON.stringify(safeErrorDetails(error, [secret]));
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('postgresql://');
    expect(serialized).toContain('[redacted]');
  });
});