const PANE = "read";
const PIVOT = 10;
const MIN_WPM = 100;
const MAX_WPM = 1200;
const WPM_STEP = 25;

let words = [];
let idx = 0;
let playing = false;
let wpm = 350;
let timer = null;

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function orpIndex(len) {
  if (len <= 1) return 0;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  if (len <= 13) return 3;
  return 4;
}

function baseMs() {
  return Math.max(25, Math.round(60000 / wpm));
}
function wordMs(i) {
  return Math.round(baseMs() * (words[i]?.mult || 1));
}

function buildWords(md) {
  let t = md;
  t = t.replace(/```[\s\S]*?```/g, " ").replace(/~~~[\s\S]*?~~~/g, " ");
  t = t.replace(/`([^`]*)`/g, "$1");
  t = t
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

  const out = [];
  for (const raw of t.split("\n")) {
    const h = raw.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    const heading = !!h;
    let line = heading ? h[2] : raw;
    line = line
      .replace(/\*\*([^*]*)\*\*/g, "$1")
      .replace(/\*([^*]*)\*/g, "$1")
      .replace(/__([^_]*)__/g, "$1")
      .replace(/_([^_]*)_/g, "$1")
      .replace(/^\s*[-*+]\s+/, "")
      .replace(/^\s*\d+\.\s+/, "")
      .replace(/^\s*>\s?/, "")
      .replace(/[#*_`]/g, "");

    const toks = line.split(/\s+/).filter(Boolean);
    if (toks.length === 0) {
      if (out.length)
        out[out.length - 1].mult = Math.max(out[out.length - 1].mult, 2.5);
      continue;
    }
    toks.forEach((tok, j) => {
      let mult = 1;
      if (/[,;:]$/.test(tok)) mult = 1.6;
      if (/[.!?]+["')\]]?$/.test(tok)) mult = 2.2;
      if (heading && j === toks.length - 1) mult = Math.max(mult, 3);
      out.push({ word: tok, mult });
    });
  }
  return out;
}

function stopTimer() {
  if (timer) {
    timer.cancel();
    timer = null;
  }
}

function scheduleNext($) {
  stopTimer();
  if (!playing || idx >= words.length) return;
  timer = $.clock.after(wordMs(idx), () => {
    if (!playing) return;
    if (idx >= words.length - 1) {
      playing = false;
      idx = words.length - 1;
      $.ui.invalidate("ui.render");
      return;
    }
    idx += 1;
    $.ui.invalidate("ui.render");
    scheduleNext($);
  });
}

function play($) {
  if (playing || !words.length) return;
  if (idx >= words.length - 1) idx = 0;
  playing = true;
  $.ui.invalidate("ui.render");
  scheduleNext($);
}

function pause($) {
  if (!playing) return;
  playing = false;
  stopTimer();
  $.ui.invalidate("ui.render");
}

function togglePlay($) {
  if (playing) pause($);
  else play($);
}

function setWpm($, newWpm) {
  wpm = clamp(newWpm, MIN_WPM, MAX_WPM);
  $.store.set("wpm", wpm);
  $.ui.invalidate("ui.render");
  if (playing) scheduleNext($);
}

async function openPane($) {
  await $.ui.open({
    id: PANE,
    title: "Speed Reader",
    focus: true,
    closeOnEscape: true,
  });
}

export function register(on) {
  on("session.start", async ($, e, next) => {
    try {
      await $.command.register({
        name: "read",
        description: "Speed-read Claude's last answer",
      });
    } catch (_) {
      /* name taken */
    }
    const saved = await $.store.get("wpm");
    if (typeof saved === "number" && saved >= MIN_WPM && saved <= MAX_WPM)
      wpm = saved;
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    if (
      !e.agentId &&
      !e.isAborted &&
      typeof e.answer === "string" &&
      e.answer.trim()
    ) {
      stopTimer();
      playing = false;
      words = buildWords(e.answer);
      idx = 0;
      $.ui.invalidate("ui.render");
    }
    return result;
  });

  on("prompt.submit", async ($, e, next) => {
    stopTimer();
    playing = false;
    try {
      await $.ui.close({ id: PANE });
    } catch (_) {
      /* not open */
    }
    return next(e);
  });

  on("command.run", { command: "read" }, async ($) => {
    await openPane($);
    return {};
  });

  on("ui.render", { component: "Pane" }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e);
    const { Box, Text, Button } = $.ui.resolve(e);

    if (!words.length) {
      return Text({
        children: ["No answer yet — ask Claude something, then reopen."],
      });
    }

    const i = clamp(idx, 0, words.length - 1);
    const word = words[i].word;
    const chars = [...word];
    const orp = orpIndex(chars.length);
    const left = chars.slice(0, orp).join("");
    const piv = chars[orp] ?? "";
    const right = chars.slice(orp + 1).join("");
    const pad = " ".repeat(Math.max(0, PIVOT - left.length));
    const marker = " ".repeat(PIVOT);

    return Box({
      flexDirection: "column",
      children: [
        Text({ children: [`${marker}▾`], dimColor: true }),
        Box({
          flexDirection: "row",
          children: [
            Text({ children: [pad + left], color: "white" }),
            Text({ children: [piv], color: "#ff8c00", bold: true }),
            Text({ children: [right], color: "white" }),
          ],
        }),
        Text({ children: [`${marker}▴`], dimColor: true }),
        Text({ children: [" "] }),
        Box({
          flexDirection: "row",
          columnGap: 3,
          children: [
            Button({
              key: "playpause",
              label: playing ? "pause" : "play",
              hotkey: "p",
              plain: true,
              onPress: () => togglePlay($),
            }),
            Button({
              key: "slower",
              label: "slower",
              hotkey: "j",
              plain: true,
              onPress: () => setWpm($, wpm - WPM_STEP),
            }),
            Button({
              key: "faster",
              label: "faster",
              hotkey: "k",
              plain: true,
              onPress: () => setWpm($, wpm + WPM_STEP),
            }),
            Text({ children: [`   ${wpm} wpm`], dimColor: true }),
          ],
        }),
      ],
    });
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const { Box, Button } = $.ui.resolve(e);
    const theirs = await next(e);
    const openButton = Button({
      key: "open-reader",
      label: "Read answer",
      hotkey: "1",
      plain: true,
      onPress: () => void openPane($),
    });
    return Box({
      flexDirection: "row",
      columnGap: 2,
      children: [openButton, theirs],
    });
  });
}
