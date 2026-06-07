#!/usr/bin/env python3
"""
AnimePahe Downloader — Bypasses Cloudflare, saves as MP4/MKV
Requirements:
    pip install cloudscraper requests tqdm
    + ffmpeg installed: https://ffmpeg.org/download.html

Usage:
    python animepahe_dl.py "One Piece" --ep 1
    python animepahe_dl.py "Re:Zero" --ep 3 --format mkv
    python animepahe_dl.py "Bleach" --ep 1 --out ./downloads
"""

import sys, os, re, json, time, argparse, threading
import cloudscraper
from tqdm import tqdm

# ── CONFIG ────────────────────────────────────────────────────────────────────
ANIMEPAHE  = "https://animepahe.ru"
KWIK_BASE  = "https://kwik.si"
THREADS    = 8      # parallel segment downloads
CHUNK_SIZE = 1024 * 256  # 256 KB

BROWSER_CFG = {
    "browser": "chrome",
    "platform": "windows",
    "mobile": False,
}

# ── CLOUDFLARE-BYPASS SCRAPER ─────────────────────────────────────────────────
def make_scraper():
    s = cloudscraper.create_scraper(browser=BROWSER_CFG)
    s.headers.update({
        "Accept":          "application/json, text/html, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection":      "keep-alive",
        "DNT":             "1",
    })
    return s

# ── ANIMEPAHE API ─────────────────────────────────────────────────────────────
def search(query, scraper):
    r = scraper.get(f"{ANIMEPAHE}/api?m=search&q={query}",
                    headers={"Referer": ANIMEPAHE + "/"})
    r.raise_for_status()
    return r.json().get("data", [])

def get_episodes(session, scraper, page=1):
    r = scraper.get(
        f"{ANIMEPAHE}/api?m=release&id={session}&sort=episode_asc&page={page}",
        headers={"Referer": ANIMEPAHE + "/"})
    r.raise_for_status()
    return r.json()

def all_episodes(session, scraper):
    eps, page = [], 1
    while True:
        data = get_episodes(session, scraper, page)
        eps.extend(data.get("data", []))
        if page >= data.get("last_page", 1):
            break
        page += 1
        time.sleep(0.4)
    return eps

def get_sources(anime_session, ep_session, scraper):
    r = scraper.get(
        f"{ANIMEPAHE}/api?m=links&id={anime_session}&session={ep_session}&p=kwik",
        headers={"Referer": ANIMEPAHE + "/"})
    r.raise_for_status()
    return r.json().get("data", [])

# ── KWIK RESOLVER (gets m3u8 + real Referer) ─────────────────────────────────
def resolve_kwik(kwik_url, scraper):
    headers = {
        "Referer":    ANIMEPAHE + "/",
        "Origin":     ANIMEPAHE,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) "
                      "Chrome/124.0.0.0 Safari/537.36",
    }
    # Step 1: GET kwik embed page
    r = scraper.get(kwik_url, headers=headers)
    html = r.text

    # Step 2: Extract the POST form token and submit
    token_m = re.search(r'name="_token"\s+value="([^"]+)"', html)
    action_m = re.search(r'<form[^>]+action="([^"]+)"', html)
    if token_m and action_m:
        token  = token_m.group(1)
        action = action_m.group(1)
        pr = scraper.post(action,
                          data={"_token": token},
                          headers={**headers, "Referer": kwik_url,
                                   "Content-Type": "application/x-www-form-urlencoded"})
        html = pr.text

    # Step 3: Extract m3u8 URL from the player JS
    for pattern in [
        r"source:\s*['\"]([^'\"]+\.m3u8[^'\"]*)['\"]",
        r'"file"\s*:\s*"([^"]+\.m3u8[^"]*)"',
        r"(https?://[^\s\"']+\.m3u8[^\s\"']*)",
        r"source\s*=\s*['\"]([^'\"]+\.m3u8[^'\"]*)['\"]",
    ]:
        m = re.search(pattern, html)
        if m:
            url = m.group(1).replace("\\/", "/")
            return url, kwik_url
    return None, None

# ── HLS DOWNLOADER ────────────────────────────────────────────────────────────
def fetch_playlist(m3u8_url, referer, scraper):
    headers = {"Referer": referer, "Origin": KWIK_BASE}
    r = scraper.get(m3u8_url, headers=headers)
    r.raise_for_status()
    base = m3u8_url.rsplit("/", 1)[0] + "/"
    lines = [l.strip() for l in r.text.splitlines() if l.strip() and not l.startswith("#")]

    # Master playlist → pick best quality
    if any(".m3u8" in l for l in lines):
        sub_url = lines[-1] if lines[-1].startswith("http") else base + lines[-1]
        r2 = scraper.get(sub_url, headers=headers)
        r2.raise_for_status()
        base = sub_url.rsplit("/", 1)[0] + "/"
        lines = [l.strip() for l in r2.text.splitlines() if l.strip() and not l.startswith("#")]

    segs = [l if l.startswith("http") else base + l for l in lines]
    return segs

def download_segment(args):
    idx, url, referer, scraper = args
    headers = {"Referer": referer, "Origin": KWIK_BASE}
    for attempt in range(4):
        try:
            r = scraper.get(url, headers=headers, timeout=30)
            r.raise_for_status()
            return idx, r.content
        except Exception as e:
            if attempt == 3:
                raise
            time.sleep(1.5 ** attempt)

