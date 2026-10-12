# WriteOff launch kit — September 25, 2026

Copy to publish when the owner decides to push traffic, plus the steps that must happen first. It follows the claims policy in the [go-to-market plan](GTM_PLAN_2026-09-25.md). Nothing here has been posted, and the agent that prepared it has no access to post: X is not connected, and there are no Hacker News, Reddit, LinkedIn or ad accounts available to it.

Bracketed text such as `[your story]` must be written by the owner. Don't replace it with an invented anecdote.

## 1. Before posting anything

| # | Step | Why |
| --- | --- | --- |
| 1 | Deploy `cursor/seo-content-hotfix-008d` (the live release plus these fixes only, commit `1f2080a465c7e67d19501439d906f876616470d6`) with the runbook's deploy workflow: set `commit` in the migration review JSON to that SHA, re-upload the secret, then run `gh workflow run deploy.yml --repo pratz456/TestOffwrite --ref cursor/seo-content-hotfix-008d -f release_commit=<sha> -f confirmation=deploy:writeoff-23910:<sha>` and approve the `production` environment. If you're deploying the preview branch anyway, merge `cursor/gtm-site-fixes-008d` into it instead. | It adds the four posts linked below and fixes `robots.txt` and the sitemap without shipping the unreviewed preview changes. |
| 2 | Add `NEXT_PUBLIC_GA_MEASUREMENT_ID` to `/private/release/production.env` and re-upload `PRODUCTION_ENV_FILE` before that deploy. `G-1P3GNBHB9J` was the tag the site used before; confirm you own that property. | The live site loads no analytics tag, so no view can be counted today. The tag loads only on public pages. |
| 3 | Submit `https://writeoffapp.com/sitemap.xml` in Google Search Console and Bing Webmaster Tools, then request indexing for the four new posts. | Search engines have never seen a sitemap with the blog posts in it. |
| 4 | Sign up once on a phone and once on a desktop: confirm the verification email arrives and Google sign-in works. | Production email delivery is still an open launch gate. If verification email fails, only Google sign-in works. |
| 5 | Decide the pilot offer (the plan suggests free Premium through April 15, 2027). | The LinkedIn post and emails mention it; remove those lines if the answer is no. |

## 2. What to expect

Realistic outcomes vary widely, so these are rough ranges from founders' public reports, not forecasts.

| Channel | Typical result | Notes |
| --- | --- | --- |
| Hacker News front page | Thousands to tens of thousands of visits in a day | Most submissions never reach the front page. It's the only channel here that can produce a five-figure spike. |
| Hacker News, not on the front page | Tens to a few hundred visits | Common outcome. |
| Reddit | Hundreds to a few thousand when a post takes off | Many freelance and tax subreddits remove self-promotion. |
| LinkedIn or X from a personal account | Dozens to hundreds | Depends on followers; replies from your network help. |
| Indie Hackers | Dozens to hundreds | Good for feedback from builders. |

100,000 views by Sunday isn't a realistic target from a near-zero baseline. A good weekend is a few thousand visits, most of them from one post that catches on. Search traffic from the new posts builds over weeks to months, in time for January to April, when freelancers look for tax help.

## 3. Schedule

| When | What |
| --- | --- |
| Day 0, 8–9am US Eastern (a weekday morning gives Hacker News the best odds; a weekend morning is acceptable) | Hacker News post (option A below). Be available to reply for the next three hours. |
| Day 0, afternoon | LinkedIn post and X thread. |
| Day 1 | Reddit post in r/SideProject; Indie Hackers post. |
| Day 1–3 | Email existing users (section 4.6). Start preparer outreach (section 4.7). |
| January 2027 | Product Hunt launch, as in the plan. Create the upcoming page now. |

After posting: reply to every comment, especially in the first two hours. Don't ask anyone to upvote; Hacker News and Reddit both penalize coordinated voting. Watch the server-error alerts and the support inbox.

