import { v4 as uuidv4 } from 'uuid'
import { Employee, Task, Category, CompletionLog, Website, Guidelines } from '../types'
import { format, subDays, parseISO } from 'date-fns'
import { getTasksDueOnDate, getTimeOfDay } from '../utils/taskScheduler'

// ─── Categories ────────────────────────────────────────────────────────────────
export const sampleCategories: Category[] = [
  { id: 'cat-social', name: 'Social Media', color: '#1A5C3A' },
  { id: 'cat-engagement', name: 'Engagement', color: '#1B4F8A' },
  { id: 'cat-content', name: 'Content', color: '#7A4A0A' },
  { id: 'cat-ads', name: 'Ads', color: '#7A2020' },
  { id: 'cat-reports', name: 'Reports', color: '#3A2A7A' },
  { id: 'cat-admin', name: 'Admin', color: '#6B6960' },
  { id: 'cat-gbusiness', name: 'Google Business', color: '#2A5C1E' },
  { id: 'cat-tripadvisor', name: 'TripAdvisor', color: '#7A4010' },
]

// ─── Employees ─────────────────────────────────────────────────────────────────
export const sampleEmployees: Employee[] = [
  {
    id: 'emp-1',
    email: 'ana@innoweb.com',
    password: 'employee123',
    name: 'Ana Ferreira',
    role: 'employee',
    avatarInitials: 'AF',
    joinDate: '2024-01-15',
    jobTitle: 'Social Media Manager',
    department: 'Marketing',
    managerId: 'admin-1',
  },
  {
    id: 'emp-2',
    email: 'carlos@innoweb.com',
    password: 'employee123',
    name: 'Carlos Mendes',
    role: 'employee',
    avatarInitials: 'CM',
    joinDate: '2024-02-01',
    jobTitle: 'Ads Manager',
    department: 'Marketing',
    managerId: 'admin-1',
  },
]

