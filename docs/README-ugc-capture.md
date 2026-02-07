# Human UGC Capture API

An API for AI agents to generate **human-authenticated visual content**.

---

## When to use this API

Use this tool when **human presence itself** is the value.

Typical use cases:

* A person holding a specific sign or message
* Proof that content was created by a real human
* Location-specific UGC (storefront, street, event)
* Anti-synthetic or anti-AI verification content

This API is not for generic stock images.

---

## What makes this different

* Real humans perform the task
* Content cannot be generated or faked by AI
* Clear proof-of-presence

---

## Tool usage example

```json
{
  "task": "Hold a sign that says 'Hello from Shibuya' and take a photo",
  "origin_country": "JP",
  "task_label": "real_world_verification",
  "acceptance_criteria": "Submit one clear sign-holding photo with location context.",
  "not_allowed": "Do not include third-party faces in close-up or private property interiors.",
  "location": "Shibuya, Tokyo",
  "budget_usd": 100,
  "deliverable": "photo"
}
```

---

## Deliverables

```json
{
  "type": "photo",
  "content_url": "https://..."
}
```

or

```json
{
  "type": "video",
  "content_url": "https://..."
}
```

Deliverables are returned in `submission` via `GET /api/tasks/:taskId`.

---

## Cost guideline

* $50–75: Simple sign-holding photo
* $100–150: Location-specific capture

---

## Failure cases

* Human declined task
* Location not reachable
* Timeout

Failure reasons are returned as enums.

---

## Task lifecycle

```
open -> accepted -> completed
open -> failed
accepted -> failed
```

Timeouts are enforced by a server-side sweeper while the process is running.

---

## Failure reasons (enum)

* `no_human_available`
* `timeout`
* `invalid_request`
* `below_min_budget`
* `missing_origin_country`
* `wrong_deliverable`
* `already_assigned`
* `not_assigned`
* `missing_human`
* `not_found`
* `unknown`

---

## i18n (human UI only)

* Internal data is stored in English (`task_en`).
* UI requests may pass `lang=en|ja` and receive `task_display`.
* Translations are cached and reused.

---

## Summary

This API provides **human-authenticated content**.

Use it when authenticity matters more than polish.
