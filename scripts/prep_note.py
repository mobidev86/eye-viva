"""Preprocess the reference-note PDF into page-tagged passage chunks.

Usage: python3 -I scripts/prep_note.py ["<pdf>" [out.json]]   (needs: pip install pypdf)
Defaults: the PDF in the parent folder, output data/note-chunks.json.
- one record per PDF page, footer/header lines stripped
- sentence-window chunks (3 sentences, stride 2) so each chunk is short enough to quote
- every chunk keeps `page` (printed page number == PDF page index) and the section heading
"""
import json, re, sys, pypdf

HEADINGS = {
    "Aqueous humour and intraocular pressure", "Measuring IOP", "Assessing the drainage angle",
    "Van Herick grading", "Gonioscopy", "Primary angle closure", "Terminology", "Risk factors",
    "Mechanisms", "Acute primary angle closure", "Symptoms", "Signs", "Triggers",
    "Differential diagnosis", "Managing an acute attack", "Immediate treatment",
    "If the IOP does not fall", "Definitive treatment", "Follow-up", "Laser peripheral iridotomy",
    "Indications", "Technique", "Complications", "Plateau iris", "Secondary angle closure",
    "Pushing mechanisms", "Pulling mechanisms", "Primary open-angle glaucoma and ocular hypertension",
    "IOP-lowering medicines", "Laser and surgery in glaucoma", "About this note",
}
FOOTER = re.compile(r"^(eyeacademy Take-home reference note|Glaucoma and angle closure · Eye Academy reference note \d+)$")

def main(pdf, out):
    reader = pypdf.PdfReader(pdf)
    chunks, section = [], "About this note"
    pages = []
    for i, page in enumerate(reader.pages, start=1):
        lines = [l.strip() for l in page.extract_text().splitlines()]
        lines = [l for l in lines if l and not FOOTER.match(l)]
        body, start_section = [], section
        for l in lines:
            if l in HEADINGS:
                section = l
                body.append(f"\n§{l}\n")
            else:
                body.append(l)
        text = re.sub(r"\s+", " ", " ".join(b for b in body if not b.startswith("\n§")))
        pages.append({"page": i, "text": text})
        # sentence windows within each section run on this page
        runs, cur, sec = [], [], start_section
        for b in body:
            if b.startswith("\n§"):
                if cur: runs.append((sec, " ".join(cur)))
                cur, sec = [], b.strip()[1:]
            else:
                cur.append(b)
        if cur: runs.append((sec, " ".join(cur)))
        for sec_name, run in runs:
            sents = [s.strip() for s in re.split(r"(?<=[.;:])\s+(?=[A-Z0-9])", re.sub(r"\s+", " ", run)) if s.strip()]
            step = 2
            for k in range(0, max(len(sents), 1), step):
                win = " ".join(sents[k:k + 3])
                if len(win) < 40: continue
                chunks.append({"id": f"p{i}-{len(chunks)}", "page": i, "section": sec_name, "text": win})
    json.dump({"source": "Glaucoma and angle closure: Eye Academy reference note", "pages": pages, "chunks": chunks},
              open(out, "w"), indent=1, ensure_ascii=False)
    print(f"{len(pages)} pages, {len(chunks)} chunks -> {out}")

main(sys.argv[1] if len(sys.argv) > 1 else "../Eye Academy - Glaucoma_and_Angle_Closure_Reference_Note.pdf",
     sys.argv[2] if len(sys.argv) > 2 else "data/note-chunks.json")
