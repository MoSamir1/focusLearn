from __future__ import annotations

import io
import json
import os
import re
import sqlite3
import tempfile
import asyncio
import copy
import time
import hashlib
import logging
from threading import Semaphore
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

import requests

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.enums import TA_RIGHT
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
import aiohttp
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import TranscriptsDisabled, NoTranscriptFound
from yt_dlp import YoutubeDL
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import arabic_reshaper
from bidi.algorithm import get_display

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "study.db"
FONTS_DIR = BASE_DIR / "fonts"

def _register_pdf_fonts() -> tuple[str, str]:
    amiri_regular_candidates = [
        FONTS_DIR / "Amiri-Regular.ttf",
        Path("/usr/share/fonts/truetype/amiri/Amiri-Regular.ttf"),
    ]
    amiri_bold_candidates = [
        FONTS_DIR / "Amiri-Bold.ttf",
        Path("/usr/share/fonts/truetype/amiri/Amiri-Bold.ttf"),
    ]
    dejavu_candidates = [
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/TTF/DejaVuSans.ttf"),
    ]

    try:
        amiri_regular = next((path for path in amiri_regular_candidates if path.exists()), None)
        amiri_bold = next((path for path in amiri_bold_candidates if path.exists()), None)
        if amiri_regular:
            pdfmetrics.registerFont(TTFont("Amiri", str(amiri_regular)))
            if amiri_bold:
                pdfmetrics.registerFont(TTFont("Amiri-Bold", str(amiri_bold)))
                return "Amiri", "Amiri-Bold"
            return "Amiri", "Amiri"

        dejavu_path = next((path for path in dejavu_candidates if path.exists()), None)
        if dejavu_path:
            pdfmetrics.registerFont(TTFont("DejaVu", str(dejavu_path)))
            return "DejaVu", "DejaVu"
    except Exception:
        pass

    return "Helvetica", "Helvetica-Bold"


DEFAULT_FONT, DEFAULT_BOLD_FONT = _register_pdf_fonts()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("focuslearn.backend")

app = FastAPI(title="Personal Learning App API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

download_jobs: dict[str, dict[str, Any]] = {}
transcript_jobs: dict[str, dict[str, Any]] = {}
download_event_queues: dict[str, asyncio.Queue] = {}
download_event_loops: dict[str, asyncio.AbstractEventLoop] = {}
HTTP_TIMEOUT_SECONDS = 60
HTTP_CONNECTOR_LIMIT = 20
SCRAPE_CONCURRENCY_LIMIT = 10
MAX_CONCURRENT_DOWNLOADS = int(os.getenv("MAX_CONCURRENT_DOWNLOADS", "2"))
download_semaphore = Semaphore(MAX_CONCURRENT_DOWNLOADS)
MAHARA_CACHE_TTL_SECONDS = 3600
mahara_course_cache: dict[str, dict[str, Any]] = {}


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    logger.warning("HTTPException at %s %s: %s", request.method, request.url.path, exc.detail)
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": "http_error", "detail": str(exc.detail)},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception at %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"error": "internal_server_error", "detail": "Unexpected server error"},
    )


def db_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA cache_size=10000")
    conn.execute("PRAGMA temp_store=MEMORY")
    return conn


def init_db() -> None:
    conn = db_conn()
    cur = conn.cursor()

    def ensure_column(table: str, column: str, definition: str) -> None:
        cols = {row[1] for row in cur.execute(f"PRAGMA table_info({table})").fetchall()}
        if column not in cols:
            cur.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS courses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            total_videos INTEGER DEFAULT 0,
            total_duration_seconds INTEGER DEFAULT 0,
            imported_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chapters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            total_duration_seconds INTEGER DEFAULT 0,
            order_index INTEGER DEFAULT 0,
            completed INTEGER DEFAULT 0,
            FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chapter_id INTEGER NOT NULL,
            youtube_id TEXT NOT NULL,
            title TEXT NOT NULL,
            duration_seconds INTEGER DEFAULT 0,
            transcript TEXT DEFAULT '',
            order_index INTEGER DEFAULT 0,
            completed INTEGER DEFAULT 0,
            FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            download_path TEXT DEFAULT ''
        );

        CREATE INDEX IF NOT EXISTS idx_videos_chapter ON videos(chapter_id);
        CREATE INDEX IF NOT EXISTS idx_chapters_course ON chapters(course_id);
        CREATE INDEX IF NOT EXISTS idx_videos_completed ON videos(completed);
        CREATE INDEX IF NOT EXISTS idx_chapters_course_order ON chapters(course_id, order_index);
        CREATE INDEX IF NOT EXISTS idx_videos_chapter_order ON videos(chapter_id, order_index);

        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    ensure_column("videos", "summary", "TEXT")
    ensure_column("videos", "last_position", "INTEGER DEFAULT 0")
    ensure_column("videos", "watch_count", "INTEGER DEFAULT 0")
    ensure_column("videos", "download_status", "TEXT DEFAULT 'idle'")
    ensure_column("videos", "download_progress", "INTEGER DEFAULT 0")
    ensure_column("videos", "local_path", "TEXT")
    ensure_column("courses", "thumbnail_url", "TEXT")
    ensure_column("courses", "last_watched_at", "TEXT")
    cur.execute("DROP TABLE IF EXISTS quizzes")

    cur.execute("INSERT OR IGNORE INTO settings(id, download_path) VALUES (1, '')")
    cur.execute(
        "INSERT OR IGNORE INTO app_settings(key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
        ("theme", "dark"),
    )
    cur.execute(
        "INSERT OR IGNORE INTO app_settings(key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
        ("default_quality", "720p"),
    )
    cur.execute(
        "INSERT OR IGNORE INTO app_settings(key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
        ("auto_mark_complete", "90"),
    )
    conn.commit()
    conn.close()


def log_query_plan_examples() -> None:
    conn = db_conn()
    cur = conn.cursor()
    query_samples = [
        ("course_details", "SELECT * FROM chapters WHERE course_id = ? ORDER BY order_index", (1,)),
        ("chapter_videos", "SELECT * FROM videos WHERE chapter_id = ? ORDER BY order_index", (1,)),
        (
            "course_export",
            "SELECT v.title, v.transcript, ch.title as ch_title FROM videos v JOIN chapters ch ON v.chapter_id = ch.id WHERE ch.course_id = ? ORDER BY ch.order_index, v.order_index",
            (1,),
        ),
    ]
    for name, sql, params in query_samples:
        plan_rows = cur.execute("EXPLAIN QUERY PLAN " + sql, params).fetchall()
        logger.info("Query plan [%s]: %s", name, [tuple(row) for row in plan_rows])
    conn.close()


