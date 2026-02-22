#!/usr/bin/env bash
set -euo pipefail

YEAR="${1:-2026}"
TERM_CODE="${2:-1}" # 1=Spring, 2=Summer, 3=Autumn, 4=Winter
LANG="${3:-ko}" # en or ko

if [[ "$TERM_CODE" != "1" && "$TERM_CODE" != "2" && "$TERM_CODE" != "3" && "$TERM_CODE" != "4" ]]; then
  echo "TERM_CODE must be 1, 2, 3, or 4" >&2
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
  --data-raw "_pgmId=NzU0MzkyMTUwMjY%3D&%40d1%23syy=${YEAR}&%40d1%23smtDivCd=${TERM_CODE}&%40d%23=%40d1%23&%40d1%23=dmCond&%40d1%23tp=dm&" | jq '.dsSles205'