def download_hls(m3u8_url, referer, out_ts, scraper):
    print(f"\n→ Fetching playlist: {m3u8_url[:60]}…")
    segs = fetch_playlist(m3u8_url, referer, scraper)
    print(f"→ {len(segs)} segments to download")

    results = [None] * len(segs)
    total_bytes = 0
    args = [(i, url, referer, scraper) for i, url in enumerate(segs)]

    with tqdm(total=len(segs), unit="seg", ncols=70, colour="red") as bar:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=THREADS) as ex:
            for idx, data in ex.map(download_segment, args):
                results[idx] = data
                total_bytes += len(data)
                bar.set_postfix(mb=f"{total_bytes/1048576:.1f}")
                bar.update(1)

    print(f"→ Merging {total_bytes/1048576:.1f} MB → {out_ts}")
    with open(out_ts, "wb") as f:
        for chunk in results:
            f.write(chunk)
    return out_ts

# ── FFMPEG CONVERT ────────────────────────────────────────────────────────────
def convert(ts_path, out_path, fmt):
    print(f"→ Converting to {fmt.upper()}…")
    codec = ["-c:v", "copy", "-c:a", "copy"]
    mkv_extra = ["-metadata:s:a:0", "language=jpn"] if fmt == "mkv" else []
    cmd = f'ffmpeg -y -i "{ts_path}" {" ".join(codec + mkv_extra)} "{out_path}" -loglevel warning'
    ret = os.system(cmd)
    if ret == 0:
        os.remove(ts_path)
        print(f"✅ Saved: {out_path}")
    else:
        print(f"⚠ ffmpeg failed — raw TS kept: {ts_path}")

# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="AnimePahe downloader with Cloudflare bypass")
    ap.add_argument("title",          help="Anime title to search")
    ap.add_argument("--ep",   type=int, default=1, help="Episode number (default: 1)")
    ap.add_argument("--lang", choices=["sub","dub"], default="sub")
    ap.add_argument("--quality", default="best", help="360p/480p/720p/1080p or best")
    ap.add_argument("--format", choices=["mp4","mkv"], default="mp4", dest="fmt")
    ap.add_argument("--out",  default=".", help="Output directory")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    scraper = make_scraper()

    # 1. Search
    print(f"\n🔍 Searching: {args.title}")
    results = search(args.title, scraper)
    if not results:
        print("✗ No results found"); sys.exit(1)

    anime = next((r for r in results if args.title.lower() in r["title"].lower()), results[0])
    print(f"✓ Found: {anime['title']} (session: {anime['session']})")

    # 2. Episodes
    print(f"📋 Fetching episode list…")
    eps = all_episodes(anime["session"], scraper)
    ep = next((e for e in eps if round(float(e.get("episode", 0))) == args.ep), None)
    if not ep:
        print(f"✗ Episode {args.ep} not found ({len(eps)} episodes available)")
        sys.exit(1)
    print(f"✓ EP{args.ep}: {ep.get('title','')[:60]}")

    # 3. Sources (quality selection)
    print("🎬 Fetching sources…")
    sources = get_sources(anime["session"], ep["session"], scraper)
    if not sources:
        print("✗ No sources found"); sys.exit(1)

    # Filter by language
    lang_sources = [s for row in sources for s in row.values()
                    if isinstance(s, dict) and s.get("audio", "sub") == args.lang]
    if not lang_sources:
        lang_sources = [s for row in sources for s in row.values() if isinstance(s, dict)]

    # Pick quality
    def q_rank(s):
        q = s.get("quality", "720")
        return int(re.sub(r"\D","",str(q)) or 0)
    best = max(lang_sources, key=q_rank) if args.quality == "best" else \
           next((s for s in lang_sources if args.quality in str(s.get("quality",""))), lang_sources[-1])

    kwik_url = best.get("kwik") or best.get("url")
    print(f"✓ Source: {best.get('quality','?')}p {args.lang.upper()} → {kwik_url[:50]}…")

    # 4. Resolve kwik → m3u8
    print("🔑 Resolving stream URL…")
    m3u8_url, referer = resolve_kwik(kwik_url, scraper)
    if not m3u8_url:
        print("✗ Could not extract m3u8 URL"); sys.exit(1)
    print(f"✓ m3u8: {m3u8_url[:70]}…")
    print(f"✓ Referer: {referer}")

    # 5. Download
    safe_title = re.sub(r'[<>:"/\\|?*]', '', anime["title"])
    base_name  = f"{safe_title} EP{str(args.ep).zfill(3)} {best.get('quality','720')}p"
    ts_path    = os.path.join(args.out, base_name + ".ts")
    out_path   = os.path.join(args.out, base_name + f".{args.fmt}")

    download_hls(m3u8_url, referer, ts_path, scraper)

    # 6. Convert
    if os.system("ffmpeg -version > /dev/null 2>&1") == 0:
        convert(ts_path, out_path, args.fmt)
    else:
        print(f"⚠ ffmpeg not found — file saved as TS: {ts_path}")
        print("  Install ffmpeg from https://ffmpeg.org/download.html")

if __name__ == "__main__":
    main()
