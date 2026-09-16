# us — V1 Product & Engineering Specification

> **us**
>
> *just us.*

## 1. Product

us is a private, campus-only dating web app.

Students from the same college can:

1. Verify that they belong to the campus.
2. Create a simple dating profile.
3. Discover other verified students.
4. Like or pass on profiles.
5. Match when the like is mutual.
6. Start a private conversation.

### Core match message

> **it's a match.**
>
> *you both liked each other.*

The V1 product intentionally does not attempt to become a social network.
The core loop is:

**Discover → Like → Match → Chat**

---

# 2. Product Identity

## Name

**us**

## Tagline

**just us.**

## Match copy

**it's a match.**

*you both liked each other.*

## Brand principles

The interface should feel:

- Minimal
- Romantic
- Warm
- Private
- Exclusive
- Modern
- Youthful without being gimmicky
- Premium rather than over-designed

The product must NOT feel:

- Corporate
- Generic
- Like a template
- Like a "vibe-coded" project
- Overly colorful
- Over-animated
- Like a direct Tinder clone

---

# 3. V1 Scope

## Included

### Authentication / verification

- Phone number
- USN
- Optional student email
- USN format validation using college-specific regex
- Internal anonymous user ID
- Verification data must never appear on public profiles

### Profile

A profile contains:

- Nickname
- Age
- Year
- Branch
- Profile photos
- Optional short bio/interests

### Discovery

- One profile card at a time
- Swipe right → Like
- Swipe left → Pass
- Like/pass buttons as secondary controls
- Only eligible campus users appear
- Previously processed profiles should not reappear unnecessarily

### Matching

A match occurs when:

```text
User A likes User B
        +
User B likes User A
        ↓
      MATCH