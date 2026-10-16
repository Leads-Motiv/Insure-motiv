# Changelog — Insure Motiv

All notable changes to the Insure Motiv site.

The site is one page. `index.html` **was** generated from `bundled-original.html`
by `build/unbundle.py`. As of 2.0.0 it is no longer purely generated: the native
form, the TrustedForm loader and the consent block live in `index.html` only, so
`unbundle.py` refuses to rebuild without `--force-from-bundle`. See 2.0.0.

    python build/unbundle.py --check     # safe to run; inspects only

---

## [2.2.0] — 2026-10-16

**Browser guards are log-only, and rejected attempts are recorded.**

### Why

The form's three anti-bot guards (filled honeypot, submitted in under four
seconds, fewer than two input events) blocked submissions silently: nothing
recorded how often they fired, or whether real people were being turned away
by autofill. Server-side rejections (validation, duplicates, TrustedForm) were
not recorded either. This matches what Champion has run since October 16.

### What changed

| File | What changed |
|---|---|
| `browser-guard-policy.js` | **New.** The one switch: `mode: "log-only"`. Served `no-store`. |
| `index.html` | Guards report to `/api/rejection`, then continue unless the mode is `"enforce"`. A missing policy file behaves as log-only. In log-only mode the honeypot is cleared from the outgoing lead. `page_version` → `IM-FE-V2.2.0`. |
| `api/rejection.js` | **New.** Browser guard telemetry. Same-origin JSON only, 2 KiB cap, three known reason codes. Log-only events get an `_observed` suffix. |
| `api/_lib/lead-rejection.js` | **New.** Copied from Champion. Best-effort write to Supabase `fact_lead_rejection` after the response is sent; whitelisted fields only, no contact data. |
| `api/lead.js` | Records validation, honeypot, duplicate, TrustedForm and pipeline failures, with the stage they happened at. No change to any response. |
| `package.json` | Adds `@vercel/functions` 3.9.11 (pinned) for `waitUntil`. |

