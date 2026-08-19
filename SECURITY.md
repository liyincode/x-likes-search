# Security Policy

## Supported versions

Security fixes are provided for the latest published release only. Before reporting an issue, please confirm that it still occurs with the newest version from the [Releases page](https://github.com/liyincode/x-likes-search/releases/latest).

## Reporting a vulnerability

Please use GitHub's [private vulnerability reporting](https://github.com/liyincode/x-likes-search/security/advisories/new). Do not open a public issue for a suspected security vulnerability.

Include the following when possible:

- the affected extension version and Chrome version;
- a concise description of the impact;
- reproduction steps or a minimal proof of concept;
- whether the issue exposes local data, expands host access, or sends data outside X and the extension.

Never include cookies, authorization headers, CSRF tokens, captured request templates, or other account credentials. Redact personal data from screenshots and logs.

Reports are reviewed on a best-effort basis. Valid issues will be investigated privately before details are published.

## Security model

X Likes Search has no backend server or telemetry. It stores the captured Likes request template and indexed likes in Chrome's local extension storage, and sends authenticated sync requests only to X. Security reports involving unexpected network destinations, unintended data exposure, or permission escalation are in scope.
