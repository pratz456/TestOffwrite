import { POST as exchange } from '../exchange-public-token/route';
export { DELETE } from '../items/route';
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return exchange(new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify({ public_token: body.publicToken ?? body.public_token }) }));
}
