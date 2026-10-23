Vehicle loan interest split proof.

Correction run. An answer of no leaves Schedule 1-A at 0 with no needs more information entry. A missing answer is the only expected-use case that files one. The business share still goes on Schedule C line 16b. A 2025 return applies the same test.

Code under test: 006e42bee25e77e2dbbf02c6bf0ea59adc75986a
Every log in this run begins and ends with that SHA.
Revert source restored from: 52f5788d36114cb3a9e611dd2f551672b80edb9c
Test files stayed at the code under test during the revert runs.

Head suite, TZ=America/Los_Angeles:
Test Files  244 passed | 6 skipped (250)
Tests  6185 passed | 49 skipped (6234)
EXIT:0

Head suite, TZ=Asia/Tokyo:
Test Files  2 failed | 242 passed | 6 skipped (250)
Tests  2 failed | 6183 passed | 49 skipped (6234)
EXIT:1
The two Tokyo failures are tests/document-image-consent.test.tsx and tests/receipt-ocr-date.test.ts. They already fail at the base commit in that time zone.

Revert suite, source at 52f5788d, same tests, TZ=America/Los_Angeles:
Test Files  4 failed | 240 passed | 6 skipped (250)
Tests  21 failed | 6164 passed | 49 skipped (6234)
EXIT:1

Revert suite, source at 52f5788d, same tests, TZ=Asia/Tokyo:
Test Files  6 failed | 238 passed | 6 skipped (250)
Tests  23 failed | 6162 passed | 49 skipped (6234)
EXIT:1
Tokyo adds the same two baseline failures. The other 21 match Los Angeles.

Revert failures are assertions. The logs contain no TypeError, missing module, or import error.

Earlier proof, before this correction:

Code under test: 52919ef2d3303bb1d736a27ac22be85becfa8457
Revert source restored from: 52f5788d36114cb3a9e611dd2f551672b80edb9c
Test files stayed at the code under test during the revert runs.
Base tip fetched for the merge check: 52f5788d36114cb3a9e611dd2f551672b80edb9c
Merge of this branch onto that tip with --no-ff --no-commit completed cleanly and was aborted. The feature branch was not rebased.

Head suite, TZ=America/Los_Angeles:
Test Files  244 passed | 6 skipped (250)
Tests  6183 passed | 49 skipped (6232)
EXIT:0

Head suite, TZ=Asia/Tokyo:
Test Files  2 failed | 242 passed | 6 skipped (250)
Tests  2 failed | 6181 passed | 49 skipped (6232)
EXIT:1
The two Tokyo failures are tests/document-image-consent.test.tsx and tests/receipt-ocr-date.test.ts. They already fail at the base commit in that time zone.

Revert suite, source at 52f5788d, same tests, TZ=America/Los_Angeles:
Test Files  4 failed | 240 passed | 6 skipped (250)
Tests  19 failed | 6164 passed | 49 skipped (6232)
EXIT:1

Revert suite, source at 52f5788d, same tests, TZ=Asia/Tokyo:
Test Files  6 failed | 238 passed | 6 skipped (250)
Tests  21 failed | 6162 passed | 49 skipped (6232)
EXIT:1
Tokyo adds the same two baseline failures. The other 19 failures match Los Angeles.

Revert failures are assertions. The logs contain no TypeError, missing module, or import error. Examples: expected true to be false, expected 422 to be 200, expected 100000 to be 99760, expected '9' to be null.
