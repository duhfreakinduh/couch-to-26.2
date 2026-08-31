# AI / Contributor Guide

Keep this training planner simple, mobile-friendly, and useful without a network connection. AI coaching is optional guidance, not a replacement for the user's plan or professional advice.

## Priorities
1. Preserve offline/local-storage behavior and existing saved plans.
2. AI must fail gracefully and never block normal planning or logging.
3. Do not expose provider tokens in browser code or send personal workout data remotely without explicit action.
4. Prefer concise, explainable recommendations based on data already in the app.
5. Avoid making medical diagnoses or high-confidence injury claims.
6. Validate imported/saved data and handle corrupted local storage safely.
7. Keep touch targets, contrast, and keyboard navigation usable.
8. Update README/docs when behavior or storage formats change.

## Before merging
- Test with old saved data.
- Test offline.
- Test an AI failure/timeout path.
- Verify plan creation, editing, and persistence.
- Check mobile layout at narrow widths.