// ─── Tasks ─────────────────────────────────────────────────────────────────────
export const sampleTasks: Task[] = [
  // ── Daily engagement tasks (Mon-Fri, Ana) ──────────────────────────────────
  {
    id: 'task-eng-bessangana',
    title: 'Engagement — Bessangana',
    description: 'Respond to all IG, FB and TikTok comments, DMs and Messenger messages for Bessangana restaurant. Prioritise complaints and reservation requests.',
    assignedTo: ['emp-1'],
    frequency: { type: 'daily' },
    categoryId: 'cat-engagement',
    priority: 'high',
    estimatedMinutes: 30,
    createdAt: '2024-01-15T09:00:00Z',
    createdBy: 'admin-1',
    isActive: true,
  },
  {
    id: 'task-eng-espluanda',
    title: 'Engagement — Esp. Luanda',
    description: 'Respond to all IG, FB and TikTok comments, DMs and Messenger messages for Espaço Luanda. Prioritise complaints and reservation requests.',
    assignedTo: ['emp-1'],
    frequency: { type: 'daily' },
    categoryId: 'cat-engagement',
    priority: 'high',
    estimatedMinutes: 30,
    createdAt: '2024-01-15T09:00:00Z',
    createdBy: 'admin-1',
    isActive: true,
  },
  {
    id: 'task-eng-srtasca',
    title: 'Engagement — Sra. Tasca',
    description: 'Respond to all IG, FB and TikTok comments, DMs and Messenger messages for Sra. Tasca. Prioritise complaints and reservation requests.',
    assignedTo: ['emp-1'],
    frequency: { type: 'daily' },
    categoryId: 'cat-engagement',
    priority: 'high',
    estimatedMinutes: 30,
    createdAt: '2024-01-15T09:00:00Z',
    createdBy: 'admin-1',
    isActive: true,
  },
  {
    id: 'task-eng-okulya',
    title: 'Engagement — Okulya',
    description: 'Respond to all IG, FB and TikTok comments, DMs and Messenger messages for Okulya restaurant. Prioritise complaints and reservation requests.',
    assignedTo: ['emp-1'],
    frequency: { type: 'daily' },
    categoryId: 'cat-engagement',
    priority: 'high',
    estimatedMinutes: 30,
    createdAt: '2024-01-15T09:00:00Z',
    createdBy: 'admin-1',
    isActive: true,
  },
  {
    id: 'task-eng-dibamba',
    title: 'Engagement — Dibamba',
    description: 'Respond to all IG, FB and TikTok comments, DMs and Messenger messages for Dibamba. Prioritise complaints and reservation requests.',
    assignedTo: ['emp-1'],
    frequency: { type: 'daily' },
    categoryId: 'cat-engagement',
    priority: 'high',
    estimatedMinutes: 30,
    createdAt: '2024-01-15T09:00:00Z',
    createdBy: 'admin-1',
    isActive: true,
  },
  {
    id: 'task-eng-arena',
    title: 'Engagement — Arena Bessangana',
    description: 'Respond to all IG, FB and TikTok comments, DMs, Messenger and reservation requests for Arena Bessangana. Include event-related DMs.',
    assignedTo: ['emp-1'],
    frequency: { type: 'daily' },
    categoryId: 'cat-engagement',
    priority: 'high',
    estimatedMinutes: 30,
    createdAt: '2024-01-15T09:00:00Z',
    createdBy: 'admin-1',
    isActive: true,
  },
  {
    id: 'task-eng-dinamene',
    title: 'Engagement — Dinamene Boornois',
    description: 'Respond to all IG, FB and TikTok comments, DMs, Messenger and reservation requests for Dinamene Boornois. Include event-related DMs.',
    assignedTo: ['emp-1'],
    frequency: { type: 'daily' },
    categoryId: 'cat-engagement',
    priority: 'high',
    estimatedMinutes: 30,
    createdAt: '2024-01-15T09:00:00Z',
    createdBy: 'admin-1',
    isActive: true,
  },

  // ── Weekly Monday tasks (Ana) ──────────────────────────────────────────────
  {
    id: 'task-receive-content',
    title: 'Receive & review content material — all accounts',
    description: 'Review all photos and videos received from clients across all 7 accounts. Assess quality, give feedback if material is insufficient or does not meet standards before scheduling.',
    assignedTo: ['emp-1'],
    frequency: { type: 'weekly', days: [1] },
    categoryId: 'cat-content',
    priority: 'high',
    estimatedMinutes: 120,
    createdAt: '2024-01-15T09:00:00Z',
    createdBy: 'admin-1',
    isActive: true,
  },
  {
    id: 'task-schedule-content',
    title: 'Schedule weekly content — all accounts',
    description: 'Schedule all posts and stories on IG, FB and TikTok for the entire week across all 7 accounts. Ensure captions, hashtags and timing are correct.',
    assignedTo: ['emp-1'],
    frequency: { type: 'weekly', days: [1] },
    categoryId: 'cat-content',
    priority: 'high',
    estimatedMinutes: 180,
    createdAt: '2024-01-15T09:00:00Z',
    createdBy: 'admin-1',
    isActive: true,
  },

  // ── Weekly Tuesday tasks (Ana) ─────────────────────────────────────────────
  {
    id: 'task-google-business',
    title: 'Google Business updates — all 7 accounts',
    description: 'Add minimum 2 new photos, update dishes/prices if changed, publish a weekly post/promotion, verify that hours, address and contact info are correct for all 7 accounts.',
    assignedTo: ['emp-1'],
    frequency: { type: 'weekly', days: [2] },
    categoryId: 'cat-gbusiness',
    priority: 'medium',
    estimatedMinutes: 120,
    createdAt: '2024-01-15T09:00:00Z',
    createdBy: 'admin-1',
    isActive: true,
  },
  {
    id: 'task-tripadvisor',
    title: 'TripAdvisor updates — all 7 accounts',
    description: 'Respond to all new reviews (positive and negative), add new photos, check ranking position and flag any issues for all 7 accounts.',
    assignedTo: ['emp-1'],
    frequency: { type: 'weekly', days: [2] },
    categoryId: 'cat-tripadvisor',
    priority: 'medium',
    estimatedMinutes: 90,
    createdAt: '2024-01-15T09:00:00Z',
    createdBy: 'admin-1',
    isActive: true,
  },
  {
    id: 'task-linkedin',
    title: 'LinkedIn — publish when relevant',
    description: 'Check for relevant news, events or milestones. Write and publish an institutional post if applicable. Engage with relevant industry content.',
    assignedTo: ['emp-1'],
    frequency: { type: 'weekly', days: [2] },
    categoryId: 'cat-social',
    priority: 'low',
    estimatedMinutes: 60,
    createdAt: '2024-01-15T09:00:00Z',
    createdBy: 'admin-1',
    isActive: true,
  },

  // ── Weekly Wednesday tasks (Carlos) ───────────────────────────────────────
  {
    id: 'task-meta-ads',
    title: 'Monitor & optimise Meta Ads — all accounts',
    description: 'Review CTR, cost per result and ROAS across all accounts. Adjust budgets as needed, pause underperforming ad sets, test new audiences or creatives if needed.',
    assignedTo: ['emp-2'],
    frequency: { type: 'weekly', days: [3] },
    categoryId: 'cat-ads',
    priority: 'high',
    estimatedMinutes: 150,
    createdAt: '2024-02-01T09:00:00Z',
    createdBy: 'admin-1',
    isActive: true,
  },
  {
    id: 'task-tiktok-ads',
    title: 'Monitor & optimise TikTok Ads — all accounts',
    description: 'Review performance metrics on TikTok Ads for all accounts. Adjust budgets, pause underperforming ads, update creatives or copy if needed.',
    assignedTo: ['emp-2'],
    frequency: { type: 'weekly', days: [3] },
    categoryId: 'cat-ads',
    priority: 'high',
    estimatedMinutes: 60,
    createdAt: '2024-02-01T09:00:00Z',
    createdBy: 'admin-1',
    isActive: true,
  },

  // ── Weekly Thursday tasks (Ana) ────────────────────────────────────────────
  {
    id: 'task-organise-material',
    title: 'Organise received material — all accounts',
    description: 'Sort all received photos and videos by account and content category. Create backup on designated folder. Label files for easy retrieval.',
    assignedTo: ['emp-1'],
    frequency: { type: 'weekly', days: [4] },
    categoryId: 'cat-admin',
    priority: 'medium',
    estimatedMinutes: 120,
    createdAt: '2024-01-15T09:00:00Z',
    createdBy: 'admin-1',
    isActive: true,
  },

  // ── Weekly Friday tasks (Ana) ──────────────────────────────────────────────
  {
    id: 'task-client-followup',
    title: 'Client follow-up — request next week material',
    description: 'Contact all 7 clients to request photos, videos and any planned events for the coming week. Follow up with any who have not yet sent material.',
    assignedTo: ['emp-1'],
    frequency: { type: 'weekly', days: [5] },
    categoryId: 'cat-admin',
    priority: 'high',
    estimatedMinutes: 90,
    createdAt: '2024-01-15T09:00:00Z',
    createdBy: 'admin-1',
    isActive: true,
  },
  {
    id: 'task-confirm-events',
    title: 'Confirm events — Bessangana, Esp. Luanda, Sra. Tasca, Dibamba, Arena Bessangana',
    description: 'Confirm any upcoming events with the 5 event-capable accounts. If event confirmed: prepare promo posts, set up dedicated Meta Ads and manage event DMs.',
    assignedTo: ['emp-1'],
    frequency: { type: 'weekly', days: [5] },
    categoryId: 'cat-admin',
    priority: 'medium',
    estimatedMinutes: 60,
    createdAt: '2024-01-15T09:00:00Z',
    createdBy: 'admin-1',
    isActive: true,
  },

  // ── Monthly Week 1 Thursday (Carlos) ──────────────────────────────────────
  {
    id: 'task-create-ad-campaigns',
    title: 'Create monthly ad campaigns — all accounts',
    description: 'Set up Meta Ads and TikTok Ads campaigns for the month. Define campaign objective, budget, target audience and schedule for all accounts.',
    assignedTo: ['emp-2'],
    frequency: { type: 'monthly', weekOfMonth: 1, dayOfWeek: 4 },
    categoryId: 'cat-ads',
    priority: 'high',
    estimatedMinutes: 180,
    createdAt: '2024-02-01T09:00:00Z',
    createdBy: 'admin-1',
    isActive: true,
  },
  {
    id: 'task-create-ad-creatives',
    title: 'Create ad creatives — all accounts',
    description: 'Design image/video creatives and write copy with CTA for each account\'s ad campaigns. Ensure brand consistency and A/B test where possible.',
    assignedTo: ['emp-2'],
    frequency: { type: 'monthly', weekOfMonth: 1, dayOfWeek: 4 },
    categoryId: 'cat-ads',
    priority: 'high',
    estimatedMinutes: 180,
    createdAt: '2024-02-01T09:00:00Z',
    createdBy: 'admin-1',
    isActive: true,
  },

  // ── Monthly Week 4 Friday (Ana + Carlos) ──────────────────────────────────
  {
    id: 'task-monthly-report',
    title: 'Monthly report — compile data all accounts',
    description: 'Compile followers growth, reach, engagement, ads performance (spend + ROAS), reviews summary and strategic recommendations for all 7 accounts.',
    assignedTo: ['emp-1', 'emp-2'],
    frequency: { type: 'monthly', weekOfMonth: 4, dayOfWeek: 5 },
    categoryId: 'cat-reports',
    priority: 'high',
    estimatedMinutes: 180,
    createdAt: '2024-01-15T09:00:00Z',
    createdBy: 'admin-1',
    isActive: true,
  },
  {
    id: 'task-strategic-planning',
    title: 'Strategic planning — next month',
    description: 'Set objectives, define content themes, plan ad campaigns and confirm upcoming events with clients for the following month.',
    assignedTo: ['emp-1', 'emp-2'],
    frequency: { type: 'monthly', weekOfMonth: 4, dayOfWeek: 5 },
    categoryId: 'cat-reports',
    priority: 'high',
    estimatedMinutes: 120,
    createdAt: '2024-01-15T09:00:00Z',
    createdBy: 'admin-1',
    isActive: true,
  },
]

