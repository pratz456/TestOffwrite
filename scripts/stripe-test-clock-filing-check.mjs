#!/usr/bin/env node
/**
 * Test mode only. This script calls Stripe. It refuses any key that does not
 * start with sk_test_. Never point it at live mode, and never commit a key or
 * a price id.
 *
 * Once those values exist in the environment, one command checks a planned
 * Checkout where a new buyer subscribes to Premium and also pays a one time
 * filing price:
 *
 * 1. Where Stripe puts the one time price. Expected: on the first invoice
 *    only, not in the subscription items. That is what lets subscriptionItem
 *    in lib/stripe/subscription-sync.ts keep selecting Premium.
 * 2. Renewal. After the test clock moves to the period end plus one day, the
 *    renewal invoice has exactly one line and that line is the Premium price.
 *
 * The first invoice id is taken from the paid Checkout Session when that
 * field is set. If it is empty, the subscription latest invoice is used.
 * If both are set and they differ, the script stops and names both ids.
 * The chosen source is printed.
 *
 * There is no current scripts README. Run it with Node, from the repo root.
 *
 * Environment names only (set the values in the shell):
 *   STRIPE_TEST_SECRET_KEY
 *   STRIPE_TEST_PREMIUM_YEARLY_PRICE_ID
 *   STRIPE_TEST_FILING_PRICE_ID
 *
 * Checkout proof. Prints a URL and waits for the operator to pay with
 * Stripe's test card:
 *   node scripts/stripe-test-clock-filing-check.mjs
 *
 * API approximation. This is not proof of Checkout itself:
 *   node scripts/stripe-test-clock-filing-check.mjs --api-only
 *
 * Leave the test clock in place instead of deleting it:
 *   node scripts/stripe-test-clock-filing-check.mjs --keep
 *
 * The flags can be combined. The Checkout wait is 30 minutes. The clock wait
 * is 15 minutes. Unit tests import the pure checks below and must not execute
 * this file.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const API_VERSION = '2025-10-29.clover';
export const ONE_DAY_SECONDS = 24 * 60 * 60;

const KEY_ENV = 'STRIPE_TEST_SECRET_KEY';
const PREMIUM_ENV = 'STRIPE_TEST_PREMIUM_YEARLY_PRICE_ID';
const FILING_ENV = 'STRIPE_TEST_FILING_PRICE_ID';
const VERIFICATION_RUN = 'stripe-test-clock-filing-check';
const CHECKOUT_WAIT_MS = 30 * 60 * 1000;
const CLOCK_WAIT_MS = 15 * 60 * 1000;
const TEST_SECRET_PREFIX = 'sk_test_';

let scriptStarted = false;

export function wasScriptInvoked() {
  return scriptStarted;
}

export function publicError(error) {
  const message = error instanceof Error && error.message ? error.message : 'Verification failed.';
  const code = error && typeof error === 'object' && typeof error.code === 'string' && error.code ? ` (${error.code})` : '';
  return `${message}${code}`.replace(/\b(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9]+/g, '[redacted]');
}

/** Accept only a test mode secret key. The thrown text never includes the key. */
export function assertTestModeKey(key) {
  const value = typeof key === 'string' ? key.trim() : '';
  if (value.startsWith(TEST_SECRET_PREFIX)) return value;
  if (!value) throw new Error(`${KEY_ENV} is missing. This script accepts only a test mode secret key starting with ${TEST_SECRET_PREFIX}.`);
  if (value.startsWith('sk_live_')) throw new Error(`Refusing ${KEY_ENV} because it is a live secret key (sk_live_). This script is test mode only.`);
  if (value.startsWith('rk_live_')) throw new Error(`Refusing ${KEY_ENV} because it is a live restricted key (rk_live_). This script is test mode only.`);
  throw new Error(`Refusing ${KEY_ENV} because it does not start with ${TEST_SECRET_PREFIX}. This script is test mode only.`);
}

