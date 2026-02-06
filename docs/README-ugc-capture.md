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
  "url": "https://..."
}
```

or

```json
{
  "type": "video",
  "url": "https://..."
}
```

---

## Cost guideline

* $50–75: Simple sign-holding photo
* $100–150: Location-specific or time-bound capture

---

## Failure cases

* Human declined task
* Location not reachable
* Timeout

---

## Summary

This API provides **human-authenticated content**.

Use it when authenticity matters more than polish.