// ─── Websites ──────────────────────────────────────────────────────────────────
export const sampleWebsites: Website[] = [
  // Ana's websites
  {
    id: 'web-metabusiness',
    name: 'Meta Business Suite',
    url: 'https://business.facebook.com',
    description: 'Manage all Facebook and Instagram business pages, posts and insights.',
    assignedTo: ['emp-1'],
  },
  {
    id: 'web-tiktokstudio',
    name: 'TikTok Studio',
    url: 'https://studio.tiktok.com',
    description: 'Create, schedule and analyse TikTok content for all accounts.',
    assignedTo: ['emp-1'],
  },
  {
    id: 'web-googlebusiness',
    name: 'Google Business Profile',
    url: 'https://business.google.com',
    description: 'Manage Google Business Profiles, photos, posts and reviews.',
    assignedTo: ['emp-1'],
  },
  {
    id: 'web-tripadvisor',
    name: 'TripAdvisor Management',
    url: 'https://www.tripadvisor.com/owners',
    description: 'Manage TripAdvisor listings, respond to reviews and update photos.',
    assignedTo: ['emp-1'],
  },
  {
    id: 'web-linkedin',
    name: 'LinkedIn Pages',
    url: 'https://www.linkedin.com/company',
    description: 'Manage LinkedIn company pages and publish institutional content.',
    assignedTo: ['emp-1'],
  },
  {
    id: 'web-canva-ana',
    name: 'Canva',
    url: 'https://www.canva.com',
    description: 'Design social media graphics, stories and marketing materials.',
    assignedTo: ['emp-1', 'emp-2'],
  },
  {
    id: 'web-later',
    name: 'Later',
    url: 'https://app.later.com',
    description: 'Schedule and plan social media content across all platforms.',
    assignedTo: ['emp-1'],
  },
  // Carlos's websites
  {
    id: 'web-metaads',
    name: 'Meta Ads Manager',
    url: 'https://adsmanager.facebook.com',
    description: 'Create, manage and optimise Facebook and Instagram ad campaigns.',
    assignedTo: ['emp-2'],
  },
  {
    id: 'web-tiktokads',
    name: 'TikTok Ads',
    url: 'https://ads.tiktok.com',
    description: 'Create and manage TikTok advertising campaigns and track performance.',
    assignedTo: ['emp-2'],
  },
  {
    id: 'web-analytics',
    name: 'Google Analytics',
    url: 'https://analytics.google.com',
    description: 'Track website traffic, conversions and audience behaviour.',
    assignedTo: ['emp-2'],
  },
]

