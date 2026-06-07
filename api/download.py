"""
api/download.py — Python Vercel function with cloudscraper Cloudflare bypass
Deploy this as api/download.py and add requirements.txt to your repo root

requirements.txt contents:
    cloudscraper>=1.2.71
"""
import json, re, time
try:
    import cloudscraper
    HAS_SCRAPER = True
except ImportError:
    import urllib.request, urllib.parse
    HAS_SCRAPER = False

ANIMEPAHE  = "https://animepahe.ru"
KWIK_BASE  = "https://kwik.si"
ANILIST    = "https://graphql.anilist.co"

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept":          "application/json, text/html, */*;q=0.9",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
}

def make_scraper():
    if HAS_SCRAPER:
        return cloudscraper.create_scraper(browser={"browser":"chrome","platform":"windows","mobile":False})
    import requests
    return requests.Session()

def anilist_title(ani_id):
    import requests
    body = json.dumps({"query":"query($id:Int){Media(id:$id,type:ANIME){title{english romaji}}}","variables":{"id":int(ani_id)}})
    r = requests.post(ANILIST, data=body, headers={"Content-Type":"application/json"}, timeout=10)
    d = r.json()
    return d.get("data",{}).get("Media",{}).get("title",{}).get("english") or \
           d.get("data",{}).get("Media",{}).get("title",{}).get("romaji")

def pahe_search(title, sc):
    r = sc.get(f"{ANIMEPAHE}/api?m=search&q={urllib.parse.quote(title)}",
               headers={**HEADERS,"Referer":ANIMEPAHE+"/"}, timeout=15)
    return r.json().get("data",[])

def pahe_episodes(session, sc, page=1):
    r = sc.get(f"{ANIMEPAHE}/api?m=release&id={session}&sort=episode_asc&page={page}",
               headers={**HEADERS,"Referer":ANIMEPAHE+"/"}, timeout=15)
    return r.json()

def pahe_sources(anime_session, ep_session, sc):
    r = sc.get(f"{ANIMEPAHE}/api?m=links&id={anime_session}&session={ep_session}&p=kwik",
               headers={**HEADERS,"Referer":ANIMEPAHE+"/"}, timeout=15)
    return r.json().get("data",[])

def resolve_kwik(kwik_url, sc):
    hdrs = {**HEADERS,"Referer":ANIMEPAHE+"/","Origin":ANIMEPAHE}
    r = sc.get(kwik_url, headers=hdrs, timeout=15)
    html = r.text
    # Submit anti-bot form if present
    token = re.search(r'name="_token"\s+value="([^"]+)"', html)
    action = re.search(r'<form[^>]+action="([^"]+)"', html)
    if token and action:
        pr = sc.post(action.group(1), data={"_token":token.group(1)},
                     headers={**hdrs,"Referer":kwik_url,"Content-Type":"application/x-www-form-urlencoded"},
                     timeout=15)
        html = pr.text
    for pat in [
        r"source:\s*['\"]([^'\"]+\.m3u8[^'\"]*)['\"]",
        r'"file"\s*:\s*"([^"]+\.m3u8[^"]*)"',
        r"(https?://[^\s\"'<>]+\.m3u8[^\s\"'<>]*)",
    ]:
        m = re.search(pat, html)
        if m:
            return m.group(1).replace("\\/","/"), kwik_url
    return None, None

def handler(request):
    """Vercel Python handler"""
    params   = dict(request.args) if hasattr(request, 'args') else {}
    ani_id   = params.get("aniId","")
    ep_num   = int(params.get("ep","1") or 1)
    lang     = params.get("lang","sub")
    
    headers  = {"Access-Control-Allow-Origin":"*","Content-Type":"application/json"}
    player   = f"https://vidnest.fun/animepahe/{ani_id}/{ep_num}/{lang}"

    if not ani_id:
        return {"statusCode":400,"headers":headers,"body":json.dumps({"error":"aniId required"})}

    try:
        sc    = make_scraper()
        title = anilist_title(ani_id)
        if not title:
            raise ValueError("Could not get title from AniList")

        # Search
        results = pahe_search(title, sc)
        if not results:
            raise ValueError(f"'{title}' not found on AnimePahe")
        anime = next((x for x in results if title.lower() in x["title"].lower()), results[0])

        # Episodes (page 1 only for speed; for ep>30 fetch more pages)
        ep_page = max(1, (ep_num - 1) // 30 + 1)
        epdata  = pahe_episodes(anime["session"], sc, ep_page)
        eps     = epdata.get("data",[])
        ep      = next((e for e in eps if round(float(e.get("episode",0)))==ep_num), None)
        if not ep and ep_num <= len(eps):
            ep = eps[ep_num-1]
        if not ep:
            raise ValueError(f"Episode {ep_num} not found")

        # Sources
        raw_sources = pahe_sources(anime["session"], ep["session"], sc)
        sources = []
        for row in raw_sources:
            for q, info in row.items():
                if isinstance(info, dict):
                    info["quality"] = q
                    sources.append(info)
        if not sources:
            raise ValueError("No sources found")
        best = sorted(sources, key=lambda s: int(re.sub(r"\D","",str(s.get("quality","720"))) or 0))[-1]
        kwik = best.get("kwik") or best.get("url")
        if not kwik:
            raise ValueError("No kwik URL")

        # Resolve
        m3u8, referer = resolve_kwik(kwik, sc)
        if not m3u8:
            raise ValueError("Could not extract m3u8 from kwik page")

        body = json.dumps({
            "success":True,"title":title,"episode":ep_num,
            "quality":best.get("quality","720p"),
            "url":m3u8,"referer":referer
        })
        return {"statusCode":200,"headers":headers,"body":body}

    except Exception as e:
        body = json.dumps({"success":False,"playerUrl":player,"error":str(e)})
        return {"statusCode":200,"headers":headers,"body":body}
