import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const BLOG_DIR = new URL("../content/blog/", import.meta.url);

function readPost(file: string): string {
  return readFileSync(new URL(file, BLOG_DIR), "utf8");
}

function allPosts(): string {
  return readdirSync(BLOG_DIR)
    .filter((name) => name.endsWith(".mdx"))
    .map((name) => readPost(name))
    .join("\n");
}

/** Applied WRONG-now sentences from the 2026-10-22 tax review. Finding 3 is held and is not in this list. */
const CORRECTIONS: { id: number; file: string; removed: string; added: string }[] = [
  {
    id: 1,
    file: "w2-and-1099-side-hustle-taxes.mdx",
    removed: "On $20,000 in net self-employment profit, that is $3,060 in SE tax that arrives as an unexpected April bill.",
    added: "On $20,000 in net self-employment profit, that is about $2,826 in SE tax ($20,000 x 92.35% x 15.3%).",
  },
  {
    id: 2,
    file: "retirement-accounts-self-employed.mdx",
    removed: "If you made $80,000 as a freelancer and contributed $20,000 to a SEP-IRA, you'd only pay income tax on $60,000. At a 22% marginal rate, that's $4,400 back in your pocket this year",
    added: "On $80,000 of net profit, the maximum SEP-IRA contribution is about $14,870 (20% of $80,000 minus the $5,652 deduction for half of SE tax). At a 22% marginal rate that cuts income tax by about $3,270, less if part of it falls in a lower bracket. A $20,000 SEP contribution is not allowed at this profit level.",
  },
  {
    id: 4,
    file: "reasonable-salary-s-corp-irs.mdx",
    removed: "At $150,000 in net income with a $70,000 salary, you save around $12,000 in self-employment taxes.",
    added: "At $150,000 in net income with a $70,000 salary, payroll tax drops by about $10,500 ($21,194 SE tax as a sole proprietor vs $10,710 FICA on the salary), before payroll, state, and filing costs.",
  },
  {
    id: 5,
    file: "reasonable-salary-s-corp-irs.mdx",
    removed: "paying themselves $31,500 and taking $270,000 in distributions: the IRS finds this implausible. Software consultants don't earn $31,500.",
    added: "paying themselves $30,000 and taking $270,000 in distributions: the IRS finds this implausible. Software consultants don't earn $30,000.",
  },
  {
    id: 6,
    file: "reasonable-salary-s-corp-irs.mdx",
    removed: "A marketing consultant earning $90,000 and paying themselves $60,000, taking $31,500 as a distribution: more defensible.",
    added: "A marketing consultant earning $90,000 and paying themselves $60,000, taking $30,000 as a distribution: more defensible.",
  },
  {
    id: 7,
    file: "self-employment-tax-explained.mdx",
    removed: "saving roughly $7,000.",
    added: "saving roughly $6,200.",
  },
  {
    id: 8,
    file: "gig-economy-tax-guide.mdx",
    removed: "On $40,000 of net gig income, that's potentially an $8,000 deduction",
    added: "On $40,000 of net gig income, that's potentially about a $7,400 deduction",
  },
  {
    id: 9,
    file: "cpa-vs-tax-software-self-employed.mdx",
    removed: "- Home office deduction (Form 8829 simplified method)",
    added: "- Home office deduction (simplified method on the Schedule C worksheet, or actual expenses on Form 8829)",
  },
  {
    id: 10,
    file: "how-irs-knows-your-income-1099k.mdx",
    removed: "- A 25% failure-to-pay penalty if you did not pay what was due",
    added: "- A failure-to-pay penalty of 0.5% per month (up to 25%) on unpaid tax. For tax that was not shown on your return, it starts only if you do not pay within 21 days of the IRS bill.",
  },
  {
    id: 11,
    file: "how-irs-knows-your-income-1099k.mdx",
    removed: "roughly $2,500 in tax, $1,000 in interest, $500 in accuracy penalty, and $625 in failure-to-pay penalty. A $4,625 bill",
    added: "roughly $2,500 in tax, $1,000 in interest, and $500 in accuracy penalty, about $4,000, with failure-to-pay penalty added if the bill is not paid within 21 days.",
  },
  {
    id: 12,
    file: "home-office-deduction-guide.mdx",
    removed: "the value of your home divided over 39 years (for the business-use portion). This sounds great, but there is a catch. When you sell the home, the IRS requires **depreciation recapture** on the amount you deducted, taxed as ordinary income even if you would otherwise qualify for the home sale exclusion.",
    added: "depreciation on the business-use share of your home's depreciable basis (the building, not the land), generally over 39 years. When you sell, gain equal to depreciation claimed after May 6, 1997 cannot be excluded under the home sale exclusion and is taxed as unrecaptured section 1250 gain at a maximum 25% rate.",
  },
  {
    id: 13,
    file: "hobby-vs-business-irs-section-183.mdx",
    removed: "**File Form 5213** to defer the hobby determination if you need more time. It extends the IRS audit window, so it is a calculated trade-off, not a free pass.",
    added: "**New activities only: Form 5213.** If you are just starting, you can elect to postpone the determination until the end of the fifth year (seventh for horse activities). The election generally must be filed within 3 years after the due date of the return for the activity's first year, and it extends the IRS's time to assess. It is not available later just because you need more time.",
  },
  {
    id: 14,
    file: "cohan-rule-lost-receipts.mdx",
    removed: "**4. Listed property.** Passenger automobiles, computers, cell phones, and other items with high personal-use potential.",
    added: "**4. Listed property.** Passenger automobiles and other property used for transportation, and property generally used for entertainment, recreation, or amusement.",
  },
  {
    id: 15,
    file: "worker-misclassification-1099-employee.mdx",
    removed: "You can file Form 8919 if a company treated you as an employee but refused to withhold. You need a valid reason code. Reason Code H covers the situation where you believe you were an employee despite being classified as a contractor.",
    added: "You can file Form 8919 if you were paid as a contractor but believe you were an employee, and one of the IRS reason codes applies. If none of codes A, C, or H applies, use reason code G and file Form SS-8 by the date you file your return. Code H is only for workers who got both a W-2 and a 1099 from the same firm.",
  },
  {
    id: 16,
    file: "irs-cp2000-notice-guide.mdx",
    removed: "Ignoring a CP2000 leads to CP3219 (Notice of Deficiency) and loss of ability to petition Tax Court without paying first.",
    added: "Ignoring a CP2000 leads to a CP3219A Notice of Deficiency. You then have 90 days (150 if addressed outside the U.S.) to petition the Tax Court without paying first; miss that and the tax is assessed.",
  },
  {
    id: 17,
    file: "mileage-deduction-guide-2026.mdx",
    removed: "The IRS requires a **contemporaneous record**, meaning you track each trip at or near the time it happens, not from memory months later. Your mileage log must include:",
    added: "Keep a log made at or near the time of each trip; records made then carry the most weight. For each business trip record the date, miles, and business purpose (where you went and why), plus your total miles for the year.",
  },
  {
    id: 18,
    file: "uber-doordash-instacart-tax-guide.mdx",
    removed: "**The non-negotiable requirement:** You need a contemporaneous mileage log. The IRS requires date, destination, business purpose, and miles for every trip. The platform apps do not generate an IRS-compliant mileage log automatically",
    added: "Keep a log made at or near the time of each trip; records made then carry the most weight. For each business trip record the date, miles, and business purpose (where you went and why), plus your total miles for the year.",
  },
  {
    id: 19,
    file: "gig-economy-tax-guide.mdx",
    removed: "Mileage logs must be contemporaneous per [IRC Section 274(d)](https://www.law.cornell.edu/uscode/text/26/274).",
    added: "Mileage must be substantiated with adequate records under IRC Section 274(d); a log kept at or near the time of each trip is the strongest evidence.",
  },
  {
    id: 20,
    file: "freelancer-tax-mistakes-cost-money.mdx",
    removed: "Mileage must be tracked contemporaneously. You cannot reconstruct it credibly from memory in March for the previous January.",
    added: "Track mileage at or near the time of each trip. A log rebuilt from memory months later carries much less weight with the IRS.",
  },
];

