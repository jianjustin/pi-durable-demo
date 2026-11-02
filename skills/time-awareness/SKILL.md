---
name: time-awareness
description: Answer questions about the current time or date accurately by using the get_current_time tool. Use when the user asks what time or date it is in any location.
---

# Time awareness

For a question about the current time or date, call `get_current_time` before answering.

- If the user specifies a city, country, or time zone, pass its IANA time zone identifier (for example, `Asia/Shanghai`) to the tool.
- If no location is specified, call the tool without `timeZone` and identify the result as the machine's local time.
- Base the answer on the tool result. Do not estimate, reuse an earlier result as if it were current, or invent a time.
- If the tool fails because the supplied time zone is invalid, ask the user for the city or a valid IANA time zone.
