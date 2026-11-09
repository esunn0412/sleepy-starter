---
title: "kubeseat: attendee privacy"
description: "No personal data in logs, telemetry, or the shared talk index"
type: check
when: "PRs that change files under app/ or scripts/"
actions: "Comment on each place personal data could be logged, stored, indexed or exported, and request changes"
---

# Attendee privacy

- Never log names, emails, GitHub usernames, bios or resume text. Log attendee ids only.
- Never put personal data in OpenTelemetry span names, span attributes or metric attributes. Span names use route templates (`/api/attendees/:id`), not raw paths.
- Profile text (bio, GitHub, resume) is used only as a search query. It is never stored, and never indexed into Elasticsearch; the talk index holds talks only.
- Uploaded resume or LinkedIn PDF files are deleted after the profile is derived.
- Times are stored as UTC ISO 8601 strings and displayed in America/Denver.
