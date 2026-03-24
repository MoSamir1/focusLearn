from __future__ import annotations

import io
import json
import os
import re
import sqlite3
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
import requests
from youtube_transcript_api import YouTubeTranscriptApi
from yt_dlp import YoutubeDL
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import arabic_reshaper
from bidi.algorithm import get_display

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "study.db"

try:
    font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    if not os.path.exists(font_path):
        font_path = "/usr/share/fonts/TTF/DejaVuSans.ttf"
    if os.path.exists(font_path):
        pdfmetrics.registerFont(TTFont('DejaVu', font_path))
        DEFAULT_FONT = 'DejaVu'
    else:
        DEFAULT_FONT = 'Helvetica'
except Exception:
    DEFAULT_FONT = 'Helvetica'

app = FastAPI(title="Personal Learning App API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

download_jobs: dict[str, dict[str, Any]] = {}
transcript_jobs: dict[str, dict[str, Any]] = {}


def db_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = db_conn()
    cur = conn.cursor()
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
        """
    )
    cur.execute("INSERT OR IGNORE INTO settings(id, download_path) VALUES (1, '')")
    conn.commit()
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
    
    title_style = styles["Title"]
    title_style.fontName = DEFAULT_FONT
    
    def process_text(text):
        if not text.strip(): return ""
        reshaped = arabic_reshaper.reshape(text)
        return get_display(reshaped)

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


def fetch_transcript(youtube_id: str) -> str:
    try:
        ytt_api = YouTubeTranscriptApi()
        result = ytt_api.fetch(youtube_id)
        return " ".join([item.text for item in result])
    except Exception:
        return ""


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
import concurrent.futures

def fetch_hvp(link: str, headers: dict) -> dict:
    import requests, re
    try:
        
        print(f"Fetching {link}...", flush=True)
        resp = requests.get(link, headers=headers, timeout=(5, 10))

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
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
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

    headers = {
        "User-Agent": "Mozilla/5.0",
    }
    if cookie:
        cleaned_cookie = cookie.strip()
        headers["Cookie"] = cleaned_cookie if "=" in cleaned_cookie else f"MoodleSession={cleaned_cookie}"

    response = requests.get(url, headers=headers, timeout=25)
    response.raise_for_status()
    
    youtube_ids = extract_youtube_ids_from_text(response.text)
    
    if not youtube_ids:
        # Only check login markers if we failed to find any videos.
        # Mahara-Tech includes some of these markers in the navbar even when logged in.
        login_markers = ["Login to your account", "Log in", "الدخول لحسابك", "تسجيل دخول"]
        if any(marker in response.text for marker in login_markers):
            raise ValueError("Session cookie is invalid or expired. Please copy a fresh MoodleSession value.")
        return {"title": "Imported Course", "videos": []}
        
    import html
    title = "Imported Course"
    title_match = re.search(r"<title>(.*?)</title>", response.text)
    if title_match:
        # Clean up title and unescape HTML entities
        title = html.unescape(title_match.group(1).split("|")[0].strip())

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
            fallback = fallback_extract_from_html(url, cookie)
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


class DownloadRequest(BaseModel):
    target_type: str
    ids: list[int]
    quality: str = "720"
    download_path: str = ""


class CompletionUpdate(BaseModel):
    completed: bool


@app.on_event("startup")
def startup() -> None:
    init_db()


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


@app.post("/import-course")
def import_course(body: ImportRequest) -> dict[str, Any]:
    extracted = extract_course(body.course_url, body.cookie)
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
        ch_title = video["chapter_title"]
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
                video["video_duration"] if "video_duration" in video else video.get("duration", 0), # Handle both keys
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
    if target_type == "course":
        placeholders = ",".join(["?"] * len(ids))
        rows = conn.execute(
            f"""
            SELECT v.youtube_id
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
            f"SELECT youtube_id FROM videos WHERE chapter_id IN ({placeholders})",
            ids,
        ).fetchall()
    elif target_type == "video":
        placeholders = ",".join(["?"] * len(ids))
        rows = conn.execute(
            f"SELECT youtube_id FROM videos WHERE id IN ({placeholders})",
            ids,
        ).fetchall()
    else:
        raise HTTPException(status_code=400, detail="Invalid target type")
    return [r["youtube_id"] for r in rows]


def run_transcript_import(job_id: str, video_targets: list[dict]) -> None:
    transcript_jobs[job_id] = {"status": "running", "progress": 0, "total": len(video_targets), "done": 0}
    conn = db_conn()
    try:
        for idx, target in enumerate(video_targets):
            yt_id = target["youtube_id"]
            db_id = target["id"]
            text = fetch_transcript(yt_id)
            conn.execute("UPDATE videos SET transcript = ? WHERE id = ?", (text, db_id))
            conn.commit()
            transcript_jobs[job_id]["done"] += 1
            transcript_jobs[job_id]["progress"] = int((transcript_jobs[job_id]["done"] / len(video_targets)) * 100)
        transcript_jobs[job_id]["status"] = "done"
    except Exception as e:
        transcript_jobs[job_id]["status"] = "error"
        transcript_jobs[job_id]["message"] = str(e)
    finally:
        conn.close()


