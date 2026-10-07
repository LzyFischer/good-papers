# Good Papers

论文版"烂番茄"：每篇论文由三桌打分，读者（登录用户）、AI 评审团（Jev 驱动的五个人格）、会议审稿人；首页总分把三桌合并，所以新论文一上线就有分数。

## 第一阶段已实现
- 二元打分（Worth reading / Not for me），醒目的大按钮，点击即投票，再点一次撤销
- 三桌分开显示 + 合并总分
- AI warm start：每天自动抓取最新 AI 论文并由 Jev 打分；有人打开一篇没评过的论文时也会当场打分
- 按板块筛选（Jev 自动分类研究领域和论文类型）
- 机构标签：工业界和顶尖学校分别着色（列表在 `lib/orgs.ts`）
- 热评榜：AI 人格的一句话金句
- 个人阅读记录和私人笔记（`/me`）

## Jev 是怎么接入的
Jev（TypeSafe AI 的 System One 模型）只返回带概率的结构化判断，**不会写文字**。所以：

- **打分**由 Jev 完成：每个人格是一个 `noul`（是/否）问题，yes 概率 ≥ 0.5 记为 Fresh。另外两个 `choice` 问题给论文分板块和类型。七个问题在**一次请求**里并行完成。
- **金句**由 Claude 写（可选）：拿到 Jev 的判断后，让 LLM 用每个人格的口吻写一句理由。不配置 `ANTHROPIC_API_KEY` 也能运行，AI 面板只显示概率。

人格定义全部在 `lib/personas.ts`。Jev 按字面理解问题，不会"扮演角色"，所以每个人格被写成"这个审稿人会检查的具体条件"。想调整人格就改这里的文字。

想换 Jev 兼容的其他端点（例如 Cloudflare 的 Clef），设置 `JEV_BASE_URL` 即可。

## 从 v1 升级（之前本地跑过 Referee）
1. 在 Supabase **SQL Editor** 运行 `supabase/migrations/002_rotten_paper.sql`（全新项目则运行 `supabase/schema.sql`）。
2. 在 `.env.local` 里补充新变量（对照 `.env.example`）：
   - `SUPABASE_SERVICE_ROLE_KEY`：Supabase → Project Settings → API 里的 service_role（或 secret）key。**只能放服务器端，不能加 `NEXT_PUBLIC_` 前缀，不能提交到 GitHub。**
   - `TYPESAFE_API_KEY`：在 console.typesafe.ai 申请。如果 TypeSafe 暂停注册，可以走 Vercel AI Gateway，但那条路的接口格式不同，需要改 `lib/jev.ts`。
   - `ANTHROPIC_API_KEY`（可选）：在 console.anthropic.com 申请。
   - `CRON_SECRET`：一串长随机字符，例如终端运行 `openssl rand -hex 32`。
3. `npm install`，然后 `npm run dev`。

## 给你自己的论文打分
`scripts/my-papers.json` 里放了你的六篇论文。REdit 和 MolEdit 用的是公开摘要；另外四篇只有简短描述，**换成真实摘要后 AI 评审会更准**。

```bash
npm run judge -- scripts/my-papers.json
```
终端会打印每篇论文每个人格的判断和概率，刷新首页就能看到。

如果想填入审稿分数（例如 OpenReview），在对应论文里加：
```json
"reviewers": { "fresh": 2, "total": 3, "note": "final reviews" }
```

## 部署到 Vercel

### 1. 把代码推到 GitHub
```bash
cd good-papers
git init
git add .
git commit -m "Good Papers v2"
```
在 github.com 新建一个仓库（可以设为 Private），然后：
```bash
git remote add origin https://github.com/<你的用户名>/good-papers.git
git branch -M main
git push -u origin main
```
`.env.local` 已在 `.gitignore` 里，不会被上传。推送前用 `git status` 确认它不在列表中。

### 2. 在 Vercel 导入
1. 用 GitHub 账号登录 vercel.com → **Add New → Project** → 选择 `good-papers` 仓库 → Import。
2. Framework 会自动识别为 Next.js，其他保持默认。
3. 展开 **Environment Variables**，把 `.env.local` 里的变量逐个填进去。
4. 点 **Deploy**，一两分钟后得到 `https://good-papers-xxx.vercel.app`。

### 3. 更新登录回调
- Supabase → **Authentication → URL Configuration**：Site URL 改为 Vercel 地址，Redirect URLs 加上 `https://你的地址.vercel.app/**`。
- GitHub OAuth App：Homepage URL 改为 Vercel 地址。Callback URL 是 Supabase 的地址，**不用改**。

### 4. 验证
- 搜索一篇论文并点开，几秒内应出现 AI 面板。
- 登录后点 ▲ / ▼，分数应变化。
- 手动触发一次每日任务：
  ```bash
  curl https://你的地址.vercel.app/api/cron -H "Authorization: Bearer 你的CRON_SECRET"
  ```

### 5. 之后的更新
改完代码 `git push`，Vercel 自动重新部署。修改环境变量后要在 Deployments 页面点 **Redeploy** 才生效。

### 每日任务
`vercel.json` 让 Vercel 每天 13:00 UTC 运行 `/api/cron`：抓最近三天的 arXiv AI 论文，最多打 `CRON_MAX_PAPERS` 篇，并补写缺失的金句。抓取范围见 `lib/openalex.ts` 的 `NEWEST_FILTER`，可用环境变量 `OPENALEX_NEWEST_FILTER` 覆盖。

## 项目结构
```
app/page.tsx              首页：最新论文、板块筛选、热评榜
app/paper/[id]/page.tsx   论文页：卡片、AI 面板、笔记、摘要（首次访问自动打分）
app/search/page.tsx       搜索（OpenAlex）
app/me/page.tsx           我的阅读记录
app/api/cron/route.ts     每日抓取 + 打分
app/api/judge/route.ts    手动指定论文打分
components/PaperCard.tsx  论文卡片（三桌 + 投票 + AI 面板）
components/Icons.tsx      原创图标
lib/jev.ts                Jev 客户端
lib/personas.ts           五个 AI 人格（改这里调整评审风格）
lib/judge.ts              一次请求完成全部判断
lib/takes.ts              金句生成（Claude）
supabase/                 数据库结构和升级脚本
scripts/                  给指定论文批量打分
```
