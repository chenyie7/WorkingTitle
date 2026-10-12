#!/usr/bin/env bash
#
# 生成 GitHub Release 的正文：把「上一个 release 之后合并进主干的 PR」按标签分组，
# **只印分类标题、PR 标题与编号**。
#
# 【为什么不用 GitHub 的 generate_release_notes】它的格式是写死的三样：
#   - 顶部固定一行  `## What's Changed`
#   - 每行固定      `* <标题> by @<作者> in <链接>`
#   - 末尾固定      `**Full Changelog**: <compare 链接>`
# 而 `.github/release.yml` 只配得了「分类标题 ↔ 标签映射」和「哪些标签不进说明」，
# **没有任何格式化开关**。所以要少掉那三样，只能自己生成。
#
# 【用法】
#   scripts/release-notes.sh            # 标签从 $GITHUB_REF_NAME 取（CI 里自动有）
#   scripts/release-notes.sh v0.2.0     # 本地手动指定
# 输出走 stdout，直接喂给 `gh release edit --notes-file` 或 workflow 里的 body_path。
#
# 【依赖】`gh`（已登录，或设了 GH_TOKEN）。不用另装 jq —— gh 自带 --jq。
#
# 【本脚本刻意避开的一个 bash 3.2 坑】带**引号模式**的 `case`（`case x in *"a"*)`）
# 一旦**写在 `$( ... )` 命令替换里**，bash 3.2 的解析器会把 `;;` 拆错、整段报
# syntax error。macOS 自带的就是 bash 3.2，所以本机跑得通、CI（bash 5）也跑得通。
# 因此：`case` 只出现在函数体里、通过 `$(函数名 ...)` 调用；循环的输入输出一律走临时文件。
set -euo pipefail

BRANCH="${BRANCH:-main}"
TAG="${1:-${GITHUB_REF_NAME:-}}"

# 分类映射：`分类标题|能进这一类的标签`（标签之间用空格分隔）。
#
# 【为什么写在这儿、而不是去读 .github/release.yml】那份配置只对 GitHub 自己的生成器
# 生效，而我们已经不用它了。让它当第二个真相来源，只会两边各自漂。改用本脚本之后，
# 那个文件只剩「万一改回 generate_release_notes」这一个用途（已在它里面注明）。
#
# 【顺序有意义】一条 PR 只归入**第一个**命中的分类，与 GitHub 的匹配方式一致。
CATEGORIES=(
  "新功能|feat"
  "修复|fix"
  "文档|docs"
  "内部改动|chore style refactor"
)
FALLBACK_TITLE="其它改动"
# 带这些标签的 PR 不进说明。
EXCLUDE_LABELS="skip-changelog"

# 一条 PR 归到哪个分类；输出分类标题，一个都没命中就输出兜底那个。
category_of() {
  local labels="$1" cat title clabels l
  for cat in "${CATEGORIES[@]}"; do
    title="${cat%%|*}"
    clabels="${cat#*|}"
    for l in $clabels; do
      case ",$labels," in *",$l,"*) printf '%s' "$title"; return ;; esac
    done
  done
  printf '%s' "$FALLBACK_TITLE"
}

# 这条 PR 带没带排除标签。
has_excluded_label() {
  local labels="$1" x
  for x in $EXCLUDE_LABELS; do
    case ",$labels," in *",$x,"*) return 0 ;; esac
  done
  return 1
}

# 上一个 release 的发布时间，当「这次范围」的下界。
#
# 【为什么用发布时间、而不是标签指向那个提交的时间】后者要绕两次 API（ref → commit），
# 而两者通常只差几分钟。代价是「标签打出去之后、release 建出来之前」这几分钟里合并的
# PR 会被漏掉——对本仓库的发版节奏（CI 建完就发）可以接受。
# 排除 $TAG 自己：重复跑同一次发版时，要拿的是它**前面**那一个。
prev_at="$(gh release list --limit 40 --json tagName,publishedAt \
  --jq "[.[] | select(.tagName != \"$TAG\")][0].publishedAt // empty")"

# 【第二道闸】下面会把这个值**插进 jq 表达式**，所以先确认它长得像 ISO 时间戳。
# 它来自 GitHub、不是外部输入，这行是防意外（比如 gh 的输出格式变了）把表达式搞坏。
case "$prev_at" in
  [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*) ;;
  *) prev_at="" ;;
esac

# 把 PR 清单拉成 TSV：编号 \t 标签(逗号分隔) \t 标题。
#
# 【为什么不带 --arg】`gh pr list --jq` 没有 `--arg`（那是 `gh api --jq` 才有的），
# 所以时间戳只能拼进表达式里 —— 上面那道格式校验就是为它准备的。
fetch_prs() {
  local select_expr='.'
  if [ -n "$prev_at" ]; then
    select_expr="select(.mergedAt > \"$prev_at\")"
  fi
  gh pr list --state merged --base "$BRANCH" --limit 300 \
    --json number,title,labels,mergedAt \
    --jq ".[] | $select_expr | \"\\(.number)\t\\([.labels[].name]|join(\",\"))\t\\(.title)\""
}

raw="$(mktemp)"
kept="$(mktemp)"
trap 'rm -f "$raw" "$kept"' EXIT

# sort -rn 让编号大的在前（新的在上），与 GitHub 的排法一致。
fetch_prs | sort -rn > "$raw"

# 先把带排除标签的滤掉，省得后面每个分类都判一遍。
while IFS=$'\t' read -r num labels title; do
  if [ -z "$num" ]; then continue; fi
  if has_excluded_label "$labels"; then continue; fi
  printf '%s\t%s\t%s\n' "$num" "$labels" "$title"
done < "$raw" > "$kept"

# 按分类顺序输出；空分类整段不输出（GitHub 也是这个规矩）。
emit_category() {
  local wanted="$1" lines="" num labels title
  while IFS=$'\t' read -r num labels title; do
    if [ -z "$num" ]; then continue; fi
    if [ "$(category_of "$labels")" != "$wanted" ]; then continue; fi
    lines="${lines}* ${title} (#${num})"$'\n'
  done < "$kept"
  if [ -n "$lines" ]; then printf '## %s\n%s\n' "$wanted" "$lines"; fi
}

for cat in "${CATEGORIES[@]}"; do
  emit_category "${cat%%|*}"
done
emit_category "$FALLBACK_TITLE"
