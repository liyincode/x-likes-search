const STORAGE_KEY = "x_likes_index";
const STATE_KEY = "x_likes_state";

const $q = document.getElementById("q");
const $results = document.getElementById("results");
const $meta = document.getElementById("meta");
const $foot = document.getElementById("footstate");

let allLikes = [];
let currentMatches = [];
let selectedIndex = 0;
let currentTerm = "";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function highlight(text, term) {
  if (!term) return escapeHtml(text);
  const re = new RegExp(
    `(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "gi"
  );
  return escapeHtml(text).replace(re, "<mark>$1</mark>");
}

function fmtDateShort(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  const now = new Date();
  const sameYear = dt.getFullYear() === now.getFullYear();
  return dt.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function fmtDateFull(d) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleString();
  } catch {
    return "";
  }
}

function initial(name) {
  if (!name) return "·";
  const c = name.trim().charAt(0);
  return c ? c.toUpperCase() : "·";
}

function avatarHtml(t) {
  if (t.avatar) {
    return `<img class="avatar" src="${escapeHtml(
      t.avatar
    )}" alt="" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=&quot;avatar fallback&quot;>${escapeHtml(
      initial(t.displayName || t.author)
    )}</div>'" />`;
  }
  return `<div class="avatar fallback">${escapeHtml(
    initial(t.displayName || t.author)
  )}</div>`;
}

function tweetHtml(t, term) {
  const dateShort = fmtDateShort(t.datetime);
  const dateFull = fmtDateFull(t.datetime);
  const profileUrl = `https://x.com/${escapeHtml(t.author || "i")}`;
  const tweetUrl = escapeHtml(t.url);
  const text = highlight(t.text || "", term);
  return `
    ${avatarHtml(t)}
    <div class="body">
      <div class="head">
        <a class="name" href="${profileUrl}" target="_blank" rel="noreferrer">${escapeHtml(
    t.displayName || t.author
  )}</a>
        <a class="handle" href="${profileUrl}" target="_blank" rel="noreferrer">@${escapeHtml(
    t.author
  )}</a>
        <span class="dot">·</span>
        <a href="${tweetUrl}" target="_blank" rel="noreferrer"><time datetime="${escapeHtml(
    t.datetime || ""
  )}" title="${escapeHtml(dateFull)}">${escapeHtml(dateShort)}</time></a>
      </div>
      <div class="text">${text || '<span style="opacity:.5">(no text — link only)</span>'}</div>
    </div>
  `;
}

function updateCounter() {
  const total = allLikes.length;
  const m = currentMatches.length;
  let counter;
  if (currentTerm) {
    counter =
      m === 0
        ? `0 matches in ${total}`
        : `${selectedIndex + 1} / ${m} match${m > 1 ? "es" : ""} in ${total}`;
  } else {
    counter = `${total} likes indexed`;
  }
  $meta.textContent = counter;
}

function highlightSelected() {
  const els = $results.querySelectorAll(".tweet");
  els.forEach((el, i) => el.classList.toggle("selected", i === selectedIndex));
  const sel = els[selectedIndex];
  if (sel) sel.scrollIntoView({ block: "nearest" });
  updateCounter();
}

function openTweet(t, { background = true } = {}) {
  chrome.tabs.create({ url: t.url, active: !background });
}

function bindTweetClicks() {
  $results.querySelectorAll(".tweet").forEach((el, i) => {
    let downX = 0,
      downY = 0;
    el.addEventListener("mousedown", (e) => {
      downX = e.clientX;
      downY = e.clientY;
    });
    el.addEventListener("click", (e) => {
      // Let explicit anchors handle their own click
      if (e.target.closest("a")) return;
      // If the user dragged to select text, don't navigate
      if (Math.abs(e.clientX - downX) > 5 || Math.abs(e.clientY - downY) > 5)
        return;
      const sel = window.getSelection && window.getSelection().toString();
      if (sel) return;
      const t = currentMatches[i];
      if (!t) return;
      selectedIndex = i;
      highlightSelected();
      openTweet(t, { background: !(e.metaKey || e.ctrlKey) });
    });
    el.addEventListener("auxclick", (e) => {
      // Middle-click → background tab
      if (e.button === 1) {
        const t = currentMatches[i];
        if (t) openTweet(t, { background: true });
      }
    });
  });
}

