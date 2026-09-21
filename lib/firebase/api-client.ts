"use client";

import { auth } from './client';

export async function makeAuthenticatedRequest(
  url: string, 
  options: RequestInit = {}
): Promise<Response> {
  const user = auth.currentUser;
  
  if (!user) {
    throw new Error('User not authenticated');
  }

  // Get the current user's ID token
  const idToken = await user.getIdToken();

  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${idToken}`);
  if (options.body instanceof FormData) {
    // Fetch must generate the multipart boundary along with the content type.
    headers.delete('Content-Type');
  } else if (options.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(url, {
    ...options,
    headers,
  });
}

export async function apiGet(url: string): Promise<any> {
  const response = await makeAuthenticatedRequest(url, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.statusText}`);
  }

  return response.json();
}

export async function apiPost(url: string, data: any): Promise<any> {
  const response = await makeAuthenticatedRequest(url, {
    method: 'POST',
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.statusText}`);
  }

  return response.json();
}

export async function apiPatch(url: string, data: any): Promise<any> {
  const response = await makeAuthenticatedRequest(url, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.statusText}`);
  }

  return response.json();
}

export async function apiDelete(url: string): Promise<any> {
  const response = await makeAuthenticatedRequest(url, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.statusText}`);
  }

  return response.json();
}

