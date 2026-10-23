// IRC §6654 (https://www.govinfo.gov/content/pkg/USCODE-2023-title26/html/USCODE-2023-title26-subtitleF-chap68-subchapA-partI-sec6654.htm)
export const CURRENT_YEAR_SAFE_HARBOR_RATE = 0.9 as const; // §6654(d)(1)(B)(i)
export const PRIOR_YEAR_SAFE_HARBOR_RATE = 1.0 as const; // §6654(d)(1)(B)(ii), 12-month year with a return filed
export const HIGH_AGI_PRIOR_YEAR_RATE = 1.1 as const; // §6654(d)(1)(C)(i)
export const HIGH_AGI_THRESHOLD = 150_000; // §6654(d)(1)(C)(i), strictly greater than
export const HIGH_AGI_THRESHOLD_MFS = 75_000; // §6654(d)(1)(C)(ii), married filing separately
export const INSTALLMENT_SHARE = 0.25 as const; // §6654(d)(1)(A)
export const DE_MINIMIS_TAX_LESS_WITHHOLDING = 1_000; // §6654(e)(1)
export const Q4_ALTERNATIVE_RETURN_DAY = { month: 1, day: 31 }; // §6654(h); moved to next business day by §7503
export const PENALTY_PERIOD_END_DAY = { month: 4, day: 15 }; // §6654(b)(2), the following year

/**
 * §6654(e)(2): prior-year tax after refundable credits at or below this amount is zero tax.
 * The exception also needs a 12-month prior year and full-year U.S. citizenship or residency.
 * https://www.govinfo.gov/content/pkg/USCODE-2023-title26/html/USCODE-2023-title26-subtitleF-chap68-subchapA-partI-sec6654.htm
 */
export const PRIOR_YEAR_ZERO_TAX_NET_CEILING = 0;
export const PRIOR_YEAR_ZERO_TAX_EXCEPTION_CITE = 'IRC §6654(e)(2)' as const;
