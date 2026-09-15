import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';
import nextConfig from '../next.config';

function policyEntries(value: string) {
  return Object.fromEntries(value.split(',').map(entry => entry.trim().split('=')));
}

describe('same-origin camera and voice capability', () => {
  it('allows the app to request capture while retaining unrelated feature restrictions', () => {
    const response = middleware(new NextRequest('https://staging.example/auth/login'));
    const policy = policyEntries(response.headers.get('permissions-policy') || '');
    expect(policy).toMatchObject({ camera: '(self)', microphone: '(self)', geolocation: '()', payment: '()', usb: '()' });
  });
  it('uses compatible CDN headers so an earlier policy cannot disable app capture', async () => {
    const routes = await nextConfig.headers!();
    const header = routes.find(route => route.source === '/(.*)')!.headers.find(header => header.key === 'Permissions-Policy')!;
    const policy = policyEntries(header.value);
    expect(policy.camera).toBe('(self)');
    expect(policy.microphone).toBe('(self)');
    expect(policy.usb).toBe('()');
  });
});
