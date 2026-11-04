// Internal metadata-style service: reachable only on the instance network, never routed.
import { send, serve, takeFlag } from './_lab/runtime.mjs';

const flag = await takeFlag();
const role = 'preview-fetcher';
const tree = {
  '/': 'latest/\n',
  '/latest/': 'meta-data/\n',
  '/latest/meta-data/': 'hostname\ninstance-id\niam/\n',
  '/latest/meta-data/hostname': 'preview-01.internal\n',
  '/latest/meta-data/instance-id': 'vm-0c4f7a91preview\n',
  '/latest/meta-data/iam/': 'security-credentials/\n',
  '/latest/meta-data/iam/security-credentials/': `${role}\n`,
  [`/latest/meta-data/iam/security-credentials/${role}`]: `${JSON.stringify({
    Code: 'Success',
    Type: 'ServiceKey',
    KeyId: 'LPK0PREVIEW0FETCHER01',
    SecretKey: flag,
    Expiration: '2030-01-01T00:00:00Z',
  }, null, 2)}\n`,
};

serve((_request, response, url) => {
  const body = tree[url.pathname];
  return body === undefined ? send(response, 404, 'Not found\n', 'text/plain') : send(response, 200, body, 'text/plain');
});