def sec_to_label(total_seconds: int) -> str:
    hrs = total_seconds // 3600
    mins = (total_seconds % 3600) // 60
    secs = total_seconds % 60
    return f"{hrs:02d}:{mins:02d}:{secs:02d}"


def markdown_transcript(video_title: str, transcript: str) -> str:
    return f"# {video_title}\n\n{transcript}\n"


def json_transcript(video_title: str, transcript: str) -> str:
    return json.dumps({"title": video_title, "transcript": transcript}, ensure_ascii=False, indent=2)


def pdf_transcript(video_title: str, transcript: str) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=50,
        rightMargin=50,
        topMargin=60,
        bottomMargin=60,
        title=video_title,
    )
    styles = getSampleStyleSheet()
    style = styles["BodyText"]
    style.fontName = DEFAULT_FONT
    style.fontSize = 12
    style.leading = 16
    style.alignment = TA_RIGHT
    style.wordWrap = "RTL"
    
    title_style = styles["Title"]
    title_style.fontName = DEFAULT_BOLD_FONT
    title_style.alignment = TA_RIGHT
    title_style.wordWrap = "RTL"
    
    def process_text(text: str) -> str:
        if not text.strip():
            return ""
        reshaped = arabic_reshaper.reshape(text)
        rtl_text = get_display(reshaped, base_dir="R")
        return escape(rtl_text)

    flow = [Paragraph(process_text(video_title), title_style), Spacer(1, 12)]
    for para in transcript.split("\n"):
        text = para.strip()
        if not text: continue
        flow.append(Paragraph(process_text(text), style))
        flow.append(Spacer(1, 6))
    doc.build(flow)
    return buffer.getvalue()


def refresh_course_and_chapter_totals(conn: sqlite3.Connection, course_id: int) -> None:
    cur = conn.cursor()
    chapter_ids = cur.execute(
        "SELECT id FROM chapters WHERE course_id = ? ORDER BY order_index",
        (course_id,),
    ).fetchall()
    for ch in chapter_ids:
        chapter_id = ch["id"]
        data = cur.execute(
            """
            SELECT
                COUNT(*) AS total_videos,
                COALESCE(SUM(duration_seconds), 0) AS total_duration,
                COALESCE(SUM(completed), 0) AS done_count
            FROM videos
            WHERE chapter_id = ?
            """,
            (chapter_id,),
        ).fetchone()
        chapter_done = 1 if data["total_videos"] > 0 and data["done_count"] == data["total_videos"] else 0
        cur.execute(
            "UPDATE chapters SET total_duration_seconds = ?, completed = ? WHERE id = ?",
            (data["total_duration"], chapter_done, chapter_id),
        )

    cdata = cur.execute(
        """
        SELECT
            COUNT(v.id) AS total_videos,
            COALESCE(SUM(v.duration_seconds), 0) AS total_duration
        FROM chapters c
        LEFT JOIN videos v ON v.chapter_id = c.id
        WHERE c.course_id = ?
        """,
        (course_id,),
    ).fetchone()
    cur.execute(
        "UPDATE courses SET total_videos = ?, total_duration_seconds = ? WHERE id = ?",
        (cdata["total_videos"], cdata["total_duration"], course_id),
    )
    conn.commit()