function render(items, term) {
  currentMatches = items;
  selectedIndex = 0;
  currentTerm = term;

  if (items.length === 0) {
    $results.innerHTML = `
      <div class="empty">
        ${
          allLikes.length === 0
            ? `
          <h3>No likes indexed yet</h3>
          <p>Open <code>https://x.com/&lt;your-username&gt;/likes</code>, click <b>Sync</b> in the bottom-right panel.</p>
          <p>Once cached, your tweets show up here for instant keyword search.</p>
        `
            : `
          <h3>No matches</h3>
          <p>Try a different keyword.</p>
        `
        }
      </div>
    `;
    updateCounter();
    return;
  }

  const html = items
    .map((t) => `<article class="tweet" data-id="${escapeHtml(t.tweetId)}">${tweetHtml(t, term)}</article>`)
    .join("");
  $results.innerHTML = html;
  bindTweetClicks();
  highlightSelected();
}

function search(term) {
  if (!term) {
    const sorted = [...allLikes].sort((a, b) =>
      (Date.parse(b.datetime || "") || 0) - (Date.parse(a.datetime || "") || 0)
    );
    render(sorted, "");
    return;
  }
  // Multi-word AND search: every whitespace-separated word must appear
  // somewhere in text / author / displayName.
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = allLikes.filter((t) => {
    const hay = `${t.text || ""} ${t.author || ""} ${t.displayName || ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  matches.sort(
    (a, b) =>
      (Date.parse(b.datetime || "") || 0) - (Date.parse(a.datetime || "") || 0)
  );
  render(matches, term);
}

async function load() {
  const data = await chrome.storage.local.get([STORAGE_KEY, STATE_KEY]);
  const index = data[STORAGE_KEY] || {};
  const state = data[STATE_KEY] || {};
  allLikes = Object.values(index);
  const last = state.lastSyncAt
    ? new Date(state.lastSyncAt).toLocaleString()
    : "never";
  $foot.textContent = `Last sync: ${last}`;
  search($q.value.trim());
}

// ---- Search input handlers ----
$q.addEventListener("input", () => search($q.value.trim()));

function advance(delta) {
  if (currentMatches.length === 0) return;
  selectedIndex =
    (selectedIndex + delta + currentMatches.length) % currentMatches.length;
  highlightSelected();
}

$q.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    advance(1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    advance(-1);
  } else if (e.key === "Enter") {
    // Cmd+F semantics: Enter cycles through matches WITHOUT opening anything.
    // Shift+Enter goes backward. Cmd/Ctrl+Enter opens the selected tweet
    // in a background tab. Plain click on a card also opens.
    e.preventDefault();
    if (e.metaKey || e.ctrlKey) {
      const t = currentMatches[selectedIndex];
      if (t) openTweet(t, { background: true });
    } else if (e.shiftKey) {
      advance(-1);
    } else {
      advance(1);
    }
  } else if (e.key === "Escape") {
    if ($q.value) {
      $q.value = "";
      search("");
    }
  }
});

// Global "/" focuses the search bar (matches X behavior)
window.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== $q) {
    e.preventDefault();
    $q.focus();
    $q.select();
  }
});

document.getElementById("open-likes").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://x.com/i/likes" });
});

document.getElementById("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(allLikes, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `x-likes-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.getElementById("clear").addEventListener("click", async () => {
  if (!confirm("Clear all cached likes? This does not unlike anything on X.")) return;
  await chrome.storage.local.remove([STORAGE_KEY, STATE_KEY]);
  load();
});

// Refresh data when the storage updates (e.g. content script just synced).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[STORAGE_KEY] || changes[STATE_KEY]) load();
});

load();
