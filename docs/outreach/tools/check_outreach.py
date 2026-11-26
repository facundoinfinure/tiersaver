#!/usr/bin/env python3
"""Checks every public text under docs/outreach/ against the wording rules.

Public text is:
  - drafts/*.md, drafts/phase1/*.md, drafts/creators/*.md: from the first
    "## First message", "## PHASE" or "## Answer" heading to the end of the
    file, minus sections whose heading starts with "## Opción" (internal).
  - any other .md: only what sits between <!-- PUBLIC TEXT START --> and
    <!-- PUBLIC TEXT END -->.
Internal notes (Spanish headers, quoted third-party titles, rule quotes) are
not scanned. Exit code 1 on any failure.

Usage: python3 docs/outreach/tools/check_outreach.py [--phase 1|2]
"""
import csv
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
ALLOWED_PRICES = {"$9", "$19", "$39", "$79"}

BANNED = [
    (r"\bsave[sd]?\b|\bsaving\b", "save"),
    (r"\bsavings\b", "savings"),
    (r"lower your (klaviyo )?bill", "lower your bill"),
    (r"\bpay(s|ing)? (klaviyo )?less\b", "pay less"),
    (r"recommended by", "recommended by"),
    (r"klaviyo(['’]s)?( own)? recommend", "Klaviyo recommends / recommended"),
    (r"read[- ]only", "read-only"),
    (r"guarantee", "guarantee"),
    (r"#1\b", "#1"),
    (r"\bbest\b", "best"),
    (r"\b(avoid|dodge|beat|circumvent|outsmart)\b", "avoid/dodge/beat (messaging guide)"),
    (r"pays for itself", "pays for itself"),
    (r"\b(official|certified)\b|klaviyo partner", "official / certified / Klaviyo partner"),
    (r"\b(infinure|dnuvi|alupont)\b", "another brand of the owner"),
    (r"!(?!\[)", "exclamation mark"),
    (r"\b(hack|10x|skyrocket|supercharge)\b", "growth jargon"),
    (r"\bahorr|\bgarant|recomendad[oa]s? por|solo lectura", "Spanish equivalent of a banned phrase"),
]


def public_chunks(path):
    text = path.read_text(encoding="utf-8")
    rel = path.relative_to(ROOT).as_posix()
    if "PUBLIC TEXT START" in text:
        return re.findall(r"<!-- PUBLIC TEXT START -->(.*?)<!-- PUBLIC TEXT END -->", text, re.S)
    if rel.startswith("drafts/") and path.name != "README.md":
        m = re.search(r"^## (First message|PHASE|Answer)", text, re.M)
        if not m:
            return []
        body = text[m.start():]
        body = re.sub(r"^## Opción.*?(?=^## |\Z)", "", body, flags=re.S | re.M)
        return [body]
    return []


def check_text(rel, chunk, errors):
    scan = re.sub(r"<!--.*?-->", "", chunk, flags=re.S)
    # headings are labels for the owner, not text a third party reads
    scan = "\n".join(l for l in scan.splitlines() if not l.startswith("## "))
    low = scan.lower()
    for pattern, label in BANNED:
        for m in re.finditer(pattern, low):
            ctx = scan[max(0, m.start() - 40): m.end() + 40].replace("\n", " ")
            errors.append(f"{rel}: banned [{label}] ...{ctx}...")
    for m in re.finditer(r"\$\s?\d+(?:[.,]\d+)*", scan):
        if m.group(0).replace(" ", "") not in ALLOWED_PRICES:
            errors.append(f"{rel}: dollar amount other than the plan prices: {m.group(0)}")
    for m in re.finditer(r"\$(?!\s?\d)", scan):
        errors.append(f"{rel}: stray dollar sign")


def check_lengths(rel, text, errors):
    for m in re.finditer(
        r"^## (First message|PHASE \d message)[^\n]*\n(.*?)(?=^## )", text, re.S | re.M
    ):
        body = [l for l in m.group(2).strip().splitlines()
                if not l.startswith("Subject:") and not l.startswith("Use only if true")]
        n = len(" ".join(body).split())
        if n >= 110:
            errors.append(f"{rel}: first message has {n} words (limit: under 110)")
    for m in re.finditer(r"^## Follow-up[^\n]*\n(.*?)(?=^## |\Z)", text, re.S | re.M):
        body = [l for l in m.group(1).strip().splitlines() if not l.startswith("Subject:")]
        n = len(" ".join(body).split())
        if n >= 50:
            errors.append(f"{rel}: follow-up has {n} words (limit: under 50)")


