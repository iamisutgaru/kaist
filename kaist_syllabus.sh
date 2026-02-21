#!/usr/bin/env bash
set -euo pipefail

DOWNLOAD_ATTACHMENTS=0
DOWNLOAD_DIR="./downloads"
POSITIONAL_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --download-attachments)
      DOWNLOAD_ATTACHMENTS=1
      shift
      ;;
    --download-dir)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        echo "--download-dir requires a path argument" >&2
        exit 1
      fi
      DOWNLOAD_ATTACHMENTS=1
      DOWNLOAD_DIR="$2"
      shift 2
      ;;
    --)
      shift
      while [[ $# -gt 0 ]]; do
        POSITIONAL_ARGS+=("$1")
        shift
      done
      ;;
    -*)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 YEAR TERM_CODE SUBJT_CD [CORSE_DVCLS_NO] [LANG] [--download-attachments] [--download-dir DIR]" >&2
      exit 1
      ;;
    *)
      POSITIONAL_ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ "${#POSITIONAL_ARGS[@]}" -gt 5 ]]; then
  echo "Too many positional arguments." >&2
  echo "Usage: $0 YEAR TERM_CODE SUBJT_CD [CORSE_DVCLS_NO] [LANG] [--download-attachments] [--download-dir DIR]" >&2
  exit 1
fi

YEAR="${POSITIONAL_ARGS[0]:-2026}"
TERM_CODE="${POSITIONAL_ARGS[1]:-1}" # 1=Spring, 2=Summer, 3=Autumn, 4=Winter
SUBJT_CD="${POSITIONAL_ARGS[2]:-}"
CORSE_DVCLS_NO="${POSITIONAL_ARGS[3]:-}"
LANG="${POSITIONAL_ARGS[4]:-ko}" # en or ko

if [[ -z "$SUBJT_CD" ]]; then
  echo "Usage: $0 YEAR TERM_CODE SUBJT_CD [CORSE_DVCLS_NO] [LANG] [--download-attachments] [--download-dir DIR]" >&2
  echo "Example: $0 2026 1 CD.40001 '  ' ko --download-attachments --download-dir ./downloads" >&2
  exit 1
fi

if [[ "$TERM_CODE" != "1" && "$TERM_CODE" != "2" && "$TERM_CODE" != "3" && "$TERM_CODE" != "4" ]]; then
  echo "TERM_CODE must be 1, 2, 3, or 4" >&2
  exit 1
fi

if [[ "$LANG" != "en" && "$LANG" != "ko" ]]; then
  echo "LANG must be 'en' or 'ko'" >&2
  exit 1
fi

urlenc() {
  jq -nr --arg v "$1" '$v|@uri'
}

encode_stream_param() {
  local input="$1"
  local curr="$2"
  node - "$input" "$curr" <<'NODE'
const crypto = require("crypto");
const input = process.argv[2];
const curr = process.argv[3];
const end = Number(curr) + 300000;
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

let plaintext = `${curr}^[this]^${b64(encodeURIComponent(String(input)))}^[this]^${end}`;
const padLen = 16 - (plaintext.length % 16);
plaintext += String.fromCharCode(padLen).repeat(padLen);

const key = Buffer.from("4146c7a57e6fe00b21712fea8f7ad79a", "hex");
const iv = Buffer.from("805be631a3b0420d6f106fcdfd54ec1b", "hex");
const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
cipher.setAutoPadding(false);
const out = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
process.stdout.write(out.toString("base64"));
NODE
}

ensure_unique_path() {
  local target="$1"
  if [[ ! -e "$target" ]]; then
    echo "$target"
    return
  fi

  local dir base ext name n
  dir="$(dirname "$target")"
  base="$(basename "$target")"
  ext=""
  name="$base"

  if [[ "$base" == *.* ]]; then
    ext=".${base##*.}"
    name="${base%.*}"
  fi

  n=1
  while [[ -e "${dir}/${name}(${n})${ext}" ]]; do
    n=$((n + 1))
  done
  echo "${dir}/${name}(${n})${ext}"
}

API_BASE="https://erp.kaist.ac.kr/sch/sles/SlesseCtr"
FILE_API_BASE="https://erp.kaist.ac.kr/com/cmsv/FileCtr"
PGM_ID="NzU0MzkyMTUwMjY%3D"

LIST_PAYLOAD="_pgmId=${PGM_ID}&%40d1%23syy=$(urlenc "$YEAR")&%40d1%23smtDivCd=$(urlenc "$TERM_CODE")&%40d1%23subjtCd=$(urlenc "$SUBJT_CD")&%40d%23=%40d1%23&%40d1%23=dmCond&%40d1%23tp=dm&"

