#!/usr/bin/env python3
"""Build and search a deterministic local index of the pinned official Title 26 XML.

Run from any directory (Python 3.9+, standard library only):
  python3 scripts/index-tax-code.py build --verified-on 2026-09-15
  python3 scripts/index-tax-code.py lookup 162 179 280F
  python3 scripts/index-tax-code.py search "ordinary and necessary" --limit 5
  python3 scripts/index-tax-code.py validate

The input archive must already exist. No network requests are made. Corpus text
includes editorial/source/effective-date notes; indexing is not legal review.
"""

import argparse
from collections import Counter
from datetime import date
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile


ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = ROOT / ".tax-research/title26-119-103.zip"
OUTPUT_DIR = ROOT / ".tax-research"
MANIFEST = ROOT / "docs/research/title26-corpus-manifest.json"
SOURCE_URL = "https://uscode.house.gov/download/releasepoints/us/pl/119/103/xml_usc26@119-103.zip"
USLM = "http://xml.house.gov/schemas/uslm/1.0"
NS = {"u": USLM, "dc": "http://purl.org/dc/elements/1.1/", "dct": "http://purl.org/dc/terms/"}
PUBLICATION = "Online@119-103"
SECTION_PREFIX = "/us/usc/t26/s"
EXPECTED_COUNT = 2161
EXPECTED_STATUSES = {"not_marked": 1899, "repealed": 241, "renumbered": 17, "reserved": 2, "omitted": 2}
REFERENCE_CHECKS = {
    "162": ("Trade or business expenses", "ordinary and necessary expenses"),
    "179": ("Election to expense certain depreciable business assets", "$2,500,000"),
    "280F": ("Limitation on depreciation for luxury automobiles", "passenger automobile"),
}
STRUCTURAL_TAGS = {"title", "subtitle", "chapter", "subchapter", "part", "subpart"}
BLOCK_TAGS = {
    "section", "subsection", "paragraph", "subparagraph", "clause", "subclause",
    "item", "subitem", "chapeau", "continuation", "content", "p", "heading",
    "sourceCredit", "notes", "note", "table", "tr", "thead", "tbody", "toc",
    "tocItem", "layout", "header", "quotedContent", "signature", "level",
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    checksum = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


def location(path):
    try:
        return path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return str(path.resolve())


def full_text(element):
    """Keep every XML text node, preserving inline text and separating blocks."""
    pieces = []

    def visit(node):
        tag = node.tag.rsplit("}", 1)[-1]
        if tag in BLOCK_TAGS:
            pieces.append("\n")
        if tag in {"td", "th", "column"}:
            pieces.append("\t")
        if node.text:
            pieces.append(node.text)
        for child in node:
            visit(child)
            if child.tail:
                pieces.append(child.tail)
        if tag == "num":
            pieces.append(" ")
        if tag in BLOCK_TAGS:
            pieces.append("\n")

    visit(element)
    lines = [" ".join(line.split()) for line in "".join(pieces).splitlines()]
    return "\n".join(line for line in lines if line)


def child_text(element, path):
    child = element.find(path, NS)
    return "" if child is None else " ".join("".join(child.itertext()).split())


def json_bytes(value, pretty=False):
    options = {"ensure_ascii": False, "sort_keys": True}
    if pretty:
        options["indent"] = 2
    else:
        options["separators"] = (",", ":")
    return (json.dumps(value, **options) + "\n").encode("utf-8")


def write_atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=path.name + ".", delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(data)
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def check_references(records):
    by_number = {record["section_number"]: record for record in records}
    checks = []
    for number, (heading, phrase) in REFERENCE_CHECKS.items():
        record = by_number.get(number)
        require(record is not None, "Missing reference section " + number)
        require(heading in record["heading"], "Unexpected heading for section " + number)
        require(phrase in record["text"], "Missing reference text in section " + number)
        checks.append({"section": number, "identifier": record["identifier"], "heading_contains": heading,
                       "text_contains": phrase, "passed": True})
    return checks


def build(args):
    date.fromisoformat(args.verified_on)
    with zipfile.ZipFile(args.archive) as archive:
        info = archive.getinfo("usc26.xml")
        require(info.file_size < 200 * 1024 * 1024, "Unexpectedly large source XML")
        xml = archive.read(info)  # zipfile also verifies the member's CRC.
    root = ET.fromstring(xml)
    require(root.tag == "{" + USLM + "}uscDoc", "Unexpected XML root or namespace")
    require(root.get("identifier") == "/us/usc/t26", "Input is not Title 26")
    publication = child_text(root, "u:meta/u:docPublicationName")
    require(publication == PUBLICATION, "Unexpected release; this script is pinned to " + PUBLICATION)
    records = []

    def visit(element, hierarchy):
        tag = element.tag.rsplit("}", 1)[-1]
        if element.tag.startswith("{" + USLM + "}") and tag in STRUCTURAL_TAGS:
            hierarchy = hierarchy + [{"type": tag, "identifier": element.get("identifier"),
                                      "number": child_text(element, "u:num"),
                                      "heading": child_text(element, "u:heading")}]
        if element.tag == "{" + USLM + "}section" and element.get("identifier", "").startswith(SECTION_PREFIX):
            text = full_text(element)
            number = element.find("u:num", NS)
            require(number is not None, "Section has no number: " + element.get("identifier"))
            records.append({
                "ordinal": len(records) + 1, "identifier": element.get("identifier"),
                "section_number": number.get("value") or child_text(element, "u:num"),
                "display_number": child_text(element, "u:num"), "heading": child_text(element, "u:heading"),
                "source_status": element.get("status"), "hierarchy": hierarchy,
                "text": text, "text_sha256": digest(text.encode("utf-8")),
                "text_characters": len(text), "text_utf8_bytes": len(text.encode("utf-8")),
            })
        for child in element:
            visit(child, hierarchy)

    visit(root, [])
    all_section_count = sum(1 for _ in root.iter("{" + USLM + "}section"))
    statuses = dict(Counter(record["source_status"] or "not_marked" for record in records))
    require(len(records) == EXPECTED_COUNT, "Unexpected matching section count: " + str(len(records)))
    require(len({record["identifier"] for record in records}) == len(records), "Duplicate section identifiers")
    require(statuses == EXPECTED_STATUSES, "Unexpected status counts: " + str(statuses))
    checks = check_references(records)
    chunks, entries, offset = [], [], 0
    for record in records:
        line = json_bytes(record)
        entry = {key: value for key, value in record.items() if key != "text"}
        entry.update({"byte_offset": offset, "byte_length": len(line), "record_sha256": digest(line)})
        entries.append(entry)
        chunks.append(line)
        offset += len(line)
    sections_data = b"".join(chunks)
    sections_path = args.output_dir / "title26-sections.jsonl"
    index_path = args.output_dir / "title26-index.json"
    index_data = json_bytes({"schema_version": 1, "publication": publication,
                             "section_count": len(records), "sections_file": sections_path.name,
                             "sections_sha256": digest(sections_data), "entries": entries}, pretty=True)
    manifest = {
        "schema_version": 1, "title": "Title 26 — Internal Revenue Code",
        "verification_date": args.verified_on,
        "source": {"authority": "U.S. House of Representatives, Office of the Law Revision Counsel",
                   "download_url": SOURCE_URL, "archive_path": location(args.archive),
                   "archive_sha256": file_digest(args.archive), "archive_bytes": args.archive.stat().st_size,
                   "xml_member": "usc26.xml", "xml_sha256": digest(xml), "xml_bytes": len(xml),
                   "xml_namespace": USLM, "document_identifier": root.get("identifier"),
                   "publication": publication, "release_point": "119-103",
                   "xml_created_at": child_text(root, "u:meta/dct:created"),
                   "xml_created_at_timezone": "not specified by source",
                   "xml_publisher": child_text(root, "u:meta/dc:publisher"),
                   "xml_creator": child_text(root, "u:meta/dc:creator"),
                   "positive_law_title": child_text(root, "u:meta/u:property[@role='is-positive-law']")},
        "selection": {"element": "{" + USLM + "}section", "identifier_prefix": SECTION_PREFIX,
                      "all_xml_section_elements": all_section_count, "indexed_section_elements": len(records),
                      "excluded_section_elements": all_section_count - len(records),
                      "unique_identifiers": len(records), "source_status_counts": statuses,
                      "status_interpretation": "not_marked means no XML status attribute, not a finding that the section is currently effective; repealed, renumbered, reserved and omitted entries are retained"},
        "extraction": {"format": "UTF-8 JSONL, one record per matching section, XML document order",
                       "text_scope": "All descendant text nodes, including statutory text, source credits, editorial notes, amendment history and effective-date notes",
                       "normalization": "Separate block elements with newlines; preserve inline text; normalize whitespace within each nonempty line; retain Unicode characters",
                       "metadata_index": "JSON entries contain byte offsets and lengths into the JSONL file plus text and record SHA-256 hashes"},
        "generator": {"script": location(Path(__file__)), "script_sha256": file_digest(Path(__file__)),
                      "dependencies": "Python 3.9+ standard library; no network access",
                      "rebuild_command": "python3 scripts/index-tax-code.py build --verified-on " + args.verified_on},
        "outputs": {"sections": {"path": location(sections_path), "sha256": digest(sections_data), "bytes": len(sections_data)},
                    "index": {"path": location(index_path), "sha256": digest(index_data), "bytes": len(index_data)}},
        "validation": {"expected_section_count": EXPECTED_COUNT, "section_count_passed": True,
                       "unique_identifiers_passed": True, "status_counts_passed": True, "reference_sections": checks},
        "coverage": {"review_status": "Machine-indexed corpus; not exhaustively reviewed",
                     "reviewed_section_count": None,
                     "limitations": ["Index completeness means only the documented XML selection was extracted; it does not certify tax-law completeness or correctness.",
                                     "A current compilation is not a historical tax-year snapshot; amendments may have future or transitional effective dates.",
                                     "Statutory base dollar amounts may require IRS annual inflation adjustments; the index does not infer 2026 or 2027 amounts.",
                                     "Treasury regulations, IRS revenue procedures, rulings, forms, instructions, case law and state law are outside this archive.",
                                     "Source metadata marks this as a non-positive-law U.S. Code title; check enacted law and effective dates where necessary."]},
    }
    write_atomic(sections_path, sections_data)
    write_atomic(index_path, index_data)
    write_atomic(args.manifest, json_bytes(manifest, pretty=True))
    print(json.dumps({"indexed_sections": len(records), "source_status_counts": statuses,
                      "manifest": location(args.manifest), "sections_sha256": digest(sections_data)}, sort_keys=True))


def load_index(output_dir):
    with (output_dir / "title26-index.json").open(encoding="utf-8") as handle:
        index = json.load(handle)
    require(index.get("schema_version") == 1, "Unsupported index schema")
    require(index.get("sections_file") == "title26-sections.jsonl", "Unexpected indexed corpus filename")
    return index


def read_record(handle, entry):
    handle.seek(entry["byte_offset"])
    data = handle.read(entry["byte_length"])
    require(digest(data) == entry["record_sha256"], "Corpus/index mismatch for " + entry["identifier"])
    record = json.loads(data)
    require(record["identifier"] == entry["identifier"], "Mismatched section identifier")
    require(digest(record["text"].encode("utf-8")) == record["text_sha256"], "Text hash mismatch")
    return record


def lookup(args):
    index = load_index(args.output_dir)
    by_number = {entry["section_number"].casefold(): entry for entry in index["entries"]}
    selected = []
    for value in args.sections:
        number = value.removeprefix(SECTION_PREFIX).strip().lstrip("§").strip().rstrip(".")
        entry = by_number.get(number.casefold())
        require(entry is not None, "No indexed section: " + value)
        selected.append(entry)
    with (args.output_dir / index["sections_file"]).open("rb") as handle:
        for entry in selected:
            record = read_record(handle, entry)
            print(json.dumps(record, ensure_ascii=False, sort_keys=True) if args.json else record["text"] + "\n")


def search(args):
    index = load_index(args.output_dir)
    query = " ".join(args.query.casefold().split())
    require(bool(query), "Search query must not be empty")
    matches = 0
    with (args.output_dir / index["sections_file"]).open("rb") as handle:
        for entry in index["entries"]:
            record = read_record(handle, entry)
            text = " ".join(record["text"].split())
            position = text.casefold().find(query)
            if position < 0:
                continue
            result = {"identifier": record["identifier"], "section_number": record["section_number"],
                      "heading": record["heading"], "source_status": record["source_status"],
                      "excerpt": text[max(0, position - 100):position + len(query) + 200]}
            print(json.dumps(result, ensure_ascii=False, sort_keys=True))
            matches += 1
            if matches >= args.limit:
                break
    print("Matches returned: " + str(matches) + " (literal phrase, case-insensitive; includes notes)", file=sys.stderr)


def validate(args):
    with args.manifest.open(encoding="utf-8") as handle:
        manifest = json.load(handle)
    require(file_digest(args.archive) == manifest["source"]["archive_sha256"], "Archive hash differs from manifest")
    require(file_digest(Path(__file__)) == manifest["generator"]["script_sha256"], "Generator hash differs; rebuild manifest")
    with zipfile.ZipFile(args.archive) as archive:
        require(digest(archive.read("usc26.xml")) == manifest["source"]["xml_sha256"], "XML hash differs from manifest")
    for kind, filename in [("sections", "title26-sections.jsonl"), ("index", "title26-index.json")]:
        path = args.output_dir / filename
        require(path.stat().st_size == manifest["outputs"][kind]["bytes"], kind + " size mismatch")
        require(file_digest(path) == manifest["outputs"][kind]["sha256"], kind + " hash mismatch")
    index = load_index(args.output_dir)
    require(index["sections_sha256"] == manifest["outputs"]["sections"]["sha256"], "Index corpus hash mismatch")
    require(index["section_count"] == EXPECTED_COUNT == len(index["entries"]), "Section count mismatch")
    records, offset = [], 0
    with (args.output_dir / index["sections_file"]).open("rb") as handle:
        for ordinal, entry in enumerate(index["entries"], 1):
            require(entry["ordinal"] == ordinal and entry["byte_offset"] == offset, "Noncontiguous index")
            records.append(read_record(handle, entry))
            offset += entry["byte_length"]
        require(offset == handle.seek(0, os.SEEK_END), "Unindexed trailing data")
    require(len({r["identifier"] for r in records}) == EXPECTED_COUNT, "Duplicate identifiers")
    require(dict(Counter(r["source_status"] or "not_marked" for r in records)) == EXPECTED_STATUSES, "Status counts mismatch")
    check_references(records)
    print(json.dumps({"valid": True, "indexed_sections": len(records), "reference_sections": list(REFERENCE_CHECKS),
                      "checks": "archive/XML/output/generator hashes; offsets; record/text hashes; counts; statuses; reference text"}, sort_keys=True))


def positive_limit(value):
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("limit must be at least 1")
    return number


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command, action in [("build", build), ("lookup", lookup), ("search", search), ("validate", validate)]:
        sub = subparsers.add_parser(command)
        sub.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
        sub.set_defaults(action=action)
        if command in {"build", "validate"}:
            sub.add_argument("--archive", type=Path, default=ARCHIVE)
            sub.add_argument("--manifest", type=Path, default=MANIFEST)
        if command == "build":
            sub.add_argument("--verified-on", required=True, help="Explicit ISO date of local corpus verification (YYYY-MM-DD)")
        elif command == "lookup":
            sub.add_argument("sections", nargs="+", help="Section numbers, e.g. 162 179 280F, or full identifiers")
            sub.add_argument("--json", action="store_true", help="Print full JSONL records")
        elif command == "search":
            sub.add_argument("query", help="Literal phrase; case-insensitive and whitespace-normalized")
            sub.add_argument("--limit", type=positive_limit, default=10)
    args = parser.parse_args()
    try:
        args.action(args)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, ET.ParseError) as error:
        print("Error: " + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
