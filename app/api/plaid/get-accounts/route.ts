// Compatibility route: the server stores credentials and returns only safe account data.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export { POST } from '../exchange-public-token/route';
