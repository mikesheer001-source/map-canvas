# Map Canvas place upload standard

For every new researched place, use the live snapshot/API to avoid duplicates, and submit a complete place record. This standard applies to future Chat, agent and manual bulk uploads.

- Use a real, precisely matched Google Maps listing when available. Record its verified rating AND review count in the `rating` field as `4.5 (378 reviews)`. Do not substitute Tripadvisor, booking-site or another attraction's rating. If no exact Google rating is verifiable, leave it empty and explicitly note that it is unavailable; the map shows N/A. Never guess.
- Supply a relevant photo that actually opens as an image (HTTP 200, supported image MIME type), not an article URL or fragile image proxy. Prefer a licensed, attributed image stored using the existing photo upload service. For Wikimedia images with a compatible license, use the original upload.wikimedia.org URL and `"mirrorPhoto": true` on the manifest; include author, license and original file page in the notes. For other images only use URLs or uploads permitted by their terms and license.
- Include a verified location, category, title, Google Maps link, useful short notes, and price if known. Identify uncertain coordinates, prices or access explicitly. One good photo per location is sufficient.
- Publish via the established workflow with the current version for updates and null for new pins. Preserve existing creation timestamps; editing a pin must not restart its 24-hour highlight.
- Verify the saved record in the refreshed live snapshot and check the rating and photo in the map UI with ratings and pictures enabled, including dark mode and recent-pin styling. A Git commit alone is not a successful live upload. If an image fails, replace it with a permitted working photo rather than claiming success. Report any missing data or verification blockers.
- Public map entries are no-sign-in and do not need a contributor name. This is not a guarantee of anonymity: GitHub commits, service logs and public photo metadata can identify contributors. Do not include private personal information in public pins.