def run_download(job_id: str, urls: list[str], quality: str, output_path: str) -> None:
    Path(output_path).mkdir(parents=True, exist_ok=True)
    download_jobs[job_id] = {"status": "running", "progress": 0, "message": "Starting..."}

    total = max(len(urls), 1)
    state = {"done": 0}

    def hook(d: dict[str, Any]) -> None:
        if d.get("status") == "finished":
            state["done"] += 1
            download_jobs[job_id]["progress"] = int((state["done"] / total) * 100)
            download_jobs[job_id]["message"] = f"Downloaded {state['done']} / {total}"

    ydl_opts: dict[str, Any] = {
        "format": f"bestvideo[height<={quality}]+bestaudio/best[height<={quality}]",
        "outtmpl": str(Path(output_path) / "%(title)s.%(ext)s"),
        "progress_hooks": [hook],
        "quiet": True,
    }
    try:
        with YoutubeDL(ydl_opts) as ydl:
            for video_id in urls:
                ydl.download([f"https://www.youtube.com/watch?v={video_id}"])
        download_jobs[job_id]["status"] = "done"
        download_jobs[job_id]["progress"] = 100
        download_jobs[job_id]["message"] = "Download complete"
    except Exception as exc:
        download_jobs[job_id]["status"] = "error"
        download_jobs[job_id]["message"] = str(exc)


@app.post("/downloads/start")
def start_download(body: DownloadRequest, background_tasks: BackgroundTasks) -> dict[str, Any]:
    if not body.ids:
        raise HTTPException(status_code=400, detail="No selected IDs")
    conn = db_conn()
    video_ids = resolve_download_video_ids(conn, body.target_type, body.ids)
    conn.execute("UPDATE settings SET download_path = ? WHERE id = 1", (body.download_path,))
    conn.commit()
    conn.close()
    if not video_ids:
        raise HTTPException(status_code=400, detail="No videos resolved for the selection")

    job_id = f"job-{datetime.utcnow().timestamp()}"
    background_tasks.add_task(run_download, job_id, video_ids, body.quality, body.download_path)
    return {"job_id": job_id}


@app.get("/downloads/{job_id}")
def download_status(job_id: str) -> dict[str, Any]:
    state = download_jobs.get(job_id)
    if not state:
        raise HTTPException(status_code=404, detail="Job not found")
    return state


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
    conn = db_conn()
    if body.target_type == "course":
        rows = conn.execute("SELECT v.id, v.youtube_id FROM videos v JOIN chapters ch ON v.chapter_id = ch.id WHERE ch.course_id IN (" + ",".join(["?"]*len(body.ids)) + ")", body.ids).fetchall()
    elif body.target_type == "chapter":
        rows = conn.execute("SELECT id, youtube_id FROM videos WHERE chapter_id IN (" + ",".join(["?"]*len(body.ids)) + ")", body.ids).fetchall()
    else:
        rows = conn.execute("SELECT id, youtube_id FROM videos WHERE id IN (" + ",".join(["?"]*len(body.ids)) + ")", body.ids).fetchall()
    conn.close()
    
    if not rows: raise HTTPException(status_code=400, detail="No videos found")
    
    job_id = f"trans-{datetime.utcnow().timestamp()}"
    targets = [{"id": r["id"], "youtube_id": r["youtube_id"]} for r in rows]
    background_tasks.add_task(run_transcript_import, job_id, targets)
    return {"job_id": job_id}


@app.get("/transcripts/status/{job_id}")
def get_transcript_status(job_id: str):
    return transcript_jobs.get(job_id, {"status": "not_found"})


@app.get("/courses/{id}/export")
def export_course_transcripts(id: int, fmt: str = Query("md")):
    conn = db_conn()
    course = conn.execute("SELECT title FROM courses WHERE id = ?", (id,)).fetchone()
    videos = conn.execute("SELECT v.title, v.transcript, ch.title as ch_title FROM videos v JOIN chapters ch ON v.chapter_id = ch.id WHERE ch.course_id = ? ORDER BY ch.order_index, v.order_index", (id,)).fetchall()
    conn.close()
    return export_combined(course["title"], videos, fmt)


@app.get("/chapters/{id}/export")
def export_chapter_transcripts(id: int, fmt: str = Query("md")):
    conn = db_conn()
    chapter = conn.execute("SELECT title FROM chapters WHERE id = ?", (id,)).fetchone()
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