## 4. Copy

### 4.1 Hacker News, option A: the privacy essay (recommended)

- **Title:** Why tax apps shouldn't run ad pixels on your financial data
- **URL:** `https://writeoffapp.com/blog/tax-apps-ad-pixels-privacy` (no tracking parameters on Hacker News)
- **First comment, from the owner:**

> I build WriteOff, an expense-records app for freelancers. While deciding where our analytics could run, I learned that tax software counts as a "tax return preparer" under IRC §7216, which changes what you can do with ad pixels and even with signup events. The post covers what the regulations and the FTC's 2023 notices say, how to check a tax site with your browser's network tab, and what we do. I'm not a lawyer; corrections welcome.

### 4.2 Hacker News, option B: Show HN

- **Title:** Show HN: WriteOff – expense records for freelancers that your accountant can use
- **URL:** `https://writeoffapp.com`
- **Text:**

> Hi HN, I'm Pratham. [One or two sentences on why you built WriteOff.]
>
> WriteOff imports bank transactions through Plaid, or takes manual entries and receipt photos. It suggests a category for each expense with the reasoning shown, and only counts what you confirm. At year end it builds one package for your preparer: records, a CSV, receipts and a list of open questions, with an optional share link that expires after one to seven days.
>
> What it doesn't do: it doesn't file returns. Federal estimates cover common sole-proprietor and single-member LLC situations, and state figures are informational.
>
> Decisions HN might find interesting: there are no ad pixels anywhere, because tax software is a "preparer" under IRC §7216, so analytics never loads on signed-in screens. Totals include only confirmed expenses. The AI is not allowed to say things like "fully deductible".
>
> The calculators work without an account: https://writeoffapp.com/tools. The app is free for 30 days with no card. I'd especially like feedback on the review flow and the preparer package.

### 4.3 Reddit: r/SideProject

Read the subreddit rules first. Most freelance and tax subreddits ban self-promotion outside designated threads; there, answer questions without links unless the rules allow them.

- **Title:** I built an expense tracker for freelancers that ends in one package for your accountant
- **Body:**

> [Why you built it, in your words.]
>
> WriteOff imports your bank transactions or takes manual entries and receipt photos, suggests a category for each expense and shows why, and only counts what you confirm. At tax time you send your accountant one package: records, a CSV, receipts and a list of open questions.
>
> It doesn't file taxes and it doesn't promise to find every deduction. Free for 30 days, no card: https://writeoffapp.com/?utm_source=reddit&utm_medium=social&utm_campaign=launch_2026_09
>
> What would make you trust an app like this with your bank data? That's the feedback I need most.

### 4.4 LinkedIn

> Freelancers: how do you get a year of expenses to your accountant?
>
> [Your story in one or two sentences.]
>
> I built WriteOff to make it one step. Connect your bank or add expenses, confirm the category the AI suggests (it shows its reasoning), and send your preparer one package with records, receipts and open questions. It doesn't file taxes, and it doesn't promise to find every deduction. It keeps honest records.
>
> I'm looking for 20 freelance designers, developers, writers and consultants to use it through this tax season, with Premium free through April 15, 2027. Comment or message me.
>
> https://writeoffapp.com/?utm_source=linkedin&utm_medium=social&utm_campaign=launch_2026_09

### 4.5 X thread

1. Tax software counts as a "tax return preparer" under IRC §7216. That matters for the ad pixels many tax sites run. A short thread:
2. In 2022 The Markup found the Meta Pixel on well-known tax-filing sites, sending details like income and refund amounts to Facebook. A 2023 congressional report followed.
3. Under the Treasury rules, using tax return information for anything but preparing the return needs specific written consent. A privacy-policy click-through doesn't count, and consent can't be a condition of service.
4. In September 2023 the FTC warned five tax-prep companies that using this data for ads through pixels, cookies or SDKs without affirmative express consent may be unfair or deceptive. Penalties can reach $50,120 per violation.
5. How to check a tax site with your browser, and what we do at WriteOff (no ad tags, analytics only on public pages): https://writeoffapp.com/blog/tax-apps-ad-pixels-privacy?utm_source=x&utm_medium=social&utm_campaign=privacy_essay

