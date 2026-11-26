#!/usr/bin/env python3
"""Banned-phrase check for the public (English) launch copy. Usage: banned.py <file>...  Exit code 1 on any hit.
What is scanned: in .md files, the fenced blocks (the copy to paste), list items that hold a `code` string, and
table rows that start with a number (shot lists); in items.json everything; in .mjs files the cap("...") captions
and the <h1>/<p> of the feature image. The Spanish notes around the copy quote the rules and are not scanned.
Allowed on purpose and removed before matching: the UI label "Save settings", and "first" used as an ordinal
("your first cleanup", "the first cleanup", "the first one")."""
import os, re, sys
RULES = [
    (r"\bklaviyo('s)?( own)? recommend", "Klaviyo + recommend"),
    (r"recommend(ed|s)? by klaviyo", "recommended by Klaviyo"),
    (r"read[- ]only", "read-only"),
    (r"\bpay(ing|s)? (klaviyo )?less\b", "pay less"),
    (r"\bsav(e|es|ing|ings)\b", "savings"),
    (r"(lower|reduce|cut|shrink)s? (your |the )?klaviyo (bill|invoice|costs?)", "lower your Klaviyo bill"),
    (r"stop paying", "stop paying"),
    (r"pays? for itself", "pays for itself"),
    (r"#\s?1\b|number one", "#1"),
    (r"\bthe (best|first|only)\b|\bbest\b", "best / first / only"),
    (r"\bofficial(ly)?\b|\bcertified\b|klaviyo partner|\bpreferred\b|top[- ]performing", "official / certified / partner / preferred"),
    (r"\bdelet(e|es|ing) (the |your |inactive |unengaged )?profiles\b", "delete profiles (as what the app does)"),
    (r"(available|live|now) (on|in) the (shopify )?app store", "says it is on the App Store"),
    (r"before klaviyo counts|billing date", "billing-timing promise"),
    (r"\b(guarantee[ds]?|skyrocket|supercharge|10x|hack)\b", "guarantee / growth jargon"),
    (r"deliverability tool|email marketing tool", "wrong product description"),
    (r"\b(infinure|dnuvi|alupont)\b", "other brands"),
    (r"!(\s|$)", "exclamation mark"),
    (r"\b\d+ ?%|\btestimonial", "percentage or testimonial"),
]
ALLOW = re.compile(r"Save settings|(your|the) first (cleanup|one)", re.I)
def lines_of(path):
    text = open(path, encoding="utf-8").read().split("\n")
    if path.endswith(".md"):
        fenced = False
        for n, line in enumerate(text, 1):
            if line.startswith("```"): fenced = not fenced; continue
            if fenced or re.match(r"\| \d+ \|", line): yield n, line
            elif line.startswith("- ") and "`" in line: yield n, " ".join(re.findall(r"`([^`]*)`", line))
    elif path.endswith(".mjs"):
        for n, line in enumerate(text, 1):
            for m in re.finditer(r'cap\("([^"]*)"\)|<h1>(.*?)</h1>|<p>(.*?)</p>', line): yield n, " ".join(g for g in m.groups() if g)
    else:
        for n, line in enumerate(text, 1): yield n, line
def files(args):
    for a in args:
        if os.path.isdir(a):
            for r, _, fs in os.walk(a):
                for f in fs:
                    if f.endswith((".md", ".json", ".mjs")): yield os.path.join(r, f)
        else: yield a
hits = 0
for path in files(sys.argv[1:]):
    for n, line in lines_of(path):
        line = ALLOW.sub("", line)
        for rx, why in RULES:
            for m in re.finditer(rx, line, re.I):
                hits += 1
                print(f"{path}:{n}: [{why}] ...{line[max(0, m.start()-40):m.end()+40].strip()}...")
print(f"{hits} hit(s)")
sys.exit(1 if hits else 0)
