---
sources:
  - https://eu.forums.blizzard.com/en/wow/t/wow-forever-hotfixes-november-11-2026/639885/1
  - https://www.warcrafttavern.com/forever/guides/
checked: 2026-11-25
scope: mixed
---

<!-- The sources above are the first places to look for a fresh web check (trust step 3):
     Blizzard's running Forever hotfix thread, and Warcraft Tavern's Forever guide index. -->


# Knowledge files

Small, hand-maintained, sourced reference notes the Forever Companion advisor reads before answering.

## Format

Every Markdown file starts with YAML frontmatter:

```yaml
---
sources: [https://..., https://...]   # every non-obvious claim must trace to one of these
checked: 2026-11-25                   # date the facts were last verified
scope: forever | classic | mixed      # forever = WoW: Forever sources; classic = Classic Era / 2019 sources; mixed = both
---
```

- Inside a `mixed` file, claims that come from Classic sources are tagged `scope: classic`.
- `unverified` marks a claim no source confirmed. `conflict` marks a claim where sources disagree; both values are given.
- JSON files (`classes/<class>.json`) carry the same data as top-level keys: `sources`, `checked`, `note`.
- Body style: tables and bullets, no prose padding.

## Trust order

When facts disagree, the advisor uses the first source that has an answer:

1. **QuestieDB data from the user's own install** (quest names, NPCs, coordinates, levels, rewards).
2. **These knowledge files.**
3. **A fresh web check** for anything Forever-specific or recent (hotfixes change rules week to week; see the dates in `forever-rules.md`).
4. **Model memory**, last, and always flagged as such.

Every file says where it is unsure. The advisor repeats that uncertainty to the user, and does not turn an `unverified` claim into a confident one.

## Files

| File | Content |
|---|---|
| `forever-rules.md` | Forever vs Classic changes that affect leveling speed, with hotfix dates |
| `classes/warrior.md` | Warrior leveling: abilities, class quests, weapon trainers, Arms talent order, weapons, tanking |
| `classes/warrior.json` | Machine-read armor/weapon proficiencies and stat weights for the bag-upgrade nudge |
| `professions/mining.md` | Mining 1→300, Horde trainers, ore by zone |
| `professions/engineering.md` | Engineering 1→300, materials, items useful for a leveling warrior |
| `professions/cooking.md` | Cooking 1→300, Well Fed XP food, campfire kits |
| `professions/first-aid.md` | First Aid 1→300, bandages and Forever healing potions |