def course_with_progress(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    total = row["total_videos"] or 0
    done = conn.execute(
        """
        SELECT COALESCE(SUM(v.completed), 0) AS done
        FROM chapters c
        LEFT JOIN videos v ON v.chapter_id = c.id
        WHERE c.course_id = ?
        """,
        (row["id"],),
    ).fetchone()["done"]
    percent = int((done / total) * 100) if total else 0
    return {
        "id": row["id"],
        "title": row["title"],
        "total_videos": total,
        "total_duration_seconds": row["total_duration_seconds"],
        "total_duration_label": sec_to_label(row["total_duration_seconds"] or 0),
        "imported_at": row["imported_at"],
        "progress_percent": percent,
    }


def fetch_transcript_text(youtube_id: str) -> tuple[str | None, str | None]:
    """Fetch transcript; try YouTubeTranscriptApi, then yt-dlp auto-captions as a fallback."""

    # Primary path: YouTubeTranscriptApi
    try:
        transcript_list = YouTubeTranscriptApi.list_transcripts(youtube_id)
        transcript = None
        try:
            transcript = transcript_list.find_transcript(["ar"])
        except Exception:
            try:
                transcript = transcript_list.find_transcript(["en"])
            except Exception:
                transcript = transcript_list.find_generated_transcript(["ar", "en"])

        entries = transcript.fetch() if transcript else []
        full_text = " ".join([entry.get("text", "") for entry in entries])
        if full_text.strip():
            return (full_text, None)
        return (None, "empty_transcript")
    except TranscriptsDisabled:
        return (None, "transcripts_disabled")
    except NoTranscriptFound:
        pass  # fall through to fallback
    except Exception as exc:
        logger.error("Transcript fetch error for %s: %s", youtube_id, exc)

    # Fallback: yt-dlp automatic captions (json3)
    try:
        url = f"https://www.youtube.com/watch?v={youtube_id}"
        ydl_opts: dict[str, Any] = {
            "quiet": True,
            "skip_download": True,
            "writesubtitles": True,
            "writeautomaticsub": True,
        }
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)

        auto_caps = info.get("automatic_captions") or {}
        lang = "ar" if "ar" in auto_caps else ("ar-orig" if "ar-orig" in auto_caps else None)
        if not lang and auto_caps:
            lang = next(iter(auto_caps.keys()))
        if not lang:
            return (None, "not_found")

        cap_url = auto_caps[lang][0].get("url") if auto_caps[lang] else None
        if not cap_url:
            return (None, "not_found")

        resp = requests.get(cap_url, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        lines: list[str] = []
        for event in data.get("events", []):
            segs = event.get("segs")
            if not segs:
                continue
            text = "".join(seg.get("utf8", "") for seg in segs).strip()
            if text:
                lines.append(text)
        full_text = "\n".join(lines)
        if full_text.strip():
            return (full_text, None)
        return (None, "empty_transcript")
    except Exception as exc:
        logger.error("yt_dlp transcript fallback failed for %s: %s", youtube_id, exc)
        return (None, "error")


def extract_youtube_ids_from_text(text: str) -> list[str]:
    # Clean up any escaped slashes (e.g. \/youtu.be\/ or \\\/) by removing backslashes entirely
    text = text.replace("\\", "")
    patterns = [
        r"youtube\.com/embed/([A-Za-z0-9_-]{11})",
        r"youtube\.com/watch\?v=([A-Za-z0-9_-]{11})",
        r"youtu\.be/([A-Za-z0-9_-]{11})",
    ]
    ids: list[str] = []
    for pattern in patterns:
        ids.extend(re.findall(pattern, text))
    # Preserve order and drop duplicates.
    return list(dict.fromkeys(ids))

import html


@lru_cache(maxsize=512)
def normalize_course_title(raw_title: str) -> str:
    return html.unescape(raw_title.split("|")[0].strip())


def _mahara_cache_key(url: str, cookie: str | None = None) -> str:
    cookie_part = (cookie or "").strip()
    return hashlib.sha256(f"{url}|{cookie_part}".encode("utf-8")).hexdigest()


def _get_cached_mahara_course(url: str, cookie: str | None = None) -> dict[str, Any] | None:
    key = _mahara_cache_key(url, cookie)
    cached = mahara_course_cache.get(key)
    if not cached:
        return None
    if cached["expires_at"] < time.time():
        mahara_course_cache.pop(key, None)
        return None
    return copy.deepcopy(cached["value"])


def _set_cached_mahara_course(url: str, cookie: str | None, value: dict[str, Any]) -> None:
    key = _mahara_cache_key(url, cookie)
    mahara_course_cache[key] = {
        "expires_at": time.time() + MAHARA_CACHE_TTL_SECONDS,
        "value": copy.deepcopy(value),
    }


def _request_headers(cookie: str | None = None) -> dict[str, str]:
    headers = {"User-Agent": "Mozilla/5.0"}
    if cookie:
        cleaned_cookie = cookie.strip()
        headers["Cookie"] = cleaned_cookie if "=" in cleaned_cookie else f"MoodleSession={cleaned_cookie}"
    return headers


def _strip_html_text(value: str) -> str:
    text = re.sub(r"<[^>]+>", " ", value)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _extract_hvp_links_with_chapters(page_html: str) -> list[dict[str, str]]:
    link_pattern = re.compile(r"https?://maharatech\.gov\.eg/mod/hvp/view\.php\?id=\d+")
    section_pattern = re.compile(
        r"<[^>]*class=\"[^\"]*sectionname[^\"]*\"[^>]*>(.*?)</[^>]+>",
        re.IGNORECASE | re.DOTALL,
    )

    section_markers: list[tuple[int, str]] = []
    for match in section_pattern.finditer(page_html):
        title = _strip_html_text(match.group(1))
        if title:
            section_markers.append((match.start(), title))

    seen_links: set[str] = set()
    resolved: list[dict[str, str]] = []
    marker_idx = -1
    for match in link_pattern.finditer(page_html):
        link = match.group(0)
        if link in seen_links:
            continue
        seen_links.add(link)

        while marker_idx + 1 < len(section_markers) and section_markers[marker_idx + 1][0] < match.start():
            marker_idx += 1

        chapter_title = section_markers[marker_idx][1] if marker_idx >= 0 else "Main Chapter"
        resolved.append({"link": link, "chapter_title": chapter_title})

    return resolved


def _normalize_chapter_group(chapter_title: str | None, video_title: str | None) -> str:
    chapter_candidate = (chapter_title or "").strip()
    video_candidate = (video_title or "").strip()

    for candidate in (chapter_candidate, video_candidate):
        if not candidate:
            continue
        match = re.search(
            r"(^|[^A-Za-z0-9])CH\s*0*(\d{1,3})(?=[^A-Za-z0-9]|$)",
            candidate,
            flags=re.IGNORECASE,
        )
        if match:
            return f"CH{int(match.group(2)):02d}"

    if chapter_candidate:
        return chapter_candidate
    if video_candidate:
        return video_candidate
    return "Main Chapter"


@lru_cache(maxsize=4096)
def _resolve_youtube_duration_seconds(youtube_id: str) -> int:
    if not youtube_id:
        return 0
    try:
        with YoutubeDL(
            {
                "quiet": True,
                "no_warnings": True,
                "skip_download": True,
                "socket_timeout": 15,
            }
        ) as ydl:
            info = ydl.extract_info(
                f"https://www.youtube.com/watch?v={youtube_id}",
                download=False,
            )
        return int((info or {}).get("duration") or 0)
    except Exception as exc:
        logger.debug("Duration lookup failed for %s: %s", youtube_id, exc)
        return 0


async def fetch_hvp(session: aiohttp.ClientSession, semaphore: asyncio.Semaphore, link: str, headers: dict[str, str]) -> dict:
    try:
        async with semaphore:
            async with session.get(link, headers=headers) as resp:
                resp.raise_for_status()
                body = await resp.text()

        ids = extract_youtube_ids_from_text(body)
        title = "Unknown Module"
        title_match = re.search(r"<title>(.*?)</title>", body)
        if title_match:
            title = html.unescape(title_match.group(1).split("|")[0].strip())
        return {"link": link, "youtube_ids": ids, "title": title}
    except Exception:
        return {"link": link, "youtube_ids": [], "title": "Failed to load"}


async def fallback_extract_full_course(url: str, cookie: str | None = None) -> dict:
    headers = _request_headers(cookie)
    timeout = aiohttp.ClientTimeout(total=HTTP_TIMEOUT_SECONDS)
    connector = aiohttp.TCPConnector(limit=HTTP_CONNECTOR_LIMIT)

    async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
        async with session.get(url, headers=headers) as response:
            response.raise_for_status()
            response_text = await response.text()

        hvp_items = _extract_hvp_links_with_chapters(response_text)
        hvp_links = [item["link"] for item in hvp_items]
        
        if not hvp_links:
            login_markers = ["Login to your account", "Log in", "الدخول لحسابك", "تسجيل دخول"]
            if any(marker in response_text for marker in login_markers):
                raise ValueError("Session cookie is invalid or expired. Please copy a fresh MoodleSession value.")
            return {"title": "Imported Course", "videos": []}

        course_title = "Imported Full Course"
        title_match = re.search(r"<title>(.*?)</title>", response_text)
        if title_match:
            course_title = normalize_course_title(title_match.group(1))

        videos = []
        semaphore = asyncio.Semaphore(SCRAPE_CONCURRENCY_LIMIT)
        tasks = [fetch_hvp(session, semaphore, link, headers) for link in hvp_links]
        results = await asyncio.gather(*tasks)
        for item, res in zip(hvp_items, results):
            chapter_title = item.get("chapter_title") or "Main Chapter"
            for vid_id in res["youtube_ids"]:
                videos.append({
                    "youtube_id": vid_id,
                    "title": res["title"],
                    "duration": 0,
                    "chapter_title": chapter_title,
                })

    return {
        "title": course_title,
        "videos": videos,
    }

async def fallback_extract_from_html(url: str, cookie: str | None = None) -> dict[str, Any]:
    headers = _request_headers(cookie)
    timeout = aiohttp.ClientTimeout(total=HTTP_TIMEOUT_SECONDS)
    connector = aiohttp.TCPConnector(limit=HTTP_CONNECTOR_LIMIT)

    async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
        async with session.get(url, headers=headers) as response:
            response.raise_for_status()
            response_text = await response.text()
    
    youtube_ids = extract_youtube_ids_from_text(response_text)
    
    if not youtube_ids:
        # Only check login markers if we failed to find any videos.
        # Mahara-Tech includes some of these markers in the navbar even when logged in.
        login_markers = ["Login to your account", "Log in", "الدخول لحسابك", "تسجيل دخول"]
        if any(marker in response_text for marker in login_markers):
            raise ValueError("Session cookie is invalid or expired. Please copy a fresh MoodleSession value.")
        return {"title": "Imported Course", "videos": []}
        
    title = "Imported Course"
    title_match = re.search(r"<title>(.*?)</title>", response_text)
    if title_match:
        title = normalize_course_title(title_match.group(1))

    return {
        "title": title,
        "videos": [
            {
                "youtube_id": vid,
                "title": f"Video {idx + 1}",
                "duration": 0,
                "chapter_title": "Main Chapter",
            }
            for idx, vid in enumerate(youtube_ids)
        ],
    }



def extract_course(url: str, cookie: str | None = None, force_refresh: bool = False) -> dict[str, Any]:
    # Fast path: yt-dlp generic extractor hangs on Mahara Tech, so go straight to fallback
    if "maharatech.gov.eg" in url:
        cached = None if force_refresh else _get_cached_mahara_course(url, cookie)
        if cached:
            return cached
        try:
            if "course/view.php" in url:
                fallback = asyncio.run(fallback_extract_full_course(url, cookie))
            else:
                fallback = asyncio.run(fallback_extract_from_html(url, cookie))
            if fallback.get("videos"):
                _set_cached_mahara_course(url, cookie, fallback)
                return fallback
        except Exception as fallback_exc:

            raise HTTPException(
                status_code=400,
                detail=f"Import failed. Check URL and cookie/session validity. Error: {fallback_exc}",
            ) from fallback_exc
        raise HTTPException(status_code=400, detail="Could not extract course from URL.")

    ydl_opts: dict[str, Any] = {
        "quiet": True,
        "skip_download": True,
        "extract_flat": False,
        "ignoreerrors": True,
    }
    if cookie:
        cleaned_cookie = cookie.strip()
        if "\t" in cleaned_cookie or cleaned_cookie.startswith("# Netscape HTTP Cookie File"):
            temp_cookie_file = tempfile.NamedTemporaryFile("w", delete=False, suffix=".txt")
            temp_cookie_file.write(cleaned_cookie)
            temp_cookie_file.close()
            ydl_opts["cookiefile"] = temp_cookie_file.name
        else:
            # Accept both raw MoodleSession value and full "name=value" cookie string.
            cookie_header = (
                cleaned_cookie
                if "=" in cleaned_cookie
                else f"MoodleSession={cleaned_cookie}"
            )
            ydl_opts["http_headers"] = {"Cookie": cookie_header}
    try:
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as exc:
        info = None
    finally:
        cookie_file = ydl_opts.get("cookiefile")
        if cookie_file:
            try:
                os.unlink(cookie_file)
            except OSError:
                pass
    if not info:
        try:
            fallback = asyncio.run(fallback_extract_from_html(url, cookie))
            if fallback["videos"]:
                return fallback
        except Exception as fallback_exc:
            raise HTTPException(
                status_code=400,
                detail=f"Import failed. Check URL and cookie/session validity. Error: {fallback_exc}",
            ) from fallback_exc
        raise HTTPException(status_code=400, detail="Could not extract course from URL.")
    entries = info.get("entries") or []
    videos: list[dict[str, Any]] = []
    for idx, entry in enumerate(entries):
        if not entry:
            continue
        video_id = entry.get("id")
        if not video_id:
            continue
        videos.append(
            {
                "youtube_id": video_id,
                "title": entry.get("title") or f"Video {idx + 1}",
                "duration": int(entry.get("duration") or 0),
                "chapter_title": entry.get("chapter") or "Main Chapter",
            }
        )
    title = info.get("title") or "Imported Course"
    if not videos:
        raise HTTPException(status_code=400, detail="No videos found in the provided URL.")
    return {"title": title, "videos": videos}


class ImportRequest(BaseModel):
    course_url: str
    cookie: str | None = None
    force_refresh: bool = False


class DownloadRequest(BaseModel):
    target_type: str
    ids: list[int]
    quality: str = "720"
    download_path: str = ""


class DownloadStartRequest(BaseModel):
    video_ids: list[int]
    quality: str = "720"
    save_path: str = ""


class DownloadPathConfig(BaseModel):
    path: str


class LinkLocalRequest(BaseModel):
    file_path: str


class CompletionUpdate(BaseModel):
    completed: bool


@app.on_event("startup")
def startup() -> None:
    init_db()
    log_query_plan_examples()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/courses")
def list_courses() -> list[dict[str, Any]]:
    conn = db_conn()
    rows = conn.execute("SELECT * FROM courses ORDER BY id DESC").fetchall()
    data = [course_with_progress(conn, row) for row in rows]
    conn.close()
    return data


@app.get("/courses/{course_id}")
def get_course(course_id: int) -> dict[str, Any]:
    conn = db_conn()
    course = conn.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()
    if not course:
        conn.close()
        raise HTTPException(status_code=404, detail="Course not found")
    chapters = conn.execute(
        "SELECT * FROM chapters WHERE course_id = ? ORDER BY order_index",
        (course_id,),
    ).fetchall()
    chapter_payload = []
    for ch in chapters:
        videos = conn.execute(
            "SELECT * FROM videos WHERE chapter_id = ? ORDER BY order_index",
            (ch["id"],),
        ).fetchall()
        for v in videos:
            if v["local_path"] and not os.path.exists(v["local_path"]):
                conn.execute("UPDATE videos SET local_path = NULL WHERE id = ?", (v["id"],))
                conn.commit()
        chapter_payload.append(
            {
                "id": ch["id"],
                "title": ch["title"],
                "total_duration_seconds": ch["total_duration_seconds"],
                "total_duration_label": sec_to_label(ch["total_duration_seconds"] or 0),
                "completed": bool(ch["completed"]),
                "videos": [
                    {
                        "id": v["id"],
                        "youtube_id": v["youtube_id"],
                        "title": v["title"],
                        "duration_seconds": v["duration_seconds"],
                        "duration_label": sec_to_label(v["duration_seconds"] or 0),
                        "transcript": v["transcript"],
                        "download_status": v["download_status"],
                        "download_progress": v["download_progress"],
                        "local_path": v["local_path"],
                        "completed": bool(v["completed"]),
                    }
                    for v in videos
                ],
            }
        )
    payload = course_with_progress(conn, course)
    payload["chapters"] = chapter_payload
    conn.close()
    return payload


@app.delete("/api/courses/{course_id}")
def delete_course(course_id: int) -> dict[str, Any]:
    conn = db_conn()
    course = conn.execute("SELECT id FROM courses WHERE id = ?", (course_id,)).fetchone()
    if not course:
        conn.close()
        raise HTTPException(status_code=404, detail="Course not found")

    videos_count = conn.execute(
        "SELECT COUNT(*) AS cnt FROM videos WHERE chapter_id IN (SELECT id FROM chapters WHERE course_id = ?)",
        (course_id,),
    ).fetchone()["cnt"]

    conn.execute("DELETE FROM videos WHERE chapter_id IN (SELECT id FROM chapters WHERE course_id = ?)", (course_id,))
    conn.execute("DELETE FROM chapters WHERE course_id = ?", (course_id,))
    conn.execute("DELETE FROM courses WHERE id = ?", (course_id,))
    conn.commit()
    conn.close()
    return {"deleted": True, "videos_count": videos_count}


@app.delete("/api/chapters/{chapter_id}")
def delete_chapter(chapter_id: int) -> dict[str, Any]:
    conn = db_conn()
    chapter = conn.execute("SELECT course_id FROM chapters WHERE id = ?", (chapter_id,)).fetchone()
    if not chapter:
        conn.close()
        raise HTTPException(status_code=404, detail="Chapter not found")
    course_id = chapter["course_id"]

    videos_count = conn.execute(
        "SELECT COUNT(*) AS cnt FROM videos WHERE chapter_id = ?",
        (chapter_id,),
    ).fetchone()["cnt"]

    conn.execute("DELETE FROM videos WHERE chapter_id = ?", (chapter_id,))
    conn.execute("DELETE FROM chapters WHERE id = ?", (chapter_id,))
    refresh_course_and_chapter_totals(conn, course_id)
    conn.commit()
    conn.close()
    return {"deleted": True, "videos_count": videos_count}


@app.delete("/api/videos/{video_id}")
def delete_video(video_id: int) -> dict[str, Any]:
    conn = db_conn()
    video = conn.execute(
        "SELECT v.chapter_id, ch.course_id FROM videos v JOIN chapters ch ON v.chapter_id = ch.id WHERE v.id = ?",
        (video_id,),
    ).fetchone()
    if not video:
        conn.close()
        raise HTTPException(status_code=404, detail="Video not found")

    conn.execute("DELETE FROM videos WHERE id = ?", (video_id,))
    refresh_course_and_chapter_totals(conn, video["course_id"])
    conn.commit()
    conn.close()
    return {"deleted": True}


@app.post("/import-course")
def import_course(body: ImportRequest) -> dict[str, Any]:
    extracted = extract_course(body.course_url, body.cookie, body.force_refresh)
    conn = db_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO courses(title, imported_at) VALUES (?, ?)",
        (extracted["title"], datetime.utcnow().isoformat()),
    )
    course_id = cur.lastrowid

    chapter_map: dict[str, int] = {}
    chapter_order = 0
    video_orders: dict[int, int] = {}
    for video in extracted["videos"]:
        ch_title = _normalize_chapter_group(video.get("chapter_title"), video.get("title"))
        if ch_title not in chapter_map:
            cur.execute(
                "INSERT INTO chapters(course_id, title, order_index) VALUES (?, ?, ?)",
                (course_id, ch_title, chapter_order),
            )
            chapter_map[ch_title] = cur.lastrowid
            video_orders[cur.lastrowid] = 0
            chapter_order += 1

        chapter_id = chapter_map[ch_title]
        transcript = "" # Skip transcript for fast import
        video_duration = int(
            video["video_duration"]
            if "video_duration" in video
            else video.get("duration", 0)
        )
        if video_duration <= 0:
            video_duration = _resolve_youtube_duration_seconds(video.get("youtube_id", ""))
        cur.execute(
            """
            INSERT INTO videos(
                chapter_id, youtube_id, title, duration_seconds, transcript, order_index
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                chapter_id,
                video["youtube_id"],
                video["title"],
                video_duration,
                transcript,
                video_orders[chapter_id],
            ),
        )
        video_orders[chapter_id] += 1
    conn.commit()
    refresh_course_and_chapter_totals(conn, course_id)
    conn.close()
    return {"ok": True, "course_id": course_id}


def resolve_download_video_ids(conn: sqlite3.Connection, target_type: str, ids: list[int]) -> list[str]:
    targets = resolve_download_targets(conn, target_type, ids)
    return [target["youtube_id"] for target in targets]


def resolve_download_targets(conn: sqlite3.Connection, target_type: str, ids: list[int]) -> list[dict[str, Any]]:
    if target_type == "course":
        placeholders = ",".join(["?"] * len(ids))
        rows = conn.execute(
            f"""
            SELECT v.id, v.youtube_id, v.title
            FROM courses c
            JOIN chapters ch ON ch.course_id = c.id
            JOIN videos v ON v.chapter_id = ch.id
            WHERE c.id IN ({placeholders})
            """,
            ids,
        ).fetchall()
    elif target_type == "chapter":
        placeholders = ",".join(["?"] * len(ids))
        rows = conn.execute(
            f"SELECT id, youtube_id, title FROM videos WHERE chapter_id IN ({placeholders})",
            ids,
        ).fetchall()
    elif target_type == "video":
        placeholders = ",".join(["?"] * len(ids))
        rows = conn.execute(
            f"SELECT id, youtube_id, title FROM videos WHERE id IN ({placeholders})",
            ids,
        ).fetchall()
    else:
        raise HTTPException(status_code=400, detail="Invalid target type")
    return [
        {"id": r["id"], "youtube_id": r["youtube_id"], "title": r["title"]}
        for r in rows
    ]


def run_transcript_import(job_id: str, video_targets: list[dict]) -> None:
    transcript_jobs[job_id] = {
        "status": "running",
        "progress": 0,
        "total": len(video_targets),
        "done": 0,
        "skipped": 0,
        "failed": 0,
    }
    conn = db_conn()
    try:
        for target in video_targets:
            yt_id = target["youtube_id"]
            db_id = target["id"]

            existing = conn.execute("SELECT transcript FROM videos WHERE id = ?", (db_id,)).fetchone()
            if existing and (existing["transcript"] or "").strip():
                transcript_jobs[job_id]["skipped"] += 1
            else:
                text, reason = fetch_transcript_text(yt_id)
                if text and text.strip():
                    conn.execute("UPDATE videos SET transcript = ? WHERE youtube_id = ?", (text, yt_id))
                    conn.commit()
                else:
                    transcript_jobs[job_id].setdefault("errors", []).append({"video_id": db_id, "reason": reason or "unknown"})
                    transcript_jobs[job_id]["failed"] += 1

            transcript_jobs[job_id]["done"] += 1
            transcript_jobs[job_id]["progress"] = int((transcript_jobs[job_id]["done"] / len(video_targets)) * 100)
        transcript_jobs[job_id]["status"] = "done"
    except Exception as e:
        transcript_jobs[job_id]["status"] = "error"
        transcript_jobs[job_id]["message"] = str(e)
    finally:
        conn.close()


def _collect_transcript_rows(conn: sqlite3.Connection, target_type: str, ids: list[int]) -> list[sqlite3.Row]:
    if not ids:
        raise HTTPException(status_code=400, detail="No selected IDs")
    placeholders = ",".join(["?"] * len(ids))
    if target_type == "course":
        query = (
            "SELECT v.id, v.youtube_id, v.transcript FROM videos v "
            "JOIN chapters ch ON v.chapter_id = ch.id WHERE ch.course_id IN (" + placeholders + ")"
        )
    elif target_type == "chapter":
        query = "SELECT id, youtube_id, transcript FROM videos WHERE chapter_id IN (" + placeholders + ")"
    elif target_type == "video":
        query = "SELECT id, youtube_id, transcript FROM videos WHERE id IN (" + placeholders + ")"
    else:
        raise HTTPException(status_code=400, detail="Invalid target type")
    return conn.execute(query, ids).fetchall()


def _queue_download_job(
    target_type: str,
    ids: list[int],
    quality: str,
    download_path: str,
    background_tasks: BackgroundTasks,
    loop: asyncio.AbstractEventLoop | None = None,
) -> dict[str, Any]:
    if not ids:
        raise HTTPException(status_code=400, detail="No selected IDs")
    conn = db_conn()
    try:
        targets = resolve_download_targets(conn, target_type, ids)
        conn.execute("UPDATE settings SET download_path = ? WHERE id = 1", (download_path,))
        if targets:
            conn.executemany(
                "UPDATE videos SET download_status = ?, download_progress = ? WHERE id = ?",
                [("queued", 0, target["id"]) for target in targets],
            )
        conn.commit()
    finally:
        conn.close()

    if not targets:
        raise HTTPException(status_code=400, detail="No videos resolved for the selection")

    job_id = f"job-{datetime.utcnow().timestamp()}"
    download_jobs[job_id] = {
        "status": "queued",
        "progress": 0,
        "message": "Queued",
        "total": len(targets),
        "done": 0,
    }
    loop = loop or asyncio.get_running_loop()
    download_event_queues[job_id] = asyncio.Queue()
    download_event_loops[job_id] = loop
    background_tasks.add_task(run_download, job_id, targets, quality, download_path)
    return {"job_id": job_id}


def queue_transcript_job(target_type: str, ids: list[int], background_tasks: BackgroundTasks) -> str:
    conn = db_conn()
    rows = _collect_transcript_rows(conn, target_type, ids)
    conn.close()

    if not rows:
        raise HTTPException(status_code=400, detail="No videos found")

    pending_rows = [r for r in rows if not (r["transcript"] or "").strip()]
    job_id = f"trans-{datetime.utcnow().timestamp()}"

    if not pending_rows:
        transcript_jobs[job_id] = {
            "status": "done",
            "progress": 100,
            "total": len(rows),
            "done": len(rows),
            "skipped": len(rows),
            "failed": 0,
        }
        return job_id

    targets = [{"id": r["id"], "youtube_id": r["youtube_id"]} for r in pending_rows]
    background_tasks.add_task(run_transcript_import, job_id, targets)
    return job_id


def run_download(job_id: str, targets: list[dict[str, Any]], quality: str, output_path: str) -> None:
    Path(output_path).mkdir(parents=True, exist_ok=True)
    job_state = download_jobs.get(job_id, {})
    job_state.update(
        {
          "status": "running",
          "progress": 0,
          "message": "Starting...",
          "current_title": None,
          "current_id": None,
          "cancelled": job_state.get("cancelled", False),
          "total": len(targets),
          "done": 0,
        }
    )
    download_jobs[job_id] = job_state
    queue = download_event_queues.get(job_id)
    loop = download_event_loops.get(job_id)

    def emit(event: dict[str, Any]) -> None:
        if not queue or not loop:
            return
        try:
            loop.call_soon_threadsafe(queue.put_nowait, event)
        except RuntimeError:
            pass

    emit({"type": "status", "status": "running", "progress": 0})
    conn = db_conn()

    total = max(len(targets), 1)
    state = {"done": 0}
    failures = 0

    base_opts: dict[str, Any] = {
        "format": f"bestvideo[height<={quality}]+bestaudio/best[height<={quality}]",
        "outtmpl": str(Path(output_path) / "%(title)s.%(ext)s"),
        "quiet": True,
        "socket_timeout": 30,
        "retries": 3,
        "fragment_retries": 3,
    }

    def cleanup_partial_files() -> None:
        try:
            for part_file in Path(output_path).glob("*.part"):
                part_file.unlink(missing_ok=True)
        except Exception:
            pass

    try:
        with download_semaphore:
            for target in targets:
                if download_jobs[job_id].get("cancelled"):
                    download_jobs[job_id]["status"] = "canceled"
                    download_jobs[job_id]["message"] = "Canceled by user"
                    emit({"type": "status", "status": "canceled"})
                    break

                video_db_id = target["id"]
                video_id = target["youtube_id"]
                video_title = target.get("title") or f"Video {video_db_id}"

                def make_progress_hook(video_pk: int) -> Any:
                    def hook(d: dict[str, Any]) -> None:
                        if d.get("status") != "downloading":
                            return
                        total_bytes = d.get("total_bytes") or d.get("total_bytes_estimate")
                        downloaded = d.get("downloaded_bytes")
                        percent = int((downloaded / total_bytes) * 100) if total_bytes and downloaded else 0
                        speed = d.get("speed") or 0
                        speed_mbps = speed / (1024 * 1024)
                        emit({
                            "video_id": video_pk,
                            "percent": percent,
                            "speed": f"{speed_mbps:.1f}M/s",
                        })
                    return hook

                ydl_opts = {
                    **base_opts,
                    "progress_hooks": [make_progress_hook(video_db_id)],
                }

                try:
                    download_jobs[job_id]["current_title"] = video_title
                    download_jobs[job_id]["current_id"] = video_db_id
                    conn.execute(
                        "UPDATE videos SET download_status = ?, download_progress = ? WHERE id = ?",
                        ("downloading", max(download_jobs[job_id]["progress"], 1), video_db_id),
                    )
                    conn.commit()
                    with YoutubeDL(ydl_opts) as ydl:
                        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=True)
                        file_path = None
                        if info:
                            requested = info.get("requested_downloads") or []
                            if requested and requested[0].get("filepath"):
                                file_path = requested[0]["filepath"]
                            elif info.get("_filename"):
                                file_path = info["_filename"]
                        if file_path and os.path.exists(file_path):
                            conn.execute(
                                "UPDATE videos SET local_path = ? WHERE id = ?",
                                (file_path, video_db_id),
                            )
                    conn.execute(
                        "UPDATE videos SET download_status = ?, download_progress = ? WHERE id = ?",
                        ("done", 100, video_db_id),
                    )
                    conn.commit()
                    emit({"video_id": video_db_id, "percent": 100, "speed": ""})
                except Exception:
                    failures += 1
                    cleanup_partial_files()
                    conn.execute(
                        "UPDATE videos SET download_status = ?, download_progress = ? WHERE id = ?",
                        ("error", 0, video_db_id),
                    )
                    conn.commit()
                    emit({"video_id": video_db_id, "percent": 0, "speed": "", "error": True})
                finally:
                    state["done"] += 1
                    download_jobs[job_id]["progress"] = int((state["done"] / total) * 100)
                    download_jobs[job_id]["done"] = state["done"]
                    download_jobs[job_id]["message"] = f"Downloaded {state['done']} / {total}"
        if download_jobs[job_id].get("status") == "canceled":
            download_jobs[job_id]["message"] = download_jobs[job_id].get("message", "Canceled")
        else:
            download_jobs[job_id]["status"] = "done"
            if failures:
                download_jobs[job_id]["message"] = f"Completed with {failures} failed download(s)"
            else:
                download_jobs[job_id]["message"] = "Download complete"
        emit({"type": "status", "status": download_jobs[job_id]["status"]})
    except Exception as exc:
        cleanup_partial_files()
        download_jobs[job_id]["status"] = "error"
        download_jobs[job_id]["message"] = str(exc)
    finally:
        conn.close()
        if queue and loop:
            try:
                loop.call_soon_threadsafe(queue.put_nowait, "__done__")
            except RuntimeError:
                pass
        download_event_queues.pop(job_id, None)
        download_event_loops.pop(job_id, None)


@app.post("/downloads/start")
async def start_download(body: DownloadRequest, background_tasks: BackgroundTasks) -> dict[str, Any]:
    loop = asyncio.get_running_loop()
    return _queue_download_job(body.target_type, body.ids, body.quality, body.download_path, background_tasks, loop)


@app.post("/api/downloads/start")
async def start_download_v2(body: DownloadStartRequest, background_tasks: BackgroundTasks) -> dict[str, Any]:
    loop = asyncio.get_running_loop()
    return _queue_download_job("video", body.video_ids, body.quality, body.save_path, background_tasks, loop)


@app.post("/api/downloads/configure-path")
def configure_download_path(body: DownloadPathConfig) -> dict[str, Any]:
    conn = db_conn()
    conn.execute("UPDATE settings SET download_path = ? WHERE id = 1", (body.path,))
    conn.commit()
    conn.close()
    return {"ok": True, "download_path": body.path}


@app.get("/api/downloads/default-path")
def get_default_download_path() -> dict[str, Any]:
    conn = db_conn()
    row = conn.execute("SELECT download_path FROM settings WHERE id = 1").fetchone()
    conn.close()
    return {"download_path": row["download_path"] if row else ""}


@app.get("/downloads/{job_id}")
def download_status(job_id: str) -> dict[str, Any]:
    state = download_jobs.get(job_id)
    if not state:
        raise HTTPException(status_code=404, detail="Job not found")
    return {**state, "job_id": job_id}


@app.get("/api/downloads/{job_id}")
def download_status_v2(job_id: str) -> dict[str, Any]:
    return download_status(job_id)


@app.post("/api/videos/{video_id}/link-local")
def link_local_video(video_id: int, body: LinkLocalRequest) -> dict[str, Any]:
    if not body.file_path or not os.path.exists(body.file_path):
        conn = db_conn()
        conn.execute("UPDATE videos SET local_path = NULL WHERE id = ?", (video_id,))
        conn.commit()
        conn.close()
        raise HTTPException(status_code=400, detail="File path does not exist")

    conn = db_conn()
    video = conn.execute("SELECT id FROM videos WHERE id = ?", (video_id,)).fetchone()
    if not video:
        conn.close()
        raise HTTPException(status_code=404, detail="Video not found")

    conn.execute("UPDATE videos SET local_path = ? WHERE id = ?", (body.file_path, video_id))
    conn.commit()
    conn.close()
    return {"success": True, "linked": True, "local_path": body.file_path}


@app.get("/api/videos/{video_id}/stream")
def stream_local_video(video_id: int):
    conn = db_conn()
    row = conn.execute("SELECT local_path FROM videos WHERE id = ?", (video_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Video not found")
    local_path = row["local_path"]
    if not local_path or not os.path.exists(local_path):
        conn.execute("UPDATE videos SET local_path = NULL WHERE id = ?", (video_id,))
        conn.commit()
        conn.close()
        raise HTTPException(status_code=404, detail="Local video not available")
    conn.close()
    return FileResponse(local_path)


@app.get("/api/downloads/progress/{job_id}")
async def download_progress_sse(job_id: str) -> StreamingResponse:
    queue = download_event_queues.get(job_id)
    if not queue:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_stream():
        while True:
            event = await queue.get()
            if event == "__done__":
                yield "data: {\"type\":\"done\"}\n\n"
                break
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/downloads/{job_id}/cancel")
@app.post("/api/downloads/{job_id}/cancel")
def cancel_download(job_id: str) -> dict[str, Any]:
    state = download_jobs.get(job_id)
    if not state:
        raise HTTPException(status_code=404, detail="Job not found")
    state["cancelled"] = True
    state["status"] = "canceled"
    state["message"] = "Cancel requested"
    queue = download_event_queues.get(job_id)
    loop = download_event_loops.get(job_id)
    if queue and loop:
        try:
            loop.call_soon_threadsafe(queue.put_nowait, {"type": "status", "status": "canceled"})
        except RuntimeError:
            pass
    return {"ok": True}


@app.patch("/videos/{video_id}/completion")
def toggle_video_completion(video_id: int, body: CompletionUpdate) -> dict[str, Any]:
    conn = db_conn()
    video = conn.execute("SELECT chapter_id FROM videos WHERE id = ?", (video_id,)).fetchone()
    if not video:
        conn.close()
        raise HTTPException(status_code=404, detail="Video not found")
    conn.execute("UPDATE videos SET completed = ? WHERE id = ?", (1 if body.completed else 0, video_id))
    course_id = conn.execute("SELECT course_id FROM chapters WHERE id = ?", (video["chapter_id"],)).fetchone()["course_id"]
    refresh_course_and_chapter_totals(conn, course_id)
    conn.close()
    return {"ok": True}


@app.patch("/chapters/{chapter_id}/completion")
def toggle_chapter_completion(chapter_id: int, body: CompletionUpdate) -> dict[str, Any]:
    conn = db_conn()
    chapter = conn.execute("SELECT course_id FROM chapters WHERE id = ?", (chapter_id,)).fetchone()
    if not chapter:
        conn.close()
        raise HTTPException(status_code=404, detail="Chapter not found")
    value = 1 if body.completed else 0
    conn.execute("UPDATE chapters SET completed = ? WHERE id = ?", (value, chapter_id))
    conn.execute("UPDATE videos SET completed = ? WHERE chapter_id = ?", (value, chapter_id))
    refresh_course_and_chapter_totals(conn, chapter["course_id"])
    conn.close()
    return {"ok": True}


@app.get("/videos/{video_id}/export")
def export_video_transcript(video_id: int, fmt: str = Query("md", pattern="^(md|pdf|json)$")) -> Response:
    conn = db_conn()
    video = conn.execute("SELECT title, transcript FROM videos WHERE id = ?", (video_id,)).fetchone()
    conn.close()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    title = video["title"]
    transcript = video["transcript"] or ""
    safe = "".join([c for c in title if c.isalnum() or c in (" ", "-", "_")]).strip().replace(" ", "_") or "transcript"

    if fmt == "md":
        content = markdown_transcript(title, transcript)
        return Response(
            content=content,
            media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="{safe}.md"'},
        )
    if fmt == "json":
        content = json_transcript(title, transcript)
        return Response(
            content=content,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{safe}.json"'},
        )
    pdf_data = pdf_transcript(title, transcript)
    return Response(
        content=pdf_data,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe}.pdf"'},
    )


@app.get("/settings")
def get_settings() -> JSONResponse:
    conn = db_conn()
    row = conn.execute("SELECT download_path FROM settings WHERE id = 1").fetchone()
    conn.close()
    return JSONResponse(content={"download_path": row["download_path"] if row else ""})


@app.post("/transcripts/import")
def start_transcript_import(body: DownloadRequest, background_tasks: BackgroundTasks) -> dict:
    job_id = queue_transcript_job(body.target_type, body.ids, background_tasks)
    return {"job_id": job_id}


@app.post("/videos/{video_id}/fetch-transcript")
def fetch_video_transcript(video_id: int) -> dict[str, Any]:
    conn = db_conn()
    row = conn.execute("SELECT youtube_id FROM videos WHERE id = ?", (video_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Video not found")
    youtube_id = row["youtube_id"]
    text, reason = fetch_transcript_text(youtube_id)
    if text and text.strip():
        conn.execute("UPDATE videos SET transcript = ? WHERE youtube_id = ?", (text, youtube_id))
        conn.commit()
        conn.close()
        return {"success": True, "transcript": text, "length": len(text)}
    conn.close()
    return {"success": False, "reason": reason or "error"}


@app.post("/chapters/{chapter_id}/fetch-transcripts")
def fetch_chapter_transcripts(chapter_id: int, background_tasks: BackgroundTasks) -> dict[str, str]:
    job_id = queue_transcript_job("chapter", [chapter_id], background_tasks)
    return {"job_id": job_id}


@app.post("/courses/{course_id}/fetch-transcripts")
def fetch_course_transcripts(course_id: int, background_tasks: BackgroundTasks) -> dict[str, str]:
    job_id = queue_transcript_job("course", [course_id], background_tasks)
    return {"job_id": job_id}


@app.get("/transcripts/status/{job_id}")
def get_transcript_status(job_id: str):
    return transcript_jobs.get(job_id, {"status": "not_found"})


@app.get("/courses/{id}/export")
def export_course_transcripts(id: int, fmt: str = Query("md")):
    conn = db_conn()
    course = conn.execute("SELECT title FROM courses WHERE id = ?", (id,)).fetchone()
    if not course:
        conn.close()
        raise HTTPException(status_code=404, detail="Course not found")
    chapters = conn.execute(
        "SELECT id, title FROM chapters WHERE course_id = ? ORDER BY order_index",
        (id,),
    ).fetchall()
    videos: list[dict[str, Any]] = []
    for chapter in chapters:
        chapter_videos = conn.execute(
            "SELECT title, transcript FROM videos WHERE chapter_id = ? ORDER BY order_index",
            (chapter["id"],),
        ).fetchall()
        for row in chapter_videos:
            videos.append(
                {
                    "title": row["title"],
                    "transcript": row["transcript"],
                    "ch_title": chapter["title"],
                }
            )
    conn.close()
    return export_combined(course["title"], videos, fmt)


@app.get("/chapters/{id}/export")
def export_chapter_transcripts(id: int, fmt: str = Query("md")):
    conn = db_conn()
    chapter = conn.execute("SELECT title FROM chapters WHERE id = ?", (id,)).fetchone()
    if not chapter:
        conn.close()
        raise HTTPException(status_code=404, detail="Chapter not found")
    videos = conn.execute("SELECT title, transcript FROM videos WHERE chapter_id = ? ORDER BY order_index", (id,)).fetchall()
    conn.close()
    return export_combined(chapter["title"], videos, fmt, include_chapters=False)


def export_combined(main_title, videos, fmt, include_chapters=True):
    full_text = f"# {main_title}\n\n"
    curr_ch = None
    for v in videos:
        if include_chapters:
            v_ch = v["ch_title"]
            if v_ch != curr_ch:
                curr_ch = v_ch
                full_text += f"## {curr_ch}\n\n"
        full_text += f"### {v['title']}\n{v['transcript'] or 'No transcript'}\n\n"
        
    safe = "".join([c for c in main_title if c.isalnum() or c in (" ", "-", "_")]).strip().replace(" ", "_")
    if fmt == "md":
        return Response(content=full_text, media_type="text/markdown", headers={"Content-Disposition": f'attachment; filename="{safe}.md"'})
    if fmt == "json":
        data = {"title": main_title, "videos": [dict(v) for v in videos]}
        return Response(content=json.dumps(data, ensure_ascii=False, indent=2), media_type="application/json", headers={"Content-Disposition": f'attachment; filename="{safe}.json"'})
    
    pdf_data = pdf_transcript(main_title, full_text)
    return Response(content=pdf_data, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{safe}.pdf"'})
