#!/usr/bin/env python3
"""Snowball Seed Scout v2 — resolve scout config to platform URLs and extract post links."""

from __future__ import annotations

import hashlib
import json
import re
import sys
import unittest
import urllib.error
import urllib.request
from datetime import UTC, datetime
from urllib.parse import quote_plus

DEFAULT_BROWSER_SESSION = "signals-publish"
# Last-resort only. Deploy records the real origin in scout.json because
# RealTimeX assigns Local App ports dynamically.
FALLBACK_SIGNALS_BASE_URL = "http://127.0.0.1:3010"

AUTHENTICATED_FEED_URLS: dict[str, str] = {
    "x": "https://x.com/home",
    "linkedin": "https://www.linkedin.com/feed/",
    "facebook": "https://www.facebook.com/",
}

SHARED_BROWSER_SESSIONS = frozenset({DEFAULT_BROWSER_SESSION})

# Only sessions the scout creates itself carry this prefix (see
# scout_start_browser). Anything else is an operator-owned Platform Connection.
SCOUT_OWNED_SESSION_PREFIX = "signals-scout-"

POST_PATTERNS: dict[str, re.Pattern[str]] = {
    "x": re.compile(r"https?://(?:x|twitter)\.com/[^/\s?#]+/status/\d+", re.I),
    "linkedin": re.compile(
        r"https?://(?:(?:www\.)?linkedin\.com/(?:posts|feed/update)/[^\s\"'<>]+|"
        r"lnkd\.in/p/[^\s\"'<>/?#]+)",
        re.I,
    ),
    "facebook": re.compile(
        r"https?://(?:www\.)?facebook\.com/(?:"
        r"[^/\s\"'<>]+/posts/(?:pfbid)?[^\s\"'<>/?#]+|"
        r"photo/?\?fbid=\d+|"
        r"groups/[^/\s\"'<>]+/permalink/\d+"
        r")",
        re.I,
    ),
}

SHELL_TAB_IGNORE = (
    "cli-browser/index.html",
    "cli-browser/start.html",
    "/cli-browser/",
)


def uses_authenticated_session(config: dict) -> bool:
    if config.get("inheritAuthenticatedSession") is False:
        return False
    session_name = resolve_browser_session_name(config, "")
    if session_name in SHARED_BROWSER_SESSIONS:
        return True
    return bool(str(config.get("targetId") or "").strip())


def authenticated_feed_url(platform: str) -> str:
    return AUTHENTICATED_FEED_URLS.get(platform, "")


def session_name_from_invoke_body(body: dict) -> str:
    """Read connection.sessionName out of an /api/agent-tools/invoke response.

    The endpoint wraps handler output as {success, tool, result}, so the
    connection lives under `result`, not at the top level.
    """
    if not isinstance(body, dict):
        return ""
    result = body.get("result")
    if not isinstance(result, dict):
        result = body
    connection = result.get("connection")
    if not isinstance(connection, dict):
        return ""
    return str(connection.get("sessionName") or "").strip()


