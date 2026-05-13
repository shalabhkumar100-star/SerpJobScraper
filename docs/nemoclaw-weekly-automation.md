# NemoClaw Weekly Automation

NemoClaw should be the weekly controller. This Vercel project exposes small, idempotent endpoints that NemoClaw can call safely without triggering a long single request.

## Weekly Flow

1. Call the plan endpoint:

```text
GET /api/nemoclaw/weekly-plan?source=both
```

2. For each returned `slices[].path`, call the slice endpoint with the same authorization header:

```text
GET /api/jobs/run-slice?source=serp&limit=1&offset=0&runKey=weekly-run-YYYY-Www
GET /api/jobs/run-slice?source=apify&limit=1&offset=0&runKey=weekly-run-YYYY-Www
```

3. Retry failed slices up to 2 times.

4. After all slices finish, call:

```text
GET /api/jobs/finalize-weekly?runKey=weekly-run-YYYY-Www
```

The finalizer reads the Notion Job Opportunities database, prioritizes jobs by relevance/deadline, sends the job-search digest, and sends a separate weekly content-generation reminder.

The content reminder can also be triggered independently:

```text
GET /api/content/weekly-reminder?runKey=weekly-run-YYYY-Www
```

## Notification Streams

Job search notifications are priority-based:

- high relevance score
- deadline within `URGENT_DEADLINE_DAYS`
- exact target-role alignment
- duplicate appearance across sources

Content notifications are routine:

- one weekly reminder that job-market signals are ready for LinkedIn content generation/review

## Environment Variables

Required:

```text
NOTION_TOKEN
SERPAPI_KEY
CRON_SECRET
```

Recommended:

```text
NOTION_JOBS_DATABASE_ID
NOTION_RUNS_DATABASE_ID
APIFY_SOURCE_URL
WEEKLY_SEARCH_LOCATION
```

Telegram notifications:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

Email notifications through Resend:

```text
RESEND_API_KEY
NOTIFY_EMAIL_FROM
NOTIFY_EMAIL_TO
```

Optional outbound callback to NemoClaw:

```text
NEMOCLAW_WEBHOOK_URL
```

Tuning:

```text
HIGH_PRIORITY_JOB_SCORE=5
URGENT_DEADLINE_DAYS=5
NOTIFICATION_TOP_JOBS=10
NOTIFICATION_URGENT_JOBS=5
```

## Fallback

Vercel Cron should only be used as a temporary trigger for NemoClaw or another durable runner. Do not point cron at a full all-roles scrape; the system is intentionally slice-based.