function requiredEnv(env, name) {
  const value = typeof env?.[name] === 'string' ? env[name].trim() : '';
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function readVerificationConfig(env = process.env, argv = []) {
  const key = assertTestModeKey(env?.[KEY_ENV]);
  const premiumPriceId = requiredEnv(env, PREMIUM_ENV);
  const filingPriceId = requiredEnv(env, FILING_ENV);
  if (premiumPriceId === filingPriceId) throw new Error(`${PREMIUM_ENV} and ${FILING_ENV} must be different prices.`);
  const unknown = argv.filter(argument => argument.startsWith('-') && argument !== '--api-only' && argument !== '--keep');
  if (unknown.length) throw new Error(`Unknown argument: ${unknown.join(', ')}. Supported flags are --api-only and --keep.`);
  return { key, premiumPriceId, filingPriceId, apiOnly: argv.includes('--api-only'), keep: argv.includes('--keep') };
}

export function assertPremiumYearlyPrice(price, expectedId) {
  if (!price || typeof price !== 'object') throw new Error('Premium price was not found.');
  if (price.livemode !== false) throw new Error('Premium price must be a test mode price (livemode false).');
  if (expectedId && price.id !== expectedId) throw new Error(`Premium price id returned by Stripe did not match ${PREMIUM_ENV}.`);
  const recurring = price.recurring;
  if (price.type !== 'recurring' || recurring?.interval !== 'year' || recurring?.interval_count !== 1) {
    throw new Error('Premium price must be a recurring yearly price.');
  }
  return price;
}

export function assertFilingPrice(price, expectedId) {
  if (!price || typeof price !== 'object') throw new Error('Filing price was not found.');
  if (price.livemode !== false) throw new Error('Filing price must be a test mode price (livemode false).');
  if (expectedId && price.id !== expectedId) throw new Error(`Filing price id returned by Stripe did not match ${FILING_ENV}.`);
  if (price.type !== 'one_time') throw new Error(`Filing price must be one_time. Received ${price.type ?? 'unknown'}.`);
  return price;
}

export function itemPriceId(item) {
  const price = item?.price;
  if (typeof price === 'string' && price) return price;
  if (price && typeof price === 'object' && typeof price.id === 'string' && price.id) return price.id;
  return null;
}

/** Clover invoice lines store the price id at pricing.price_details.price. */
export function linePriceId(line) {
  const priced = line?.pricing?.price_details?.price ?? line?.price;
  if (typeof priced === 'string' && priced) return priced;
  if (priced && typeof priced === 'object' && typeof priced.id === 'string' && priced.id) return priced.id;
  return null;
}

export function assertInitialSubscription(subscription, premiumPriceId, filingPriceId) {
  const priceIds = (subscription?.items?.data ?? []).map(itemPriceId);
  const problems = [];
  if (!priceIds.includes(premiumPriceId)) problems.push('subscription items do not include the Premium price');
  if (priceIds.includes(filingPriceId)) problems.push('subscription items include the filing price');
  if (problems.length) throw new Error(`Initial subscription check failed: ${problems.join('; ')}.`);
  return priceIds;
}

export function invoiceAmountReport(invoice) {
  return {
    id: invoice?.id ?? null,
    status: invoice?.status ?? null,
    currency: invoice?.currency ?? null,
    subtotal: invoice?.subtotal ?? null,
    total: invoice?.total ?? null,
    amount_due: invoice?.amount_due ?? null,
    amount_paid: invoice?.amount_paid ?? null,
    lines: (invoice?.lines?.data ?? []).map(line => ({
      priceId: linePriceId(line),
      amount: line?.amount ?? null,
      currency: line?.currency ?? invoice?.currency ?? null,
      description: line?.description ?? null,
    })),
  };
}

export function assertFirstInvoice(invoice, premiumPriceId, filingPriceId) {
  const priceIds = (invoice?.lines?.data ?? []).map(linePriceId);
  const problems = [];
  if (!priceIds.includes(premiumPriceId)) problems.push('first invoice does not include the Premium price');
  if (!priceIds.includes(filingPriceId)) problems.push('first invoice does not include the filing price');
  if (invoice?.status !== 'paid') problems.push(`first invoice status is ${invoice?.status ?? 'missing'}, expected paid`);
  if (problems.length) throw new Error(`First invoice check failed: ${problems.join('; ')}.`);
  return invoiceAmountReport(invoice);
}

export function assertRenewalInvoice(invoice, premiumPriceId, filingPriceId) {
  const priceIds = (invoice?.lines?.data ?? []).map(linePriceId);
  const problems = [];
  if (priceIds.length !== 1 || priceIds[0] !== premiumPriceId) {
    problems.push(`renewal invoice lines are [${priceIds.filter(Boolean).join(', ') || 'none'}], expected exactly one Premium line`);
  }
  if (priceIds.includes(filingPriceId)) problems.push('renewal invoice includes the filing price');
  if (problems.length) throw new Error(`Renewal invoice check failed: ${problems.join('; ')}.`);
  return invoiceAmountReport(invoice);
}

export function renewalAdvanceTime(subscription, premiumPriceId) {
  const item = (subscription?.items?.data ?? []).find(entry => itemPriceId(entry) === premiumPriceId);
  if (!item || typeof item.current_period_end !== 'number') throw new Error('Premium subscription item has no current_period_end.');
  return item.current_period_end + ONE_DAY_SECONDS;
}

export function selectRenewalInvoice(invoices, firstInvoiceId) {
  const list = Array.isArray(invoices) ? invoices : [];
  const renewals = list.filter(invoice => invoice && invoice.id !== firstInvoiceId && invoice.billing_reason === 'subscription_cycle');
  if (renewals.length !== 1) {
    const seen = list.map(invoice => `${invoice?.id ?? 'unknown'} (${invoice?.billing_reason ?? 'unknown'})`).join(', ') || 'none';
    throw new Error(`Expected exactly one renewal invoice with billing_reason subscription_cycle besides the first invoice. Found ${renewals.length}: ${seen}.`);
  }
  return renewals[0];
}

function idOf(value) {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object' && typeof value.id === 'string' && value.id) return value.id;
  return null;
}

/** Prefer the Checkout Session invoice, and fall back to the subscription invoice only when the session field is empty. */
export function resolveFirstInvoiceId(session, subscription) {
  const sessionInvoiceId = idOf(session?.invoice);
  const latestInvoiceId = idOf(subscription?.latest_invoice);
  if (sessionInvoiceId && latestInvoiceId && sessionInvoiceId !== latestInvoiceId) {
    throw new Error(`Checkout Session invoice ${sessionInvoiceId} does not match subscription latest_invoice ${latestInvoiceId}.`);
  }
  if (sessionInvoiceId) return { id: sessionInvoiceId, source: 'session.invoice' };
  if (latestInvoiceId) return { id: latestInvoiceId, source: 'subscription.latest_invoice' };
  throw new Error('No first invoice was found on session.invoice or subscription.latest_invoice.');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForPaidCheckout(stripe, sessionId) {
  const deadline = Date.now() + CHECKOUT_WAIT_MS;
  let lastSummary = '';
  let lastLog = 0;
  for (;;) {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status === 'complete' && session.payment_status === 'paid') return session;
    if (session.status === 'expired') throw new Error('Checkout Session expired before it was paid.');
    const summary = `${session.status ?? 'unknown'} / ${session.payment_status ?? 'unknown'}`;
    const now = Date.now();
    if (summary !== lastSummary || now - lastLog >= 60_000) {
      console.log(`Waiting for the test card payment. Checkout status: ${summary}.`);
      lastSummary = summary;
      lastLog = now;
    }
    if (now > deadline) throw new Error('Timed out after 30 minutes waiting for the Checkout Session to be paid.');
    await sleep(5_000);
  }
}

async function waitForClockReady(stripe, clockId) {
  const deadline = Date.now() + CLOCK_WAIT_MS;
  let lastStatus = '';
  for (;;) {
    const clock = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (clock.status === 'ready') return clock;
    if (clock.status === 'internal_failure') throw new Error(`Test clock ${clockId} status is internal_failure.`);
    if (clock.status !== lastStatus) {
      console.log(`Test clock ${clockId} status: ${clock.status}.`);
      lastStatus = clock.status;
    }
    if (Date.now() > deadline) throw new Error(`Timed out after 15 minutes waiting for test clock ${clockId} to be ready (last status ${clock.status}).`);
    await sleep(2_000);
  }
}

async function listInvoices(stripe, customerId, subscriptionId) {
  const invoices = [];
  let startingAfter;
  for (;;) {
    const page = await stripe.invoices.list({
      customer: customerId,
      subscription: subscriptionId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    invoices.push(...page.data);
    if (!page.has_more) return invoices;
    startingAfter = page.data.at(-1)?.id;
    if (!startingAfter) throw new Error('Invoice list was truncated without a cursor.');
  }
}

async function invoiceWithLines(stripe, invoiceId) {
  const invoice = await stripe.invoices.retrieve(invoiceId);
  if (!invoice.lines?.has_more) return invoice;
  const lines = [];
  let startingAfter;
  for (;;) {
    const page = await stripe.invoices.listLineItems(invoiceId, {
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    lines.push(...page.data);
    if (!page.has_more) return { ...invoice, lines: { ...invoice.lines, data: lines, has_more: false } };
    startingAfter = page.data.at(-1)?.id;
    if (!startingAfter) throw new Error(`Invoice ${invoiceId} line list was truncated without a cursor.`);
  }
}

async function runVerification(stripe, config, state) {
  if (config.apiOnly) {
    console.log('Path B is an API approximation of Checkout, not proof of Checkout itself. It calls subscriptions.create with the Premium price plus add_invoice_items for the filing price, and pays with the pm_card_visa test payment method.');
  } else {
    console.log('Path A is a real Checkout Session in subscription mode with the Premium yearly price and the filing one time price.');
  }

  assertPremiumYearlyPrice(await stripe.prices.retrieve(config.premiumPriceId), config.premiumPriceId);
  assertFilingPrice(await stripe.prices.retrieve(config.filingPriceId), config.filingPriceId);
  console.log('Confirmed the Premium price is test mode, recurring, and yearly.');
  console.log('Confirmed the filing price is test mode and one_time.');

  const clock = await stripe.testHelpers.testClocks.create({
    frozen_time: Math.floor(Date.now() / 1000),
    name: 'Verification run for a one time filing line',
  });
  state.clockId = clock.id;

  const customer = await stripe.customers.create({
    name: 'Verification run',
    email: 'verification-run@example.com',
    test_clock: clock.id,
    metadata: { verification_run: VERIFICATION_RUN },
    ...(config.apiOnly ? {
      payment_method: 'pm_card_visa',
      invoice_settings: { default_payment_method: 'pm_card_visa' },
    } : {}),
  });
  console.log(`Customer ${customer.id} is attached to test clock ${clock.id} with verification metadata.`);

  let subscription;
  let firstInvoiceId;
  if (config.apiOnly) {
    const created = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: config.premiumPriceId }],
      add_invoice_items: [{ price: config.filingPriceId }],
      collection_method: 'charge_automatically',
      payment_behavior: 'error_if_incomplete',
      metadata: { verification_run: VERIFICATION_RUN },
    });
    subscription = await stripe.subscriptions.retrieve(created.id);
    const resolved = resolveFirstInvoiceId(null, subscription);
    firstInvoiceId = resolved.id;
    console.log(`First invoice source: ${resolved.source}.`);
  } else {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      line_items: [
        { price: config.premiumPriceId, quantity: 1 },
        { price: config.filingPriceId, quantity: 1 },
      ],
      success_url: 'https://example.com/stripe-test-clock-filing-check/success',
      cancel_url: 'https://example.com/stripe-test-clock-filing-check/cancel',
      metadata: { verification_run: VERIFICATION_RUN },
      subscription_data: { metadata: { verification_run: VERIFICATION_RUN } },
    });
    if (!session.url) throw new Error('Checkout Session did not return a URL.');
    console.log(`Checkout URL: ${session.url}`);
    console.log('Pay that Checkout page with Stripe\'s test card. This script polls until the session is paid.');
    await waitForPaidCheckout(stripe, session.id);
    const paid = await stripe.checkout.sessions.retrieve(session.id);
    const subscriptionId = idOf(paid.subscription);
    if (!subscriptionId) throw new Error('The paid Checkout Session has no subscription.');
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const resolved = resolveFirstInvoiceId(paid, subscription);
    firstInvoiceId = resolved.id;
    console.log(`First invoice source: ${resolved.source}.`);
  }

  const firstInvoice = await invoiceWithLines(stripe, firstInvoiceId);
  const itemPriceIds = assertInitialSubscription(subscription, config.premiumPriceId, config.filingPriceId);
  console.log(`PASS: subscription items are ${itemPriceIds.join(', ')} (Premium present, filing price absent).`);
  const firstReport = assertFirstInvoice(firstInvoice, config.premiumPriceId, config.filingPriceId);
  console.log('PASS: first invoice is paid and includes the Premium price and the filing price.');
  console.log('First invoice amounts returned by Stripe:');
  console.log(JSON.stringify(firstReport, null, 2));

  const advanceTo = renewalAdvanceTime(subscription, config.premiumPriceId);
  console.log(`Advancing test clock ${clock.id} to ${new Date(advanceTo * 1000).toISOString()} (period end plus one day).`);
  await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: advanceTo });
  await waitForClockReady(stripe, clock.id);

  const renewal = selectRenewalInvoice(await listInvoices(stripe, customer.id, subscription.id), firstInvoice.id);
  const renewalInvoice = await invoiceWithLines(stripe, renewal.id);
  const renewalReport = assertRenewalInvoice(renewalInvoice, config.premiumPriceId, config.filingPriceId);
  console.log('PASS: renewal invoice has exactly one Premium line and no filing line.');
  console.log('Renewal invoice amounts returned by Stripe:');
  console.log(JSON.stringify(renewalReport, null, 2));
}

async function deleteClock(state) {
  if (!state.stripe || !state.clockId) return;
  if (state.keep) {
    console.log(`Kept test clock ${state.clockId}.`);
    return;
  }
  try {
    await state.stripe.testHelpers.testClocks.del(state.clockId);
    console.log(`Deleted test clock ${state.clockId}.`);
  } catch (error) {
    console.error(`FAIL: could not delete test clock ${state.clockId}: ${publicError(error)}`);
    process.exitCode = 1;
  }
}

async function main() {
  scriptStarted = true;
  const state = { clockId: null, stripe: null, keep: false };
  let passed = false;
  try {
    const config = readVerificationConfig(process.env, process.argv.slice(2));
    state.keep = config.keep;
    const { default: Stripe } = await import('stripe');
    state.stripe = new Stripe(config.key, { apiVersion: API_VERSION, timeout: 30_000, maxNetworkRetries: 1 });
    await runVerification(state.stripe, config, state);
    passed = true;
  } catch (error) {
    console.error(`FAIL: ${publicError(error)}`);
    process.exitCode = 1;
  } finally {
    await deleteClock(state);
  }
  if (passed && !process.exitCode) console.log('PASS: the filing price was on the first invoice only, and the renewal invoice billed only Premium.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
