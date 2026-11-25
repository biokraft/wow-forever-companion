---
name: wow-checkin
description: "Quick mid-session WoW: Forever check-in. Use when the player says \"check on me\", \"how am I doing\", \"check-in\", \"status\", or asks you to look at their game. Syncs ForeverLog data, looks at a live screenshot, summarizes state and nudges, and lists the next 3–6 steps."
---

# WoW: Forever check-in

**Never click, type, or send keys into the World of Warcraft window.** Look only.

1. Get fresh state: the `wow_state` tool (Pi), or
   in Claude Code: `node "${CLAUDE_PLUGIN_ROOT}/bin/wowf" state` from the data folder (it syncs,
   then prints the main character with live values merged; `--json` for every field).
   Live values (the `Live:` line, `(live)` in the state) are current for level, XP, money,
   zone and position, and quest progress, and say how old they are; gear, bags, talents and
   skills are from the last `/fc sync`. A quest that left the log was turned in or abandoned
   (the next sync confirms which), never "ready".
2. Look at the game: use an attached screenshot if there is one (the overlay's "look"); in
   Claude Code with computer use, `app_screenshot` of `com.blizzard.worldofwarcraft`
   (request access once if needed). Otherwise skip it and say so.
3. Reply in this shape, short:

   ```
   Testa · L7 (62% XP, 1.2k rested) · Razor Hill · snapshot 4 min old
   Nudges: talent point, trainer due, 2 turn-ins ready
   Next:
   1. Turn in Sarkoth → Gornek (Valley of Trials 42.1, 68.3)
   2. ...
   ```

4. Build the "Next" list with the `wow-advisor` skill's rules (Questie data first, then
   `knowledge list` notes; research and cache anything missing or stale). Ask for `/fc sync`
   only as that skill's "When to ask for `/fc sync`" says (never for level, XP, zone or quest
   progress while the `Live:` line is there).
5. Push the "Next" list to the in-game panel (`wow_plan_write`, or `wowf plan write`) as the
   `wow-advisor` skill describes, and end with "`/fc sync` to load it in game".
6. If progress moved since the last check-in, update the player's guide and notes as the
   `wow-advisor` skill describes.
