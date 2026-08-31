# Security Policy

## Reporting a vulnerability
Do not post secrets, tokens, private URLs, personal data, exploit details, or sensitive logs in a public issue. Use GitHub private vulnerability reporting if enabled; otherwise open only a minimal public issue until a private channel is established.

## Security expectations
- Never commit credentials or provider tokens.
- Treat saved plans, progress, and workout history as private local data.
- Do not send personal fitness data to remote AI services without explicit user action and disclosure.
- Validate imported/saved data and handle corrupted local storage safely.
- Keep AI/network calls bounded by timeouts and safe fallbacks.
- Review dependency/CDN changes before release.
