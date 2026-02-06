# Property Verification API (Human-backed)

An API for AI agents to verify **real-world property conditions** using on-site humans.

---

## When to use this API

Use this tool when an AI needs **physical confirmation** related to real estate.

Typical use cases:

* Verify if a property exists at a given address
* Take photos of building exterior or entrance
* Confirm presence of signs, nameplates, or notices
* Check occupancy indicators (lights, mailboxes, posted info)

If the information can be obtained from public databases or listings, **do not use this API**.

---

## What this API provides

* On-site human verification
* Photo or text-based proof
* Clear success / failure signaling
* No human interaction required by the agent

---

## Tool usage example

```json
{
  "task": "Take a photo of the building entrance and nameplate",
  "location": "Shinjuku, Tokyo",
  "budget_usd": 120,
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
  "content": "The building exists and the nameplate matches."
}
```

---

## Cost guideline

* $75–100: Exterior photo verification
* $120–150: Multi-angle or time-sensitive confirmation

---

## Failure cases

* Property inaccessible
* No human available in the area
* Timeout before deadline

Failures are explicit and safe to retry.

---

## Summary

This API gives AI agents **ground truth for real estate**.

Use it only when physical verification is required.
