#!/usr/bin/env python3
"""Собирает data/questions.json из Markdown-выгрузки документа «Пул вопросов».

Запуск:  python3 tools/build_questions.py путь/к/pool.md

- Разделы — заголовки «## », вопросы — «### », частота — строка «**Частота:** N».
- Раздел «Источники» в сайт не попадает (там данные об учениках).
- id уже существующих вопросов сохраняются (сопоставление по тексту вопроса),
  чтобы у студентов не сбрасывался прогресс «знаю / повторить».
"""
import json, re, sys, datetime, pathlib

import markdown  # pip install markdown

MD_EXT = ["fenced_code", "tables", "sane_lists"]

def to_html(text):
    html = markdown.markdown(text, extensions=MD_EXT)
    # широкие таблицы прокручиваются по горизонтали, а не ломают вёрстку на телефоне
    return html.replace("<table>", '<div class="tablewrap"><table>').replace("</table>", "</table></div>")

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "questions.json"
SKIP_SECTIONS = {"Источники"}
TYPE_BY_SECTION = {
    "Практические задачи": "practice",
    "Ситуационные вопросы": "situational",
    "Вопросы о себе и опыте": "personal",
    "Вопросы к компании": "company",
}

def norm(s):
    return re.sub(r"\s+", " ", s.replace("\\", "")).strip().lower()

def unescape(s):
    return re.sub(r"\\([_*\[\]()#+\-.!>`~|])", r"\1", s)

def main(src):
    md = pathlib.Path(src).read_text(encoding="utf-8")
    old = {}
    if OUT.exists():
        prev = json.loads(OUT.read_text(encoding="utf-8"))
        old = {norm(q["question"]): q["id"] for q in prev["questions"]}
    next_num = max([int(i[1:]) for i in old.values()] + [0]) + 1

    used = set()
    # старые тексты, которые и сейчас есть в документе дословно, для нечёткого сопоставления не годятся
    exact_now = {norm(unescape(l[4:].strip())) for l in md.split("\n") if l.startswith("### ")}
    sections, questions = [], []
    sec = q = None
    buf = []

    def flush():
        nonlocal q, buf
        if q is not None:
            body = "\n".join(buf).strip()
            m = re.search(r"\*\*Частота:\*\*\s*(\d+)", body)
            q["frequency"] = int(m.group(1)) if m else 1
            body = re.sub(r"^\*\*Частота:\*\*.*$", "", body, count=1, flags=re.M).strip()
            # «**Условие:** … **Ответ:** …» — условие показывается до ответа
            if body.startswith("**Условие:**"):
                parts = re.split(r"^\*\*Ответ:\*\*\s*$", body, maxsplit=1, flags=re.M)
                if len(parts) == 2:
                    cond = parts[0][len("**Условие:**"):].strip()
                    cond = cond[:1].upper() + cond[1:]
                    q["condition"] = cond
                    q["condition_html"] = to_html(cond)
                    body = parts[1].strip()
            q["answer"] = body
            q["answer_html"] = to_html(body)
            questions.append(q)
        elif sec is not None:
            intro = "\n".join(buf).strip()
            if intro:
                sec["intro"] = intro
        q, buf = None, []

    for line in md.split("\n"):
        if line.startswith("## "):
            flush()
            title = line[3:].strip()
            if title in SKIP_SECTIONS:
                sec = None
                continue
            sec = {"id": f"s{len(sections)+1:02d}", "title": title,
                   "type": TYPE_BY_SECTION.get(title, "theory")}
            sections.append(sec)
        elif line.startswith("### ") and sec is not None:
            flush()
            text = unescape(line[4:].strip())
            qid = old.get(norm(text))
            if not qid:
                # вопрос дополнили новой частью — старый текст входит в новый:
                # сохраняем id, чтобы у студентов не сбросились отметки
                nt = norm(text)
                for ot, oid in old.items():
                    if len(ot) >= 15 and ot in nt and oid not in used and ot not in exact_now:
                        qid = oid
                        break
            if qid in used:
                qid = None
            if not qid:
                qid = f"q{next_num:03d}"
                next_num += 1
            used.add(qid)
            q = {"id": qid, "section": sec["id"], "type": sec["type"], "question": text}
        elif sec is not None:
            buf.append(line)
    flush()

    media_file = ROOT / "data" / "media.json"
    media = json.loads(media_file.read_text(encoding="utf-8")) if media_file.exists() else {}
    for q in questions:
        imgs = media.get(q["question"])
        if imgs:
            q["images"] = imgs

    data = {
        "updated": datetime.date.today().isoformat(),
        "sections": sections,
        "questions": questions,
    }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(sections)} разделов, {len(questions)} вопросов → {OUT}")

if __name__ == "__main__":
    main(sys.argv[1])
