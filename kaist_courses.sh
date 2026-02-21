#!/usr/bin/env bash
set -euo pipefail

YEAR="${1:-2026}"
SEMESTER="${2:-1}"
LANG="${3:-ko}" # en or ko

if [[ "$SEMESTER" != "1" && "$SEMESTER" != "2" && "$SEMESTER" != "3" && "$SEMESTER" != "4" ]]; then
  echo "SEMESTER must be 1, 2, 3, or 4" >&2
  exit 1
fi

if [[ "$LANG" != "en" && "$LANG" != "ko" ]]; then
  echo "LANG must be 'en' or 'ko'" >&2
  exit 1
fi

curl -s 'https://erp.kaist.ac.kr/sch/sles/SlesseCtr/findAllEstblSubjtList.do' \
  -X POST \
  -H 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8' \
  -H "Cookie: locale=${LANG}" \
  --data-raw "_pgmId=NzU0MzkyMTUwMjY%3D&%40d1%23syy=${YEAR}&%40d1%23smtDivCd=${SEMESTER}&%40d%23=%40d1%23&%40d1%23=dmCond&%40d1%23tp=dm&" | jq '.dsSles205'
