import { describe, it, expect } from "vitest";
import {
  APP_SHELL_PATH,
  AUTH_LOGIN_PATH,
  AUTH_SIGN_UP_PATH,
  hasAuthSessionCookie,
  loginAliasDestination,
} from "../lib/auth-routes";

describe("auth entry routes", () => {
  it("keeps a single login and sign-up path", () => {
    expect(AUTH_LOGIN_PATH).toBe("/auth/login");
    expect(AUTH_SIGN_UP_PATH).toBe("/auth/sign-up");
    expect(APP_SHELL_PATH).toBe("/protected");
  });

  it("aliases /login to the existing Firebase login", () => {
    expect(loginAliasDestination()).toBe("/auth/login");
    expect(loginAliasDestination(null)).toBe("/auth/login");
    expect(loginAliasDestination({})).toBe("/auth/login");
  });

  it("forwards query params to /auth/login", () => {
    expect(loginAliasDestination("redirect=/protected")).toBe(
      "/auth/login?redirect=/protected",
    );
    expect(loginAliasDestination({ redirect: "/protected" })).toBe(
      "/auth/login?redirect=%2Fprotected",
    );
    expect(loginAliasDestination(new URLSearchParams("redirect=/protected"))).toBe(
      "/auth/login?redirect=%2Fprotected",
    );
  });

  it("treats Firebase session cookies as signed-in for /welcome", () => {
    expect(hasAuthSessionCookie(() => undefined)).toBe(false);
    expect(hasAuthSessionCookie((name) => (name === "firebase-auth-token" ? { value: "tok" } : undefined))).toBe(true);
    expect(hasAuthSessionCookie((name) => (name === "__session" ? { value: "sess" } : undefined))).toBe(true);
  });
});
