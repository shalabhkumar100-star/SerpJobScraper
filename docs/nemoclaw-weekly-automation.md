# NemoClaw Weekly Automation

Vercel Cron is the temporary production scheduler. NemoClaw-facing endpoints remain in place so the orchestration can move to a NemoClaw/OpenClaw runtime later without changing the scraping primitives.

## Production Cron Flow

Vercel Cron calls the cron-safe runner every Monday at 08:00 UTC:

```text
GET /api/nemoclaw/weekly-run?source=both
```

That route:

1. builds the same slice plan exposed by `/api/nemoclaw/weekly-plan`
2. executes each slice through the shared slice runner
3. retries failed slices up to 2 times by default
4. finalizes the weekly digest
5. sends the job-search notifications and weekly content reminder

The runner supports safe validation without writes to sources beyond route execution:

```text
GET /api/nemoclaw/weekly-run?source=both&dryRun=1
```

For a bounded live smoke test, limit execution to one or a few slices and suppress notifications:

```text
GET /api/nemoclaw/weekly-run?source=serp&maxSlices=1&send=0&runKey=smoke-test
```

## NemoClaw-Compatible Manual Flow

A future NemoClaw runtime can still orchestrate the same sequence directly.

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
WEEKLY_SLICE_RETRIES=2
WEEKLY_MAX_SLICES=0
WEEKLY_FINALIZE_JOB_LIMIT=100
```

## Fallback

The legacy `/api/weekly-job-run` endpoint remains in the repository for manual fallback, but Vercel Cron no longer calls it.
