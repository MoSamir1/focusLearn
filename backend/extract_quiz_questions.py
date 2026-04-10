from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import requests
from bs4 import BeautifulSoup


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def build_attempt_page_url(base_attempt_url: str, page_number: int) -> str:
    parsed = urlparse(base_attempt_url)
    query = parse_qs(parsed.query)
    query["page"] = [str(page_number)]
    new_query = urlencode(query, doseq=True)
    return urlunparse(parsed._replace(query=new_query))


def extract_choices(question_node: BeautifulSoup) -> list[str]:
    raw_choices: list[str] = []

    row_nodes = question_node.select(".answer > div")
    for row in row_nodes:
        classes = row.get("class", [])
        if any(cls.startswith("r") for cls in classes):
            txt = normalize_space(row.get_text(" ", strip=True))
            if txt:
                raw_choices.append(txt)

    if not raw_choices:
        label_nodes = question_node.select(".answer label")
        for node in label_nodes:
            txt = normalize_space(node.get_text(" ", strip=True))
            if txt:
                raw_choices.append(txt)

    if not raw_choices:
        answer_blocks = question_node.select(".answer .flex-fill, .answer .d-flex")
        for block in answer_blocks:
            txt = normalize_space(block.get_text(" ", strip=True))
            if txt:
                raw_choices.append(txt)

    split_choices: list[str] = []
    marker_regex = re.compile(r"(?<!\w)([A-Ha-h])\.\s+")
    for item in raw_choices:
        markers = list(marker_regex.finditer(item))
        if len(markers) <= 1:
            split_choices.append(item)
            continue
        for idx, marker in enumerate(markers):
            start = marker.start()
            end = markers[idx + 1].start() if idx + 1 < len(markers) else len(item)
            part = normalize_space(item[start:end])
            if part:
                split_choices.append(part)

    cleaned: list[str] = []
    seen_norm: set[str] = set()
    for choice in split_choices:
        value = normalize_space(re.sub(r"^[A-Ha-h]\.\s*", "", choice))
        norm_key = value.casefold()
        if not value or norm_key in seen_norm:
            continue
        seen_norm.add(norm_key)
        cleaned.append(value)

    return cleaned


def extract_questions_from_html(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    questions: list[dict] = []

    for q in soup.select("div.que"):
        qid = q.get("id", "")
        number_node = q.select_one(".info .no")
        number = normalize_space(number_node.get_text(" ", strip=True)) if number_node else ""

        text_node = q.select_one(".content .qtext") or q.select_one(".qtext")
        text = normalize_space(text_node.get_text(" ", strip=True)) if text_node else ""

        if not text:
            continue

        choices = extract_choices(q)
        questions.append(
            {
                "question_id": qid,
                "number": number,
                "question": text,
                "choices": choices,
            }
        )
    return questions


def extract_page_numbers(html: str) -> list[int]:
    soup = BeautifulSoup(html, "html.parser")
    pages: set[int] = {0}
    for a in soup.select("#quiznavblock a[href*='attempt.php'], .qn_buttons a[href*='attempt.php']"):
        href = a.get("href", "")
        parsed = urlparse(href)
        query = parse_qs(parsed.query)
        page_value = (query.get("page") or [None])[0]
        if page_value is None:
            continue
        try:
            pages.add(int(page_value))
        except ValueError:
            continue
    return sorted(pages)


def fetch_attempt_pages(attempt_url: str, moodle_session: str) -> dict[int, str]:
    session = requests.Session()
    session.cookies.set("MoodleSession", moodle_session, domain="maharatech.gov.eg")
    headers = {"User-Agent": "Mozilla/5.0"}

    first = session.get(attempt_url, headers=headers, timeout=60)
    first.raise_for_status()
    pages = extract_page_numbers(first.text)
    html_by_page = {0: first.text}

    for page_number in pages:
        if page_number == 0:
            continue
        page_url = build_attempt_page_url(attempt_url, page_number)
        response = session.get(page_url, headers=headers, timeout=60)
        response.raise_for_status()
        html_by_page[page_number] = response.text

    return html_by_page


def deduplicate_questions(items: list[dict]) -> list[dict]:
    seen: set[tuple[str, str]] = set()
    out: list[dict] = []
    for item in items:
        key = (item.get("number", ""), item.get("question", ""))
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract quiz questions and options from a Mahara quiz attempt URL.")
    parser.add_argument("--attempt-url", required=True)
    parser.add_argument("--session", required=True, help="MoodleSession cookie value")
    parser.add_argument("--out", default="quiz_questions.json")
    args = parser.parse_args()

    html_pages = fetch_attempt_pages(args.attempt_url, args.session)
    all_questions: list[dict] = []
    for page_number in sorted(html_pages.keys()):
        page_questions = extract_questions_from_html(html_pages[page_number])
        for q in page_questions:
            q["page"] = page_number
        all_questions.extend(page_questions)

    result = {
        "attempt_url": args.attempt_url,
        "total_pages": len(html_pages),
        "total_questions": len(deduplicate_questions(all_questions)),
        "questions": deduplicate_questions(all_questions),
    }

    output_path = Path(args.out)
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved: {output_path}")
    print(f"Questions: {result['total_questions']}")


if __name__ == "__main__":
    main()
