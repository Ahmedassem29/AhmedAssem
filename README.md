# Ahmed Assem

Portfolio website for Ahmed Assem, promo producer, VFX compositor and AI video artist based in Dubai. Promos, trailers and visual effects for Arabic television, film and brands.

**Live site:** https://aahmedassem.com

## What's in this repo

| File | What it is |
| --- | --- |
| `index.html` | The whole site in one file: layout, styles, the animated light hero (WebGL) and scripts |
| `og-image.jpg` | Preview image shown when the site link is shared on WhatsApp, LinkedIn or X |
| `CNAME` | Tells GitHub Pages to serve the site on `aahmedassem.com` |

## Editing the site

Everything lives in `index.html`. The usual edits:

- **Showreels:** each reel card has a `data-vimeo="VIDEO_ID"` attribute. Change the number to swap the video. The same attribute on the hero's "Watch the reel" button sets which reel it opens.
- **Experience:** the roles are listed in the `#experience` section. The timeline clips above them use `--s` (start) and `--e` (end), counted in years after 2010.
- **Contact:** the email, WhatsApp number and profile links are in the `#contact` section.

Commit the change to the `main` branch and GitHub Pages republishes the site within a minute or two.

## Hosting and domain

The site is published with GitHub Pages (Settings → Pages → Deploy from a branch → `main`, `/ (root)`).

The domain's DNS is managed at GoDaddy and needs exactly these records:

| Type | Name | Value |
| --- | --- | --- |
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | ahmedassem29.github.io |

GoDaddy's default parking records (`A @ 15.197.148.33` and `A @ 3.33.130.190`) must be deleted so only the four GitHub addresses remain. Once the DNS check passes in Settings → Pages, tick **Enforce HTTPS**.

© Ahmed Assem. All rights reserved.

## أرخص أكلة (`/food`)

A private page at `aahmedassem.com/food` that ranks Talabat deals near Al Zahya, Ajman by the estimated total you'd actually pay (talabat pro rules: free delivery from 30 AED, small-order fee under 20 AED, ~10% service fee capped at 3.25).

- `food-tool/scrape.py` collects the deals. Food types and their keywords are in `CATEGORIES` at the top.
- `.github/workflows/food-deals.yml` runs it five times a day and saves `food/data.json`. Run it any time from the Actions tab → food-deals → Run workflow.
- `food/index.html` is the page; add it to the phone's home screen to use it like an app.
