-- Golden vectors for the pixel bridge frame codec. The JS codec (src/bridge/codec.js) and the
-- Lua encoder in the addon must both reproduce these symbol arrays exactly.
-- Generated once from the JS codec and frozen; do not edit by hand.
-- The quest digest is Fletcher-16 over each quest's own bits in log order (no page counts, no padding),
-- so it is independent of screen width.
return {
  vectors = {
    {
      label = "core-level1-empty", seq = 1, page = 0, pages = 1, tag = 28566,
      core = { level = 1, xp = 0, xpMax = 400, rested = 0, money = 0, uiMapId = 1411, x = 0, y = 0, questDigest = 0, questCount = 0 },
      symbols = {
        3, 0, 3, 0, 3, 3, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 2, 3, 3, 2, 1, 1, 2, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 3, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 2, 3, 0, 0, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 2, 2, 3, 0, 2, 0, 1
      },
    },
    {
      label = "core-level60-max", seq = 255, page = 0, pages = 1, tag = 28566,
      core = { level = 60, xp = 1234567, xpMax = 2345678, rested = 345678, money = 4294967295, uiMapId = 1429, x = 1000, y = 1000, questDigest = 0, questCount = 0 },
      symbols = {
        3, 0, 3, 0, 3, 3, 0, 1, 3, 3, 3, 3, 0, 0, 0, 1, 1, 2, 3, 3, 2, 1, 1, 2, 1, 3, 2, 0, 0, 2, 1, 1, 2, 2, 3, 1, 0, 0, 3, 2,
        1, 0, 1, 3, 2, 1, 1, 1, 2, 1, 3, 0, 0, 0, 2, 2, 2, 0, 3, 0, 2, 1, 3, 1, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2,
        0, 0, 2, 3, 0, 2, 2, 3, 3, 3, 1, 0, 1, 3, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 2, 1, 3, 2
      },
    },
    {
      label = "quests-25", seq = 7, pages = 4, tag = 28566, capacity = 788,
      core = { level = 33, xp = 98765, xpMax = 120000, rested = 4000, money = 123456, uiMapId = 1429, x = 512, y = 487, questDigest = 11963, questCount = 25 },
      quests = {
        { id = 1000, complete = true, failed = false, objectives = { 0, 17, 34, 51, 68 } },
        { id = 1037, complete = false, failed = false, objectives = { 11, 28, 45, 62, 79 } },
        { id = 1074, complete = false, failed = false, objectives = { 22, 39, 56, 73, 90 } },
        { id = 1111, complete = false, failed = false, objectives = { 33, 50, 67, 84, 101 } },
        { id = 1148, complete = true, failed = false, objectives = { 44, 61, 78, 95, 112 } },
        { id = 1185, complete = false, failed = false, objectives = { 55, 72, 89, 106, 123 } },
        { id = 1222, complete = false, failed = false, objectives = { 66, 83, 100, 117, 134 } },
        { id = 1259, complete = false, failed = false, objectives = { 77, 94, 111, 128, 145 } },
        { id = 1296, complete = true, failed = false, objectives = { 88, 105, 122, 139, 156 } },
        { id = 1333, complete = false, failed = false, objectives = { 99, 116, 133, 150, 167 } },
        { id = 1370, complete = false, failed = true, objectives = { 110, 127, 144, 161, 178 } },
        { id = 1407, complete = false, failed = false, objectives = { 121, 138, 155, 172, 189 } },
        { id = 1444, complete = true, failed = false, objectives = { 132, 149, 166, 183, 200 } },
        { id = 1481, complete = false, failed = false, objectives = { 143, 160, 177, 194, 211 } },
        { id = 1518, complete = false, failed = false, objectives = { 154, 171, 188, 205, 222 } },
        { id = 1555, complete = false, failed = false, objectives = { 165, 182, 199, 216, 233 } },
        { id = 1592, complete = true, failed = false, objectives = { 176, 193, 210, 227, 244 } },
        { id = 1629, complete = false, failed = false, objectives = { 187, 204, 221, 238, 255 } },
        { id = 1666, complete = false, failed = false, objectives = { 198, 215, 232, 249, 10 } },
        { id = 1703, complete = false, failed = false, objectives = { 209, 226, 243, 4, 21 } },
        { id = 1740, complete = true, failed = false, objectives = { 220, 237, 254, 15, 32 } },
        { id = 1777, complete = false, failed = true, objectives = { 231, 248, 9, 26, 43 } },
        { id = 1814, complete = false, failed = false, objectives = { 242, 3, 20, 37, 54 } },
        { id = 1851, complete = false, failed = false, objectives = { 253, 14, 31, 48, 65 } },
        { id = 1888, complete = true, failed = false, objectives = { 8, 25, 42, 59, 76 } },
      },
      frames = {
        {
          page = 0,
          symbols = {
            3, 0, 3, 0, 3, 3, 0, 1, 0, 0, 1, 3, 0, 0, 1, 0, 1, 2, 3, 3, 2, 1, 1, 2, 1, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 3, 2, 1, 2, 2,
            0, 0, 0, 3, 2, 2, 2, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 1, 3, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 0, 1, 0, 2, 0, 0, 0,
            0, 0, 2, 3, 0, 2, 2, 3, 0, 0, 0, 0, 0, 3, 3, 0, 3, 2, 1, 1, 3, 1, 1, 3, 1, 3, 2, 1, 3, 2, 3, 3, 1, 2, 2, 2
          },
        },
        {
          page = 1,
          symbols = {
            3, 0, 3, 0, 3, 3, 0, 1, 0, 0, 1, 3, 0, 1, 1, 0, 1, 2, 3, 3, 2, 1, 1, 2, 1, 2, 0, 0, 0, 0, 3, 3, 2, 2, 0, 2, 2, 2, 0, 0,
            0, 0, 0, 2, 0, 2, 1, 0, 1, 0, 1, 2, 1, 2, 2, 0, 2, 0, 0, 0, 1, 0, 0, 0, 3, 1, 0, 2, 2, 0, 1, 1, 2, 0, 3, 2, 0, 1, 1, 2,
            2, 1, 3, 3, 0, 2, 1, 3, 2, 0, 0, 1, 0, 0, 3, 0, 2, 0, 2, 2, 0, 2, 3, 0, 1, 0, 3, 2, 1, 3, 0, 0, 2, 1, 0, 2, 2, 3, 1, 0,
            0, 0, 1, 0, 1, 1, 1, 3, 0, 2, 2, 1, 0, 0, 2, 1, 2, 1, 0, 2, 0, 1, 2, 2, 2, 2, 0, 3, 0, 2, 2, 0, 0, 1, 0, 1, 3, 3, 0, 2,
            2, 2, 1, 1, 2, 0, 1, 3, 2, 2, 2, 1, 3, 0, 2, 3, 3, 2, 3, 2, 0, 0, 0, 0, 1, 0, 2, 2, 0, 1, 0, 2, 2, 1, 2, 3, 2, 2, 1, 0,
            0, 2, 3, 0, 2, 3, 1, 1, 0, 3, 3, 1, 2, 0, 0, 1, 0, 3, 0, 1, 2, 0, 2, 2, 2, 0, 1, 0, 2, 2, 1, 2, 3, 0, 2, 0, 3, 2, 2, 3,
            0, 0, 3, 0, 0, 0, 1, 0, 3, 2, 2, 3, 0, 2, 2, 2, 1, 2, 2, 2, 3, 3, 0, 3, 1, 3, 3, 0, 0, 0, 1, 0, 2, 0, 2, 0, 0, 1, 1, 0,
            1, 0, 0, 2, 2, 2, 2, 3, 0, 0, 3, 1, 0, 2, 3, 3, 1, 1, 0, 1, 1, 3, 0, 3, 2, 0, 0, 0, 1, 1, 0, 3, 1, 1, 0, 2, 2, 3, 0, 1,
            2, 3, 2, 2, 1, 0, 0, 2, 3, 0, 2, 3, 1, 1, 0, 3, 2, 0, 0, 1, 1, 1, 1, 2, 2, 1, 2, 2, 3, 1, 3, 0, 3, 3, 3, 3, 0, 2, 0, 1,
            1, 0, 0, 3, 1, 2, 1, 0, 0, 0, 1, 1, 1, 3, 3, 3, 0, 2, 2, 3, 3, 0, 3, 0, 1, 1, 1, 0, 3, 1, 3, 1, 1, 2, 1, 1, 3, 2, 2, 1,
            1, 3, 3, 0, 0, 0, 2
          },
        },
        {
          page = 2,
          symbols = {
            3, 0, 3, 0, 3, 3, 0, 1, 0, 0, 1, 3, 0, 2, 1, 0, 1, 2, 3, 3, 2, 1, 1, 2, 1, 2, 0, 0, 0, 1, 1, 2, 2, 1, 0, 2, 2, 3, 0, 0,
            2, 1, 0, 2, 2, 3, 1, 0, 3, 1, 1, 2, 3, 3, 2, 1, 0, 0, 0, 0, 1, 1, 3, 0, 2, 1, 0, 2, 3, 0, 1, 3, 3, 1, 0, 0, 1, 1, 2, 0,
            3, 2, 0, 1, 1, 2, 2, 1, 2, 0, 0, 1, 1, 3, 2, 3, 2, 0, 2, 3, 0, 3, 1, 1, 1, 1, 1, 3, 1, 3, 2, 1, 2, 1, 2, 3, 2, 3, 3, 0,
            0, 0, 1, 2, 0, 1, 0, 3, 0, 2, 3, 1, 0, 2, 3, 1, 2, 3, 1, 2, 0, 3, 3, 2, 3, 0, 1, 3, 1, 0, 2, 0, 0, 1, 2, 0, 3, 2, 0, 2,
            2, 3, 1, 2, 0, 1, 2, 0, 0, 3, 2, 2, 1, 1, 3, 0, 1, 3, 3, 2, 2, 0, 0, 0, 1, 2, 1, 1, 3, 1, 0, 2, 3, 1, 3, 1, 3, 2, 1, 2,
            1, 2, 3, 2, 3, 3, 1, 3, 1, 3, 3, 3, 2, 0, 0, 1, 2, 2, 0, 0, 2, 0, 2, 3, 2, 0, 3, 1, 2, 2, 3, 3, 3, 1, 0, 1, 3, 3, 0, 2,
            0, 1, 1, 0, 0, 0, 1, 2, 2, 2, 1, 3, 0, 2, 3, 2, 2, 0, 3, 3, 0, 1, 1, 3, 2, 1, 2, 0, 0, 2, 0, 0, 2, 2, 2, 0, 0, 1, 2, 3,
            0, 3, 0, 2, 2, 3, 2, 3, 2, 1, 3, 1, 2, 3, 3, 3, 3, 0, 0, 1, 3, 2, 1, 0, 0, 0, 0, 0, 1, 2, 3, 3, 0, 1, 1, 2, 3, 3, 0, 3,
            3, 3, 3, 0, 0, 0, 1, 0, 2, 0, 3, 1, 0, 1, 1, 1, 2, 0, 0, 1, 3, 0, 1, 1, 2, 0, 2, 3, 3, 2, 1, 0, 0, 0, 1, 2, 0, 2, 2, 0,
            1, 0, 2, 2, 1, 2, 3, 0, 0, 0, 1, 3, 0, 3, 2, 3, 0, 2, 3, 3, 3, 2, 2, 0, 1, 3, 0, 0, 3, 3, 2, 1, 2, 0, 0, 2, 0, 0, 2, 1,
            1, 1, 1, 0, 3, 1, 3
          },
        },
        {
          page = 3,
          symbols = {
            3, 0, 3, 0, 3, 3, 0, 1, 0, 0, 1, 3, 0, 3, 1, 0, 1, 2, 3, 3, 2, 1, 1, 2, 0, 0, 2, 0, 0, 1, 3, 1, 2, 0, 0, 2, 2, 2, 0, 1,
            0, 0, 0, 3, 0, 2, 1, 1, 1, 0, 1, 3, 1, 2, 2, 1, 2, 0, 0, 2, 2, 0, 0, 3, 3, 0
          },
        },
      },
    },
    { label = "tag-testchar", charName = "Testchar", classFile = "WARRIOR", tag = 28566 },
  },
}