COURSE_LIST_JSON="$(curl -s "${API_BASE}/findAllEstblSubjtList.do" \
  -X POST \
  -H 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8' \
  -H "Cookie: locale=${LANG}" \
  --data-raw "$LIST_PAYLOAD")"

if [[ -n "$CORSE_DVCLS_NO" ]]; then
  COURSE_ROW="$(echo "$COURSE_LIST_JSON" | jq -cer --arg subjt "$SUBJT_CD" --arg corse "$CORSE_DVCLS_NO" '
    (.dsSles205 // [])
    | map(select(.subjtCd == $subjt and .corseDvclsNo == $corse))
    | .[0]
  ')" || {
    echo "No course found for SUBJT_CD=${SUBJT_CD}, CORSE_DVCLS_NO='${CORSE_DVCLS_NO}'" >&2
    exit 1
  }
else
  MATCH_COUNT="$(echo "$COURSE_LIST_JSON" | jq -r --arg subjt "$SUBJT_CD" '
    (.dsSles205 // [])
    | map(select(.subjtCd == $subjt))
    | length
  ')"

  if [[ "$MATCH_COUNT" -eq 0 ]]; then
    echo "No course found for SUBJT_CD=${SUBJT_CD}" >&2
    exit 1
  fi

  if [[ "$MATCH_COUNT" -gt 1 ]]; then
    echo "Multiple sections found for SUBJT_CD=${SUBJT_CD}. Pass CORSE_DVCLS_NO exactly as shown below." >&2
    echo "$COURSE_LIST_JSON" | jq -r --arg subjt "$SUBJT_CD" '
      (.dsSles205 // [])
      | map(select(.subjtCd == $subjt))
      | .[]
      | "corseDvclsNo=[" + .corseDvclsNo + "] deprtCd=" + .deprtCd + " subjtNm=" + .subjtNm
    ' >&2
    exit 1
  fi

  COURSE_ROW="$(echo "$COURSE_LIST_JSON" | jq -cer --arg subjt "$SUBJT_CD" '
    (.dsSles205 // [])
    | map(select(.subjtCd == $subjt))
    | .[0]
  ')"
fi

DEPRT_CD="$(echo "$COURSE_ROW" | jq -r '.deprtCd')"
RESOLVED_CORSE_DVCLS_NO="$(echo "$COURSE_ROW" | jq -r '.corseDvclsNo')"

DETAIL_PAYLOAD="_pgmId=${PGM_ID}&%40d1%23syy=$(urlenc "$YEAR")&%40d1%23smtDivCd=$(urlenc "$TERM_CODE")&%40d1%23deprtCd=$(urlenc "$DEPRT_CD")&%40d1%23subjtCd=$(urlenc "$SUBJT_CD")&%40d1%23corseDvclsNo=$(urlenc "$RESOLVED_CORSE_DVCLS_NO")&%40d%23=%40d1%23&%40d1%23=dmCond&%40d1%23tp=dm&"

SYLLABUS_JSON="$(curl -s "${API_BASE}/findLctreAtplDetlOne.do" \
  -X POST \
  -H 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8' \
  -H "Cookie: locale=${LANG}" \
  --data-raw "$DETAIL_PAYLOAD")"

PROF_JSON="$(curl -s "${API_BASE}/findLctreAtplDetlProfList.do" \
  -X POST \
  -H 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8' \
  -H "Cookie: locale=${LANG}" \
  --data-raw "$DETAIL_PAYLOAD")"

TIMETABLE_JSON="$(curl -s "${API_BASE}/findLctreAtplDetlTimtbList.do" \
  -X POST \
  -H 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8' \
  -H "Cookie: locale=${LANG}" \
  --data-raw "$DETAIL_PAYLOAD")"

ATTFL_UUID="$(echo "$SYLLABUS_JSON" | jq -r '.dsSles300[0].attflUuid // ""')"
ATTACHMENT_JSON='{"dsCsys401":[]}'
if [[ -n "$ATTFL_UUID" ]]; then
  ATTACHMENT_PAYLOAD="_pgmId=${PGM_ID}&attflUuid=$(urlenc "$ATTFL_UUID")&type=all&table=SCH.SLES300"
  ATTACHMENT_JSON="$(curl -s "${FILE_API_BASE}/findFileDetailList.do" \
    -X POST \
    -H 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8' \
    -H "Cookie: locale=${LANG}" \
    --data-raw "$ATTACHMENT_PAYLOAD")"
fi

DOWNLOADS_JSON='[]'
if [[ "$DOWNLOAD_ATTACHMENTS" -eq 1 ]]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "node is required for --download-attachments" >&2
    exit 1
  fi

  mkdir -p "$DOWNLOAD_DIR"
  CURR_MILLIS="$(curl -s "https://erp.kaist.ac.kr/com/cnst/PropCtr/findCurrTimeMillis.do" \
    -X POST \
    -H 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8' | jq -r '._METADATA_.curr')"

  while IFS=$'\t' read -r ATT_UUID ATT_SEQ FILE_NM; do
    [[ -z "$ATT_UUID" ]] && continue
    [[ -z "$ATT_SEQ" ]] && continue

    ENC_UUID="$(encode_stream_param "$ATT_UUID" "$CURR_MILLIS")"
    ENC_SEQ="$(encode_stream_param "$ATT_SEQ" "$CURR_MILLIS")"
    SAFE_FILE_NM="${FILE_NM//\//_}"
    SAFE_FILE_NM="${SAFE_FILE_NM//\\/_}"
    OUT_PATH="$(ensure_unique_path "${DOWNLOAD_DIR}/${SAFE_FILE_NM}")"
    HDR_PATH="$(mktemp)"

    curl -s -D "$HDR_PATH" -o "$OUT_PATH" "${FILE_API_BASE}/fileDefaultDownload.do" \
      -X POST \
      -H 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8' \
      --data-raw "_pgmId=${PGM_ID}&attflUuid=$(urlenc "$ENC_UUID")&attflSeqno=$(urlenc "$ENC_SEQ")"

    CONTENT_TYPE="$(awk -F': *' 'tolower($1)=="content-type"{print tolower($2)}' "$HDR_PATH" | tr -d '\r')"
    rm -f "$HDR_PATH"

    if [[ "$CONTENT_TYPE" == text/html* ]]; then
      rm -f "$OUT_PATH"
      DOWNLOADS_JSON="$(echo "$DOWNLOADS_JSON" | jq -c \
        --arg attflUuid "$ATT_UUID" \
        --arg attflSeqno "$ATT_SEQ" \
        --arg fileNm "$FILE_NM" \
        '. + [{attflUuid:$attflUuid, attflSeqno:$attflSeqno, fileNm:$fileNm, status:"failed", reason:"unexpected HTML response"}]')"
    else
      DOWNLOADS_JSON="$(echo "$DOWNLOADS_JSON" | jq -c \
        --arg attflUuid "$ATT_UUID" \
        --arg attflSeqno "$ATT_SEQ" \
        --arg fileNm "$FILE_NM" \
        --arg savedPath "$OUT_PATH" \
        '. + [{attflUuid:$attflUuid, attflSeqno:$attflSeqno, fileNm:$fileNm, status:"downloaded", savedPath:$savedPath}]')"
    fi
  done < <(echo "$ATTACHMENT_JSON" | jq -r '.dsCsys401[]? | [.attflUuid, (.attflSeqno|tostring), .fileNm] | @tsv')
fi

jq -n \
  --arg year "$YEAR" \
  --arg termCode "$TERM_CODE" \
  --arg subjtCd "$SUBJT_CD" \
  --arg corseDvclsNo "$RESOLVED_CORSE_DVCLS_NO" \
  --arg lang "$LANG" \
  --argjson course "$COURSE_ROW" \
  --argjson syllabus "$SYLLABUS_JSON" \
  --argjson prof "$PROF_JSON" \
  --argjson timetable "$TIMETABLE_JSON" \
  --argjson attachment "$ATTACHMENT_JSON" \
  --argjson downloads "$DOWNLOADS_JSON" \
  --argjson downloadRequested "$DOWNLOAD_ATTACHMENTS" \
  '{
    request: {
      year: $year,
      termCode: $termCode,
      subjtCd: $subjtCd,
      corseDvclsNo: $corseDvclsNo,
      lang: $lang,
      downloadAttachments: ($downloadRequested == 1)
    },
    course: $course,
    syllabus: ($syllabus.dsSles300[0] // null),
    syllabusMeta: ($syllabus._METADATA_.infos // null),
    attachments: ($attachment.dsCsys401 // []),
    downloads: $downloads,
    professors: ($prof.dsSles220 // []),
    timetable: ($timetable.dsSles240 // [])
  }'