### 4.6 Email to existing users

Send from a personal address, one person at a time or with BCC. If the email promotes anything beyond an update to the service people already use, include the business postal address and an unsubscribe line (CAN-SPAM).

- **Subject:** WriteOff update, and a favor
- **Body:**

> Hi {first name},
>
> You signed up for WriteOff earlier this year, so I wanted to tell you what's changed. AI suggestions now explain their reasoning, and totals include only what you confirm. At tax time you can send your accountant one package with your records, receipts and open questions.
>
> If you connected a bank before September, please reconnect it here so new transactions keep arriving: https://writeoffapp.com/plaid/reconnect
>
> Could I have 20 minutes of your time to hear what's missing? [Scheduling link]
>
> Thanks,
> Pratham

### 4.7 Preparer outreach (CPAs and enrolled agents with freelance clients)

- **Subject:** Cleaner records from your freelance clients
- **Body:**

> Hi {name},
>
> I build WriteOff, an app freelancers use to keep expense records during the year. At tax time, a client can send you one package: transaction CSV, receipts, business-purpose notes and a list of questions they couldn't resolve, through a link that expires after one to seven days. We don't file returns or give tax advice; the package is meant for preparers like you.
>
> Could I show you a sample package in 15 minutes and hear what would make it more useful for your practice? [Scheduling link]
>
> Pratham, WriteOff

### 4.8 Newsletter or creator pitch

> Hi {name}, I'm the founder of WriteOff, an expense-records app for freelancers that ends in one package for their accountant. Your readers ask about tax season every January. I'd be glad to write a practical piece on what freelancers should hand their preparer, with no product pitch in the body, or to discuss a sponsored slot with a clear disclosure. Here's an example of how we write about tax rules: https://writeoffapp.com/blog/tax-deductions-freelance-designers

## 5. Tracking links

Use these so first-party attribution and Google Analytics can tell channels apart. Leave Hacker News links clean.

| Channel | Link |
| --- | --- |
| LinkedIn | `https://writeoffapp.com/?utm_source=linkedin&utm_medium=social&utm_campaign=launch_2026_09` |
| X | `https://writeoffapp.com/blog/tax-apps-ad-pixels-privacy?utm_source=x&utm_medium=social&utm_campaign=privacy_essay` |
| Reddit | `https://writeoffapp.com/?utm_source=reddit&utm_medium=social&utm_campaign=launch_2026_09` |
| Indie Hackers | `https://writeoffapp.com/?utm_source=indiehackers&utm_medium=community&utm_campaign=launch_2026_09` |
| Existing-user email | No tracking link: analytics never loads on signed-in pages. Count reconnects and returning reviewers in the funnel report instead. |
| Preparer outreach | `https://writeoffapp.com/?utm_source=preparer&utm_medium=partner&utm_campaign=outreach_2026_10` |
| Designer guide | `https://writeoffapp.com/blog/tax-deductions-freelance-designers?utm_source={channel}&utm_medium={medium}` |
| Developer guide | `https://writeoffapp.com/blog/tax-deductions-freelance-software-developers?utm_source={channel}&utm_medium={medium}` |
| Consultant guide | `https://writeoffapp.com/blog/tax-deductions-independent-consultants?utm_source={channel}&utm_medium={medium}` |

## 6. Before any claim goes out

Check each post against the plan's claims policy: no "finds every deduction", "maximize", guaranteed savings, "file your taxes", "e-file", audit protection, or "free" for anything that isn't free to everyone; no testimonials or savings figures that aren't real and documented. The copy above already follows these rules. Keep it that way when editing.
