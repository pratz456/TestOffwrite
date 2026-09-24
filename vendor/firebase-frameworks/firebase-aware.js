// Modified by WriteOff, 2026-09-24: prevent stale/concurrent auth-cache deletion
// and retain evicted Firebase apps until their active requests finish.
import { initializeApp as initializeAdminApp, getApps } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, signInWithCustomToken } from "firebase/auth";
import cookie from "cookie";
import LRU from "lru-cache";
import { COOKIE_MAX_AGE, ID_TOKEN_MAX_AGE, LRU_MAX_INSTANCES, LRU_TTL } from "./constants.js";
const ADMIN_APP_NAME = "firebase-frameworks";
const adminApp = getApps().find((it) => it.name === ADMIN_APP_NAME) ||
    initializeAdminApp(undefined, ADMIN_APP_NAME);
const adminAuth = getAdminAuth(adminApp);
// LRU eviction must not delete an app still authenticating or rendering a response.
const appLeases = new Map();
const disposeApp = (app) => {
    const lease = appLeases.get(app);
    if (lease) {
        lease.evicted = true;
    }
    else {
        deleteApp(app).catch((e) => console.error(e.message));
    }
};
const retainApp = (app, res) => {
    const lease = appLeases.get(app) || { users: 0, evicted: false };
    lease.users++;
    appLeases.set(app, lease);
    let released = false;
    let workDone = false;
    let responseDone = res.destroyed || res.writableFinished;
    const releaseIfDone = () => {
        if (released || !workDone || !responseDone)
            return;
        released = true;
        res.removeListener("finish", responseFinished);
        res.removeListener("close", responseFinished);
        if (--lease.users === 0) {
            appLeases.delete(app);
            if (lease.evicted)
                disposeApp(app);
        }
    };
    const responseFinished = () => { responseDone = true; releaseIfDone(); };
    res.once("finish", responseFinished);
    res.once("close", responseFinished);
    return {
        complete: () => { workDone = true; releaseIfDone(); },
        abort: () => { workDone = responseDone = true; releaseIfDone(); },
    };
};
const firebaseAppsLRU = new LRU({
    max: LRU_MAX_INSTANCES,
    ttl: LRU_TTL,
    allowStale: false,
    updateAgeOnGet: true,
    dispose: disposeApp,
});
const mintCookie = async (req, res) => {
    const idToken = req.header("Authorization")?.split("Bearer ")?.[1];
    const verifiedIdToken = idToken ? await adminAuth.verifyIdToken(idToken) : null;
    if (verifiedIdToken) {
        if (new Date().getTime() / 1000 - verifiedIdToken.iat > ID_TOKEN_MAX_AGE) {
            res.status(301).end();
        }
        else {
            const cookie = await adminAuth
                .createSessionCookie(idToken, { expiresIn: COOKIE_MAX_AGE })
                .catch((e) => {
                console.error(e.message);
            });
            if (cookie) {
                const options = { maxAge: COOKIE_MAX_AGE, httpOnly: true, secure: true };
                res.cookie("__session", cookie, options).status(201).end();
            }
            else {
                res.status(401).end();
            }
        }
    }
    else {
        res.status(204).clearCookie("__session").end();
    }
};
const handleAuth = async (req, res) => {
    const cookies = cookie.parse(req.headers.cookie || "");
    const { __session } = cookies;
    if (!__session)
        return;
    const decodedIdToken = await adminAuth
        .verifySessionCookie(__session)
        .catch((e) => console.error(e.message));
    if (!decodedIdToken)
        return;
    const { uid } = decodedIdToken;
    let app = firebaseAppsLRU.get(uid);
    if (!app) {
        const isRevoked = !(await adminAuth
            .verifySessionCookie(__session, true)
            .catch((e) => console.error(e.message)));
        if (isRevoked)
            return;
        // Another request may have filled this UID while revocation was checked.
        app = firebaseAppsLRU.get(uid);
        if (!app) {
            const random = Math.random().toString(36).split(".")[1];
            const appName = `authenticated-context:${uid}:${random}`;
            // Force JS SDK autoinit with the undefined
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            app = initializeApp(undefined, appName);
            firebaseAppsLRU.set(uid, app);
        }
    }
    // Retain synchronously before another UID can evict this app during an await.
    const lease = retainApp(app, res);
    try {
        const auth = getAuth(app);
        if (auth.currentUser?.uid !== uid) {
            // TODO(jamesdaniels) get custom claims
            const customToken = await adminAuth
                .createCustomToken(uid)
                .catch((e) => console.error(e.message));
            if (!customToken)
                return lease;
            await signInWithCustomToken(auth, customToken);
        }
        res.locals.firebaseApp = app;
        res.locals.currentUser = auth.currentUser;
        return lease;
    }
    catch (e) {
        lease.abort();
        throw e;
    }
};
export const handleFactory = (frameworkHandle) => async (req, res) => {
    if (req.url === "/__session") {
        await mintCookie(req, res);
    }
    else {
        const lease = await handleAuth(req, res);
        try {
            // Keep the lease until finish/close, including asynchronous streaming.
            return await frameworkHandle(req, res);
        }
        catch (e) {
            lease?.abort();
            throw e;
        }
        finally {
            lease?.complete();
        }
    }
};