describe("2026-10-22 blog tax corrections", () => {
  const corpus = allPosts();

  it.each(CORRECTIONS)("#$id old wording is gone from the blog", ({ removed }) => {
    expect(corpus).not.toContain(removed);
  });

  it.each(CORRECTIONS)("#$id corrected wording is in $file", ({ file, added }) => {
    expect(readPost(file)).toContain(added);
  });

  it("applies the Tax Watch follow-up wording", () => {
    const cohan = readPost("cohan-rule-lost-receipts.mdx");
    expect(cohan).toContain("**1. Travel expenses.**");
    expect(cohan).toContain("Meals fall under travel and entertainment, not their own category.");
    expect(cohan).toContain("**3. Gifts.**");
    expect(cohan).toContain("**4. Listed property.**");
    expect(cohan).not.toContain("**2. Business meals.**");
    expect(cohan).toContain("(travel, entertainment, gifts, listed property)");
    expect(cohan).not.toContain("(travel, meals, entertainment, listed property)");

    const underreporting = readPost("how-irs-knows-your-income-1099k.mdx");
    expect(underreporting).toContain("five years later");
    expect(underreporting).toContain("This is only possible under the 6-year statute of limitations for leaving out more than 25% of gross income (IRC §6501(e)(1)(A)), and the normal limit is 3 years.");

    const gig = readPost("gig-economy-tax-guide.mdx");
    const gigFootnote = gig.split("\n").find((line) => line.startsWith("*2025 standard mileage rate:"));
    expect(gigFootnote).toContain("72.5 cents/mile Jan to Jun (IRS Notice 2026-10) and 76 cents/mile Jul to Dec (IRS Announcement 2026-11).");
    expect(gigFootnote).not.toContain("[IRC Section 274(d)](");
    expect(gigFootnote).not.toContain("Jan–Jun");
    expect(gigFootnote).not.toContain("Jul–Dec");

    const mileage = readPost("mileage-deduction-guide-2026.mdx");
    expect(mileage).toContain("## What a Good Mileage Log Includes");
    expect(mileage).toContain("A simple log that covers each of these is the strongest evidence:");
    expect(mileage).not.toContain("## The IRS-Required Mileage Log");
  });

  it("applies finding 3 from tax review v2", () => {
    const post = readPost("qbi-deduction-freelancers-section-199a.mdx");
    expect(post).toContain("Say you are single, this $80,000 is your only income, and you take the standard deduction. Your QBI deduction is roughly $11,650 for 2026, which cuts federal income tax by about $2,180.");
    expect(post).not.toContain("Full qualification gets you a $16,000 deduction");
    expect(post).not.toContain("**$3,520 back in your pocket**");
  });
});