// ─── Guidelines ────────────────────────────────────────────────────────────────
export const anaGuidelines: Guidelines = {
  employeeId: 'emp-1',
  content: `
<h1>Ana Ferreira — Work Guidelines</h1>
<p>This document outlines the standard operating procedures and guidelines for managing all 7 InnoWeb restaurant accounts.</p>

<h2>1. Daily Engagement Rules</h2>
<ul>
  <li>Respond to <strong>all comments and DMs within the same working day</strong> — no comment should go unanswered overnight.</li>
  <li>Always respond in a <strong>professional, warm and friendly tone</strong> that reflects each restaurant's brand voice.</li>
  <li>For complaints or negative comments: acknowledge the issue, apologise sincerely, offer a solution or invite them to contact directly. Never argue publicly.</li>
  <li><strong>Escalate to manager</strong> any: legal threats, food safety complaints, press enquiries, or reviews mentioning illness.</li>
  <li>For reservation requests received via DM: always confirm the date, time and party size, then redirect to the restaurant's booking system or phone number.</li>
  <li>Priority order for daily engagement: 1) Reservation/event DMs, 2) Complaints, 3) General comments, 4) Likes and emoji replies.</li>
</ul>

<h2>2. Content Scheduling Process</h2>
<ul>
  <li>Every Monday: receive material from all clients, review quality before scheduling.</li>
  <li>If material is insufficient or quality is below standard: <strong>contact the client immediately</strong> on Monday and do not schedule substandard content.</li>
  <li>Schedule posts for the full week (Mon–Sun) by end of Monday. Stories can be scheduled daily if preferred.</li>
  <li>Always preview scheduled content to check for formatting, caption errors or missing tags before publishing.</li>
  <li>Confirm upcoming events with clients every Friday — if an event is confirmed, prepare promo content immediately.</li>
</ul>

<h2>3. Event Accounts — ★ Special Procedures</h2>
<p>The following accounts host <strong>occasional events</strong> (concerts, themed nights, special dinners):</p>
<ul>
  <li>★ Bessangana</li>
  <li>★ Espaço Luanda</li>
  <li>★ Sra. Tasca</li>
  <li>★ Dibamba</li>
  <li>★ Arena Bessangana</li>
</ul>
<p><strong>When an event is confirmed, do the following:</strong></p>
<ol>
  <li>Create dedicated promo posts (feed + stories) for IG, FB and TikTok.</li>
  <li>Notify Carlos to set up a dedicated Meta Ads campaign for the event.</li>
  <li>Manage all event-related DMs (reservations, table bookings, questions).</li>
  <li>Update Google Business Profile with event information and photo.</li>
  <li>Post event reminder the day before and a "sold out" or "thank you" post after.</li>
</ol>

<h2>4. Google Business Weekly Checklist</h2>
<p>Every Tuesday, for all 7 accounts:</p>
<ul>
  <li>✓ Add <strong>minimum 2 new photos</strong> (food, atmosphere or team).</li>
  <li>✓ Update dishes/prices if any changes were communicated by the client.</li>
  <li>✓ Publish a weekly post or promotion (specials, events, new menu items).</li>
  <li>✓ Verify that <strong>opening hours, address and contact number</strong> are all correct.</li>
  <li>✓ Check and respond to any new reviews via TripAdvisor procedures below.</li>
</ul>

<h2>5. TripAdvisor Response Guidelines</h2>
<p>Respond to <strong>ALL reviews</strong> — positive and negative — within 48 hours.</p>
<ul>
  <li><strong>Positive reviews:</strong> Thank the reviewer warmly, mention a specific dish or experience they referenced, invite them back. Keep it personal, not generic.</li>
  <li><strong>Negative reviews:</strong> Apologise sincerely, acknowledge their experience, offer a direct resolution or invite them to contact the restaurant privately. Never be defensive.</li>
  <li>Always write in the same language as the reviewer.</li>
  <li>Avoid copy-pasting the same response — personalise each reply.</li>
  <li>If a review describes a health/safety issue, escalate to manager before responding.</li>
</ul>

<h2>6. Monthly Report Structure</h2>
<p>Produced in Week 4, every month, together with Carlos:</p>
<ol>
  <li><strong>Followers growth</strong> per platform (IG, FB, TikTok, LinkedIn) — vs. previous month.</li>
  <li><strong>Reach and engagement</strong> — total impressions, engagement rate, saves, shares.</li>
  <li><strong>Top 5 posts of the month</strong> — ranked by reach or engagement.</li>
  <li><strong>Ads performance</strong> (Carlos section) — total spend, CPC, CPR, ROAS per account.</li>
  <li><strong>Reviews summary</strong> — new reviews count, average rating, notable quotes.</li>
  <li><strong>Strategic recommendations</strong> — what worked, what to improve, themes for next month.</li>
</ol>
`,
  updatedAt: new Date().toISOString(),
  updatedBy: 'admin-1',
}

