#!/usr/bin/env python3
"""Fetch the Tanach for Lumora's offline library (app/public/tanach/).

Hebrew: "Tanach with Nikkud" (the Westminster Leningrad Codex, tanach.us) and
English: "The Holy Scriptures: A New Translation (JPS 1917)" — both in the
public domain — through Sefaria's open API. Run once; the files are kept in
the repository so Lumora never needs the internet for them.
"""

import json
import pathlib
import re
import urllib.parse
import urllib.request

BOOKS = [
    # (Sefaria title, Hebrew name, part)
    ("Genesis", "בראשית", "Torah"), ("Exodus", "שמות", "Torah"), ("Leviticus", "ויקרא", "Torah"),
    ("Numbers", "במדבר", "Torah"), ("Deuteronomy", "דברים", "Torah"),
    ("Joshua", "יהושע", "Neviim"), ("Judges", "שופטים", "Neviim"), ("I Samuel", "שמואל א", "Neviim"),
    ("II Samuel", "שמואל ב", "Neviim"), ("I Kings", "מלכים א", "Neviim"), ("II Kings", "מלכים ב", "Neviim"),
    ("Isaiah", "ישעיהו", "Neviim"), ("Jeremiah", "ירמיהו", "Neviim"), ("Ezekiel", "יחזקאל", "Neviim"),
    ("Hosea", "הושע", "Neviim"), ("Joel", "יואל", "Neviim"), ("Amos", "עמוס", "Neviim"), ("Obadiah", "עובדיה", "Neviim"),
    ("Jonah", "יונה", "Neviim"), ("Micah", "מיכה", "Neviim"), ("Nahum", "נחום", "Neviim"), ("Habakkuk", "חבקוק", "Neviim"),
    ("Zephaniah", "צפניה", "Neviim"), ("Haggai", "חגי", "Neviim"), ("Zechariah", "זכריה", "Neviim"), ("Malachi", "מלאכי", "Neviim"),
    ("Psalms", "תהילים", "Ketuvim"), ("Proverbs", "משלי", "Ketuvim"), ("Job", "איוב", "Ketuvim"),
    ("Song of Songs", "שיר השירים", "Ketuvim"), ("Ruth", "רות", "Ketuvim"), ("Lamentations", "איכה", "Ketuvim"),
    ("Ecclesiastes", "קהלת", "Ketuvim"), ("Esther", "אסתר", "Ketuvim"), ("Daniel", "דניאל", "Ketuvim"),
    ("Ezra", "עזרא", "Ketuvim"), ("Nehemiah", "נחמיה", "Ketuvim"), ("I Chronicles", "דברי הימים א", "Ketuvim"),
    ("II Chronicles", "דברי הימים ב", "Ketuvim"),
]

HE = "Tanach with Nikkud"
EN = "The Holy Scriptures: A New Translation (JPS 1917)"
OUT = pathlib.Path(__file__).resolve().parent.parent / "app" / "public" / "tanach"


def clean(text: str) -> str:
    # Footnotes, then any other markup, then the paragraph signs.
    text = re.sub(r'<sup[^>]*class="footnote-marker"[^>]*>.*?</sup>', "", text, flags=re.S)
    text = re.sub(r'<i[^>]*class="footnote"[^>]*>.*?</i>', "", text, flags=re.S)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\{[פס]\}", "", text)
    text = text.replace("&nbsp;", " ").replace("&thinsp;", "")
    return re.sub(r"\s+", " ", text).strip()


def fetch(title: str) -> dict:
    q = urllib.parse.urlencode([("version", f"hebrew|{HE}"), ("version", f"english|{EN}")])
    url = f"https://www.sefaria.org/api/v3/texts/{urllib.parse.quote(title)}?{q}"
    with urllib.request.urlopen(url, timeout=120) as r:
        return json.load(r)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    index = []
    for i, (title, he_name, part) in enumerate(BOOKS):
        data = fetch(title)
        texts = {v["language"]: v["text"] for v in data["versions"]}
        he = [[clean(v) for v in ch] for ch in texts["he"]]
        en = [[clean(v) for v in ch] for ch in texts.get("en", [])]
        file = f"{i:02d}.json"
        (OUT / file).write_text(json.dumps({"he": he, "en": en}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        index.append({"name": title, "he": he_name, "part": part, "file": file, "chapters": [len(c) for c in he]})
        print(title, len(he), "chapters")
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
