"""
How a publication is cited, and how machines read it.

The JSON-LD matters more than it looks: schema.org/Dataset is what gets a Kura
release into Google Dataset Search, and schema.org/Article is what makes a link
render as a proper article card rather than a bare URL.
"""

import json
import re

from .models import Kind

SCHEMA_TYPE = {
    Kind.ARTICLE: "Article",
    Kind.DATASET: "Dataset",
    Kind.DECK: "PresentationDigitalDocument",
    Kind.BOARD: "CreativeWork",
    Kind.CARD: "CreativeWork",
    Kind.SHOW: "Event",
}


def _authors(pub):
    people = list(pub.authors.all())
    if people:
        return people
    return []


def _author_names(pub, style="apa"):
    people = _authors(pub)
    if not people:
        return pub.owner.get_full_name() or pub.owner.get_username()
    if style == "apa":
        names = [a.surname_initials for a in people]
        if len(names) == 1:
            return names[0]
        return "%s, & %s" % (", ".join(names[:-1]), names[-1])
    return " and ".join(a.display_name for a in people)


def year(pub):
    when = pub.first_published_at or pub.published_at or pub.created_at
    return when.year if when else ""


def apa(pub, url=""):
    bits = [
        "%s (%s)." % (_author_names(pub, "apa"), year(pub)),
        "%s%s" % (pub.title, "" if pub.title.endswith((".", "?", "!")) else "."),
    ]
    if pub.kind != Kind.ARTICLE:
        bits.append("[%s]." % pub.kind_label)
    bits.append("KnockKnock.")
    if pub.version > 1:
        bits.append("Version %d." % pub.version)
    if url:
        bits.append(url)
    return " ".join(b for b in bits if b)


def bibtex(pub, url=""):
    people = _authors(pub)
    authors = " and ".join(a.display_name for a in people) if people else (
        pub.owner.get_full_name() or pub.owner.get_username())
    key = re.sub(r"[^A-Za-z0-9]", "", (people[0].display_name.split()[-1] if people else "knockknock"))
    entry = "misc" if pub.kind != Kind.ARTICLE else "article"
    lines = [
        "@%s{%s%s," % (entry, key.lower(), year(pub)),
        "  title        = {%s}," % pub.title,
        "  author       = {%s}," % authors,
        "  year         = {%s}," % year(pub),
        "  howpublished = {KnockKnock}," if entry == "misc" else "  journal      = {KnockKnock},",
        "  note         = {%s, version %d}," % (pub.citation_key, pub.version),
    ]
    if url:
        lines.append("  url          = {%s}," % url)
    lines.append("}")
    return "\n".join(lines)


def ris(pub, url=""):
    ty = {"dataset": "DATA", "article": "JOUR", "deck": "SLIDE"}.get(pub.kind, "GEN")
    lines = ["TY  - %s" % ty]
    for a in _authors(pub):
        lines.append("AU  - %s" % a.surname_initials)
    if not _authors(pub):
        lines.append("AU  - %s" % (pub.owner.get_full_name() or pub.owner.get_username()))
    lines += [
        "TI  - %s" % pub.title,
        "PY  - %s" % year(pub),
        "PB  - KnockKnock",
    ]
    if pub.abstract:
        lines.append("AB  - %s" % " ".join(pub.abstract.split()))
    for t in pub.tags.all():
        lines.append("KW  - %s" % t.name)
    if url:
        lines.append("UR  - %s" % url)
    lines.append("ER  - ")
    return "\n".join(lines)


def json_ld(pub, url=""):
    doc = {
        "@context": "https://schema.org",
        "@type": SCHEMA_TYPE.get(pub.kind, "CreativeWork"),
        "name": pub.title,
        "headline": pub.title,
        "description": pub.abstract or pub.subtitle,
        "identifier": pub.citation_key,
        "inLanguage": pub.language,
        "version": pub.version,
        "datePublished": pub.first_published_at.isoformat() if pub.first_published_at else None,
        "dateModified": pub.published_at.isoformat() if pub.published_at else None,
        "publisher": {"@type": "Organization", "name": "KnockKnock"},
        "author": [
            {"@type": "Person", "name": a.display_name,
             **({"affiliation": {"@type": "Organization", "name": a.affiliation}} if a.affiliation else {})}
            for a in _authors(pub)
        ] or [{"@type": "Person", "name": pub.owner.get_full_name() or pub.owner.get_username()}],
        "keywords": [t.name for t in pub.tags.all()],
    }
    if url:
        doc["url"] = url
        doc["@id"] = url
    if pub.license_url:
        doc["license"] = pub.license_url
    if pub.cover:
        doc["image"] = pub.cover.url
    if pub.kind == Kind.DATASET:
        dist = []
        for a in pub.current_assets():
            if a.role in ("primary", "data"):
                dist.append({
                    "@type": "DataDownload",
                    "name": a.label,
                    "encodingFormat": a.media_type,
                    "contentSize": str(a.byte_size),
                    "sha256": a.checksum,
                })
        if dist:
            doc["distribution"] = dist
        if pub.coverage_area:
            doc["spatialCoverage"] = pub.coverage_area
        if pub.collected_between:
            doc["temporalCoverage"] = pub.collected_between
        meta = pub.meta or {}
        if meta.get("columns"):
            doc["variableMeasured"] = meta.get("preview", {}).get("columns", [])
    return {k: v for k, v in doc.items() if v not in (None, [], "", {})}


def json_ld_script(pub, url=""):
    return json.dumps(json_ld(pub, url), ensure_ascii=False)