Rows use `property = 'insure-motiv'`. Writes happen only when `VERCEL_ENV` is
`production` **and** `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are set on the
Vercel project; otherwise each attempt logs `supabase_rejection_skipped` and
nothing else changes.

### To turn blocking back on

Change `browser-guard-policy.js` to `mode: "enforce"`, run `npm test`, commit,
deploy, reload. Open tabs keep the mode they loaded. The server still rejects a
populated honeypot on any direct post, in either mode.

---

## [2.0.0] — 2026-10-15

**The final expense form is native, and the page now certifies consent.**

### Why

The quote form was an embedded GoHighLevel iframe, and the page carried no
TrustedForm, Jornaya or LeadiD. Nothing was certifying consent, and it could
not be fixed in place: certification scripts have to run in the document the
consumer types into, and a cross-origin iframe is not that document.

That blocks a buyer outright. SSDI's SIO campaign requires
`trusted_form_cert_id`, and the September consent complaint on SSDI was only
resolved by producing the certificate and its session replay.

So the rebuild is not waiting on a buyer — it is what makes having one
possible. Only the delivery destination depends on the buyer being named.

### Files changed

| File | What changed |
|---|---|
| `index.html` | Both GoHighLevel iframes removed. Hero carries a native two-step form; the closing section links to it rather than embedding a second copy. TrustedForm loader, form behaviour and the consent block added. |
| `api/lead.js` | **New.** Ported from Window Motiv, minus the ZIP allowlist. |
| `api/_lib/config.js` | **New.** Final expense consent wording and the sign-off gate. |
| `api/_lib/validate.js` | **New.** Final expense fields, age band, no ZIP gate. |
| `api/_lib/sio.js` | **New.** Final expense payload, refuses unsigned consent. |
| `api/_lib/ghl.js` | **New.** Final expense field set. |
| `api/_lib/{logger,states,store,idempotency,trustedform}.js` | **New.** Ported unchanged. |
| `test/*.js` | **New.** 28 tests, including the consent guards below. |
| `package.json`, `.env.example`, `.gitignore`, `BACKEND.md` | **New.** |
| `vercel.json` | `api/lead.js` function config; no-store headers on `/api/*`. |
| `build/unbundle.py` | Rebuild guard — see below. |
| `build/fix_cls.py` | **Deleted.** It reserved layout space for the iframe's height jump. There is no iframe. |

### Two things testing turned up

**The host page replaces the form node.** The first version of the script
bound listeners to the form directly and silently did nothing. Instrumenting
it showed the node is correct at the end of the script and a *different node*
800ms later — the page's own renderer (`#dc-root`) re-renders after load and
swaps the subtree, taking every listener and hand-written attribute with it.

The script now holds nothing across time: listeners are delegated on
`document`, elements are looked up when used, and the current step is read
from the DOM rather than remembered, so a re-render cannot desynchronise it.
A short-lived MutationObserver re-applies the date bounds and tracking fields
and then disconnects.

**The GoHighLevel embed runtime was still loading, twice.**
`assets/1710ab34.js` (`ghl_embed`, `__ghl_iframe_resizer_initialized__`) was
referenced by two script tags with no embeds left to manage. Both tags and the
asset are removed.

### One form, not two

The closing section now links to the hero form instead of carrying a second
copy. TrustedForm injects its certificate field by name, so two forms on one
page makes it ambiguous which field belongs to which submission.

### Consent wording

Champion's wording was deliberately **not** carried across. It consents to
"calls and text messages", names no buyer, and is written for home
improvement. The final expense purchase order is **calls only**.

The wording lives in `api/_lib/config.js` and in the `im-consent` label in
`index.html`. `test/consent.test.js` fails the build if the two drift apart,
if the text ever mentions texts or SMS, or if Champion's phrasing reappears.

### The sign-off gate

The buyer is undecided, so the wording carries one unresolved slot,
`[BUYER LEGAL NAME]`. While that marker is present:

- `sio.js` refuses to build a payload — `QUARANTINE`, `consent_text_awaiting_signoff`
- `lead.js` logs an error-level transition on every submission
- the page shows a visible draft warning above the checkbox

No lead can reach a buyer on unsigned wording, even fully deployed. Going live
means replacing the marker in both places, deleting the on-page warning, and
having the result signed off.

### Eligibility

Ages 50–85 inclusive, computed server-side from the submitted date of birth
rather than trusted from the browser. No buyer is named, so that band is the
conservative default and the one number to revisit against a purchase order.

No ZIP allowlist: Window Motiv gated on Champion's 9,225 covered ZIPs, and
there is no final expense coverage list because there is no buyer yet.

### Still outstanding

The page shows a placeholder telephone number, `(800) 555-0123`, in three
places. 555-01xx is a reserved fictional range, so it must be replaced or
removed before launch.

---

## [1.7.2] — 2026-09-11

**Favicon on the home page, and a font-path bug on the subdirectory page.**

### Files changed

| File | What changed |
|---|---|
| `build/unbundle.py` | Favicon link added to the home page head. |
| `build/gen.py` | Subdirectory rewrite now covers CSS `url()`, not just attributes. |
| `index.html`, `disclosures/marketing-partners.html` | Regenerated. |

The bundle shipped no favicon link, so `index.html` was the only page on the
site without one — every generated page has carried `assets/favicon.svg` since
those were built.

Adding it surfaced a second problem. The `../` prefixing for pages in a
subdirectory only rewrote `href` and `src` attributes, so the `@font-face`
rules, which reach the files through CSS `url()`, were left pointing at
`assets/...` from inside `disclosures/`. All 30 font URLs on that page were
404ing and it was falling back to system fonts. Now prefixed too; verified
2/2 fonts load and Source Serif 4 applies.

Home page unchanged otherwise: CLS 0.0000, 6/6 images, both form iframes
1027px, analytics firing.

---

## [1.7.1] — 2026-09-10

**Header logo links to the home page.**

### Files changed

| File | What changed |
|---|---|
| `build/unbundle.py` | Wraps the header brand in a link. |
| `index.html` and every generated page | Regenerated. |

The brand was a plain `<div>`, so neither the logo tile nor the wordmark was
clickable — it had nowhere to link to until the inner pages existed. It is now
an `<a href="index.html">` around the tile and the name, a 239×40px target,
`aria-label="Insure Motiv home"`. Every Motiv site links its header brand home.

Verified by clicking the logo on Terms of Use and landing on the home page.

---

## [1.7.0] — 2026-09-10

**Thank-you page.** The site had none; PestMotiv has one, so this matches it.

### Files changed

| File | What changed |
|---|---|
| `thank-you.html` | **New.** |
| `build/src/thank-you.txt` | **New.** Its source. |

Plain document, like the other legal pages, on the site's header and footer.
Says what happens next, repeats the carrier and Medicare disclaimers, and links
the Privacy Policy and the Marketing Partners disclosure.

### Not reachable yet — needs a GoHighLevel setting

The quote form is a GoHighLevel embed, so what happens after a visitor submits
is configured **inside GoHighLevel**, not in this HTML. Nothing on the site can
route to this page. Point the form's post-submit redirect at `/thank-you.html`
or no one will ever land on it.

PestMotiv does not have this problem: its form is native to the page and shows
an inline result panel, so its `thank-you.html` is a spare rather than the main
path.

---

## [1.6.0] — 2026-09-10

**Marketing Partners and Affiliate Disclosure pages**, and the footer legal row
matched to Window Motiv's.

### Files changed

| File | What changed |
|---|---|
| `disclosures/marketing-partners.html` | **New.** 11 sections. |
| `Disclosure.html` | **New.** Forked from Window Motiv's rich page. |
| `build/fork_disclosure.py` | **New.** Does that fork. |
| `build/_vertical.py` | **New.** The insurance wording, shared by both scripts. |
| `build/src/marketing-partners.txt` | **New.** Adapted source. |
| `build/adapt_sources.py` | Imports the shared wording; builds the marketing source too. |
| `build/_changelog.py` | Changelog comments for both new pages. |
| `build/gen.py` | Prefixes relative references with `../` for pages in a subdirectory. |
| `build/fork_footer.py` | Legal row keeps Window Motiv's Marketing Partners link. |
| `index.html`, `privacy-policy.html`, `terms-of-use.html` | Regenerated. |

### Footer

The legal row is now Window Motiv's three: **Privacy Policy · Terms of Use ·
Marketing Partners**, on all five pages. The Affiliate Disclosure is
deliberately not in the row, per the client; the Marketing Partners document
links to it as the directory of participating companies.

### Shared wording

The vertical rewrites moved out of `adapt_sources.py` into `build/_vertical.py`,
imported by both it and `fork_disclosure.py`. Without that the two would have
been free to describe the same business differently. The entity constant lives
there now too.

### The Disclosure page

Window Motiv's page is a rich design — hero, summary strip, network lanes,
policy cards, accordion FAQ, participant directory. It is fully token-driven,
so the palette was one block; the shell was swapped for this site's header,
forked footer, self-hosted fonts and analytics tag.

Beyond the shared rules it needed **34 page-specific rewrites**, because the
copy names the vertical throughout — "window count", "replacement windows or
installation", "Window-project details", "purchase windows, installation,
financing". A disclosure page describing window counts on an insurance site
would have been worse than no page.

Two things the palette block did not reach:

- **The hero graphic and chip icons are hardcoded hexes, not tokens.** Left
  alone the page kept Window Motiv's orange nodes. Mapped to two tints of the
  site's teal so the graphic still distinguishes node types.
- **The footer's own changelog comment sits above the footer div**, so cutting
  at the div left ~50 lines of Window Motiv footer history inside the body.

The participant directory itself is unchanged: it is the Motiv network, shared
across the brands, and PestMotiv's disclosure lists the same companies.

### Subdirectory paths

The site uses relative paths, so a page written to `disclosures/` needs `../`
in front of every reference. `gen.py` now adds it, leaving absolute, anchor,
`tel:`, `mailto:` and `data:` references alone. That keeps Window Motiv's URL
shape (`/disclosures/marketing-partners`) without breaking the relative paths.

Verified: 5 pages, 0 dead links, no window copy outside the build comments,
CLS 0.0000, 6/6 images, analytics firing.

---

## [1.5.1] — 2026-09-10

**Insurance and TCPA paragraph moved under the footer logo and name**, per the
client.

### Files changed

| File | What changed |
|---|---|
| `build/fork_footer.py` | Paragraph moved from the secondary band into the primary one. |
| `build/_footer.html` | Re-forked. |
| `index.html`, `privacy-policy.html`, `terms-of-use.html` | Regenerated. |

It was beneath the house disclosure in the legal band; it now sits directly
under the brand, above the fold of the footer. The brand link and the paragraph
are wrapped in a `.wmf-brand-block` column, which is the primary grid's first
child, so the logo, name and call to action still share one line and the
paragraph flows beneath them.

`.wmf-primary-inner` changes from `align-items: center` to `start`, or the call
to action would float at the vertical centre of a now much taller left column.
The paragraph takes no width cap: the brand column is the `1fr` of
`minmax(0, 1fr) auto`, so it runs to where the call to action begins — an
earlier `78ch` cap left a wide empty gap beside it.

The secondary band is back to Window Motiv's two children: house disclosure on
the left, copyright and legal links on the right.

Verified at 1440px and 390px, on all three pages. At 390px the band stacks:
brand, paragraph, phone, call to action; no horizontal overflow.

---

## [1.5.0] — 2026-09-10

**Footer layout matched to the other Motiv sites.** Forked from Window Motiv's
global footer rather than restyled, so the structure is the same one, not an
imitation of it.

### Files changed

| File | What changed |
|---|---|
| `build/fork_footer.py` | **New.** Forks `motiv/build/_footer.html` into this site's. |
| `build/_footer.html` | **New.** The forked component. |
| `build/unbundle.py` | Replaces the bundle's footer with the component; the 1.4.0 disclosure injection is gone, the component carries it. |
| `build/extract_shell.py` | Extracts the header and fonts only; `fork_footer.py` owns the footer now. |
| `index.html`, `privacy-policy.html`, `terms-of-use.html` | Regenerated. |

### Layout

The same two bands Window Motiv and PestMotiv use, with the same class names
and the same footer script:

- **Primary band** — brand on the left (mark, wordmark, tagline), call to
  action on the right.
- **Secondary band** — disclosure on the left, copyright and legal links on
  the right.

The bundle's footer was a single flat row with a rule under it, which is why it
did not match.

### Insure Motiv differences, each forced

- Palette is the site's navy and teal; type is Public Sans and Source Serif 4,
  the faces this site self-hosts, not Inter. The brand accent was hardcoded
  `#ffab7b` rather than a palette token, so it needed its own rule.
- The mark is the header's "IM" tile, not Window Motiv's window glyph.
- The call to action is a link to `#quote` plus the phone, so Window Motiv's
  survey button and the seven functions of modal-opening JavaScript behind it
  are dropped — there is no survey modal here to open. `setCurrentYear()` and
  `setActiveLinks()` are kept and both work: the legal link for the current page
  is marked `aria-current`.
- The legal row is Privacy Policy and Terms of Use; there is no Marketing
  Partners page on this site.
- The insurance and TCPA paragraph is kept beneath the house disclosure, as
  fine print. `.wmf-secondary-inner` is a two-column grid, so both paragraphs
  share the first cell — a third child would have broken the row.

Verified on all three pages. Home page unchanged otherwise: CLS 0.0000, 6/6
images, both form iframes 1027px, analytics firing, FCP 96 ms.

---

## [1.4.0] — 2026-09-10

**Footer disclosure**, in the Motiv house form Window Motiv and PestMotiv use.

### Files changed

| File | What changed |
|---|---|
| `build/unbundle.py` | Emits the standard disclosure into the footer. |
| `index.html`, `privacy-policy.html`, `terms-of-use.html` | Regenerated — all three carry it. |

The bundle shipped without one. Same shape as the other two sites: who the
entity is, what the service does, and that submitting a request means agreeing
to the Terms and acknowledging the Privacy Policy, with both linked.

```
Insure Motiv disclosure: Insure Motiv is a DBA of Leads Motiv, LLC. Insure
Motiv connects consumers with participating licensed insurance agents and
carriers. By submitting a request, you agree to our Terms of Use and
acknowledge our Privacy Policy. Your information may be shared with
participating providers and marketing partners as described in our Privacy
Policy.
```

Two differences from Window Motiv's, both forced:

- It ends at the Privacy Policy. Window Motiv points at a Marketing Partners
  Disclosure and PestMotiv at an Affiliate Disclosure; this site has neither.
- It sits **above** the existing insurance paragraph rather than replacing it.
  That paragraph carries the carrier, Medicare and TCPA disclaimers, which the
  house disclosure does not cover.

Because the legal pages take their footer from `index.html`, all three pages
carry it. Every link in the footer resolves.

---

## [1.3.1] — 2026-09-10

**Fixed: images, fonts and components did not load unless the folder was the
web root.** Reported as "the images and all not loading" on the home page.

### Files changed

| File | What changed |
|---|---|
| `build/unbundle.py` | Asset and legal-page paths emitted relative. |
| `build/extract_shell.py` | Header/footer links emitted relative. |
| `build/adapt_sources.py` | In-body legal links emitted relative. |
| `build/gen.py` | Favicon path relative. |
| `index.html`, `privacy-policy.html`, `terms-of-use.html` | Regenerated. |

### What was wrong

Every generated path was root-absolute (`/assets/...`), so it only resolved
when `insure-motiv/` was itself the web root. Opening `index.html` from disk,
or serving it from a parent folder, pointed the browser at a root with no
`assets/` directory.

The images were the visible symptom, but the worse part was silent: the
`image-slot` component's own script is at `/assets/fa6c1a4c.js`, so it 404s
too, the custom element is never defined, and all six slots collapse to
**zero height** — the pictures do not break, they disappear along with the space
they occupied. The self-hosted fonts fell back to system faces for the same
reason.

Reproduced by serving the parent folder: `customElements.get('image-slot')`
returned `undefined` and every slot measured 0px tall.

### The fix

Paths are relative now, so the site works from the web root, from a subfolder,
and from disk. Verified in all cases:

| Served as | image-slot defined | Images loaded | Fonts |
|---|---|---|---|
| `/index.html` (folder as root) | yes | 6/6 | loaded |
| `/insure-motiv/index.html` (subfolder) | yes | 6/6 | loaded |

CLS still 0.0000, both form iframes 1027px, analytics still firing.

---

## [1.3.0] — 2026-09-10

**Privacy Policy and Terms of Use.** The site had neither; the footer linked
`#privacy` and `#terms`, which were anchors to nothing.

### Files changed

| File | What changed |
|---|---|
| `privacy-policy.html` | **New.** 22 sections. |
| `terms-of-use.html` | **New.** 33 sections. |
| `build/src/privacy-policy.txt`, `build/src/terms-of-use.txt` | **New.** Copied from Window Motiv, then adapted. |
| `build/adapt_sources.py` | **New.** Rewrites the Window Motiv sources for insurance. |
| `build/gen.py` | **New.** The Motiv legal-page renderer, on the Insure Motiv palette. |
| `build/extract_shell.py` | **New.** Pulls the header, footer and @font-face block out of `index.html`. |
| `build/_changelog.py` | **New.** The per-page changelog comment. |
| `build/_header.html`, `build/_footer.html`, `build/_fonts.html` | **New.** Generated by `extract_shell.py`. |
| `build/unbundle.py` | Points the footer's `#privacy` and `#terms` at the new pages. |
| `index.html` | Regenerated — four `href`s, nothing else. |

### Same documents as Window Motiv

Section-for-section identical, in the same order, which is how Pest Motiv's
were done:

| | Window Motiv | Insure Motiv |
|---|---|---|
| Privacy Policy | 22 sections | 22 sections |
| Terms of Use | 33 sections | 33 sections |

Two headings differ, because the vertical does:

```
4. PROPERTY AND PROJECT INFORMATION    ->  4. COVERAGE AND ELIGIBILITY INFORMATION
8. WINDOW MOTIV AND HOME-IMPROVEMENT   ->  8. INSURE MOTIV AND INSURANCE SERVICES
```

Beyond the names, the wording had to change where a final-expense site cannot
say what a window site says. Insurance also carries disclaimers home
improvement does not, and these follow what `index.html` already tells
visitors, so the pages and the site cannot drift apart:

- not a carrier, insurer, underwriter, agency, or licensed producer;
- not affiliated with Medicare, Medicaid, the SSA, or any state insurance
  department;
- coverage, rates, and eligibility decided solely by the carrier's
  underwriting;
- nothing on the site is an offer of insurance, a solicitation where a product
  is unavailable, or insurance, tax, legal, or financial advice.

The collected-data table now lists what the live form actually asks for. The
policy states that Insure Motiv collects no health information through its lead
forms — true of the current form — and that an agent or carrier may ask health
questions separately, under their own privacy practices.

### Design

Insure Motiv's own header and footer, extracted from `index.html` rather than
copied by hand, so a change to the site's header reaches these pages by
re-running `extract_shell.py`. Same for the self-hosted `@font-face` block, so
the pages render in Public Sans and Source Serif 4 rather than system fonts.
The plain-document layout is Window Motiv's, on the Insure Motiv palette — navy
ink, teal accents, ivory ground. Footer disclosure and its Privacy Policy /
Terms of Service links appear on both pages, as on the home page.

### Not built

- **No Marketing Partners / disclosures page**, per the client. The inherited
  sources linked one seven times; those references are now plain text rather
  than dead links. Window Motiv's link to a separate participating-company
  directory at `/Disclosure.html` was dropped for the same reason.
- **The home page was not otherwise touched.** The only change is four `href`
  attributes — the two dead anchors, each appearing twice. Layout, copy, the
  form, analytics and the CLS work are all as they were.

### Needs client confirmation

- **Legal entity.** `index.html` names none, so these follow the Pest Motiv
  pattern: a DBA of Leads Motiv, LLC, a subsidiary of Motiv Brands, Inc. To
  change it, edit `ENTITY` in `build/adapt_sources.py` and re-run.
- **Legal review.** Insurance is regulated; counsel should approve before
  publication, particularly the state privacy rights, California,
  sale/sharing, data-retention, arbitration and insurance-disclaimer sections.

Verified: every internal link resolves, no `Window Motiv` or `PestMotiv` string
survives outside the build comment, and the entity reads the same on both pages.

---

## [1.2.0] — 2026-09-09

**Google Analytics 4.** Measurement ID `G-0TFCXJL0Z8`, the standard gtag.js
snippet, in `<head>` on the site's single page.

### Files changed

| File | What changed |
|---|---|
| `build/unbundle.py` | GA4 snippet added to the `<head>` injection, as `GA_ID` + `ANALYTICS`. |
| `index.html` | Regenerated — carries the tag. |

The snippet is injected by the build rather than typed into `index.html`,
because `index.html` is generated and a hand-edit would be lost on the next
`python build/unbundle.py`.

Verified in the browser: `gtag` defined, `dataLayer` carries `js` and
`config: G-0TFCXJL0Z8`, and a real `page_view` reaches
`google-analytics.com/g/collect` with `tid=G-0TFCXJL0Z8`. This is the site's
first analytics tag — there was no previous property to remove.

CLS re-checked after the change and still 0.0000; FCP 104 ms, DCL 33 ms.

---

## [1.1.0] — 2026-09-09

**Loading and layout stability.** Client report: *"An old menu header flashes
during load, potentially slowing site performance"*, plus the hero form
repositioning itself after load.

### Files changed

| File | What changed |
|---|---|
| `index.html` | Regenerated as a plain 51 KB page instead of a 1,426 KB self-extracting bundle; quote-form height reserved and skeleton added. |
| `assets/` | **New.** 18 files unpacked from the bundle: 6 webp, 9 woff2, 3 js, favicon. |
| `bundled-original.html` | **New.** The delivered bundle, kept for reference. Not deployed. |
| `build/unbundle.py` | **New.** Unpacks the bundle into a normal static site. |
| `build/fix_cls.py` | **New.** Reserves the quote-form height and fills the reserve while it loads. |
| `.image-slots.state.json` | **New.** Empty state file the image-slot component fetches; silences a 404. |
| `vercel.json` | **New.** Immutable caching on `/assets/`. |
| `.vercelignore` | **New.** Keeps `build/`, `CHANGELOG.md` and the 1.4 MB bundle out of the deploy. |

### The header flash

The delivered `index.html` was a self-extracting bundle: a full-screen navy
placeholder with an "Unpacking…" badge, a 1.4 MB base64 manifest holding every
image, font and script, and the real page stored as a JSON string. Nothing
rendered until JavaScript decoded ~926 KB of base64 and rebuilt the document,
so every visitor saw the placeholder first. **That placeholder was the "old
menu header" the client reported** — not a stale header, but the bundler's
splash.

`build/unbundle.py` writes the real document to `index.html` and each asset to
`assets/`, so the browser gets HTML in the first byte and fetches assets in
parallel and individually cacheable. It also:

- drops one script the page never referenced,
- removes two Google font preconnects that cost a DNS + TLS handshake each and
  were never used, since the fonts are self-hosted,
- hoists the `@font-face` block out of `<helmet>` into `<head>` so the font
  fetch starts during the initial HTML parse rather than after a 69 KB script
  has executed,
- adds the title, meta description, robots tag and a preload for the first
  font.

| | Before | After |
|---|---|---|
| `index.html` | 1,426 KB | 51 KB |
| DOMContentLoaded | 109 ms | 29 ms |
| First Contentful Paint | 96 ms (splash) | 68 ms (real content) |
| Splash screen | shown every load | gone |

First-party console errors: 0. Four remain, all from Cloudflare Turnstile
inside the embedded GoHighLevel form.

### The hero form jump (CLS 0.1495 → 0.0000)

Both quote-form iframes declared `min-height: 652px`, but the GoHighLevel
resizer grows them to their real height once the form reports back — measured
**1027px** at 1440px wide and **1187px** at 390px. The hero card therefore grew
~375px after load. Measured CLS was **0.1495** ("needs work"), and both shifts
attributed to `div#quote`.

`build/fix_cls.py` moves the sizing out of the inline `style` attribute — which
cannot hold a media query — into a `<head>` rule that reserves the measured
height at each breakpoint. The resizer is still free to adjust afterwards; this
only removes the first-load jump.

| Viewport | Before | After |
|---|---|---|
| 1440 × 900 | 0.1495 | 0.0002 |
| 390 × 844 | 0.1495 | 0.0000 |

### The blank card

Reserving the height exposed the next problem: the resizer keeps its iframe
`visibility: hidden` until the form reports, so the reserved space showed as a
tall empty card. Each iframe now sits over a skeleton — a label bar and a field
bar tiled down the full reserve, with a shimmer sweep.

No load handshake is involved. The skeleton sits at `z-index: 0` and the iframe
at `z-index: 1`, so the skeleton is simply covered when the resizer reveals the
iframe over it. Both iframes are given an opaque white background for this: the
GoHighLevel form itself is transparent, and the footer copy shipped without a
background, so the skeleton bars showed through its loaded fields. Both cards
behind these iframes are already white, so this changes nothing once loaded.

The shimmer runs a bounded 10 iterations — the skeleton stays in the DOM under
the loaded form, and an infinite animation there would repaint for the life of
the page.

### Tried and reverted

Both were verified in the browser, not assumed:

- **`onload` on the iframe** to fade the skeleton out. The embed strips the
  attribute and re-parents the iframe into its own `.ep-wrapper`, so the
  handler never fires and `this.parentNode` is no longer the shell.
- **`loading="lazy"` on the below-fold second form.** The resizer hides the
  iframe at init and reveals it when the form posts its height; deferring the
  load misses that handshake and the iframe stays `visibility: hidden`
  permanently, leaving the skeleton up for good.

### Deploy

`public/` is deliberately not used as a folder name — Vercel treats it as the
entire output directory for a zero-config static project, which would publish
the assets and no `index.html`.
