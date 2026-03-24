# Focus Learn (Mahara Super) 🚀

An integrated educational platform designed to streamline importing, managing, downloading, and documenting courses from platforms like **YouTube** and **Mahara-Tech**. It features a fast, interactive user interface powered by a robust Python backend.

---

## ✨ Key Features

### 1. Smart Course Import
- **Mahara-Tech Support:** Import entire courses (with hundreds of videos) instantly using a custom Fast-Path HTML Scraper, bypassing the slowness of standard extraction tools.
- **Authentication Bypass:** Supports using `MoodleSession` cookies to extract closed or private courses tied to your account.
- **Browser Persistence:** Automatically saves your last used Course URL and Cookie in the browser's Local Storage so you don't lose them upon refresh.

### 2. Transcript Management
- **Background Fetching:** Operates transcript extraction as asynchronous background jobs, ensuring the UI remains responsive and fast.
- **Selective Import:** Use the interactive Tree View to selectively import transcripts for an entire course, a specific chapter, or individual videos.
- **Real-time Progress Bar:** Watch the background job's progress in real-time as your transcripts are downloaded and saved to the database.

### 3. Advanced Exporting
- **Arabic RTL PDF Export:** Export all your course transcripts into a professionally formatted PDF. Features full support for Arabic text (Right-to-Left formatting, character reshaping using `arabic-reshaper` and `python-bidi`). 
- **Multiple Formats:** Export course data to Markdown (`.md`) or JSON (`.json`) for developer use.
- **One-Click Copy:** Copy all transcripts across the course directly to your clipboard.

### 4. Video Playback & Downloads
- **Built-in Player:** Watch course videos directly within the platform and track your lesson completion.
- **Local Downloading:** Download videos locally at your preferred quality (up to 1080p) using powerful integrations with `yt-dlp` and `ffmpeg`.

---

## 🛠 Tech Stack

### Backend (Python 3)
- **FastAPI:** High-performance framework for building the APIs.
- **SQLite:** Lightweight, disk-based database for tracking courses, videos, and user progress.
- **youtube-transcript-api:** Directly fetches video transcripts.
- **yt-dlp:** Parses video URLs and downloads media.
- **ReportLab, Arabic-Reshaper, & Python-Bidi:** Renders complex PDF documents with proper Arabic typography support.
- **Concurrent Futures (Multithreading):** Enables parallel processing, reducing hours of extraction time into just seconds for large Mahara-Tech courses.

### Frontend (React)
- **Vite:** Next-generation frontend tooling and fast builds.
- **React 18:** Component-based UI library.
- **TailwindCSS:** Utility-first CSS framework for a sleek, responsive, and dark-mode-ready design.

---

## 🚀 How to Run

### 1. Prerequisites
- `Python 3.10+`
- `Node.js 16+`
- `ffmpeg` installed on your system (Required for merging video and audio during downloads).
  - *Linux:* `sudo apt install ffmpeg`

### 2. Start the Backend
Open a terminal, navigate to the `backend` directory, create a virtual environment, and run the server:
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
*The API will be available at `http://localhost:8000`.*

### 3. Start the Frontend
Open a new terminal, navigate to the `frontend` directory, install dependencies, and run the dev server:
```bash
cd frontend
npm install
npm run dev
```
*The User Interface will open at `http://localhost:5173`.*

---

## ⚙️ Database Schema
The SQLite database (`study.db`) consists of three primary, relational tables:
1. **courses:** Stores the course title, import date, and aggregate duration.
2. **chapters:** Linked to a course (1:N), acting as structural groupings.
3. **videos:** Linked to a chapter (1:N), storing the YouTube ID, video title, fetched transcript text, duration, and user completion status.