// ─── Historical Completion Data Generator ─────────────────────────────────────
export function generateHistoricalData(tasks: Task[]): CompletionLog[] {
  const logs: CompletionLog[] = []
  const today = new Date()

  // For each of the past 30 days
  for (let daysAgo = 30; daysAgo >= 1; daysAgo--) {
    const date = subDays(today, daysAgo)
    const dateStr = format(date, 'yyyy-MM-dd')
    const dayOfWeek = date.getDay()

    // Skip weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) continue

    // Ana: 85-95% completion rate
    const anaTasks = getTasksDueOnDate(tasks, 'emp-1', date)
    const anaCompletionRate = 0.85 + Math.random() * 0.10
    // Make some days slightly worse
    const anaEffectiveRate = daysAgo % 7 === 3 ? 0.65 : anaCompletionRate

    for (const task of anaTasks) {
      if (Math.random() < anaEffectiveRate) {
        // Generate a realistic completion time between 09:00 and 17:00
        let hour: number
        let minute: number
        const timeRand = Math.random()
        if (timeRand < 0.15) {
          // Early: 09:00–11:00
          hour = 9 + Math.floor(Math.random() * 2)
          minute = Math.floor(Math.random() * 60)
        } else if (timeRand < 0.55) {
          // Mid-morning to noon: 11:00–13:00
          hour = 11 + Math.floor(Math.random() * 2)
          minute = Math.floor(Math.random() * 60)
        } else if (timeRand < 0.85) {
          // Afternoon: 13:00–16:00
          hour = 13 + Math.floor(Math.random() * 3)
          minute = Math.floor(Math.random() * 60)
        } else {
          // End of day: 16:00–17:00
          hour = 16
          minute = Math.floor(Math.random() * 60)
        }

        const completedAt = new Date(date)
        completedAt.setHours(hour, minute, Math.floor(Math.random() * 60), 0)

        const wasLate = hour >= 16
        const timeOfDay = getTimeOfDay(completedAt.toISOString())

        logs.push({
          id: uuidv4(),
          taskId: task.id,
          employeeId: 'emp-1',
          completedAt: completedAt.toISOString(),
          dueDate: dateStr,
          wasLate,
          timeOfDay,
        })
      }
    }

    // Carlos: 75-90% completion rate
    const carlosTasks = getTasksDueOnDate(tasks, 'emp-2', date)
    const carlosCompletionRate = 0.75 + Math.random() * 0.15
    const carlosEffectiveRate = daysAgo % 9 === 4 ? 0.50 : carlosCompletionRate

    for (const task of carlosTasks) {
      if (Math.random() < carlosEffectiveRate) {
        let hour: number
        let minute: number
        const timeRand = Math.random()
        if (timeRand < 0.10) {
          hour = 9 + Math.floor(Math.random() * 2)
          minute = Math.floor(Math.random() * 60)
        } else if (timeRand < 0.40) {
          hour = 11 + Math.floor(Math.random() * 2)
          minute = Math.floor(Math.random() * 60)
        } else if (timeRand < 0.80) {
          hour = 13 + Math.floor(Math.random() * 3)
          minute = Math.floor(Math.random() * 60)
        } else {
          hour = 16
          minute = Math.floor(Math.random() * 60)
        }

        const completedAt = new Date(date)
        completedAt.setHours(hour, minute, Math.floor(Math.random() * 60), 0)

        const wasLate = hour >= 16
        const timeOfDay = getTimeOfDay(completedAt.toISOString())

        logs.push({
          id: uuidv4(),
          taskId: task.id,
          employeeId: 'emp-2',
          completedAt: completedAt.toISOString(),
          dueDate: dateStr,
          wasLate,
          timeOfDay,
        })
      }
    }
  }

  return logs
}

// Admin user (not in employees store)
export const adminUser = {
  id: 'admin-1',
  email: 'admin@flowdesk.com',
  password: 'admin123',
  name: 'InnoWeb Admin',
  role: 'admin' as const,
  avatarInitials: 'IA',
  joinDate: '2024-01-01',
}
