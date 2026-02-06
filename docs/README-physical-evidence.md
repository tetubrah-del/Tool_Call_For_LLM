# Physical Evidence Collection API

An API for AI agents to collect **real-world evidence** via human presence.

---

## When to use this API

Use this tool when **legal or compliance workflows** require physical confirmation.

Typical use cases:

* Confirm posted notices or warnings
* Verify signage compliance
* Check if required documents are publicly displayed
* Collect time-stamped physical evidence

This API does not provide legal interpretation.

---

## What this API guarantees

* Human-performed verification
* Structured evidence output
* Explicit failure modes
* No direct human-agent communication

---

## Tool usage example

```json
{
  "task": "Take a photo of any posted legal notices at the storefront",
  "location": "Osaka",
  "budget_usd": 150,
  "deliverable": "photo"
}
```

---

## Deliverables

```json
{
  "type": "photo",
  "url": "https://..."
}
```

or

```json
{
  "type": "text",
  "content": "No legal notices were visible at the location."
}
```

---

## Cost guideline

* $100–150: Single-location evidence capture
* $150+: Multi-point or strict deadline tasks

---

## Failure cases

* Access restricted
* Unsafe environment
* No available human

Failures are explicit and should be handled programmatically.

---

## Summary

This API provides **physical evidence**, not opinions.

Agents are responsible for downstream interpretation.
