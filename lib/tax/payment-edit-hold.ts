/** The emulator race test installs a hold. Production leaves this unset, so the payment transaction does not sleep. */
type PaymentEditHold = () => Promise<void> | void;

let paymentEditHold: PaymentEditHold | null = null;

export function setPaymentEditHoldForTests(hold: PaymentEditHold | null): void {
  paymentEditHold = hold;
}

export async function holdPaymentEditForTests(): Promise<void> {
  if (paymentEditHold) await paymentEditHold();
}
