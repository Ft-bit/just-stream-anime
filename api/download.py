"""
api/download.py
Place this file at api/download.py in your GitHub repo.
Vercel will run it as a Python serverless function.
Uses cloudscraper to bypass Cloudflare on AnimePahe.
"""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, quote
import json, re, time, os

try:
    import cloudscraper
    HAS_CS = True
except ImportError:
    import urllib.request
    HAS_CS = False

ANIMEPAHE = "https://animepahe.ru"
KWIK_BASE = "https://kwik.si"
ANILIST   = "https://graphql.anilist.co"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

def scraper():
    if HAS_CS:
        s = cloudscraper.create_scraper(
            browser={"browser": "chrome", "platform": "windows", "mobile": False})
        s.headers.update({"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
        return s
    import requests
    s = requests.Session()
    s.headers.update({"User-Agent": UA})
    return s

def anilist_title(ani_id):
    import urllib.request
    body = json.dumps({
        "query": "query($id:Int){Media(id:$id,type:ANIME){title{english romaji}}}",
        "variables": {"id": int(ani_id)}
    }).encode()
    req = urllib.request.Request(ANILIST, data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        d = json.loads(r.read())
    t = d.get("data", {}).get("Media", {}).get("title", {})
    return t.get("english") or t.get("romaji")

def pahe_get(sc, path):
    r = sc.get(ANIMEPAHE + path, headers={"Referer": ANIMEPAHE + "/"}, timeout=20)
    r.raise_for_status()
    return r.json()

def resolve_kwik(kwik_url, sc):
    hdrs = {"Referer": ANIMEPAHE + "/", "Origin": ANIMEPAHE, "User-Agent": UA}
    r = sc.get(kwik_url, headers=hdrs, timeout=20)
    html = r.text
    # Submit form if anti-bot present
    tok = re.search(r'name="_token"\s+value="([^"]+)"', html)
    act = re.search(r'<form[^>]+action="([^"]+)"', html)
    if tok and act:
        pr = sc.post(act.group(1), data={"_token": tok.group(1)},
                     headers={**hdrs, "Referer": kwik_url,
                              "Content-Type": "application/x-www-form-urlencoded"},
                     timeout=20)
        html = pr.text
    for pat in [
        r"source:\s*['\"]([^'\"]+\.m3u8[^'\"]*)['\"]",
        r'"file"\s*:\s*"([^"]+\.m3u8[^"]*)"',
        r"(https?://[^\s\"'<>]+\.m3u8[^\s\"'<>]*)",
    ]:
        m = re.search(pat, html)
        if m:
            return m.group(1).replace("\\/", "/"), kwik_url
    return None, None

def resolve(ani_id, ep_num, lang):
    sc = scraper()

    # 1. AniList title
    title = anilist_title(ani_id)
    if not title:
        raise ValueError("Could not get title from AniList")

    # 2. Search AnimePahe
    data = pahe_get(sc, f"/api?m=search&q={quote(title)}")
    results = data.get("data", [])
    if not results:
        raise ValueError(f"'{title}' not found on AnimePahe")
    anime = next((x for x in results
                  if title.lower() in x.get("title", "").lower()), results[0])

    # 3. Episodes — fetch correct page
    ep_page = max(1, (ep_num - 1) // 30 + 1)
    epdata = pahe_get(sc, f"/api?m=release&id={anime['session']}"
                         f"&sort=episode_asc&page={ep_page}")
    eps = epdata.get("data", [])
    ep = next((e for e in eps
               if round(float(e.get("episode", 0))) == ep_num), None)
    if not ep and 0 < ep_num <= len(eps):
        ep = eps[ep_num - 1]
    if not ep:
        raise ValueError(f"Episode {ep_num} not found")

    # 4. Sources
    raw = pahe_get(sc, f"/api?m=links&id={anime['session']}"
                       f"&session={ep['session']}&p=kwik")
    sources = []
    for row in raw.get("data", []):
        for q, info in row.items():
            if isinstance(info, dict):
                info["quality"] = q
                sources.append(info)
    if not sources:
        raise ValueError("No sources found")
    best = sorted(sources,
                  key=lambda s: int(re.sub(r"\D","",str(s.get("quality","720"))or"0")))[-1]
    kwik = best.get("kwik") or best.get("url")
    if not kwik:
        raise ValueError("No kwik URL in sources")

    # 5. Resolve kwik → m3u8
    m3u8, referer = resolve_kwik(kwik, sc)
    if not m3u8:
        raise ValueError("Could not extract m3u8 from kwik page")

    return {
        "success": True,
        "title":   title,
        "episode": ep_num,
        "quality": best.get("quality", "720p"),
        "url":     m3u8,
        "referer": referer,
    }


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        qs = parse_qs(urlparse(self.path).query)
        ani_id  = (qs.get("aniId",  [""])[0] or qs.get("aniid",  [""])[0]).strip()
        ep_num  = int(qs.get("ep",  ["1"])[0] or 1)
        lang    = qs.get("lang", ["sub"])[0]
        player  = f"https://vidnest.fun/animepahe/{ani_id}/{ep_num}/{lang}"

        self.send_response(200)
        self.send_header("Content-Type",                "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control",               "no-store")
        self.end_headers()

        if not ani_id:
            self.wfile.write(json.dumps({"error": "aniId required"}).encode())
            return
        try:
            result = resolve(ani_id, ep_num, lang)
            self.wfile.write(json.dumps(result).encode())
        except Exception as e:
            fallback = {"success": False, "playerUrl": player, "error": str(e)}
            self.wfile.write(json.dumps(fallback).encode())

    def log_message(self, *_):
        pass   # silence Vercel logs
