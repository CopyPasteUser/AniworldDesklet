#!/usr/bin/env python3
import cloudscraper
from bs4 import BeautifulSoup
import json
import os
import time
from datetime import datetime

LOGIN_URL = "https://aniworld.to/login"
BASE_URL = "https://aniworld.to"
COOKIE_PATH = ".local/share/cinnamon/desklets/AniworldDesklet/cookies.json"
OUTPUT_JSON = ".local/share/cinnamon/desklets/AniworldDesklet/recentAniworldFetch.json"
LOG_PATH = ".local/share/cinnamon/desklets/AniworldDesklet/aniworldScrapeLogs.txt"

EMAIL = ""   #placeholder obviously
PASSWORD = ""

def write_log_block(lines):
    """Fügt neuen Logblock hinzu und hält Datei bei max 5000 Zeilen."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    block = [f"[🕓 {timestamp}] === BEGIN ==="] + lines + [f"[🕓 {timestamp}] === ENDE ===\n"]

    
    if os.path.exists(LOG_PATH):
        with open(LOG_PATH, "r", encoding="utf-8") as f:
            existing = f.readlines()
    else:
        existing = []

    
    new_log = existing + [line + "\n" if not line.endswith("\n") else line for line in block]

    
    blocks = []
    current = []
    for line in new_log:
        if "=== BEGIN ===" in line and current:
            blocks.append(current)
            current = [line]
        else:
            current.append(line)
    if current:
        blocks.append(current)

   
    trimmed_blocks = []
    total_lines = 0
    for block in reversed(blocks):
        if total_lines + len(block) > 5000:
            break
        trimmed_blocks.insert(0, block)
        total_lines += len(block)

    with open(LOG_PATH, "w", encoding="utf-8") as f:
        for b in trimmed_blocks:
            f.writelines(b)

def fetch_continue_watching():
    log_lines = []
    def log(msg):
        timestamp = datetime.now().strftime("[%Y-%m-%d %H:%M:%S]")
        line = f"{timestamp} {msg}"
        print(line)
        log_lines.append(line)

    log("----- Starte neuen Fetch-Vorgang -----")
    scraper = cloudscraper.create_scraper()
    session_cookie = None

    if os.path.exists(COOKIE_PATH):
        try:
            with open(COOKIE_PATH, "r") as f:
                data = json.load(f)
                session_cookie = data.get("aniworld_session")
                log(f"Cookie geladen: {session_cookie}")
        except Exception as e:
            log(f"Fehler beim Laden des Cookies: {e}")

    if not session_cookie:
        log("Kein Cookie vorhanden, Login notwendig.")
        try:
            resp = scraper.post(LOGIN_URL, data={"email": EMAIL, "password": PASSWORD})
            log(f"Login HTTP-Status: {resp.status_code}")
            if resp.status_code == 200:
                for cookie in scraper.cookies:
                    if cookie.name == "aniworld_session":
                        session_cookie = cookie.value
                        with open(COOKIE_PATH, "w") as f:
                            json.dump({"aniworld_session": session_cookie}, f)
                        log("Login erfolgreich, Cookie gespeichert.")
            else:
                log("Login fehlgeschlagen.")
                write_log_block(log_lines)
                return
        except Exception as e:
            log(f"Fehler beim Login: {e}")
            write_log_block(log_lines)
            return

    cookies = { "aniworld_session": session_cookie }
    try:
        log("Lade Startseite...")
        resp = scraper.get(BASE_URL, cookies=cookies)
        html = resp.text
        log(f"HTTP-Status: {resp.status_code}, HTML-Länge: {len(html)}")

        if "logout" not in html.lower():
            log("Session scheint ungültig, versuche erneuten Login...")
            resp = scraper.post(LOGIN_URL, data={"email": EMAIL, "password": PASSWORD})
            for cookie in scraper.cookies:
                if cookie.name == "aniworld_session":
                    session_cookie = cookie.value
                    with open(COOKIE_PATH, "w") as f:
                        json.dump({"aniworld_session": session_cookie}, f)
                    log("Erneuter Login erfolgreich.")
                    cookies = { "aniworld_session": session_cookie }
                    resp = scraper.get(BASE_URL, cookies=cookies)
                    html = resp.text
            if "logout" not in html.lower():
                log("Session ungültig nach erneutem Login.")
                write_log_block(log_lines)
                return

        soup = BeautifulSoup(html, "html.parser")
        items = soup.find_all("div", class_="coverListItem")
        log(f"Gefundene Serien: {len(items)}")

        output = []
        for idx, item in enumerate(items[:20], 1):
            a_tag = item.find("a")
            if not a_tag:
                continue

            href = a_tag.get("href", "")
            link = BASE_URL + href if href.startswith("/") else href
            titel = a_tag.find("h3").text.strip() if a_tag.find("h3") else "Kein Titel"
            p_tags = a_tag.find_all("p")
            staffel = p_tags[0].text.strip() if len(p_tags) > 0 else "?"
            episode = p_tags[1].text.strip() if len(p_tags) > 1 else "?"
            img_tag = a_tag.find("img")
            bild = BASE_URL + img_tag.get("src", "") if img_tag and img_tag.get("src", "").startswith("/") else img_tag.get("src", "") if img_tag else ""

            log(f"{idx}. {titel} – {staffel} {episode}")
            output.append({
                "titel": titel,
                "link": link,
                "staffel": staffel,
                "episode": episode,
                "bild": bild
            })

        with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        log(f"{len(output)} Serien gespeichert nach {OUTPUT_JSON}")

    except Exception as e:
        log(f"Fehler im Fetch-Prozess: {e}")

    write_log_block(log_lines)

if __name__ == "__main__":
    while True:
        try:
            fetch_continue_watching()
        except Exception as e:
            write_log_block([f"[ERROR] Unerwarteter Fehler im Hauptloop: {e}"])
        time.sleep(900)