def check_phase(rel, text, phase, errors):
    """In phase 1 nothing may ask a third party to run the audit."""
    if phase != 1:
        return
    if rel.startswith("drafts/phase1/"):
        if re.search(r"try the free audit|run (a|the) free audit", text, re.I):
            errors.append(f"{rel}: phase 1 draft asks to try the audit")
    m = re.search(r"^## PHASE 1 message[^\n]*\n(.*?)(?=^## )", text, re.S | re.M)
    if m and re.search(r"free audit|auditoría gratis", m.group(1), re.I):
        errors.append(f"{rel}: PHASE 1 message asks to try the audit")
    if m and re.search(r"is now on the shopify app store|ya está en el shopify app store", m.group(1), re.I):
        errors.append(f"{rel}: PHASE 1 message claims the app is on the App Store")


def check_csv(name, id_col, evidence_col, draft_dir, errors):
    path = ROOT / name
    if not path.exists():
        return 0
    rows = list(csv.DictReader(path.open(encoding="utf-8")))
    for row in rows:
        if not row[evidence_col].startswith("http"):
            errors.append(f"{name}: row {row[id_col]} has no evidence URL")
        if draft_dir and not (ROOT / draft_dir / f"{row[id_col]}.md").exists():
            errors.append(f"{name}: row {row[id_col]} has no draft in {draft_dir}/")
    dnc = ROOT / "do-not-contact.csv"
    if dnc.exists():
        blocked = {r["organization"].strip().lower() for r in csv.DictReader(dnc.open(encoding="utf-8")) if r.get("organization")}
        key = "organization" if "organization" in rows[0] else "name"
        for row in rows:
            if row[key].strip().lower() in blocked and row.get("status") != "do-not-contact":
                errors.append(f"{name}: row {row[id_col]} is in do-not-contact.csv but its status is {row.get('status')}")
    return len(rows)


def check_product_hunt(errors):
    path = ROOT / "drafts/communities/product-hunt.md"
    if not path.exists():
        return
    text = path.read_text(encoding="utf-8")
    tag = re.search(r"\*\*Tagline[^*]*\*\*\s*(.+)", text)
    desc = re.search(r"\*\*Description[^*]*\*\*\s*(.+)", text)
    if not tag or len(tag.group(1).strip()) > 60:
        errors.append(f"product-hunt.md: tagline missing or over 60 characters ({len(tag.group(1).strip()) if tag else 0})")
    if not desc or len(desc.group(1).strip()) > 260:
        errors.append(f"product-hunt.md: description missing or over 260 characters ({len(desc.group(1).strip()) if desc else 0})")
    return (len(tag.group(1).strip()) if tag else 0, len(desc.group(1).strip()) if desc else 0)


def read_phase():
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    m = re.search(r"^PHASE:\s*([12])\b", readme, re.M)
    return int(m.group(1)) if m else None


def main():
    errors = []
    phase = read_phase()
    if "--phase" in sys.argv:
        phase = int(sys.argv[sys.argv.index("--phase") + 1])
    if phase is None:
        errors.append("README.md: no 'PHASE: 1' or 'PHASE: 2' line")
    files = chunks = 0
    for path in sorted(ROOT.rglob("*.md")):
        rel = path.relative_to(ROOT).as_posix()
        text = path.read_text(encoding="utf-8")
        parts = public_chunks(path)
        if parts:
            files += 1
        for chunk in parts:
            chunks += 1
            check_text(rel, chunk, errors)
        if rel.startswith("drafts/"):
            check_lengths(rel, text, errors)
            check_phase(rel, text, phase, errors)
    n_cre = check_csv("creators.csv", "id", "evidence_url", "drafts/creators", errors)
    n_pro = check_csv("prospects.csv", "id", "evidence_url", None, errors)
    ph = check_product_hunt(errors)
    print(f"phase: {phase}")
    print(f"files with public text: {files}; public chunks scanned: {chunks}")
    print(f"creators.csv rows: {n_cre}; prospects.csv rows: {n_pro}")
    if ph:
        print(f"Product Hunt tagline: {ph[0]} chars; description: {ph[1]} chars")
    if errors:
        print(f"FAIL: {len(errors)} problem(s)")
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print("OK: no banned phrase, no off-list dollar amount, lengths within limits, every row has an evidence URL")


if __name__ == "__main__":
    main()
