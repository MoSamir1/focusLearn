import re

with open('/home/mosamir/Desktop/mahara super/backend/main.py', 'r') as f:
    code = f.read()

# Add imports
code = code.replace("from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer", 
                   "from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer\nfrom reportlab.pdfbase import pdfmetrics\nfrom reportlab.pdfbase.ttfonts import TTFont\nimport arabic_reshaper\nfrom bidi.algorithm import get_display")

# Register font (Standard on most Linux)
font_registration = """
try:
    font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    if not os.path.exists(font_path):
        # Fallback for some systems
        font_path = "/usr/share/fonts/TTF/DejaVuSans.ttf"
    if os.path.exists(font_path):
        pdfmetrics.registerFont(TTFont('DejaVu', font_path))
        DEFAULT_FONT = 'DejaVu'
    else:
        DEFAULT_FONT = 'Helvetica'
except Exception:
    DEFAULT_FONT = 'Helvetica'
"""

code = code.replace("DB_PATH = BASE_DIR / \\"study.db\\"", "DB_PATH = BASE_DIR / \\"study.db\\"\\n" + font_registration)

# Update pdf_transcript for RTL
pdf_code = \"\"\"
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
    for para in transcript.split("\\n"):
        text = para.strip()
        if not text: continue
        flow.append(Paragraph(process_text(text), style))
        flow.append(Spacer(1, 6))
    doc.build(flow)
    return buffer.getvalue()
\"\"\"
code = re.sub(r'def pdf_transcript\(video_title: str, transcript: str\) -> bytes:.*?doc\.build\(flow\)\\n    return buffer\.getvalue\(\)', pdf_code, code, flags=re.DOTALL)

# Add transcript job state
code = code.replace("download_jobs: dict[str, dict[str, Any]] = {}", "download_jobs: dict[str, dict[str, Any]] = {}\\ntranscript_jobs: dict[str, dict[str, Any]] = {}")

# Add Transcript Management Task
job_task = \"\"\"
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
\"\"\"
code = code.replace("def run_download(", job_task + "\\n\\ndef run_download(")

# Add New Endpoints
endpoints = \"\"\"
@app.post("/transcripts/import")
def start_transcript_import(body: DownloadRequest, background_tasks: BackgroundTasks) -> dict:
    conn = db_conn()
    # Re-use resolve_download_video_ids but we need the DB IDs too
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
    full_text = f"# {main_title}\\n\\n"
    curr_ch = None
    for v in videos:
        if include_chapters and v.get("ch_title") != curr_ch:
            curr_ch = v["ch_title"]
            full_text += f"## {curr_ch}\\n\\n"
        full_text += f"### {v['title']}\\n{v['transcript'] or 'No transcript'}\\n\\n"
        
    safe = "".join([c for c in main_title if c.isalnum() or c in (" ", "-", "_")]).strip().replace(" ", "_")
    if fmt == "md":
        return Response(content=full_text, media_type="text/markdown", headers={"Content-Disposition": f'attachment; filename="{safe}.md"'})
    if fmt == "json":
        data = {"title": main_title, "videos": [dict(v) for v in videos]}
        return Response(content=json.dumps(data, ensure_ascii=False, indent=2), media_type="application/json", headers={"Content-Disposition": f'attachment; filename="{safe}.json"'})
    
    pdf_data = pdf_transcript(main_title, full_text)
    return Response(content=pdf_data, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{safe}.pdf"'})
\"\"\"
code = code.replace("@app.get(\"\/settings\")", endpoints + "\\n\\n@app.get(\"\/settings\")")

# Update import_course to NOT fetch transcripts by default
code = code.replace(\"\"\"        chapter_id = chapter_map[ch_title]
        transcript = fetch_transcript(video["youtube_id"])
        cur.execute(\"\"\", \"\"\"        chapter_id = chapter_map[ch_title]
        transcript = "" # Skip transcript for fast import
        cur.execute(\"\"\")

with open('/home/mosamir/Desktop/mahara super/backend/main.py', 'w') as f:
    f.write(code)