def fetch_target_session_name(signals_base: str, target_id: str) -> str:
    if not signals_base or not target_id:
        return ""
    payload = json.dumps(
        {"tool": "get_platform_target", "input": {"targetId": target_id}}
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{signals_base.rstrip('/')}/api/agent-tools/invoke",
        data=payload,
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        return ""

    return session_name_from_invoke_body(body)


def resolve_browser_session_name(config: dict, signals_base: str) -> str:
    # `browserSessionName` is always populated (it defaults to the shared publish
    # session), so treating any value as an override would make the acting-profile
    # selection dead. Only a genuinely custom name outranks `targetId`.
    explicit = str(config.get("browserSessionName") or "").strip()
    if explicit and explicit != DEFAULT_BROWSER_SESSION:
        return explicit

    target_id = str(config.get("targetId") or "").strip()
    if target_id and signals_base:
        resolved = fetch_target_session_name(signals_base, target_id)
        if resolved:
            return resolved

    return explicit or DEFAULT_BROWSER_SESSION


def resolve_signals_base_url(config: dict, env_override: str = "") -> str:
    """Base URL the scout calls Signals on.

    Precedence: an explicit SIGNALS_BASE_URL override, then the origin recorded
    at deploy time, then the legacy default. The heartbeat shell does not inherit
    the Local App's port, so the recorded value is what makes a non-3010
    assignment work.
    """
    override = str(env_override or "").strip()
    if override:
        return override.rstrip("/")
    recorded = str((config or {}).get("signalsBaseUrl") or "").strip()
    if recorded:
        return recorded.rstrip("/")
    return FALLBACK_SIGNALS_BASE_URL


def should_stop_browser_session(session_name: str) -> bool:
    """Whether the scout may shut this browser session down on exit.

    Only sessions the scout creates are its to stop. An acting profile can
    resolve to a dedicated, already-running Platform Connection (for example
    `signals-contention`); harvesting through it and then stopping it would take
    the operator's own browser session away.
    """
    name = session_name.strip()
    if not name or name in SHARED_BROWSER_SESSIONS:
        return False
    return name.startswith(SCOUT_OWNED_SESSION_PREFIX)


def is_http_url(value: str) -> bool:
    lowered = value.strip().lower()
    return lowered.startswith("http://") or lowered.startswith("https://")


def looks_like_post_url(url: str, platform: str) -> bool:
    pattern = POST_PATTERNS.get(platform)
    if not pattern or not pattern.search(url):
        return False
    if platform == "facebook" and "/posts/pfbid" in url.lower():
        # pfbid tokens are long; truncated calendar/display URLs break navigation.
        token = url.lower().split("/posts/", 1)[-1]
        if len(token) < 60:
            return False
    return True


def resolve_community(platform: str, name: str) -> str:
    entry = str(name).strip()
    if not entry:
        return ""
    if is_http_url(entry):
        return entry

    query = quote_plus(entry)
    if platform == "x":
        return f"https://x.com/search?q={query}&f=live&src=typed_query"
    if platform == "linkedin":
        return (
            "https://www.linkedin.com/search/results/content/"
            f"?keywords={query}&origin=GLOBAL_SEARCH_HEADER"
        )
    if platform == "facebook":
        return f"https://www.facebook.com/search/posts?q={query}"
    return ""


def resolve_facebook_intent_search(intent_keywords: list[str]) -> str:
    """Facebook-only harvest fallback when home feed is unusable and no explicit targets exist.

    Intent keywords already filter harvested posts; reusing them as a search query keeps
    X/LinkedIn on home-feed rotation without adding global searchQueries entries.
    """
    terms = [str(keyword).strip() for keyword in intent_keywords if str(keyword).strip()]
    if not terms:
        return ""
    return f"https://www.facebook.com/search/posts?q={quote_plus(' '.join(terms))}"


def resolve_search(platform: str, query: str, intent_keywords: list[str]) -> str:
    entry = str(query).strip()
    if not entry:
        return ""
    if is_http_url(entry):
        return entry

    terms = [entry]
    for keyword in intent_keywords:
        keyword = str(keyword).strip()
        if keyword and keyword.lower() not in entry.lower():
            terms.append(keyword)
            break

    combined = quote_plus(" ".join(terms))
    if platform == "x":
        return f"https://x.com/search?q={combined}&f=live&src=typed_query"
    if platform == "linkedin":
        return (
            "https://www.linkedin.com/search/results/content/"
            f"?keywords={combined}&origin=GLOBAL_SEARCH_HEADER"
        )
    if platform == "facebook":
        return f"https://www.facebook.com/search/posts?q={combined}"
    return ""


def resolve_targets(config: dict, platform: str) -> list[str]:
    keywords = [
        str(keyword).strip()
        for keyword in (config.get("intentKeywords") or [])
        if str(keyword).strip()
    ]
    seen: set[str] = set()
    targets: list[str] = []

    if uses_authenticated_session(config):
        feed_url = authenticated_feed_url(platform)
        # Facebook home feed does not expose per-post Share buttons in the DOM;
        # copy-link harvest needs search/group result pages instead.
        if feed_url and platform != "facebook":
            seen.add(feed_url)
            targets.append(feed_url)

    for entry in config.get("communities") or []:
        url = resolve_community(platform, str(entry))
        if url and url not in seen:
            seen.add(url)
            targets.append(url)

    for entry in config.get("searchQueries") or []:
        url = resolve_search(platform, str(entry), keywords)
        if url and url not in seen:
            seen.add(url)
            targets.append(url)

    if platform == "facebook" and not targets and keywords:
        url = resolve_facebook_intent_search(keywords)
        if url and url not in seen:
            seen.add(url)
            targets.append(url)

    return targets


def configured_platforms(config: dict) -> list[str]:
    platforms = [
        str(platform).strip()
        for platform in (config.get("platforms") or ["x", "linkedin"])
        if str(platform).strip()
    ]
    return platforms or ["x"]


def eligible_platforms(config: dict) -> list[str]:
    return [
        platform
        for platform in configured_platforms(config)
        if resolve_targets(config, platform)
    ]


def platform_skip_reason(platform: str, config: dict) -> str:
    if resolve_targets(config, platform):
        return ""
    if platform == "facebook":
        return (
            "snowball-seed-scout: facebook skipped — no harvest targets "
            "(add intent keywords, a group URL, or a search query)"
        )
    return f"snowball-seed-scout: {platform} skipped — no harvest targets configured"


def pick_scout_platform(config: dict, *, day_seed: str | None = None) -> str:
    eligible = eligible_platforms(config)
    if not eligible:
        return ""
    seed = day_seed or datetime.now(UTC).strftime("%Y-%m-%d")
    idx = int(hashlib.sha256(seed.encode()).hexdigest(), 16) % len(eligible)
    return eligible[idx]


def is_navigation_url(url: str, platform: str) -> bool:
    lowered = url.strip().lower()
    if platform == "x":
        return (
            lowered.endswith("x.com/home")
            or "/x.com/home?" in lowered
            or "x.com/search?" in lowered
            or "twitter.com/search?" in lowered
        )
    if platform == "linkedin":
        return (
            lowered.endswith("linkedin.com/feed/")
            or lowered.endswith("linkedin.com/feed")
            or "linkedin.com/search/" in lowered
        )
    if platform == "facebook":
        return (
            lowered.rstrip("/").endswith("facebook.com")
            or "facebook.com/search/" in lowered
        )
    return False


def is_enqueueable_seed(url: str, platform: str) -> bool:
    return looks_like_post_url(url, platform) and not is_navigation_url(url, platform)


def direct_post_urls_from_config(config: dict, platform: str, max_links: int) -> list[str]:
    seen: set[str] = set()
    urls: list[str] = []
    for entry in (config.get("communities") or []) + (config.get("searchQueries") or []):
        candidate = str(entry).strip()
        if not is_http_url(candidate):
            continue
        if is_enqueueable_seed(candidate, platform) and candidate not in seen:
            seen.add(candidate)
            urls.append(candidate)
            if len(urls) >= max_links:
                break
    return urls


def fallback_candidates(config: dict, platform: str, max_links: int) -> list[str]:
    return direct_post_urls_from_config(config, platform, max_links)


def extract_post_url_from_share_href(href: str) -> str | None:
    try:
        from urllib.parse import parse_qs, unquote, urlparse

        parsed = urlparse(href)
        if "l.facebook.com" in parsed.netloc:
            inner = (parse_qs(parsed.query).get("u") or [None])[0]
            if inner:
                return extract_post_url_from_share_href(unquote(inner))
        if "wa.me" in parsed.netloc:
            text = (parse_qs(parsed.query).get("text") or [None])[0]
            if text:
                return extract_post_url_from_share_href(text)
        if "facebook.com" in parsed.netloc:
            # Accept the same post forms POST_PATTERNS does, not just pfbid.
            rebuilt = f"{parsed.scheme}://{parsed.netloc}{parsed.path.rstrip('/')}"
            if parsed.query and "fbid=" in parsed.query:
                rebuilt = f"{rebuilt}?{parsed.query}"
            # Match POST_PATTERNS here (the share dialog yields canonical URLs);
            # the pfbid truncation guard is enforced downstream in filter_post_urls.
            pattern = POST_PATTERNS.get("facebook")
            if pattern and pattern.search(rebuilt):
                return rebuilt
    except (ValueError, TypeError):
        return None
    return None


FACEBOOK_INIT_JS = """(() => {
window.__scoutCopiedLinks = window.__scoutCopiedLinks || [];
if (!window.__scoutClipboardHooked) {
  const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
  navigator.clipboard.writeText = async (text) => {
    window.__scoutCopiedLinks.push(String(text));
    try { return await orig(text); } catch (err) { return undefined; }
  };
  window.__scoutClipboardHooked = true;
}
window.scoutExtractPostUrl = function(href) {
  try {
    const url = new URL(href);
    if (url.hostname.includes('l.facebook.com')) {
      const inner = url.searchParams.get('u');
      if (inner) return window.scoutExtractPostUrl(decodeURIComponent(inner));
    }
    if (url.hostname.includes('wa.me')) {
      const text = url.searchParams.get('text');
      if (text) return window.scoutExtractPostUrl(text);
    }
    if (url.hostname.includes('facebook.com')) {
      // Keep in parity with POST_PATTERNS['facebook'] in resolve.py: pfbid and
      // numeric /posts/<id>, /photo?fbid=<id>, and group permalinks.
      const path = url.pathname.replace(/\\/+$/, '');
      if (/^\\/[^/]+\\/posts\\/[^/]+$/.test(path)) {
        return `${url.origin}${path}`;
      }
      if (/^\\/groups\\/[^/]+\\/permalink\\/\\d+$/.test(path)) {
        return `${url.origin}${path}`;
      }
      if (path === '/photo' && /^\\d+$/.test(url.searchParams.get('fbid') || '')) {
        return `${url.origin}${path}?fbid=${url.searchParams.get('fbid')}`;
      }
    }
  } catch (err) {}
  return null;
};
window.scoutCloseShareDialog = function() {
  const close = document.querySelector('[aria-label="Close"]');
  if (close) close.click();
};
window.scoutEscapeMenu = function() {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  window.scoutCloseShareDialog();
};
return 'ready';
})()"""

COPY_LINK_INIT_JS = FACEBOOK_INIT_JS

X_OPEN_MENU_JS = """(() => {
const keywords = __SCOUT_KEYWORDS__;
const articles = [...document.querySelectorAll('article')]
  .filter((art) => art.querySelector('a[href*="/status/"]'))
  .filter((art) => !art.getAttribute('data-scout-processed'));
if (!articles.length) return 'none';
const art = articles[0];
const text = (art.innerText || '').toLowerCase();
if (keywords.length && !keywords.some((kw) => text.includes(kw))) {
  art.setAttribute('data-scout-processed', '1');
  return 'skipped';
}
const share = art.querySelector('button[aria-label="Share post"]');
if (!share) {
  art.setAttribute('data-scout-processed', '1');
  return 'none';
}
document.querySelectorAll('article[data-scout-active="1"]').forEach((node) => node.removeAttribute('data-scout-active'));
art.setAttribute('data-scout-processed', '1');
art.setAttribute('data-scout-active', '1');
share.click();
return 'opened';
})()"""

X_CLICK_COPY_LINK_JS = """(() => {
const copy = [...document.querySelectorAll('[role="menuitem"]')]
  .find((el) => (el.innerText || '').trim() === 'Copy link');
if (!copy) return 'no-copy';
copy.click();
return 'copy-clicked';
})()"""

X_EXTRACT_URL_JS = """(() => {
const urls = new Set();
const copied = window.__scoutCopiedLinks?.[window.__scoutCopiedLinks.length - 1];
if (copied && /\\/status\\/\\d+/.test(copied)) {
  urls.add(copied.split('?')[0].replace(/\\/analytics$/, ''));
}
const art = document.querySelector('article[data-scout-active="1"]');
if (art) {
  for (const anchor of art.querySelectorAll('a[href*="/status/"]')) {
    const clean = anchor.href.split('?')[0].replace(/\\/analytics$/, '');
    if (/\\/status\\/\\d+$/.test(clean)) urls.add(clean);
  }
}
return JSON.stringify([...urls]);
})()"""

X_CLOSE_MENU_JS = """(() => {
window.scoutEscapeMenu();
return 'closed';
})()"""

LINKEDIN_OPEN_MENU_JS = """(() => {
const keywords = __SCOUT_KEYWORDS__;
const selectors = [
  'button[aria-label*="control menu"]',
  'button.feed-shared-control-menu__trigger',
  'button[aria-label*="Open control menu for post"]',
];
const buttons = [...document.querySelectorAll(selectors.join(','))]
  .filter((btn) => !btn.closest('[data-scout-processed="1"]'));
if (!buttons.length) return 'none';
const btn = buttons[0];
const root = btn.closest('.feed-shared-update-v2, [data-urn*="activity"], [data-urn*="ugcPost"]')
  || btn.closest('div[data-urn]')
  || btn.parentElement;
const text = (root?.innerText || '').toLowerCase();
if (keywords.length && !keywords.some((kw) => text.includes(kw))) {
  if (root) root.setAttribute('data-scout-processed', '1');
  return 'skipped';
}
if (root) root.setAttribute('data-scout-processed', '1');
document.querySelectorAll('[data-scout-active="1"]').forEach((node) => node.removeAttribute('data-scout-active'));
if (root) root.setAttribute('data-scout-active', '1');
btn.click();
return 'opened';
})()"""

LINKEDIN_CLICK_COPY_LINK_JS = """(() => {
const copy = [...document.querySelectorAll('span, div, [role="menuitem"]')]
  .find((el) => (el.innerText || '').trim() === 'Copy link to post');
if (!copy) return 'no-copy';
copy.click();
return 'copy-clicked';
})()"""

LINKEDIN_EXTRACT_URL_JS = """(() => {
const urls = new Set();
const copied = window.__scoutCopiedLinks?.[window.__scoutCopiedLinks.length - 1];
if (copied) {
  const clean = copied.split('?')[0];
  if (/linkedin\\.com\\/(posts|feed\\/update)/.test(clean) || /lnkd\\.in\\/p\\//.test(clean)) {
    urls.add(clean);
  }
}
return JSON.stringify([...urls]);
})()"""

LINKEDIN_CLOSE_MENU_JS = """(() => {
window.scoutEscapeMenu();
return 'closed';
})()"""


def build_open_menu_script(platform: str, keywords: list[str]) -> str:
    keywords_json = json.dumps([keyword.lower() for keyword in keywords if keyword])
    templates = {
        "x": X_OPEN_MENU_JS,
        "linkedin": LINKEDIN_OPEN_MENU_JS,
        "facebook": FACEBOOK_OPEN_SHARE_JS,
    }
    template = templates.get(platform)
    if not template:
        return "(() => 'unsupported')()"
    return template.replace("__SCOUT_KEYWORDS__", keywords_json)


FACEBOOK_OPEN_SHARE_JS = """(() => {
const keywords = __SCOUT_KEYWORDS__;
const buttons = [...document.querySelectorAll('[aria-label="Send this to friends or post it on your profile."]')]
  .filter((el) => el.getAttribute('role') === 'button')
  .filter((btn) => !btn.closest('[data-scout-processed="1"]'));
if (!buttons.length) return 'none';
const btn = buttons[0];
const root = btn.closest('[role="article"], [data-pagelet], div[data-ad-preview]') || btn.parentElement;
const text = (root?.innerText || '').toLowerCase();
if (keywords.length && !keywords.some((kw) => text.includes(kw))) {
  if (root) root.setAttribute('data-scout-processed', '1');
  return 'skipped';
}
if (root) root.setAttribute('data-scout-processed', '1');
btn.click();
return 'opened';
})()"""


def build_facebook_open_share_script(keywords: list[str]) -> str:
    keywords_json = json.dumps([keyword.lower() for keyword in keywords if keyword])
    return FACEBOOK_OPEN_SHARE_JS.replace("__SCOUT_KEYWORDS__", keywords_json)

FACEBOOK_CLICK_COPY_LINK_JS = """(() => {
const copy = [...document.querySelectorAll('span, div, [role="button"]')]
  .find((el) => (el.innerText || '').trim() === 'Copy link');
if (!copy) return 'no-copy';
copy.click();
return 'copy-clicked';
})()"""

FACEBOOK_EXTRACT_DIALOG_JS = """(() => {
const urls = new Set();
for (const anchor of document.querySelectorAll('a[href]')) {
  const extracted = window.scoutExtractPostUrl(anchor.href);
  if (extracted) urls.add(extracted);
}
for (const input of document.querySelectorAll('input[type="text"], textarea')) {
  const value = (input.value || '').trim();
  if (value.includes('facebook.com')) {
    const extracted = window.scoutExtractPostUrl(value);
    if (extracted) urls.add(extracted);
  }
}
return JSON.stringify([...urls]);
})()"""

FACEBOOK_CLOSE_DIALOG_JS = """(() => {
window.scoutCloseShareDialog();
return 'closed';
})()"""

COPY_LINK_PLATFORM_COMMANDS: dict[str, dict[str, str]] = {
    "x": {
        "click-copy-link": X_CLICK_COPY_LINK_JS,
        "extract-url": X_EXTRACT_URL_JS,
        "close-menu": X_CLOSE_MENU_JS,
    },
    "linkedin": {
        "click-copy-link": LINKEDIN_CLICK_COPY_LINK_JS,
        "extract-url": LINKEDIN_EXTRACT_URL_JS,
        "close-menu": LINKEDIN_CLOSE_MENU_JS,
    },
    "facebook": {
        "click-copy-link": FACEBOOK_CLICK_COPY_LINK_JS,
        "extract-url": FACEBOOK_EXTRACT_DIALOG_JS,
        "close-menu": FACEBOOK_CLOSE_DIALOG_JS,
    },
}


def normalize_post_url(url: str, platform: str) -> str:
    cleaned = str(url).strip().split("#")[0]
    if platform == "facebook":
        try:
            from urllib.parse import parse_qs, urlparse

            parsed = urlparse(cleaned)
            if parsed.path.rstrip("/") == "/photo":
                fbid = (parse_qs(parsed.query).get("fbid") or [None])[0]
                if fbid:
                    return f"https://www.facebook.com/photo/?fbid={fbid}"
            if "/permalink/" in parsed.path or "/posts/" in parsed.path:
                return f"{parsed.scheme}://{parsed.netloc}{parsed.path.rstrip('/')}"
        except ValueError:
            pass
    if platform == "x":
        cleaned = cleaned.split("?")[0].rstrip("/")
        if cleaned.endswith("/analytics"):
            cleaned = cleaned[: -len("/analytics")]
        return cleaned
    if platform == "linkedin":
        return cleaned.split("?")[0].rstrip("/")
    cleaned = cleaned.split("?")[0].rstrip("/")
    if cleaned.endswith("/analytics"):
        cleaned = cleaned[: -len("/analytics")]
    return cleaned


def filter_post_urls(
    urls: list[str],
    platform: str,
    keywords: list[str],
    max_links: int,
    *,
    require_keywords: bool = False,
) -> list[str]:
    pattern = POST_PATTERNS.get(platform)
    if not pattern:
        return []

    lowered_keywords = [keyword.lower() for keyword in keywords if keyword]
    seen: set[str] = set()
    filtered: list[str] = []

    for raw in urls:
        cleaned = normalize_post_url(str(raw).strip(), platform)
        # looks_like_post_url, not the bare pattern: a truncated facebook pfbid
        # token still matches the regex but is a dead link once dispatched.
        if not looks_like_post_url(cleaned, platform) or cleaned in seen:
            continue
        if require_keywords and lowered_keywords:
            haystack = cleaned.lower()
            if not any(keyword in haystack for keyword in lowered_keywords):
                continue
        seen.add(cleaned)
        filtered.append(cleaned)
        if len(filtered) >= max_links:
            break

    return filtered


def build_eval_script(platform: str, keywords: list[str], max_links: int) -> str:
    keywords_json = json.dumps([keyword.lower() for keyword in keywords if keyword])
    if platform == "x":
        return (
            "(() => {"
            f"const keywords = {keywords_json};"
            f"const maxLinks = {max_links};"
            "const urls = new Set();"
            "const normalize = (href) => {"
            "if (!href) return null;"
            "const clean = href.split('?')[0].replace(/\\/analytics$/, '');"
            "return /\\/status\\/\\d+$/.test(clean) ? clean : null;"
            "};"
            "for (const article of document.querySelectorAll('article')) {"
            "const text = (article.innerText || '').toLowerCase();"
            "if (keywords.length && !keywords.some((kw) => text.includes(kw))) continue;"
            "for (const anchor of article.querySelectorAll('a[href*=\"/status/\"]')) {"
            "const href = normalize(anchor.href);"
            "if (href) urls.add(href);"
            "if (urls.size >= maxLinks) break;"
            "}"
            "if (urls.size >= maxLinks) break;"
            "}"
            "return JSON.stringify([...urls]);"
            "})()"
        )
    if platform == "linkedin":
        return (
            "(() => {"
            f"const keywords = {keywords_json};"
            f"const maxLinks = {max_links};"
            "const urls = new Set();"
            "const normalize = (href) => {"
            "if (!href) return null;"
            " const clean = href.split('?')[0];"
            " if (!/(\\/posts\\/|feed\\/update\\/)/.test(clean)) return null;"
            " return clean;"
            "};"
            "for (const card of document.querySelectorAll('div.feed-shared-update-v2, article, li')) {"
            "const text = (card.innerText || '').toLowerCase();"
            "if (keywords.length && !keywords.some((kw) => text.includes(kw))) continue;"
            "for (const anchor of card.querySelectorAll('a[href]')) {"
            "const href = normalize(anchor.href);"
            "if (href) urls.add(href);"
            "if (urls.size >= maxLinks) break;"
            "}"
            "if (urls.size >= maxLinks) break;"
            "}"
            "return JSON.stringify([...urls]);"
            "})()"
        )
    if platform == "facebook":
        return (
            "(() => {"
            f"const keywords = {keywords_json};"
            f"const maxLinks = {max_links};"
            "const urls = new Set();"
            "const normalize = (href) => {"
            "if (!href || !href.includes('facebook.com')) return null;"
            "try {"
            "const url = new URL(href);"
            "if (url.pathname.includes('/posts/')) return url.origin + url.pathname;"
            "if (url.pathname.replace(/\\/$/, '') === '/photo' && url.searchParams.get('fbid')) {"
            "return `${url.origin}/photo/?fbid=${url.searchParams.get('fbid')}`;"
            "}"
            "if (url.pathname.includes('/permalink/')) return url.origin + url.pathname;"
            "} catch (err) {}"
            "return null;"
            "};"
            "window.scrollBy(0, Math.min(document.body.scrollHeight || 0, 1600));"
            "for (const anchor of document.querySelectorAll('a[href*=\"facebook.com\"]')) {"
            "let text = '';"
            "let node = anchor;"
            "for (let depth = 0; depth < 7 && node; depth += 1, node = node.parentElement) {"
            "text += ` ${node.innerText || ''}`;"
            "}"
            "text = text.toLowerCase();"
            "if (keywords.length && !keywords.some((kw) => text.includes(kw))) continue;"
            "const href = normalize(anchor.href);"
            "if (href) urls.add(href);"
            "if (urls.size >= maxLinks) break;"
            "}"
            "return JSON.stringify([...urls]);"
            "})()"
        )
    return "JSON.stringify([])"


def parse_eval_posts(
    config: dict,
    platform: str,
    max_links: int,
    raw_output: str,
) -> list[str]:
    keywords = [
        str(keyword).strip()
        for keyword in (config.get("intentKeywords") or [])
        if str(keyword).strip()
    ]
    text = raw_output.strip()
    if not text:
        return []
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("[")
        end = text.rfind("]")
        if start == -1 or end == -1:
            return []
        try:
            payload = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return []

    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            return []
    if not isinstance(payload, list):
        return []
    return filter_post_urls([str(item) for item in payload], platform, keywords, max_links)


def extract_posts_from_snapshot(
    config: dict,
    platform: str,
    max_links: int,
    snapshot: dict,
) -> list[str]:
    keywords = [
        keyword.lower()
        for keyword in (config.get("intentKeywords") or [])
        if str(keyword).strip()
    ]
    pattern = POST_PATTERNS.get(platform)
    if not pattern:
        return []

    refs = snapshot.get("refs") or snapshot.get("elements") or []
    seen: set[str] = set()
    urls: list[str] = []

    for ref in refs:
        text = " ".join(
            str(ref.get(key) or "")
            for key in ("href", "url", "text", "name", "label", "value", "ariaLabel")
        )
        if keywords and not any(keyword in text.lower() for keyword in keywords):
            continue

        for token in re.findall(r"https?://\S+", text):
            cleaned = normalize_post_url(token.rstrip(".,)\"'"), platform)
            if looks_like_post_url(cleaned, platform) and cleaned not in seen:
                seen.add(cleaned)
                urls.append(cleaned)
                if len(urls) >= max_links:
                    return urls

    return urls


def pick_content_tab_id(tabs_payload: dict, platform: str = "") -> str:
    tabs = tabs_payload.get("data", {}).get("tabs") or tabs_payload.get("tabs") or []
    content_tabs: list[dict] = []

    for tab in tabs:
        url = str(tab.get("url") or "").strip()
        lowered = url.lower()
        if not lowered.startswith("http"):
            continue
        if lowered.startswith("devtools://"):
            continue
        if any(marker in lowered for marker in SHELL_TAB_IGNORE):
            continue
        if str(tab.get("title") or "") == "RealTimeX Browser":
            continue
        content_tabs.append(tab)

    if not content_tabs:
        return ""

    def matches_platform(tab: dict) -> bool:
        url = str(tab.get("url") or "").lower()
        if platform == "x":
            return "x.com" in url or "twitter.com" in url
        if platform == "linkedin":
            return "linkedin.com" in url
        if platform == "facebook":
            return "facebook.com" in url
        return True

    preferred = next((tab for tab in content_tabs if matches_platform(tab)), content_tabs[0])
    return str(
        preferred.get("tabId")
        or preferred.get("id")
        or preferred.get("targetId")
        or ""
    )


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: resolve.py <targets|pick-platform|eligible-platforms|fallback|extract-posts|pick-tab> ...", file=sys.stderr)
        return 2

    command = sys.argv[1]

    if command == "session":
        config = json.loads(sys.argv[2])
        signals_base = sys.argv[3] if len(sys.argv) > 3 else ""
        print(resolve_browser_session_name(config, signals_base))
        return 0

    if command == "signals-base-url":
        config = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
        env_override = sys.argv[3] if len(sys.argv) > 3 else ""
        print(resolve_signals_base_url(config, env_override))
        return 0

    if command == "should-stop":
        print("1" if should_stop_browser_session(sys.argv[2]) else "0")
        return 0

    if command == "targets":
        config = json.loads(sys.argv[2])
        platform = sys.argv[3]
        for url in resolve_targets(config, platform):
            print(url)
        return 0

    if command == "eligible-platforms":
        config = json.loads(sys.argv[2])
        for platform in eligible_platforms(config):
            print(platform)
        return 0

    if command == "pick-platform":
        config = json.loads(sys.argv[2])
        for platform in configured_platforms(config):
            reason = platform_skip_reason(platform, config)
            if reason:
                print(reason, file=sys.stderr)
        print(pick_scout_platform(config))
        return 0

    if command == "fallback":
        config = json.loads(sys.argv[2])
        platform = sys.argv[3]
        max_links = int(sys.argv[4])
        for url in fallback_candidates(config, platform, max_links):
            print(url)
        return 0

    if command == "extract-posts":
        config = json.loads(sys.argv[2])
        platform = sys.argv[3]
        max_links = int(sys.argv[4])
        snapshot = json.load(sys.stdin)
        for url in extract_posts_from_snapshot(config, platform, max_links, snapshot):
            print(url)
        return 0

    if command == "copy-link-init":
        print(COPY_LINK_INIT_JS)
        return 0

    if command.endswith("-open-menu"):
        platform = command[: -len("-open-menu")]
        if len(sys.argv) > 2 and sys.argv[2] != "-":
            config = json.loads(sys.argv[2])
        else:
            config = json.load(sys.stdin)
        keywords = [
            str(keyword).strip()
            for keyword in (config.get("intentKeywords") or [])
            if str(keyword).strip()
        ]
        print(build_open_menu_script(platform, keywords))
        return 0

    if command.endswith("-click-copy-link") or command.endswith("-extract-url") or command.endswith("-close-menu"):
        platform = command.split("-", 1)[0]
        action = command[len(platform) + 1 :]
        script = COPY_LINK_PLATFORM_COMMANDS.get(platform, {}).get(action)
        if script:
            print(script)
            return 0
        print(f"unknown copy-link command: {command}", file=sys.stderr)
        return 2

    if command == "facebook-init":
        print(FACEBOOK_INIT_JS)
        return 0

    if command == "facebook-open-share":
        if len(sys.argv) > 2 and sys.argv[2] != "-":
            config = json.loads(sys.argv[2])
        else:
            config = json.load(sys.stdin)
        keywords = [
            str(keyword).strip()
            for keyword in (config.get("intentKeywords") or [])
            if str(keyword).strip()
        ]
        print(build_facebook_open_share_script(keywords))
        return 0

    if command == "facebook-click-copy-link":
        print(FACEBOOK_CLICK_COPY_LINK_JS)
        return 0

    if command == "facebook-extract-dialog":
        print(FACEBOOK_EXTRACT_DIALOG_JS)
        return 0

    if command == "facebook-close-dialog":
        print(FACEBOOK_CLOSE_DIALOG_JS)
        return 0

    if command == "eval-script":
        config = json.loads(sys.argv[2])
        platform = sys.argv[3]
        max_links = int(sys.argv[4])
        keywords = [
            str(keyword).strip()
            for keyword in (config.get("intentKeywords") or [])
            if str(keyword).strip()
        ]
        print(build_eval_script(platform, keywords, max_links))
        return 0

    if command == "parse-eval-posts":
        config_arg = sys.argv[2]
        if config_arg.startswith("@"):
            with open(config_arg[1:], encoding="utf-8") as handle:
                config = json.load(handle)
        else:
            config = json.loads(config_arg)
        platform = sys.argv[3]
        max_links = int(sys.argv[4])
        raw_output = sys.stdin.read()
        for url in parse_eval_posts(config, platform, max_links, raw_output):
            print(url)
        return 0

    if command == "pick-tab":
        payload = json.load(sys.stdin)
        platform = sys.argv[2] if len(sys.argv) > 2 else ""
        tab_id = pick_content_tab_id(payload, platform)
        if tab_id:
            print(tab_id)
        return 0

    if command == "self-test":
        unittest.main(argv=[sys.argv[0]], exit=True, verbosity=2)
        return 0

    print(f"unknown command: {command}", file=sys.stderr)
    return 2


class ResolveTests(unittest.TestCase):
    def test_resolve_community_name_on_x(self) -> None:
        url = resolve_community("x", "Build in Public")
        self.assertIn("x.com/search?q=Build+in+Public", url)

    def test_resolve_search_with_intent_keyword(self) -> None:
        url = resolve_search("x", "yc", ["funding", "founder"])
        self.assertIn("yc", url)
        self.assertIn("funding", url)

    def test_http_url_passthrough(self) -> None:
        direct = "https://x.com/someuser/status/123"
        self.assertEqual(resolve_search("x", direct, []), direct)

    def test_fallback_only_returns_direct_post_urls(self) -> None:
        config = {
            "inheritAuthenticatedSession": True,
            "browserSessionName": "signals-publish",
            "communities": ["https://x.com/foo/status/111"],
            "searchQueries": ["yc"],
            "intentKeywords": [],
        }
        urls = fallback_candidates(config, "x", 5)
        self.assertEqual(urls, ["https://x.com/foo/status/111"])

    def test_fallback_skips_navigation_urls(self) -> None:
        config = {
            "inheritAuthenticatedSession": True,
            "browserSessionName": "signals-publish",
            "communities": ["Build in Public"],
            "searchQueries": ["yc"],
            "intentKeywords": ["funding"],
        }
        urls = fallback_candidates(config, "x", 5)
        self.assertEqual(urls, [])

    def test_authenticated_feed_prepended(self) -> None:
        config = {
            "inheritAuthenticatedSession": True,
            "browserSessionName": "signals-publish",
            "searchQueries": ["yc"],
            "intentKeywords": [],
        }
        urls = resolve_targets(config, "linkedin")
        self.assertEqual(urls[0], "https://www.linkedin.com/feed/")

    def test_facebook_falls_back_to_intent_keyword_search(self) -> None:
        config = {
            "inheritAuthenticatedSession": True,
            "browserSessionName": "signals-publish",
            "communities": [],
            "searchQueries": [],
            "intentKeywords": ["funding", "founder"],
        }
        urls = resolve_targets(config, "facebook")
        self.assertEqual(
            urls,
            ["https://www.facebook.com/search/posts?q=funding+founder"],
        )

    def test_facebook_intent_fallback_skipped_when_explicit_targets_exist(self) -> None:
        config = {
            "inheritAuthenticatedSession": True,
            "browserSessionName": "signals-publish",
            "communities": ["https://www.facebook.com/groups/acme"],
            "searchQueries": [],
            "intentKeywords": ["funding"],
        }
        urls = resolve_targets(config, "facebook")
        self.assertEqual(urls, ["https://www.facebook.com/groups/acme"])

    def test_intent_keywords_do_not_add_x_search_targets(self) -> None:
        config = {
            "inheritAuthenticatedSession": True,
            "browserSessionName": "signals-publish",
            "communities": [],
            "searchQueries": [],
            "intentKeywords": ["funding", "founder"],
        }
        urls = resolve_targets(config, "x")
        self.assertEqual(urls, ["https://x.com/home"])

    def test_facebook_excluded_from_eligible_platforms_without_targets(self) -> None:
        config = {
            "platforms": ["x", "linkedin", "facebook"],
            "inheritAuthenticatedSession": True,
            "browserSessionName": "signals-publish",
            "communities": [],
            "searchQueries": [],
            "intentKeywords": [],
        }
        self.assertEqual(eligible_platforms(config), ["x", "linkedin"])

    def test_facebook_eligible_with_intent_keywords_only(self) -> None:
        config = {
            "platforms": ["x", "linkedin", "facebook"],
            "inheritAuthenticatedSession": True,
            "browserSessionName": "signals-publish",
            "communities": [],
            "searchQueries": [],
            "intentKeywords": ["funding"],
        }
        self.assertEqual(eligible_platforms(config), ["x", "linkedin", "facebook"])

    def test_pick_scout_platform_skips_ineligible_facebook(self) -> None:
        config = {
            "platforms": ["x", "linkedin", "facebook"],
            "inheritAuthenticatedSession": True,
            "browserSessionName": "signals-publish",
            "communities": [],
            "searchQueries": [],
            "intentKeywords": [],
        }
        picked = pick_scout_platform(config, day_seed="2026-08-26")
        self.assertIn(picked, {"x", "linkedin"})
        self.assertNotEqual(picked, "facebook")

    def test_pick_scout_platform_empty_when_no_platforms_eligible(self) -> None:
        config = {
            "platforms": ["facebook"],
            "inheritAuthenticatedSession": True,
            "browserSessionName": "signals-publish",
            "communities": [],
            "searchQueries": [],
            "intentKeywords": [],
        }
        self.assertEqual(pick_scout_platform(config), "")
        self.assertEqual(eligible_platforms(config), [])

    def test_platform_skip_reason_for_facebook(self) -> None:
        config = {
            "platforms": ["facebook"],
            "communities": [],
            "searchQueries": [],
            "intentKeywords": [],
        }
        reason = platform_skip_reason("facebook", config)
        self.assertIn("facebook skipped", reason)
        self.assertIn("intent keywords", reason)

    def test_resolve_browser_session_defaults_to_publish(self) -> None:
        self.assertEqual(resolve_browser_session_name({}, ""), "signals-publish")

    def test_extract_post_url_from_share_dialog(self) -> None:
        href = (
            "https://l.facebook.com/l.php?u=https%3A%2F%2Fwa.me%2F%3Ftext%3D"
            "https%253A%252F%252Fwww.facebook.com%252Fvdphat%252Fposts%252FpfbidABC123"
        )
        self.assertEqual(
            extract_post_url_from_share_href(href),
            "https://www.facebook.com/vdphat/posts/pfbidABC123",
        )

    def test_facebook_photo_urls_are_enqueueable(self) -> None:
        url = "https://www.facebook.com/photo/?fbid=1234567890&set=a.1"
        self.assertTrue(looks_like_post_url(url, "facebook"))
        self.assertEqual(
            normalize_post_url(url, "facebook"),
            "https://www.facebook.com/photo/?fbid=1234567890",
        )

    def test_truncated_facebook_pfbid_urls_are_rejected(self) -> None:
        truncated = "https://www.facebook.com/saritasym/posts/pfbid0AVUoH55Pnb4cxmX8Gt5yjEYJm"
        full = (
            "https://www.facebook.com/saritasym/posts/"
            "pfbid0AVUoH55Pnb4cxmX8Gt5yjEYJmuy8cS3cvm8iWRUyLyyuxg5MzDSt5NwNpLY6xpvrl"
        )
        self.assertFalse(looks_like_post_url(truncated, "facebook"))
        self.assertTrue(looks_like_post_url(full, "facebook"))

    def test_filter_post_urls_rejects_truncated_pfbid(self) -> None:
        truncated = "https://www.facebook.com/saritasym/posts/pfbid0AVUoH55Pnb4cxmX8Gt5yjEYJm"
        full = (
            "https://www.facebook.com/saritasym/posts/"
            "pfbid0AVUoH55Pnb4cxmX8Gt5yjEYJmuy8cS3cvm8iWRUyLyyuxg5MzDSt5NwNpLY6xpvrl"
        )
        # The harvest path, not just the standalone predicate, must drop it.
        self.assertEqual(
            filter_post_urls([truncated, full], "facebook", [], 5),
            [full],
        )

    def test_snapshot_extractor_rejects_truncated_pfbid(self) -> None:
        truncated = "https://www.facebook.com/saritasym/posts/pfbid0AVUoH55Pnb4cxmX8Gt5yjEYJm"
        snapshot = {"refs": [{"href": truncated}]}
        self.assertEqual(
            extract_posts_from_snapshot({}, "facebook", 5, snapshot),
            [],
        )

    def test_target_id_resolves_over_defaulted_session_name(self) -> None:
        calls: list[tuple[str, str]] = []

        def fake_fetch(base: str, target_id: str) -> str:
            calls.append((base, target_id))
            return "signals-acme"

        original = globals()["fetch_target_session_name"]
        globals()["fetch_target_session_name"] = fake_fetch
        try:
            # browserSessionName is always populated with the default, so the
            # selected acting profile must still win.
            name = resolve_browser_session_name(
                {"browserSessionName": DEFAULT_BROWSER_SESSION, "targetId": "tgt-1"},
                "http://127.0.0.1:3010",
            )
        finally:
            globals()["fetch_target_session_name"] = original

        self.assertEqual(name, "signals-acme")
        self.assertEqual(calls, [("http://127.0.0.1:3010", "tgt-1")])

    def test_custom_session_name_still_overrides_target_id(self) -> None:
        name = resolve_browser_session_name(
            {"browserSessionName": "my-own-session", "targetId": "tgt-1"},
            "http://127.0.0.1:3010",
        )
        self.assertEqual(name, "my-own-session")

    def test_session_name_read_from_invoke_result_envelope(self) -> None:
        body = {
            "success": True,
            "tool": "get_platform_target",
            "result": {"connection": {"sessionName": "signals-acme"}},
        }
        self.assertEqual(session_name_from_invoke_body(body), "signals-acme")
        # A bare top-level connection (older shape) still works.
        self.assertEqual(
            session_name_from_invoke_body({"connection": {"sessionName": "legacy"}}),
            "legacy",
        )
        self.assertEqual(session_name_from_invoke_body({"result": {}}), "")

    def test_facebook_share_href_accepts_numeric_post_ids(self) -> None:
        url = extract_post_url_from_share_href(
            "https://www.facebook.com/acme/posts/1234567890"
        )
        self.assertEqual(url, "https://www.facebook.com/acme/posts/1234567890")

    def test_linkedin_short_urls_are_enqueueable(self) -> None:
        url = "https://lnkd.in/p/g8t6zZDV"
        self.assertTrue(looks_like_post_url(url, "linkedin"))
        self.assertEqual(normalize_post_url(url, "linkedin"), url)

    def test_x_status_urls_strip_analytics(self) -> None:
        url = "https://x.com/foo/status/123/analytics"
        self.assertEqual(
            normalize_post_url(url, "x"),
            "https://x.com/foo/status/123",
        )

    def test_parse_eval_posts_handles_quoted_json(self) -> None:
        raw = '"[\\"https://x.com/foo/status/123\\"]"'
        urls = parse_eval_posts({"intentKeywords": []}, "x", 5, raw)
        self.assertEqual(urls, ["https://x.com/foo/status/123"])

    def test_signals_base_url_prefers_recorded_origin(self) -> None:
        config = {"signalsBaseUrl": "http://127.0.0.1:45231"}
        self.assertEqual(
            resolve_signals_base_url(config), "http://127.0.0.1:45231"
        )

    def test_signals_base_url_env_override_wins(self) -> None:
        config = {"signalsBaseUrl": "http://127.0.0.1:45231"}
        self.assertEqual(
            resolve_signals_base_url(config, "http://127.0.0.1:9999/"),
            "http://127.0.0.1:9999",
        )

    def test_signals_base_url_falls_back_when_unrecorded(self) -> None:
        self.assertEqual(resolve_signals_base_url({}), FALLBACK_SIGNALS_BASE_URL)

    def test_should_not_stop_shared_session(self) -> None:
        self.assertFalse(should_stop_browser_session("signals-publish"))

    def test_should_not_stop_dedicated_platform_connection(self) -> None:
        # Resolved from an acting profile; the scout did not create it.
        self.assertFalse(should_stop_browser_session("signals-contention"))
        self.assertFalse(should_stop_browser_session("my-linkedin-profile"))

    def test_should_stop_scout_owned_session(self) -> None:
        self.assertTrue(should_stop_browser_session("signals-scout-x"))
        self.assertTrue(should_stop_browser_session("signals-scout-linkedin"))

    def test_extract_posts_filters_keywords(self) -> None:
        config = {"intentKeywords": ["funding"]}
        snapshot = {
            "refs": [
                {
                    "href": "https://x.com/a/status/1",
                    "text": "raised funding today",
                },
                {
                    "href": "https://x.com/b/status/2",
                    "text": "random lunch photo",
                },
            ]
        }
        urls = extract_posts_from_snapshot(config, "x", 5, snapshot)
        self.assertEqual(urls, ["https://x.com/a/status/1"])


if __name__ == "__main__":
    raise SystemExit(main())
