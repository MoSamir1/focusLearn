with open('/home/mosamir/Desktop/mahara super/backend/main.py', 'r') as f:
    code = f.read()

importances_block = """
import html
import concurrent.futures

def fetch_hvp(link: str, headers: dict) -> dict:
    import requests, re
    try:
        resp = requests.get(link, headers=headers, timeout=15)
        resp.raise_for_status()
        ids = extract_youtube_ids_from_text(resp.text)
        
        title = "Unknown Module"
        title_match = re.search(r"<title>(.*?)</title>", resp.text)
        if title_match:
            title = html.unescape(title_match.group(1).split("|")[0].strip())
            
        return {"link": link, "youtube_ids": ids, "title": title}
    except Exception:
        return {"link": link, "youtube_ids": [], "title": "Failed to load"}

def fallback_extract_full_course(url: str, cookie: str | None = None) -> dict:
    import requests, re
    headers = {"User-Agent": "Mozilla/5.0"}
    if cookie:
        cleaned_cookie = cookie.strip()
        headers["Cookie"] = cleaned_cookie if "=" in cleaned_cookie else f"MoodleSession={cleaned_cookie}"

    response = requests.get(url, headers=headers, timeout=25)
    response.raise_for_status()

    # Find all module links
    hvp_links = list(dict.fromkeys(
        re.findall(r"https?://maharatech\.gov\.eg/mod/hvp/view\.php\?id=\d+", response.text)
    ))
    
    if not hvp_links:
        login_markers = ["Login to your account", "Log in", "الدخول لحسابك", "تسجيل دخول"]
        if any(marker in response.text for marker in login_markers):
            raise ValueError("Session cookie is invalid or expired. Please copy a fresh MoodleSession value.")
        return {"title": "Imported Course", "videos": []}

    course_title = "Imported Full Course"
    title_match = re.search(r"<title>(.*?)</title>", response.text)
    if title_match:
        course_title = html.unescape(title_match.group(1).split("|")[0].strip())

    videos = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        for res in executor.map(lambda l: fetch_hvp(l, headers), hvp_links):
            for vid_id in res["youtube_ids"]:
                videos.append({
                    "youtube_id": vid_id,
                    "title": res["title"],
                    "duration": 0,
                    "chapter_title": "Main Chapter",
                })

    return {
        "title": course_title,
        "videos": videos,
    }

def fallback_extract_from_html(url: str, cookie: str | None = None) -> dict[str, Any]:
"""

code = code.replace('def fallback_extract_from_html(url: str, cookie: str | None = None) -> dict[str, Any]:', importances_block)

extract_block = """
def extract_course(url: str, cookie: str | None = None) -> dict[str, Any]:
    # Fast path: yt-dlp generic extractor hangs on Mahara Tech, so go straight to fallback
    if "maharatech.gov.eg" in url:
        try:
            if "course/view.php" in url:
                fallback = fallback_extract_full_course(url, cookie)
            else:
                fallback = fallback_extract_from_html(url, cookie)
            if fallback.get("videos"):
                return fallback
        except Exception as fallback_exc:
"""

code = code.replace("""def extract_course(url: str, cookie: str | None = None) -> dict[str, Any]:
    # Fast path: yt-dlp generic extractor hangs on Mahara Tech, so go straight to fallback
    if "maharatech.gov.eg" in url:
        try:
            fallback = fallback_extract_from_html(url, cookie)
            if fallback.get("videos"):
                return fallback
        except Exception as fallback_exc:""", extract_block)

with open('/home/mosamir/Desktop/mahara super/backend/main.py', 'w') as f:
    f.write(code)
print("Patched main.py successfully!")
